import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { audioFile } from '@cairn/core/store/library';
import type { LibraryEntry } from '@cairn/core/store/library';
import { stationHeat } from '@cairn/core/store/asks';
import {
  CompanionPane, DeckPane, StagePane, Splitter, PanelToggle, SettingsPanel, useSplit, useResume,
  useUi, columnWidth,
  DEFAULT_LEFT, DEFAULT_RIGHT, LEFT_LIMITS, RIGHT_LIMITS,
} from '@cairn/ui';
import { AddBook } from './AddBook';
import { Home } from './Home';
import {
  chatCancel, chatClear, chatHistory, chatSend, deleteBook, focusStation, inShell, libraryBase,
  listBooks, onCompanionEvent, onDeckStatus, onOpenSettings, markBookFinished, resumeBook, retryBook, setMenuLocale,
  wereadStart,
} from './bridge';
import { shortcuts } from './shortcut';
import { useBundle } from './useBundle';
import { useShellSettings } from './useShellSettings';
import { applyCompanionEvent, beginCompanionTurn, emptyCompanionView } from './companion-state';

/** Typed in the companion's box, it clears the conversation instead of asking the model. */
const CLEAR_COMMAND = '/clear';

export function App(): ReactElement {
  const [books, setBooks] = useState<readonly LibraryEntry[]>([]);
  const [bookId, setBookId] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Port and token are new on every launch, so every URL is built from this. */
  const [base, setBase] = useState<string>();
  const { bundle, error, reload } = useBundle(bookId, base);

  const { prefs, t } = useUi();
  /**
   * Read at mount only. As a dependency it would reopen the last book the
   * moment the reader toggled this setting, which is not what the switch says.
   */
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const shell = useShellSettings();
  const resume = useResume();
  const left = useSplit('pane.left', DEFAULT_LEFT, LEFT_LIMITS, 'left');
  const right = useSplit('pane.right', DEFAULT_RIGHT, RIGHT_LIMITS, 'right');

  const [currentId, setCurrentId] = useState<string>();
  const [chat, setChat] = useState(() => emptyCompanionView(''));
  const [selection, setSelection] = useState<string>();

  useEffect(() => {
    void (async () => {
      setBase(await libraryBase().catch(() => '.'));
      const shelf = await listBooks().catch(() => []);
      setBooks(shelf);
      // Reopen whatever was being read, if it is still on the shelf. A path is
      // walked over several sittings; landing on the drop zone every launch
      // makes the reader find their place by hand.
      const last = resume.lastBookId;
      if (prefsRef.current.resume && last !== undefined && shelf.some((b) => b.id === last)) {
        setBookId(last);
      }
    })();
  }, [resume]);

  // The menu bar is the one surface our dictionary cannot reach
  useEffect(() => setMenuLocale(prefs.locale), [prefs.locale]);

  // A book closed mid-build would otherwise sit unfinished forever
  useEffect(() => {
    if (bookId) void resumeBook(bookId);
  }, [bookId]);

  // The shelf is read once at launch, so without this its progress is frozen
  // at whatever it was then — which read as "0 built" for the whole run.
  useEffect(() => onDeckStatus((s) => {
    setBooks((list) => list.map(
      (b) => (b.id === s.bookId ? { ...b, built: s.ready, complete: s.complete } : b),
    ));
  }), []);

  useEffect(() => {
    if (!bookId || !bundle?.path) return;
    const generation = bundle.path.generatedAt;
    let live = true;
    setChat(emptyCompanionView(bookId));
    void chatHistory(bookId).then((session) => {
      if (live && session.pathGeneratedAt === generation) {
        setChat((state) => state.bookId === bookId && !state.pendingTurn
          ? { ...state, messages: session.messages } : state);
      }
    }).catch((cause: unknown) => console.error('chatHistory', cause));
    return () => { live = false; };
  }, [bookId, bundle?.path?.generatedAt]);

  useEffect(() => onCompanionEvent((event) => {
    setChat((state) => applyCompanionEvent(state, event));
    if (event.type === 'final' || event.type === 'error') {
      void chatHistory(event.bookId).then((session) => {
        setChat((state) => state.bookId === event.bookId && !state.pendingTurn
          ? { ...state, messages: session.messages } : state);
      }).catch((cause: unknown) => console.error('chatHistory', cause));
    }
  }), []);

  const heat = useMemo(() => stationHeat(chat.messages.flatMap((message) =>
    message.role === 'user' && message.atNode
      ? [{ at: message.at, nodeId: message.atNode, question: message.text, grounded: true }]
      : [])), [chat.messages]);

  const path = bundle?.path;
  /** Where the reader stopped in this book, read once per book, before any render. */
  const place = useMemo(
    () => (prefs.resume && path ? resume.placeFor(path.bookId) : undefined),
    [prefs.resume, path, resume],
  );
  /** A book never played here starts where the reader stopped in WeChat Reading. */
  const [wereadAt, setWereadAt] = useState<{ readonly bookId: string; readonly nodeId?: string }>();
  const askWeread = prefs.resume && path !== undefined && place === undefined;
  useEffect(() => {
    if (!askWeread || !path) return;
    let live = true;
    void wereadStart(path.bookId).then((nodeId) => {
      if (live) setWereadAt({ bookId: path.bookId, ...(nodeId ? { nodeId } : {}) });
    });
    return () => { live = false; };
  }, [askWeread, path?.bookId]);
  const lookingUp = askWeread && inShell && wereadAt?.bookId !== path?.bookId;
  const fromWeread = wereadAt?.bookId === path?.bookId ? wereadAt?.nodeId : undefined;

  // The stored station is the fallback, not an effect that sets state afterwards:
  // setting it later would render — and start playing — the first station first.
  const node = useMemo(
    () => path?.nodes.find((n) => n.id === (currentId ?? place?.nodeId ?? fromWeread)) ?? path?.nodes[0],
    [path, currentId, place, fromWeread],
  );

  const step = useCallback((delta: number) => {
    if (!path || !node) return;
    const next = path.nodes[node.idx + delta];
    if (next) setCurrentId(next.id);
  }, [path, node]);

  // Build what the reader is about to reach, not what follows where they began.
  // Keyed on the station and on whether anything is left to build — not on the
  // bundle, which is a fresh object on every poll and would re-send every 2s.
  const building = bundle !== undefined && !bundle.complete;
  useEffect(() => {
    if (bookId && node && building) focusStation(bookId, node.id);
  }, [bookId, node, building]);

  useEffect(() => onOpenSettings(() => setSettingsOpen(true)), []);

  // Stations only. Transport keys (← → space) belong to the deck.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // ⌘, opens settings, as it does in every macOS app
      if (shortcuts.matches(e, ',')) {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }
      // ⌘B / ⌘J fold the side panes, as they do in an editor
      if (shortcuts.matches(e, 'b') || shortcuts.matches(e, 'j')) {
        e.preventDefault();
        (e.key === 'b' ? left : right).toggleCollapsed();
        return;
      }
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
      if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, left, right]);

  const askQuestion = useCallback((question: string) => {
    if (!node || !bookId) return;
    if (question.trim().toLowerCase() === CLEAR_COMMAND) {
      void chatClear(bookId)
        .then((cleared) => { if (cleared) setChat(emptyCompanionView(bookId)); })
        .catch((cause: unknown) => console.error('chatClear', cause));
      return;
    }
    const id = crypto.randomUUID();
    const sel = selection;
    setSelection(undefined);
    setChat((state) => beginCompanionTurn(state, id, question, sel, node.id));
    void chatSend({ turnId: id, bookId, nodeId: node.id, question, locale: prefs.locale, selection: sel })
      .then((started) => {
        if (!started) setChat((state) => applyCompanionEvent(state, {
          bookId, turnId: id, type: 'error', code: 'busy', message: t.companion.busy,
        }));
      })
      .catch((cause: unknown) => setChat((state) => applyCompanionEvent(state, {
        bookId, turnId: id, type: 'error', code: 'request_failed',
        message: cause instanceof Error ? cause.message : String(cause),
      })));
  }, [node, bookId, selection, prefs.locale, t.companion.busy]);

  /** Opening a book is what makes it the one to reopen next launch. */
  const openBook = useCallback((id: string) => {
    resume.open(id);
    setBookId(id);
  }, [resume]);

  const onAdded = useCallback((entry: LibraryEntry) => {
    setBooks((b) => [entry, ...b.filter((x) => x.id !== entry.id)]);
    setAdding(false);
    setCurrentId(undefined);
    setChat(emptyCompanionView(entry.id));
    if (entry.id === bookId) reload(); else openBook(entry.id);
  }, [bookId, reload, openBook]);

  /** Deleting drops the stored position too: re-adding the same file reuses its id. */
  const removeBook = useCallback(async (id: string) => {
    await deleteBook(id);
    setBooks((b) => b.filter((x) => x.id !== id));
    resume.forget(id);
  }, [resume]);

  const goHome = useCallback(() => {
    // Going back to the shelf is deliberate, so the next launch opens there too.
    // The position inside each book is kept.
    resume.close();
    setBookId(undefined);
    setCurrentId(undefined);
    if (chat.pendingTurn) void chatCancel(chat.pendingTurn);
    setChat(emptyCompanionView(''));
  }, [resume, chat.pendingTurn]);

  const modal = (
    <>
      {adding && <AddBook autoPick onDone={onAdded} onClose={() => setAdding(false)} />}
      {settingsOpen && (
        <SettingsPanel shell={shell} onClose={() => setSettingsOpen(false)} />
      )}
    </>
  );

  if (!bookId) {
    return (
      <div className="shell empty">
        <Home
          books={books}
          {...(base ? { base } : {})}
          onAdd={() => setAdding(true)}
          onOpen={openBook}
          onSettings={() => setSettingsOpen(true)}
          {...(inShell ? { onDelete: removeBook } : {})}
        />
        {modal}
      </div>
    );
  }

  if (!bundle || !path || !node || lookingUp) {
    return (
      <div className="shell empty">
        <div className="deck-empty">
          {error ?? t.app.loading}
          <button type="button" className="ghost" onClick={goHome}>{t.app.backToShelf}</button>
        </div>
        {modal}
      </div>
    );
  }

  return (
    <div
      className={[
        'shell',
        left.state.collapsed ? 'left-off' : '',
        right.state.collapsed ? 'right-off' : '',
      ].filter(Boolean).join(' ')}
      style={{
        gridTemplateColumns:
          `${columnWidth(left.state)}px 1px 1fr 1px ${columnWidth(right.state)}px`,
      }}
    >
      {/* Both switches are pinned to the shell, not to the panes they control:
          a switch that moves when its pane folds is a switch you have to find
          again, and one that lives inside the pane vanishes with it. */}
      <PanelToggle
        control={{ collapsed: left.state.collapsed, toggle: left.toggleCollapsed }}
        side="left"
        label={t.panel.stagePane}
        hint={shortcuts.label('b')}
      />
      <PanelToggle
        control={{ collapsed: right.state.collapsed, toggle: right.toggleCollapsed }}
        side="right"
        label={t.panel.askPane}
        hint={shortcuts.label('j')}
      />

      <StagePane
        path={path}
        decks={bundle.decks}
        currentId={node.id}
        onPick={setCurrentId}
        books={books}
        onSwitchBook={(id) => { if (chat.pendingTurn) void chatCancel(chat.pendingTurn); openBook(id); setCurrentId(undefined); setChat(emptyCompanionView(id)); }}
        onAdd={inShell ? () => setAdding(true) : undefined}
        onHome={goHome}
        failed={bundle.failed}
        heat={heat}
        complete={bundle.complete}
        collapsed={left.state.collapsed}
      />

      <Splitter split={left} label={t.panel.stagePane} />

      <DeckPane
        node={node}
        deck={bundle.decks.get(node.id)}
        build={bundle.failed.has(node.id) ? 'failed' : 'pending'}
        {...(inShell ? {
          onRetry: () => retryBook(path.bookId).then(() => undefined)
            .catch((cause: unknown) => console.error('retryBook', cause)),
        } : {})}
        audioSrc={`${base ?? '.'}/${audioFile(path.bookId, node.id)}`}
        stageTitle={path.stages.find((st) => st.nodeIds.includes(node.id))?.title}
        resumeAt={place}
        onSelect={setSelection}
        // The reader chose whether a finished chapter rolls into the next one
        onEnded={() => {
          if (node.kind === 'recap') {
            void markBookFinished(path.bookId, node.id).catch((cause: unknown) => console.error('markBookFinished', cause));
          }
          if (prefs.autoNext) step(1);
        }}
        onProgress={(ms) => resume.record(path.bookId, { nodeId: node.id, ms })}
      />

      <Splitter split={right} label={t.panel.askPane} />

      <CompanionPane
        messages={chat.messages}
        pending={chat.pendingTurn !== undefined}
        draftAnswer={chat.draft}
        error={chat.error}
        errorCode={chat.errorCode}
        onAsk={askQuestion}
        onCancel={() => { if (chat.pendingTurn) void chatCancel(chat.pendingTurn); }}
        onJumpToChapter={(chapter) => {
          const target = path.nodes.find((item) => item.sourceChapters.includes(chapter));
          if (target) setCurrentId(target.id);
          return target !== undefined;
        }}
        onOpenShelf={(id, nodeId) => { if (chat.pendingTurn) void chatCancel(chat.pendingTurn); openBook(id); setCurrentId(nodeId); setChat(emptyCompanionView(id)); }}
        selection={selection}
        onClearSelection={() => setSelection(undefined)}
        collapsed={right.state.collapsed}
      />

      {modal}
    </div>
  );
}
