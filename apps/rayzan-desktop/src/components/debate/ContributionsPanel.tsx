import { useState } from 'react';

import { ProviderLogo } from '../providers/ProviderLogo.js';
import type { WatcherContributionView } from './types.js';

export function ContributionsPanel(input: {
  readonly contributions: readonly WatcherContributionView[];
}) {
  const [openId, setOpenId] = useState<string | undefined>();
  if (input.contributions.length === 0) {
    return null;
  }

  const byAgent = new Map<string, WatcherContributionView[]>();
  for (const item of input.contributions) {
    const list = byAgent.get(item.agentId) ?? [];
    list.push(item);
    byAgent.set(item.agentId, list);
  }

  return (
    <section className="obs-contributions card-panel" aria-label="AI Team Contributions">
      <header className="obs-section-head">
        <h2>AI Team Contributions</h2>
        <p className="review-copy">
          Exact prompts and responses from each Watcher. Optional evidence — the
          Coordinator answer above is the Operator-facing result.
        </p>
      </header>
      <ul className="obs-contribution-list">
        {[...byAgent.entries()].map(([agentId, items]) => {
          const latest = items[items.length - 1]!;
          const open = openId === agentId;
          return (
            <li key={agentId} className="obs-contribution-row">
              <div className="obs-contribution-summary">
                <div className="obs-contribution-identity">
                  <ProviderLogo
                    name={latest.name}
                    provider={latest.provider}
                    size={24}
                  />
                  <div>
                    <h3>{latest.name}</h3>
                    <p>
                      {latest.status}
                      {items.length > 1
                        ? ` · ${items.length} consultations`
                        : ` · Round ${latest.roundNumber}`}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    setOpenId((current) =>
                      current === agentId ? undefined : agentId,
                    )
                  }
                >
                  {open ? 'Hide' : 'View response'}
                </button>
              </div>
              {open ? (
                <div className="obs-contribution-detail">
                  {items.map((item) => (
                    <article key={item.id} className="obs-contribution-turn">
                      <p className="obs-eyebrow">Round {item.roundNumber}</p>
                      <h4>Coordinator request</h4>
                      <pre className="obs-report">{item.prompt}</pre>
                      <h4>Captured response</h4>
                      <pre className="obs-report">
                        {item.response?.trim() || '(waiting for response)'}
                      </pre>
                    </article>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
