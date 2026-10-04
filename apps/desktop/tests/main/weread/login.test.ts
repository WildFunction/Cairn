import { expect, test } from 'bun:test';
import {
  cookieHeader, createWereadLogin, readLoginInfo, withCookies,
} from '../../../src/main/weread/login';

test('cookies merge from every Set-Cookie line, including ones whose Expires holds a comma', () => {
  const headers = new Headers();
  headers.append('set-cookie', 'wr_gid=1; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Path=/');
  headers.append('set-cookie', 'wr_fp=9; Path=/');
  const jar = withCookies({ wr_fp: '1', other: 'x' }, headers);
  expect(jar).toEqual({ wr_fp: '9', other: 'x', wr_gid: '1' });
  expect(cookieHeader(jar)).toBe('wr_fp=9; other=x; wr_gid=1');
});

test('the comma fallback for runtimes without getSetCookie keeps both cookies', () => {
  const headers = { get: () => 'a=1; Expires=Wed, 01 Jan 2031 00:00:00 GMT, b=2; Path=/' } as unknown as Headers;
  expect(withCookies({}, headers)).toEqual({ a: '1', b: '2' });
});

test('login replies read into steps', () => {
  expect(readLoginInfo({})).toEqual({ kind: 'step', step: { state: 'waiting' } });
  expect(readLoginInfo({ logicCode: 'NEED_OTP' })).toEqual({ kind: 'step', step: { state: 'otp', wrong: false } });
  expect(readLoginInfo({ logicCode: 'OTP_NOT_MATCH' })).toEqual({ kind: 'step', step: { state: 'otp', wrong: true } });
  expect(readLoginInfo({ logicCode: 'LOGIN_TIMEOUT' })).toEqual({ kind: 'step', step: { state: 'failed', reason: 'expired' } });
  expect(readLoginInfo({ logicCode: 'SOMETHING_NEW' })).toEqual({ kind: 'step', step: { state: 'failed', reason: 'rejected' } });
  // Signed in but missing the token is not a sign-in
  expect(readLoginInfo({ succeed: true, webLoginVid: 7 })).toEqual({ kind: 'step', step: { state: 'failed', reason: 'rejected' } });
  expect(readLoginInfo({ succeed: true, webLoginVid: 7, accessToken: 't', refreshToken: 'r' }))
    .toEqual({ kind: 'signed_in', credentials: { vid: '7', accessToken: 't', refreshToken: 'r' } });
});

/** The website's login, answering by path; `login` is what getLoginInfo says next. */
function fakeSite(script: { login: unknown[]; apikey?: string; created?: string; unauthorizedOnce?: boolean }) {
  const seen: { url: string; headers: Headers }[] = [];
  let unauthorized = script.unauthorizedOnce ?? false;
  const json = (body: unknown, init: ResponseInit = {}): Response =>
    new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json', ...init.headers } });
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, headers: new Headers(init?.headers) });
    if (url.endsWith('/r/weread-skills')) return new Response('<html>', { headers: { 'set-cookie': 'wr_gid=g; Path=/' } });
    if (url.includes('/api/auth/getLoginUid')) return json({ uid: 'u-1' });
    if (url.includes('/api/auth/getLoginInfo')) return json(script.login.shift() ?? {});
    if (url.includes('/api/userInfo')) {
      if (unauthorized) { unauthorized = false; return json({}, { status: 401 }); }
      return json({ name: '读者' });
    }
    if (url.includes('/api/skills/apikeyGet')) {
      return json({ apikey: url.includes('only_show=1') ? script.apikey ?? '' : script.created ?? '' });
    }
    return json({}, { status: 404 });
  }) as typeof fetch;
  return { fetcher, seen };
}

test('a scan, a code and a key: the key and the name are saved, the session is not', async () => {
  const site = fakeSite({
    login: [{ logicCode: 'NEED_OTP' }, { succeed: true, webLoginVid: 42, accessToken: 'tok', refreshToken: 'r/t' }],
    apikey: 'wrk-abc',
    unauthorizedOnce: true,
  });
  const saved: [string, string][] = [];
  const login = createWereadLogin({
    fetcher: site.fetcher, fingerprint: () => '123',
    save: async (key, account) => { saved.push([key, account]); },
  });

  const { id, url } = await login.start();
  expect(url).toBe('https://weread.qq.com/web/confirm?uid=u-1');
  expect(await login.poll(id)).toEqual({ state: 'otp', wrong: false });
  expect(await login.poll(id, '1234')).toEqual({ state: 'done', account: '读者' });
  expect(saved).toEqual([['wrk-abc', '读者']]);

  const uidCall = site.seen.find((s) => s.url.includes('getLoginUid'));
  expect(uidCall?.headers.get('cookie')).toBe('wr_fp=123; wr_gid=g');
  expect(site.seen.find((s) => s.url.includes('otp=1234'))).toBeDefined();
  // An existing key is read, never re-created
  expect(site.seen.filter((s) => s.url.includes('apikeyGet')).map((s) => s.url))
    .toEqual(['https://weread.qq.com/api/skills/apikeyGet?only_show=1']);
  const keyCall = site.seen.find((s) => s.url.includes('apikeyGet'));
  expect(keyCall?.headers.get('x-vid')).toBe('42');
  expect(keyCall?.headers.get('x-skey')).toBe('tok');
  expect(keyCall?.headers.get('cookie')).toContain('wr_rt=r%2Ft');
  // Spent: the session cannot be polled again
  expect(await login.poll(id)).toEqual({ state: 'failed', reason: 'expired' });
});

test('an account with no key yet gets one created', async () => {
  const site = fakeSite({ login: [{ succeed: true, webLoginVid: 1, accessToken: 't' }], created: 'wrk-new' });
  const saved: string[] = [];
  const login = createWereadLogin({ fetcher: site.fetcher, save: async (key) => { saved.push(key); } });
  const { id } = await login.start();
  expect(await login.poll(id)).toEqual({ state: 'done', account: '读者' });
  expect(saved).toEqual(['wrk-new']);
});

test('when the site will neither show nor create a key, nothing is saved', async () => {
  const site = fakeSite({ login: [{ succeed: true, webLoginVid: 1, accessToken: 't' }] });
  let saves = 0;
  const login = createWereadLogin({ fetcher: site.fetcher, save: async () => { saves++; } });
  const { id } = await login.start();
  expect(await login.poll(id)).toEqual({ state: 'failed', reason: 'no_skill' });
  expect(saves).toBe(0);
});

test('a long poll that times out is still waiting; a code past five minutes has expired', async () => {
  let clock = 0;
  const timeout = (async (input: string | URL | Request) => {
    if (String(input).includes('getLoginInfo')) throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    return site.fetcher(input);
  }) as typeof fetch;
  const site = fakeSite({ login: [] });
  const login = createWereadLogin({ fetcher: timeout, now: () => clock, save: async () => {} });
  const { id } = await login.start();
  expect(await login.poll(id)).toEqual({ state: 'waiting' });
  clock = 5 * 60_000 + 1;
  expect(await login.poll(id)).toEqual({ state: 'failed', reason: 'expired' });
});

test('starting again, or cancelling, retires the old code', async () => {
  const site = fakeSite({ login: [{ succeed: true, webLoginVid: 1, accessToken: 't' }], apikey: 'k' });
  const login = createWereadLogin({ fetcher: site.fetcher, save: async () => {} });
  const first = await login.start();
  login.cancel(first.id);
  expect(await login.poll(first.id)).toEqual({ state: 'failed', reason: 'expired' });
});
