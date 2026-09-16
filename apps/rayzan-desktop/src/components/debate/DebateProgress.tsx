import type { ProgressDetail, ProgressStage, StageStatus } from './types.js';

export function DebateProgress(input: {
  readonly stages: readonly ProgressStage[];
  readonly details: readonly ProgressDetail[];
  readonly nextAction?: string;
}) {
  return (
    <section className="obs-progress card-panel">
      <header className="obs-section-head">
        <h2>Debate Progress</h2>
      </header>
      <ol className="obs-stages">
        {input.stages.map((stage, index) => (
          <li key={stage.id} className={`obs-stage ${stage.status}`}>
            {index > 0 ? (
              <span className="obs-stage-line" aria-hidden="true" />
            ) : null}
            <span className="obs-stage-mark" aria-hidden="true">
              {mark(stage.status, index + 1)}
            </span>
            <div className="obs-stage-copy">
              <strong>{stage.label}</strong>
              <small>{stage.detail}</small>
            </div>
          </li>
        ))}
      </ol>
      <ul className="obs-progress-details">
        {input.details.map((detail) => (
          <li key={detail.label}>
            <span className={`obs-detail-mark ${detail.status}`} aria-hidden="true">
              {detailMark(detail.status)}
            </span>
            <span>
              {detail.label}
              {detail.note ? ` · ${detail.note}` : ''}
            </span>
          </li>
        ))}
      </ul>
      {input.nextAction ? (
        <p className="obs-next-action">
          <span aria-hidden="true">⏱</span> Next action: {input.nextAction}
        </p>
      ) : null}
    </section>
  );
}

function mark(status: StageStatus, step: number): string {
  if (status === 'completed') {
    return '✓';
  }
  if (status === 'active') {
    return String(step);
  }
  return '○';
}

function detailMark(status: ProgressDetail['status']): string {
  if (status === 'completed') {
    return '✓';
  }
  if (status === 'active') {
    return '◉';
  }
  if (status === 'info') {
    return 'ℹ';
  }
  return '○';
}
