# Status

Current phase: Phase 1 — Core Orchestrator

Completed:

- Initial workspace setup
- Baseline dependencies
- Initial project documentation
- `packages/protocol` domain model (Agent, Debate, Round, MessageEnvelope, Exposure Ledger)
- In-memory AgentRegistry, MessageStore, DebateStore, RoundStore, and ExposureLedgerStore
- `@rayzan/transport` abstraction and in-memory ManualTransport
- Delivery lifecycle: pending → delivered → responded

Currently being worked on:

- Nothing. Phase 1D delivery lifecycle is complete.

Next:

- Build the orchestrator that connects MessageStore, Transport, and Exposure Ledger
- Not started

Blockers:

- None
