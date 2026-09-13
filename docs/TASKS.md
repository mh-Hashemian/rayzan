# Tasks

## Phase 0 — Foundation

- [x] Initialize project/workspace
- [x] Install baseline development dependencies
- [x] Create project documentation

## Phase 1 — Core Orchestrator

- [x] Define Agent model
- [x] Define MessageEnvelope
- [x] Define Debate and Round state
- [x] Define Exposure Ledger model
- [x] Implement agent registry
- [x] Implement message store
- [x] Implement debate store
- [x] Implement round store
- [x] Implement exposure ledger store
- [x] Define transport abstraction
- [x] Implement ManualTransport
- [x] Distinguish pending, delivered, and responded delivery states

## Phase 2 — Debate Workflow

- [x] Connect protocol stores to transport via Orchestrator
- [x] Dispatch canonical messages
- [x] Confirm delivery and record exposure
- [x] Store inbound responses
- [ ] Support Coordinator routing
- [ ] Support Round 1 broadcast as isolated per-Watcher messages
- [ ] Collect attributed Watcher responses
- [ ] Support personalized Round 2 messages
- [ ] Support additional rounds
- [ ] Support adding fresh Watchers during a debate

## Phase 3 — Browser Bridge

- [ ] Create browser extension foundation
- [ ] Connect extension to local orchestrator
- [ ] Implement explicit tab-to-agent binding
- [ ] Define BrowserAdapter interface
- [ ] Implement first provider adapter
- [ ] Implement prompt sending
- [ ] Implement Operator-triggered response capture
- [ ] Implement manual fallback when adapter fails

## Later

- [ ] Additional provider adapters
- [ ] API transports
- [ ] Automatic completion detection
- [ ] More automation after reliability is proven
