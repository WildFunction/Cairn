/**
 * Signing in to WeChat Reading by QR code, to fetch the account's API key.
 *
 * This is the website's own login, not part of the official skill: the key is
 * all Cairn keeps. The web session it passes through — cookies, access and
 * refresh tokens — lives in memory for the length of one login and is dropped,
 * because nothing else here may read the website on the reader's behalf.
 */
import { CairnError } from '@cairn/core/errors';
import type { LoginFailure, LoginStep } from '../../shared/weread-login';

const SITE = 'https://weread.qq.com';
const SKILLS_PAGE = `${SITE}/r/weread-skills`;
/** The site answers a client it does not recognise as a browser with a login page. */
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';
/** `getLoginInfo` holds the request open until the phone acts; a timeout just means "not yet". */
const POLL_MS = 25_000;
const REQUEST_MS = 15_000;
const SESSION_MS = 5 * 60_000;
const RETRIES = 3;
const RETRY_MS = 500;

export type { LoginFailure, LoginStep };

export interface WereadLogin {
  /** A fresh code, cancelling any login still open. `url` is what the QR code encodes. */
  start(): Promise<{ readonly id: string; readonly url: string }>;
  /** Waits up to ~25 s for the phone. `otp` is the four digits the phone showed, when it asked. */
  poll(id: string, otp?: string): Promise<LoginStep>;
  cancel(id: string): void;
}

export type CookieJar = Readonly<Record<string, string>>;

/** `getSetCookie` where the runtime has it; a comma split that spares `Expires=Wed, 01 …` where not. */
function setCookieLines(headers: Headers): readonly string[] {
  const all = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
  if (all) return all;
  const joined = headers.get('set-cookie');
  return joined ? joined.split(/,(?=\s*[^;,=\s]+=)/) : [];
}

