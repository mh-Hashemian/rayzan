# Status

Current phase: Phase 2 — Debate Workflow

Completed:

- Initial workspace setup
- Baseline dependencies
- Initial project documentation
- `packages/protocol` domain model and in-memory stores
- `@rayzan/transport` abstraction, ManualTransport, and delivery lifecycle
- `@rayzan/orchestrator` dispatch, confirm-delivery/exposure, and response storage
- Mechanical round execution (`RoundWorkflow`)
- `DispatchIntent` exposure metadata declared at dispatch
- Recipient routing via `DispatchPlan` / `DispatchPlanner`
- Coordinator command protocol parser (`dispatch`, `complete-round`, `finalize-debate`)

Currently being worked on:

- Nothing. Phase 2E command parsing is complete.

Next:

- Coordinator command execution
- Remaining debate workflow (`start-round` deferred, additional rounds, adding Watchers)
- Coordinator connectivity and browser/API transports are not started

Blockers:

- None
