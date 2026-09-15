# Status

Current phase: Phase 3B.3 — Deterministic event replay (waiting for Operator validation)

Completed:

- Initial workspace setup
- Baseline dependencies
- Initial project documentation
- `packages/protocol` domain model and in-memory stores
- `@rayzan/transport` abstraction, ManualTransport, delivery lifecycle, BrowserTransport
- `@rayzan/orchestrator` dispatch, rounds, command parse/execute
- Checkpoint 3A.1: visible local Agent registration and Round 1 bootstrap (Operator accepted)
- Checkpoint 3A.2: browser bindings and prompt delivery (`e7c7be5`)
- Checkpoint 3A.3: Round 1 auto-capture, Coordinator evidence, personalized Round 2 dispatch
- Coordinator final synthesis: Round 2 Watcher capture + stored Operator report
- ChatGPT browser adapter: send + auto-capture (`chatgpt.com` / `chat.openai.com`)
- Checkpoint 3B.1: append-only event model, InMemoryEventStore, orchestrator emission, debug timeline
- Checkpoint 3B.2: SqliteEventStore, `apps/rayzan-local/data/rayzan.sqlite`, dashboard persisted timeline
- Checkpoint 3B.3: EventReplayer rebuilds in-memory stores from the SQLite event sequence

Currently being worked on:

- None (waiting for Operator validation of 3B.3)

Next:

- 3B.4: Debate Observatory (do not start until 3B.3 is accepted)
- Operator intervention

Blockers:

- None
