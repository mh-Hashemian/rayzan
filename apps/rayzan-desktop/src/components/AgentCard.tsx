import type { AgentView } from '../api.js';
import { ProviderLogo } from './providers/ProviderLogo.js';

function roleLabel(role: string): string {
  if (role.length === 0) {
    return role;
  }
  return role[0]!.toUpperCase() + role.slice(1);
}

function connectionCopy(agent: AgentView): {
  readonly label: string;
  readonly kind: 'ok' | 'warn' | 'mute';
} {
  if (agent.connection === 'connected') {
    return { label: 'Connected', kind: 'ok' };
  }
  if (agent.connection === 'error') {
    return { label: 'Error', kind: 'warn' };
  }
  return { label: 'Disconnected', kind: 'mute' };
}

export function AgentCard(input: {
  readonly agent: AgentView;
  readonly onChangeCoordinator?: () => void;
  readonly onToggleParticipation?: (enabled: boolean) => void;
}) {
  const status = connectionCopy(input.agent);
  const excluded =
    input.agent.role === 'watcher' && input.agent.enabled === false;
  const provider = input.agent.provider?.trim();
  const showProvider =
    provider !== undefined &&
    provider.length > 0 &&
    provider.toLowerCase() !== input.agent.name.toLowerCase();

  return (
    <article
      className={excluded ? 'agent-card agent-card-excluded' : 'agent-card'}
    >
      <div className="agent-card-top">
        <ProviderLogo
          name={input.agent.name}
          provider={input.agent.provider}
          size={36}
        />
        <div className="agent-card-identity">
          <p className="agent-role">{roleLabel(input.agent.role)}</p>
          <h3 className="agent-name">{input.agent.name}</h3>
          {showProvider ? (
            <p className="agent-provider">{provider}</p>
          ) : null}
        </div>
      </div>
      <p className={`agent-link ${status.kind}`}>
        <span className="dot" aria-hidden="true" />
        {status.label}
      </p>
      {input.onChangeCoordinator || input.onToggleParticipation ? (
        <div className="agent-card-footer">
          {input.onChangeCoordinator ? (
            <button
              type="button"
              className="text-btn"
              onClick={input.onChangeCoordinator}
            >
              Change Coordinator
            </button>
          ) : null}
          {input.onToggleParticipation ? (
            <label className="include-toggle">
              <input
                type="checkbox"
                checked={!excluded}
                onChange={(event) => {
                  input.onToggleParticipation?.(event.target.checked);
                }}
              />
              In next debate
            </label>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
