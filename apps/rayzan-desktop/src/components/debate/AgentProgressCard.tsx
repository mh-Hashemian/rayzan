import { ProviderLogo } from '../providers/ProviderLogo.js';
import type { AgentProgress } from './types.js';

export function AgentProgressCard(input: { readonly agent: AgentProgress }) {
  const agent = input.agent;
  const pct =
    agent.phasesTotal > 0
      ? Math.round((agent.phasesDone / agent.phasesTotal) * 100)
      : 0;
  const generating = agent.status === 'Thinking' || agent.status === 'Active';
  const done =
    agent.status === 'Responded' || agent.status === 'Completed';

  return (
    <article
      className={
        generating
          ? 'obs-agent-card generating'
          : done
            ? 'obs-agent-card done'
            : 'obs-agent-card'
      }
    >
      <div
        className={
          generating
            ? 'obs-agent-load generating'
            : done
              ? 'obs-agent-load done'
              : 'obs-agent-load idle'
        }
        aria-hidden="true"
      >
        <span />
      </div>
      <header className="obs-agent-top">
        <div className="obs-agent-identity">
          <ProviderLogo
            name={agent.name}
            provider={agent.provider}
            size={28}
          />
          <div>
            <p className="obs-agent-role">
              {agent.role === 'coordinator' ? 'Coordinator' : 'Watcher'}
            </p>
            <h3>{agent.name}</h3>
          </div>
        </div>
        <span className={`obs-agent-status ${statusClass(agent.status)}`}>
          · {agent.status}
        </span>
      </header>
      <p className="obs-agent-summary">{agent.summary}</p>
      {agent.role === 'watcher' ? (
        <dl className="obs-agent-rounds">
          <div>
            <dt>Round 1</dt>
            <dd>{agent.round1 ?? 'Waiting'}</dd>
          </div>
          <div>
            <dt>Round 2</dt>
            <dd>{agent.round2 ?? 'Waiting'}</dd>
          </div>
        </dl>
      ) : null}
      <div className="obs-agent-bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="obs-agent-phases">
        {agent.phasesDone} of {agent.phasesTotal} phases
      </p>
    </article>
  );
}

function statusClass(status: AgentProgress['status']): string {
  if (status === 'Completed' || status === 'Responded') {
    return 'ok';
  }
  if (status === 'Active' || status === 'Thinking') {
    return 'live';
  }
  return 'wait';
}
