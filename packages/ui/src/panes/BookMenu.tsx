import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { LibraryEntry } from '@cairn/core/store/library';
import { ChevronMark } from './icons';
import { useT } from '../settings/SettingsProvider';

/**
 * The book switcher: the pane's title is the trigger.
 *
 * Replaces a native `<select>` plus a separate ＋ button. Switching books and
 * adding one are the same kind of act, and splitting them across two controls
 * put two of them in a header row that has space for one.
 *
 * A popover rather than an inline disclosure: the station list stays where it
 * is, so switching books does not move the row the reader was looking at.
 *
 * Everything a native select gave away for free has to be rebuilt here — Escape,
 * click-outside, arrow keys, focus return. Leaving any of them out is what makes
 * a custom menu feel worse than the select it replaced.
 */
export function BookMenu({
  title, books, currentId, onSwitch, onAdd, onHome,
}: {
  title: string;
  books: readonly LibraryEntry[];
  currentId: string;
  onSwitch?: (bookId: string) => void;
  /** Absent outside the desktop shell, where generation is not possible. */
  onAdd?: () => void;
  /** Back to the shelf: the only route to the home screen once a book is open. */
  onHome?: () => void;
}): ReactElement {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  /**
   * Every row the arrow keys walk, in the order they are rendered.
   *
   * Held in a ref as well: the array is new on every render, so keying the key
   * handler's effect on it would unbind and rebind the listeners each time.
   */
  const rows: readonly (() => void)[] = [
    ...books.map((b) => () => choose(b.id)),
    ...(onAdd ? [() => run(onAdd)] : []),
    ...(onHome ? [() => run(onHome)] : []),
  ];
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }, []);

  const run = (fn: () => void): void => {
    close(false);
    fn();
  };

  const choose = (bookId: string): void => {
    close(false);
    // Picking the open book is a no-op, not a reload
    if (bookId !== currentId) onSwitch?.(bookId);
  };

  // Open on the current book, so ↓ Enter is never a surprise
  useEffect(() => {
    if (open) setActive(Math.max(0, books.findIndex((b) => b.id === currentId)));
  }, [open, books, currentId]);

  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (menu.current?.contains(target) || trigger.current?.contains(target)) return;
      // A click that lands outside dismisses without stealing focus back
      close(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        const count = rowsRef.current.length;
        setActive((i) => (i + step + count) % count);
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setActive((i) => { rowsRef.current[i]?.(); return i; });
      }
    };

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return (
    <div className="book-menu-wrap">
      <button
        ref={trigger}
        type="button"
        className={open ? 'book-trigger open' : 'book-trigger'}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={title}
      >
        <span className="book-name">{title}</span>
        <span className={open ? 'book-chev up' : 'book-chev'} aria-hidden="true">
          <ChevronMark />
        </span>
      </button>

      {open && (
        <div className="book-menu" id={menuId} ref={menu} role="menu">
          {/* The list scrolls, the actions do not: the pane clips anything taller
              than itself, and a clipped ＋ is an unreachable ＋. */}
          <div className="book-list">
          {books.map((book, i) => (
            <button
              type="button"
              key={book.id}
              role="menuitemradio"
              aria-checked={book.id === currentId}
              className={rowClass('book-item', i, active, book.id === currentId)}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(book.id)}
            >
              <span className="book-check" aria-hidden="true">
                {book.id === currentId ? '✓' : ''}
              </span>
              <span className="book-item-body">
                <span className="book-item-name">{book.title}</span>
                <span className="book-item-meta">
                  {t.unit.count(book.stations)} · {t.unit.minutes(book.minutes)}
                </span>
              </span>
            </button>
          ))}
          </div>

          {(onAdd || onHome) && <div className="book-sep" />}

          {onAdd && (
            <button
              type="button"
              role="menuitem"
              className={rowClass('book-item action', books.length, active, false)}
              onMouseEnter={() => setActive(books.length)}
              onClick={() => run(onAdd)}
            >
              <span className="book-check" aria-hidden="true">＋</span>
              <span className="book-item-body">
                <span className="book-item-name">{t.menu.addBook}</span>
              </span>
            </button>
          )}


          {onHome && (
            <button
              type="button"
              role="menuitem"
              className={rowClass('book-item quiet', rows.length - 1, active, false)}
              onMouseEnter={() => setActive(rows.length - 1)}
              onClick={() => run(onHome)}
            >
              <span className="book-check" aria-hidden="true">‹</span>
              <span className="book-item-body">
                <span className="book-item-name">{t.menu.backToShelf}</span>
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function rowClass(base: string, index: number, active: number, current: boolean): string {
  return [base, index === active ? 'active' : '', current ? 'on' : '']
    .filter(Boolean)
    .join(' ');
}
