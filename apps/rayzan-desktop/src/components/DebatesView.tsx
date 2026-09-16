import { DebateCard } from './DebateCard.js';
import type { DebateView } from '../api.js';

export function DebatesView(input: { readonly debates: readonly DebateView[] }) {
  return (
    <section className="page">
      <h1>Debates</h1>
      <p className="lede">Past and restored decisions from the event log.</p>
      {input.debates.length === 0 ? (
        <p className="empty">No debates in history yet.</p>
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
