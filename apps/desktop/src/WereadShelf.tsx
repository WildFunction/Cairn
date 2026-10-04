import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { LibraryEntry } from '@cairn/core/store/library';
import { useT } from '@cairn/ui';
import { wereadIntro, wereadShelf } from './bridge';
import { ShelfCard } from './ShelfCard';
import type { WereadShelfBook } from './shared/types';
import { normalize } from './shared/title';

/** Enough to fill a screen; the rest arrive a page at a time as the reader scrolls, and so do their intros. */
const PAGE = 12;

/** WeChat Reading's books that are not already walked here. */
export function notInLibrary(
  shelf: readonly WereadShelfBook[], library: readonly LibraryEntry[],
): readonly WereadShelfBook[] {
  const owned = new Set(library.map((b) => normalize(b.title)));
  return shelf.filter((b) => !owned.has(normalize(b.title)));
}

/**
 * The reader's WeChat Reading shelf, for picking what to walk next. Cairn reads
 * only a file the reader has, so a card here opens the file picker, not the book.
 */
export function WereadShelf({ library, connected, onAdd }: {
  library: readonly LibraryEntry[];
  connected: boolean;
  onAdd: () => void;
}): ReactElement | null {
  const t = useT();
  const [shelf, setShelf] = useState<readonly WereadShelfBook[]>([]);
  const [intros, setIntros] = useState<Readonly<Record<string, string>>>({});
  const [count, setCount] = useState(PAGE);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!connected) return setShelf([]);
    let live = true;
    void wereadShelf().then((books) => { if (live) setShelf(books); });
    return () => { live = false; };
  }, [connected]);

  const books = useMemo(() => notInLibrary(shelf, library), [shelf, library]);
  const shown = books.slice(0, count);
  const more = count < books.length;

  // Loading starts a little before the end comes into view, so the scroll does not stall on it
  useEffect(() => {
    const target = end.current;
    if (!more || !target) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) setCount((n) => n + PAGE); },
      { rootMargin: '0px 0px 400px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [more, count]);
  const wanted = shown.map((b) => b.bookId).join('\n');
  const asked = useRef(new Set<string>());

  // One at a time, as the library's own covers are looked up
  useEffect(() => {
    let live = true;
    void (async () => {
      for (const id of wanted.split('\n').filter(Boolean)) {
        if (asked.current.has(id)) continue;
        asked.current.add(id);
        const intro = await wereadIntro(id);
        if (intro) setIntros((m) => ({ ...m, [id]: intro }));
        if (!live) return;
      }
    })();
    return () => { live = false; };
  }, [wanted]);

  if (books.length === 0) return null;

  return (
    <section className="shelf">
      <h2 className="shelf-title">{t.home.weread}</h2>
      <div className="shelf-grid">
        {shown.map((b) => (
          <ShelfCard
            key={b.bookId}
            cover={b.cover}
            coverFallback={b.coverFallback}
            title={b.title}
            meta={b.author}
            intro={intros[b.bookId] || undefined}
            onOpen={onAdd}
          />
        ))}
      </div>
      {more && <div ref={end} aria-hidden="true" />}
    </section>
  );
}
