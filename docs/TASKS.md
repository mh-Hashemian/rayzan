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
- [x] Track mechanical round execution and expected responses
- [x] Support Round 1 broadcast as isolated per-Watcher messages
- [x] Collect attributed Watcher responses
- [x] Support personalized Round 2 messages
- [x] Declare exposure references at dispatch and materialize them on confirm
- [x] Support Coordinator routing
- [x] Parse Coordinator command protocol
- [x] Execute Coordinator commands
- [ ] Support additional rounds
- [ ] Support adding fresh Watchers during a debate

## Phase 3 — Browser Bridge

- [x] Visible local Rayzan session: Agent registration and Round 1 bootstrap (Checkpoint 3A.1)
- [x] Browser extension tab binding and automatic prompt send (Checkpoint 3A.2)
- [x] Full Round 1 capture, Coordinator evidence, personalized Round 2 dispatch (Checkpoint 3A.3)
- [x] Coordinator final synthesis (Round 2 Watcher capture + Operator report)

## Phase 3B — Decision Observatory foundation

- [x] Event model
- [x] Event store abstraction
- [x] Persistent event storage (3B.2 — durable history; replay is 3B.3)
- [x] State replay / crash recovery (3B.3 — restore projections; do not auto-resume browser jobs or re-dispatch Start live debate)
- [x] Event contract and causal provenance (3B.4 — versioned envelope, causation/correlation, IN_DOUBT external actions)

## Phase 3C — Product UI

- [x] Rayzan Desktop foundation (3C.1 — Electron shell, shared runtime bootstrap, React status screen)
- [x] Isolate Electron better-sqlite3 (ABI 128) from CLI Node (ABI 115)
- [x] Debate history and single active debate (3C.1.1)
- [x] Product home interface (3C.2 Step 1)
- [x] Product home refinement (3C.2 Step 1.5 — SSE, logos, coordinator switch)
- [x] New Decision wizard (3C.2 Step 2 — UI Steps 1–4 + Start Decision → runtime)
- [x] Debate workspace / Observatory UI (3C.3 — layout + live progress/agents/synthesis)
- [x] 3C.3 Acceptance Stabilization (reliable complete debate loop; awaiting Operator validation)
- [x] Operator-gated iterative debate loop (3C.4 — checkpoints, Continue, guidance, Finish, dynamic Desktop stages)
- [ ] Coordinator-centric orchestration (3C.5 — Coordinator owns Watcher prompts/format; Desktop Contributions View; awaiting Operator validation)
- [ ] Agentic Coordinator action loop (3C.6 — selective/sequential/parallel dispatch + re-invocation; awaiting Operator validation)

## Phase 3D — Managed provider browser

- [ ] 3D.1 Managed Provider Browser MVP (ChatGPT + DeepSeek internal sessions; awaiting Operator validation)

## Later

- [ ] Additional managed provider adapters (Qwen, Grok, …)
- [ ] API transports
- [ ] Automatic completion detection
- [ ] More automation after reliability is proven
