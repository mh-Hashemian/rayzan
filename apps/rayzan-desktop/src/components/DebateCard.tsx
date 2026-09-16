import { debateTitle, type DebateView } from '../api.js';

function formatDate(value: string | undefined): string {
  if (value === undefined) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function statusKind(status: string): string {
  if (status === 'completed') {
    return 'ok';
  }
  if (status === 'archived') {
    return 'mute';
  }
  if (status === 'active' || status === 'pending') {
    return 'info';
  }
  return 'mute';
}

export function DebateCard(input: {
  readonly debate: DebateView;
  readonly onOpen?: () => void;
}) {
  const status = input.debate.status;
  const body = (
    <>
      <div className="debate-copy">
        <h3>{debateTitle(input.debate.topic)}</h3>
        <p className="debate-meta">
          {formatDate(input.debate.createdAt)}
          {formatDate(input.debate.createdAt) !== '' ? ' · ' : ''}
          <span className={`badge ${statusKind(status)}`}>{status}</span>
        </p>
      </div>
      {input.onOpen ? <span className="debate-open-hint">Open →</span> : null}
    </>
  );

  if (input.onOpen) {
    return (
      <button
        type="button"
        className="debate-card debate-card-button"
        onClick={input.onOpen}
      >
        {body}
      </button>
    );
  }

  return <article className="debate-card">{body}</article>;
}
