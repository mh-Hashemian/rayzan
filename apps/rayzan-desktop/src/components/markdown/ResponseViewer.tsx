import { useState } from 'react';

import { MarkdownBody } from './MarkdownBody.js';

/**
 * Rendered | Raw viewer for captured model text. Raw shows the exact captured
 * response; stored text is never modified by rendering.
 */
export function ResponseViewer(input: {
  readonly text?: string;
  readonly tone?: 'primary' | 'secondary';
}) {
  const [raw, setRaw] = useState(false);
  const tone = input.tone ?? 'secondary';
  return (
    <div className={`response-viewer response-viewer--${tone}`}>
      <div className="response-viewer-toggle" role="group" aria-label="Response format">
        <button
          type="button"
          className={raw ? 'btn' : 'btn primary'}
          aria-pressed={!raw}
          onClick={() => {
            setRaw(false);
          }}
        >
          Rendered
        </button>
        <button
          type="button"
          className={raw ? 'btn primary' : 'btn'}
          aria-pressed={raw}
          onClick={() => {
            setRaw(true);
          }}
        >
          Raw
        </button>
      </div>
      {raw ? (
        <pre className="obs-report">{input.text ?? ''}</pre>
      ) : (
        <MarkdownBody text={input.text ?? ''} tone={tone} />
      )}
    </div>
  );
}
