import { useId, useState } from 'react';
import type { ReactElement } from 'react';
import { Row, Section, Switch } from './rows';
import { useUi } from './SettingsProvider';
import type { CloudBookRow, ShellSettings } from './shell';

/** One decimal under ten megabytes, where it still tells two books apart. */
export function megabytes(bytes: number): string {
  const mb = bytes / 1_000_000;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/**
 * iCloud: the switch, then every book with what it takes and whether it is up
 * there. A book switched off here stays out of iCloud and off the phone — which
 * is also what removing it on the phone does.
 */
export function CloudSection({ shell }: { shell: ShellSettings }): ReactElement | null {
  const { t } = useUi();
  const syncId = useId();
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const cloud = shell.cloud;
  if (!cloud) return null;

  const words = t.settings.cloud;
  const usable = cloud.reach === 'ready';
  const on = shell.prefs.icloudSync && usable;
  const inCloud = cloud.books.filter((book) => book.state === 'synced');
  const stateOf = (book: CloudBookRow): string => {
    if (book.state === 'uploading') return words.uploading(book.done ?? 0, book.total ?? 0);
    // Nothing uploads while syncing is off, so "waiting" would promise something that is not happening.
    return !on && book.state === 'waiting' ? words.state.held : words.state[book.state];
  };

  const removeAll = async (): Promise<void> => {
    setRemoving(true);
    try {
      await cloud.removeAll();
      setConfirming(false);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Section title={words.title}>
      <Row
        label={words.sync}
        htmlFor={syncId}
        hint={cloud.reach === 'ready'
          ? words.syncHint
          : <span className="set-hint warn">{words.reach[cloud.reach]}</span>}
      >
        <Switch
          id={syncId}
          checked={on}
          disabled={!usable}
          onChange={(next) => shell.setPref('icloudSync', next)}
          label={words.sync}
        />
      </Row>

      {on && (
        <Row
          label={words.inCloud(inCloud.length)}
          hint={megabytes(inCloud.reduce((total, book) => total + book.bytes, 0))}
        >
          <button type="button" className="set-btn" disabled={cloud.running} onClick={cloud.syncNow}>
            {cloud.running ? words.syncing : words.syncNow}
          </button>
        </Row>
      )}

      {/* Listed whether or not syncing is on, so what goes up can be chosen before anything does. */}
      {usable && cloud.books.map((book) => (
        <CloudBook key={book.id} book={book} state={stateOf(book)} onChange={(next) => cloud.setBook(book.id, next)} />
      ))}

      <Row label={words.removeAll} hint={words.removeAllHint}>
        {confirming ? (
          <span className="set-confirm">
            <span className="set-hint">{words.confirm}</span>
            <button type="button" className="set-btn danger" disabled={removing} onClick={() => void removeAll()}>
              {removing ? words.removing : words.confirmYes}
            </button>
            <button type="button" className="set-btn" disabled={removing} onClick={() => setConfirming(false)}>
              {words.confirmNo}
            </button>
          </span>
        ) : (
          <button type="button" className="set-btn danger" disabled={!usable} onClick={() => setConfirming(true)}>
            {words.removeAll}
          </button>
        )}
      </Row>
    </Section>
  );
}

function CloudBook({
  book, state, onChange,
}: {
  book: CloudBookRow;
  state: string;
  onChange: (next: boolean) => void;
}): ReactElement {
  const { t } = useUi();
  const id = useId();
  return (
    <Row
      label={book.title}
      htmlFor={id}
      hint={(
        <span className={book.state === 'failed' ? 'set-hint warn' : 'set-hint'}>
          {megabytes(book.bytes)} · {state}
        </span>
      )}
    >
      <Switch
        id={id}
        checked={book.state !== 'off' && book.state !== 'building'}
        disabled={book.state === 'building'}
        onChange={onChange}
        label={t.settings.cloud.bookSwitch(book.title)}
      />
    </Row>
  );
}
