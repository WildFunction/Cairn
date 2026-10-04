import { useId, useState } from 'react';
import type { ReactElement } from 'react';
import { useUi } from './SettingsProvider';
import { QrCode } from './QrCode';
import { Offline, Section, StackedRow } from './rows';
import type { ShellSettings, WereadAccount } from './shell';

export function WereadPage({ shell }: { shell?: ShellSettings }): ReactElement {
  const { t } = useUi();
  if (!shell) return <Offline title={t.settings.pages.weread} />;
  return (
    <Section title={t.settings.pages.weread}>
      <StackedRow label={t.settings.weread.account} hint={t.settings.weread.accountHint}>
        <AccountControl account={shell.weread} />
      </StackedRow>
    </Section>
  );
}

function AccountControl({ account }: { account: WereadAccount }): ReactElement | null {
  const { t } = useUi();
  const { state } = account;
  switch (state.step) {
    case 'loading':
      return null;
    case 'in':
      return (
        <span className="set-weread">
          <span className="set-hint ok">{t.settings.weread.signedIn(state.account)}</span>
          <button type="button" className="set-btn" onClick={account.signOut}>{t.settings.weread.signOut}</button>
        </span>
      );
    case 'out':
    case 'starting':
      return (
        <span className="set-weread">
          {state.step === 'out' && state.failed && (
            <span className="set-hint warn" role="alert">{t.settings.weread.failed[state.failed]}</span>
          )}
          <button type="button" className="set-btn" disabled={state.step === 'starting'} onClick={account.signIn}>
            {state.step === 'starting' ? t.settings.weread.starting : t.settings.weread.signIn}
          </button>
        </span>
      );
    case 'qr':
      return (
        <span className="set-weread stacked">
          <QrCode text={state.url} label={t.settings.weread.qrLabel} />
          <span className="set-hint">{t.settings.weread.scan}</span>
          <button type="button" className="set-btn" onClick={account.cancel}>{t.settings.weread.cancel}</button>
        </span>
      );
    case 'otp':
      return <OtpForm account={account} wrong={state.wrong} busy={state.busy} />;
  }
}

function OtpForm({ account, wrong, busy }: { account: WereadAccount; wrong: boolean; busy: boolean }): ReactElement {
  const { t } = useUi();
  const id = useId();
  const [code, setCode] = useState('');
  const valid = /^\d{4}$/.test(code);
  return (
    <form
      className="set-weread"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !busy) account.submitOtp(code);
      }}
    >
      <label htmlFor={id} className={wrong ? 'set-hint warn' : 'set-hint'}>
        {wrong ? t.settings.weread.otpWrong : t.settings.weread.otp}
      </label>
      <input
        id={id}
        className="set-input set-otp"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={4}
        value={code}
        disabled={busy}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
      />
      <button type="submit" className="set-btn" disabled={!valid || busy}>{t.settings.weread.verify}</button>
      <button type="button" className="set-btn" onClick={account.cancel}>{t.settings.weread.cancel}</button>
    </form>
  );
}
