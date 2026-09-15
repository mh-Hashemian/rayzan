# Status

Current phase: Phase 3C.1.1 — Debate history + single active debate (waiting for Operator validation)

Completed:

- Initial workspace setup
- Baseline dependencies
- Initial project documentation
- `packages/protocol` domain model and in-memory stores
- `@rayzan/transport` abstraction, ManualTransport, delivery lifecycle, BrowserTransport
- `@rayzan/orchestrator` dispatch, rounds, command parse/execute
- Checkpoint 3A.1: visible local Agent registration and Round 1 bootstrap (Operator accepted)
- Checkpoint 3A.2: browser bindings and prompt delivery (`e7c7be5`)
- Checkpoint 3A.3: Full Round 1 capture, Coordinator evidence, personalized Round 2 dispatch
- Coordinator final synthesis: Round 2 Watcher capture + stored Operator report
- ChatGPT browser adapter: send + auto-capture (`chatgpt.com` / `chat.openai.com`)
- Checkpoint 3B.1: append-only event model, InMemoryEventStore, orchestrator emission, debug timeline
- Checkpoint 3B.2: SqliteEventStore, `apps/rayzan-local/data/rayzan.sqlite`, dashboard persisted timeline
- Checkpoint 3B.3: EventReplayer rebuilds in-memory stores from the SQLite event sequence
- 3B.3 follow-up: restored debates must not re-dispatch Coordinator Round 1
- Checkpoint 3B.4: versioned event envelope, causal provenance, IN_DOUBT recovery (Operator accepted)
- Checkpoint 3C.1: Rayzan Desktop foundation (Electron + React shell, shared `createRayzanServer`)
- Checkpoint 3C.1.1: debate history + at most one active debate (waiting for Operator validation)

Currently being worked on:

- None (waiting for Operator validation of 3C.1.1)

Next:

- UI/UX redesign of the Electron product (after 3C.1.1 is accepted)
- 3C.2: Agent and browser workspace
- Debate Observatory
- Operator intervention

Blockers:

- None