export function withCookies(jar: CookieJar, headers: Headers): CookieJar {
  const next: Record<string, string> = { ...jar };
  for (const line of setCookieLines(headers)) {
    const pair = line.split(';')[0] ?? '';
    const at = pair.indexOf('=');
    if (at <= 0) continue;
    next[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
  }
  return next;
}

export function cookieHeader(jar: CookieJar): string {
  return Object.entries(jar).map(([name, value]) => `${name}=${value}`).join('; ');
}

export interface Credentials {
  readonly vid: string;
  readonly accessToken: string;
  readonly refreshToken?: string;
}

type Reply = { readonly kind: 'step'; readonly step: LoginStep } | { readonly kind: 'signed_in'; readonly credentials: Credentials };

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const asText = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';

export function readLoginInfo(raw: unknown): Reply {
  const body = asRecord(raw);
  if (body.succeed === true) {
    const vid = asText(body.webLoginVid);
    const accessToken = asText(body.accessToken);
    const refreshToken = asText(body.refreshToken);
    if (!vid || !accessToken) return { kind: 'step', step: { state: 'failed', reason: 'rejected' } };
    return { kind: 'signed_in', credentials: { vid, accessToken, ...(refreshToken ? { refreshToken } : {}) } };
  }
  switch (asText(body.logicCode)) {
    case '': return { kind: 'step', step: { state: 'waiting' } };
    case 'NEED_OTP': return { kind: 'step', step: { state: 'otp', wrong: false } };
    case 'OTP_NOT_MATCH': return { kind: 'step', step: { state: 'otp', wrong: true } };
    case 'LOGIN_TIMEOUT': return { kind: 'step', step: { state: 'failed', reason: 'expired' } };
    case 'OTP_EXPIRED': return { kind: 'step', step: { state: 'failed', reason: 'otp_expired' } };
    default: return { kind: 'step', step: { state: 'failed', reason: 'rejected' } };
  }
}

interface Session {
  readonly uid: string;
  readonly jar: CookieJar;
  readonly startedAt: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const isTimeout = (cause: unknown): boolean =>
  cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');

export function createWereadLogin({
  save, fetcher = fetch, now = Date.now, fingerprint = randomFingerprint,
}: {
  /** Stores the key and the account's display name. */
  readonly save: (key: string, account: string) => Promise<void>;
  readonly fetcher?: typeof fetch;
  readonly now?: () => number;
  readonly fingerprint?: () => string;
}): WereadLogin {
  let open: Session | undefined;

  const get = async (url: string, jar: CookieJar, ms: number, extra: Record<string, string> = {}) => {
    const response = await fetcher(url, {
      headers: {
        'user-agent': USER_AGENT,
        accept: 'application/json, text/plain, */*',
        referer: SKILLS_PAGE,
        cookie: cookieHeader(jar),
        ...extra,
      },
      signal: AbortSignal.timeout(ms),
    });
    return { response, jar: withCookies(jar, response.headers) };
  };

  const json = async (response: Response, what: string): Promise<Record<string, unknown>> => {
    if (!response.ok) throw new CairnError('weread_failed', { status: response.status }, what);
    return asRecord(await response.json());
  };

  /** The site briefly answers 401 to a token it has only just issued. */
  const signedGet = async (url: string, jar: CookieJar, credentials: Credentials) => {
    for (let attempt = 1; ; attempt++) {
      const { response, jar: next } = await get(url, jar, REQUEST_MS, {
        'x-vid': credentials.vid, 'x-skey': credentials.accessToken,
      });
      if (response.status !== 401 || attempt === RETRIES) return { body: await json(response, url), jar: next };
      await sleep(RETRY_MS);
    }
  };

  const finish = async (session: Session, credentials: Credentials): Promise<LoginStep> => {
    let jar: CookieJar = {
      ...session.jar,
      wr_vid: credentials.vid,
      wr_skey: credentials.accessToken,
      wr_ql: '0',
      ...(credentials.refreshToken ? { wr_rt: encodeURIComponent(credentials.refreshToken) } : {}),
    };
    const user = await signedGet(`${SITE}/api/userInfo?userVid=${encodeURIComponent(credentials.vid)}`, jar, credentials);
    jar = user.jar;
    // Asks for the existing key first, so another tool already using it is not
    // cut off; only an account without one gets a key created for it.
    let key = '';
    for (const query of ['?only_show=1', '']) {
      for (let attempt = 1; attempt <= RETRIES && !key; attempt++) {
        if (attempt > 1) await sleep(RETRY_MS);
        const reply = await signedGet(`${SITE}/api/skills/apikeyGet${query}`, jar, credentials);
        jar = reply.jar;
        key = asText(reply.body.apikey).trim();
      }
    }
    if (open !== session) return { state: 'failed', reason: 'expired' };
    open = undefined;
    if (!key) return { state: 'failed', reason: 'no_skill' };
    const account = asText(user.body.name).trim();
    await save(key, account);
    return { state: 'done', account };
  };

  return {
    async start() {
      open = undefined;
      const seed: CookieJar = { wr_fp: fingerprint() };
      const page = await fetcher(SKILLS_PAGE, {
        headers: { 'user-agent': USER_AGENT, referer: `${SITE}/`, cookie: cookieHeader(seed) },
        signal: AbortSignal.timeout(REQUEST_MS),
      });
      if (!page.ok) throw new CairnError('weread_failed', { status: page.status }, 'login page');
      const { response, jar } = await get(`${SITE}/api/auth/getLoginUid`, withCookies(seed, page.headers), REQUEST_MS);
      const uid = asText((await json(response, 'getLoginUid')).uid);
      if (!uid) throw new CairnError('weread_failed', {}, 'getLoginUid returned no uid');
      open = { uid, jar, startedAt: now() };
      return { id: uid, url: `${SITE}/web/confirm?uid=${encodeURIComponent(uid)}` };
    },

    async poll(id, otp = '') {
      const session = open;
      if (!session || session.uid !== id) return { state: 'failed', reason: 'expired' };
      if (now() - session.startedAt > SESSION_MS) {
        open = undefined;
        return { state: 'failed', reason: 'expired' };
      }
      try {
        const url = `${SITE}/api/auth/getLoginInfo?uid=${encodeURIComponent(id)}&otp=${encodeURIComponent(otp)}`;
        const { response, jar } = await get(url, session.jar, POLL_MS);
        const reply = readLoginInfo(await json(response, 'getLoginInfo'));
        if (open !== session) return { state: 'failed', reason: 'expired' };
        const current: Session = { ...session, jar };
        open = current;
        if (reply.kind === 'signed_in') return await finish(current, reply.credentials);
        if (reply.step.state === 'failed') open = undefined;
        return reply.step;
      } catch (cause) {
        if (isTimeout(cause)) return { state: 'waiting' };
        console.error('weread login', cause instanceof Error ? cause.message : cause);
        if (open === session) open = undefined;
        return { state: 'failed', reason: 'network' };
      }
    },

    cancel(id) {
      if (open?.uid === id) open = undefined;
    },
  };
}

/** The site's own value is an unsigned 32-bit browser fingerprint; a random one per login is enough. */
function randomFingerprint(): string {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] ?? 0);
}
