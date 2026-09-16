import type { TimelineItem } from './types.js';

export function DebateTimeline(input: {
  readonly items: readonly TimelineItem[];
}) {
  return (
    <section className="obs-timeline card-panel">
      <header className="obs-section-head">
        <h2>Round Activity</h2>
      </header>
      {input.items.length === 0 ? (
        <p className="empty">Activity will appear as the debate progresses.</p>
      ) : (
        <ol className="obs-activity">
          {input.items.map((item) => (
            <li key={item.id} className={item.status}>
              <span className="obs-activity-mark" aria-hidden="true">
                {item.status === 'completed'
                  ? '✓'
                  : item.status === 'active'
                    ? '◉'
                    : '○'}
              </span>
              <div className="obs-activity-copy">
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
              </div>
              <time>{item.time}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
