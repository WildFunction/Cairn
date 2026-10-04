import type { ReactElement } from 'react';
import type { NodeDeck, Path, PathNode } from '@cairn/core/types';
import type { LibraryEntry } from '@cairn/core/store/library';
import { BookMenu } from './BookMenu';
import { useT } from '../settings/SettingsProvider';

/**
 * Left pane: stages and their stations.
 * Jumping around is allowed — this is a personal tool, not a course with a gate.
 *
 * A station with no deck yet is shown as pending rather than hidden. The path is
 * decided in one go and only the decks trickle in, so the whole walk is known
 * from the start — showing it is honest, and a path whose end you can see is the
 * point of the thing.
 */
export function StagePane({
  path, decks, currentId, onPick, books = [], onSwitchBook, onAdd, onHome,
  failed, heat, complete = true, collapsed = false,
}: {
  path: Path;
  decks: ReadonlyMap<string, NodeDeck>;
  currentId: string;
  onPick: (nodeId: string) => void;
  /** Stations that will not arrive, so waiting can stop. */
  failed?: ReadonlySet<string>;
  /** Questions asked per station — where the path was not clear enough. */
  heat?: ReadonlyMap<string, number>;
  /** False while stations are still being built. */
  complete?: boolean;
  books?: readonly LibraryEntry[];
  onSwitchBook?: (bookId: string) => void;
  /** Absent outside the desktop shell, where generation is not possible. */
  onAdd?: () => void;
  /** Back to the shelf. */
  onHome?: () => void;
  /** Collapsed panes keep their grid slot, or the columns would shift. */
  collapsed?: boolean;
}): ReactElement {
  const t = useT();
  if (collapsed) return <nav className="pane stage-pane collapsed" />;

  const byId = new Map(path.nodes.map((n) => [n.id, n]));
  const currentIdx = byId.get(currentId)?.idx ?? 0;
  const pending = path.nodes.length - decks.size - (failed?.size ?? 0);

  return (
    <nav className="pane stage-pane">
      <header className="stage-head">
        {/* The fold switch is pinned to the window corner over this row's left
            padding, so folding the pane cannot move it. */}
        <div className="stage-head-row">
          <BookMenu
            title={path.title}
            books={books}
            currentId={path.bookId}
            onSwitch={onSwitchBook}
            onAdd={onAdd}
            onHome={onHome}
          />
        </div>
        <div className="stage-meta">
          {t.unit.count(path.nodes.length)} · {complete ? '' : t.unit.approx}
          {t.unit.minutes(path.totalMinutes)}
          {!complete && pending > 0 && (
            <span className="stage-building">{t.stage.building(pending)}</span>
          )}
        </div>
      </header>

      {path.stages.map((stage) => (
        <section key={stage.title}>
          <h3 className="stage-name">{stage.title}</h3>
          {stage.nodeIds.map((id) => {
            const node = byId.get(id);
            if (!node) return null;
            return (
              <StationRow
                key={id}
                node={node}
                state={node.idx < currentIdx ? 'done' : node.idx === currentIdx ? 'current' : 'ahead'}
                minutes={minutesOf(decks.get(id), node)}
                build={buildStateOf(id, decks, failed)}
                heat={heat?.get(id) ?? 0}
                onPick={onPick}
              />
            );
          })}
        </section>
      ))}
    </nav>
  );
}

type BuildState = 'ready' | 'pending' | 'failed';

function StationRow({
  node, state, minutes, build, heat, onPick,
}: {
  node: PathNode;
  state: 'done' | 'current' | 'ahead';
  minutes: number;
  build: BuildState;
  heat: number;
  onPick: (nodeId: string) => void;
}): ReactElement {
  const t = useT();
  return (
    <button
      type="button"
      className={`station ${state} build-${build}`}
      onClick={() => onPick(node.id)}
    >
      <span className="station-mark">{state === 'done' ? '✓' : node.idx + 1}</span>
      <span className="station-title">{node.title}</span>
      {heat > 1 && (
        <span className="station-heat" title={t.stage.asked(heat)} aria-hidden="true">·</span>
      )}
      <span className="station-min">
        {build === 'ready' ? `${minutes}′` : build === 'failed' ? t.stage.failed : t.stage.notReady}
      </span>
    </button>
  );
}

function buildStateOf(
  nodeId: string,
  decks: ReadonlyMap<string, NodeDeck>,
  failed: ReadonlySet<string> | undefined,
): BuildState {
  if (decks.has(nodeId)) return 'ready';
  return failed?.has(nodeId) ? 'failed' : 'pending';
}

/** Show the real audio length once it exists; fall back to the estimate before that. */
function minutesOf(deck: NodeDeck | undefined, node: PathNode): number {
  return deck ? Math.max(1, Math.round(deck.durationMs / 60_000)) : node.estMinutes;
}
