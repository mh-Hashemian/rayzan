# Status

Current phase: Phase 3C.2 Step 2 — New Decision wizard (Steps 1–4 UI waiting for Operator validation)

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
- 3C.1 follow-up: isolate Electron better-sqlite3 (ABI 128) from the CLI Node binary (ABI 115)
- 3C.2 Step 1: product home shell (sidebar, operator bar, AI team, recent debates)
- 3C.2 Step 1.5: stable connection state, SSE live updates, provider logos, coordinator switching, watcher participation
- 3C.2 Step 2 (UI): New Decision wizard — define question, select team, review plan (Start Decision not connected yet)

Currently being worked on:

- None (waiting for Operator validation of wizard Steps 1–4 before connecting Start Decision)

Next:

- 3C.2 Step 2 Step 5: connect Start Decision to existing runtime
- 3C.2 Step 3: Debate workspace
- 3C.2 Step 4: Observatory inside a debate
- Operator intervention

Blockers:

- None
