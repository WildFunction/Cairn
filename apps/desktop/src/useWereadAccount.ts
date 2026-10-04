import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WereadAccount, WereadAccountState } from '@cairn/ui';
import {
  wereadLoginCancel, wereadLoginPoll, wereadLoginStart, wereadSignOut, wereadStatus,
} from './bridge';
import type { LoginStep } from './shared/weread-login';

/**
 * The QR sign-in, driven from the webview: each poll is one long request, and
 * the loop runs until the phone answers, the code expires, or the reader leaves.
 * `attempt` retires a loop the moment a newer one, a cancel or an unmount supersedes it.
 */
export function useWereadAccount(onChanged: () => void): WereadAccount {
  const [state, setState] = useState<WereadAccountState>({ step: 'loading' });
  const attempt = useRef(0);
  const loginId = useRef<string | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void wereadStatus().then((status) => {
      if (!live) return;
      setState(status.connected
        ? { step: 'in', ...(status.account ? { account: status.account } : {}) }
        : { step: 'out' });
    });
    return () => {
      live = false;
      attempt.current++;
      if (loginId.current) void wereadLoginCancel(loginId.current);
    };
  }, []);

  const follow = useCallback(async (run: number, id: string, otp?: string): Promise<void> => {
    let code = otp;
    while (run === attempt.current) {
      const step: LoginStep = await wereadLoginPoll(id, code)
        .catch((): LoginStep => ({ state: 'failed', reason: 'network' }));
      code = undefined;
      if (run !== attempt.current) return;
      if (step.state === 'waiting') continue;
      loginId.current = step.state === 'otp' ? id : undefined;
      if (step.state === 'otp') setState({ step: 'otp', wrong: step.wrong, busy: false });
      if (step.state === 'failed') setState({ step: 'out', failed: step.reason });
      if (step.state === 'done') {
        setState({ step: 'in', ...(step.account ? { account: step.account } : {}) });
        onChanged();
      }
      return;
    }
  }, [onChanged]);

  const signIn = useCallback(() => {
    const run = ++attempt.current;
    setState({ step: 'starting' });
    void wereadLoginStart()
      .then(({ id, url }) => {
        if (run !== attempt.current) return void wereadLoginCancel(id);
        loginId.current = id;
        setState({ step: 'qr', url });
        return follow(run, id);
      })
      .catch((cause: unknown) => {
        console.error('weread sign-in', cause);
        if (run === attempt.current) setState({ step: 'out', failed: 'network' });
      });
  }, [follow]);

  const submitOtp = useCallback((code: string) => {
    const id = loginId.current;
    if (!id) return;
    setState({ step: 'otp', wrong: false, busy: true });
    void follow(attempt.current, id, code);
  }, [follow]);

  const cancel = useCallback(() => {
    attempt.current++;
    if (loginId.current) void wereadLoginCancel(loginId.current);
    loginId.current = undefined;
    setState({ step: 'out' });
  }, []);

  const signOut = useCallback(() => {
    void wereadSignOut()
      .then(() => {
        setState({ step: 'out' });
        onChanged();
      })
      .catch((cause: unknown) => console.error('weread sign-out', cause));
  }, [onChanged]);

  return useMemo(
    () => ({ state, signIn, submitOtp, cancel, signOut }),
    [state, signIn, submitOtp, cancel, signOut],
  );
}
