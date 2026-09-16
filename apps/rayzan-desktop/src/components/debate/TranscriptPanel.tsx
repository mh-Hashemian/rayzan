import { useState } from 'react';

import type { TranscriptMessage } from './types.js';

export function TranscriptPanel(input: {
  readonly messages: readonly TranscriptMessage[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <section className="obs-transcript card-panel">
      <button
        type="button"
        className="obs-transcript-toggle"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <span>
          <strong>Full Debate Transcript</strong>
          <small>View the complete structured record of this debate.</small>
        </span>
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open ? (
        input.messages.length === 0 ? (
          <p className="empty">No messages captured yet.</p>
        ) : (
          <ul className="obs-transcript-list">
            {input.messages.map((message) => (
              <li key={message.id}>
                <header>
                  <strong>{message.from}</strong>
                  <span>{message.kind}</span>
                </header>
                <pre>{message.body}</pre>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
