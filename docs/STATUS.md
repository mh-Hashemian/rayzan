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

Currently being worked on:

- Nothing. Phase 2D recipient routing is complete.

Next:

- Remaining debate workflow (additional rounds, adding Watchers)
- Coordinator connectivity, command parsing, and browser/API transports are not started

Blockers:

- None
