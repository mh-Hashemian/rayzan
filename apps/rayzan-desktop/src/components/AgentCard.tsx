import type { AgentView } from '../api.js';

function roleLabel(role: string): string {
  if (role.length === 0) {
    return role;
  }
  return role[0]!.toUpperCase() + role.slice(1);
}

function connectionLabel(agent: AgentView): string {
  if (agent.bindingState === 'bound' || agent.connected) {
    return 'Connected';
  }
  if (agent.bindingState === 'unavailable') {
    return 'Unavailable';
  }
  return 'Not connected';
}

function connectionKind(agent: AgentView): 'ok' | 'warn' | 'mute' {
  if (agent.bindingState === 'bound' || agent.connected) {
    return 'ok';
  }
  if (agent.bindingState === 'unavailable') {
    return 'warn';
  }
  return 'mute';
}

export function AgentCard(input: { readonly agent: AgentView }) {
  const kind = connectionKind(input.agent);
  return (
    <article className="agent-card">
      <p className="agent-role">{roleLabel(input.agent.role)}</p>
      <h3 className="agent-name">{input.agent.name}</h3>
      <p className="agent-provider">
        {input.agent.provider ?? 'No provider bound'}
      </p>
      <p className={`agent-link ${kind}`}>
        <span className="dot" aria-hidden="true" />
        {connectionLabel(input.agent)}
      </p>
    </article>
  );
}
