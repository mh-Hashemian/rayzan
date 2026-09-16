import { DebateCard } from './DebateCard.js';
import type { DebateView } from '../api.js';

export function DebatesView(input: {
  readonly debates: readonly DebateView[];
  readonly activeDebate?: DebateView | null;
  readonly onOpenActive?: () => void;
}) {
  return (
    <section className="page">
      <h1>Debates</h1>
      <p className="lede">Past and restored decisions from the event log.</p>
      {input.activeDebate && input.onOpenActive ? (
        <section className="block">
          <h2>Current decision</h2>
          <DebateCard debate={input.activeDebate} onOpen={input.onOpenActive} />
        </section>
      ) : null}
      {input.debates.length === 0 ? (
        input.activeDebate ? null : (
          <p className="empty">No debates in history yet.</p>
        )
      ) : (
        <div className="debate-list">
          {input.debates.map((debate) => (
            <DebateCard key={debate.id} debate={debate} />
          ))}
        </div>
      )}
    </section>
  );
}
