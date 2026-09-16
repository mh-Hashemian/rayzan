import type { InsightsView } from './types.js';

export function InsightsPanel(input: { readonly insights: InsightsView }) {
  const empty =
    input.insights.agreement.length === 0 &&
    input.insights.disagreement.length === 0 &&
    input.insights.risks.length === 0 &&
    input.insights.emerging === undefined;

  return (
    <aside className="obs-insights card-panel">
      <header className="obs-section-head">
        <h2>Current Insights</h2>
        <span className="obs-live-badge">Live synthesis</span>
      </header>
      {empty ? (
        <p className="empty">
          Insights will appear after Coordinator synthesis.
        </p>
      ) : (
        <>
          {input.insights.emerging ? (
            <div className="obs-emerging">
              <p className="obs-emerging-label">Emerging direction</p>
              <p>{input.insights.emerging}</p>
            </div>
          ) : null}
          <InsightList
            title="Key points of agreement"
            items={input.insights.agreement}
            tone="ok"
          />
          <InsightList
            title="Key disagreements"
            items={input.insights.disagreement}
            tone="warn"
          />
          <InsightList
            title="Notable risks"
            items={input.insights.risks}
            tone="error"
          />
        </>
      )}
    </aside>
  );
}

function InsightList(input: {
  readonly title: string;
  readonly items: readonly string[];
  readonly tone: 'ok' | 'warn' | 'error';
}) {
  if (input.items.length === 0) {
    return null;
  }
  return (
    <section className="obs-insight-block">
      <h3>{input.title}</h3>
      <ul>
        {input.items.map((item) => (
          <li key={item} className={input.tone}>
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
