import { useId, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useUi } from './SettingsProvider';

/**
 * The parts every settings page is built from.
 *
 * A titled section over a card whose rows are separated by hairlines, and one
 * control per row on the right. Kept here rather than inside each page so the
 * six pages cannot drift into six different row heights.
 *
 * Every control is labelled by a real `<label for>` rather than an `aria-label`
 * on the control: the visible words and the control have to be the same thing
 * to a screen reader, and a duplicated accessible name is how they stop being.
 */

export function Section({
  title, children,
}: {
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="set-section">
      <h3 className="set-section-title">{title}</h3>
      <div className="set-group">{children}</div>
    </section>
  );
}

/** A row whose control sits to the right of its label. */
export function Row({
  label, hint, htmlFor, children,
}: {
  label: string;
  hint?: ReactNode;
  /** The id of the control this row labels. Omit for rows holding a button. */
  htmlFor?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="set-row">
      <span className="set-label">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}
        {hint && <span className="set-hint">{hint}</span>}
      </span>
      <span className="set-control">{children}</span>
    </div>
  );
}

/** A row whose control needs the full width — a key field, a sample. */
export function StackedRow({
  label, hint, htmlFor, aside, children,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  /** Sits opposite the label: a link, a preview button. */
  aside?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="set-row stacked">
      <div className="set-row-head">
        <span className="set-label">
          {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}
        </span>
        {aside}
      </div>
      {hint && <span className="set-hint">{hint}</span>}
      {children}
    </div>
  );
}

export interface Choice<T extends string> {
  readonly value: T;
  readonly label: string;
}

/**
 * Two to four mutually exclusive values, shown all at once.
 *
 * A `<select>` hides the alternatives behind a click, which is the wrong trade
 * when there are three of them and they fit.
 */
export function Segmented<T extends string>({
  value, choices, onPick, label,
}: {
  value: T;
  choices: readonly Choice<T>[];
  onPick: (value: T) => void;
  /** Names the group for screen readers; the visible label is the row's. */
  label: string;
}): ReactElement {
  return (
    <span className="set-seg" role="group" aria-label={label}>
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          aria-pressed={choice.value === value}
          onClick={() => onPick(choice.value)}
        >
          {choice.label}
        </button>
      ))}
    </span>
  );
}

export function Select<T extends string>({
  id, value, choices, onPick, disabled = false,
}: {
  id: string;
  value: T;
  choices: readonly Choice<T>[];
  onPick: (value: T) => void;
  disabled?: boolean;
}): ReactElement {
  return (
    <select
      id={id}
      className="set-select"
      value={value}
      disabled={disabled}
      onChange={(e) => onPick(e.target.value as T)}
    >
      {choices.map((choice) => (
        <option key={choice.value} value={choice.value}>{choice.label}</option>
      ))}
    </select>
  );
}

export function Switch({
  id, checked, onChange, label, disabled = false,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}): ReactElement {
  return (
    <button
      id={id}
      type="button"
      className="set-switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

/** `$NAME` names an environment variable; it is no secret, so it is shown as typed. */
export function isEnvRef(value: string): boolean {
  return /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(value.trim());
}

/** A key, hidden until the eye is pressed. A `$NAME` reference is no secret and shows as typed. */
export function SecretField({
  id, value, onChange, showLabel, hideLabel, invalid = false, describedBy,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  showLabel: string;
  hideLabel: string;
  invalid?: boolean;
  describedBy?: string;
}): ReactElement {
  const fallbackId = useId();
  const [shown, setShown] = useState(false);

  return (
    <span className="set-secret">
      <input
        id={id || fallbackId}
        className={invalid ? 'set-input bad' : 'set-input'}
        type={shown || isEnvRef(value) ? 'text' : 'password'}
        value={value}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="set-eye"
        aria-label={shown ? hideLabel : showLabel}
        onClick={() => setShown((v) => !v)}
      >
        <EyeMark off={shown} />
      </button>
    </span>
  );
}

function EyeMark({ off }: { off: boolean }): ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}

/** Every page that needs the main process says the same thing without it. */
export function Offline({ title }: { title: string }): ReactElement {
  const { t } = useUi();
  return (
    <Section title={title}>
      <div className="set-row">
        <span className="set-hint">{t.settings.offline}</span>
      </div>
    </Section>
  );
}
