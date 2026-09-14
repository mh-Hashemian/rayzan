# Decisions

Append-only decision record. Do not rewrite earlier entries. Add a new entry when a decision changes.

## DEC-001 — Project name is Rayzan

Status: Accepted

Decision:
The project name is Rayzan.

Reason:
The Operator selected this name for the local-first debate and orchestration tool.

## DEC-002 — Architecture is local-first

Status: Accepted

Decision:
Rayzan runs locally. The Operator's machine is the system of record for protocol state.

Reason:
The tool exists to coordinate local agents and remove copy/paste work. A remote control plane is not part of the agreed architecture.

## DEC-003 — Coordinator owns semantic decisions

Status: Accepted

Decision:
The Coordinator owns semantic judgment: the question being debated, what each Watcher should see, how positions are interpreted, whether another round is needed, when the debate has converged, and the final synthesis.

Reason:
Semantic reasoning must stay with the agent that holds complete debate context. The software system must not decide meaning.

## DEC-004 — Orchestrator owns mechanical protocol enforcement

Status: Accepted

Decision:
The Orchestrator owns mechanical protocol invariants: agent identity, routing, round state, recipient enforcement, attribution, delivery state, the exposure ledger, audit/history, and Round 1 isolation.

Reason:
Protocol integrity is a software concern. Separating it from semantic judgment keeps debates enforceable without replacing the Coordinator.

## DEC-005 — Coder is the only implementation agent

Status: Accepted

Decision:
Only Coder may modify project files, repository state, configuration, or perform implementation work.

Reason:
Implementation authority must stay with the agent that has codebase access. Coordinator and Watchers remain non-implementing roles.

## DEC-006 — Watchers remain independent during Round 1

Status: Accepted

Decision:
Round 1 isolates Watchers. Each Watcher receives the shared brief and must not receive another Watcher's opinion during that round.

Reason:
Independent first opinions are a core protocol rule. Later rounds may cross-examine; Round 1 must not.

## DEC-007 — The system maintains an exposure ledger

Status: Accepted

Decision:
Rayzan records what information has been exposed to each agent.

Reason:
Independence and later cross-examination depend on knowing who has seen what. The Orchestrator must be able to enforce and audit that history.

## DEC-008 — Transport implementations are pluggable

Status: Accepted

Decision:
How a message is delivered is a replaceable transport. Manual, browser, and API transports share the same protocol model.

Reason:
Delivery mechanism must not define the architecture. The Orchestrator stays authoritative across transports.

## DEC-009 — Manual transport is the permanent fallback

Status: Accepted

Decision:
Manual copy/paste remains a first-class transport, not a temporary scaffold.

Reason:
Browser and API paths can fail. The Operator must still be able to complete a debate by hand.

## DEC-010 — Browser extension is a generic bridge rather than the core system

Status: Accepted

Decision:
The browser extension is a generic bridge between the local Orchestrator and a bound browser tab. It is not the Orchestrator and not the debate engine.

Reason:
Browser automation is a delivery path. Core protocol state and debate mechanics stay in the local Orchestrator.

## DEC-011 — Each AI website gets an isolated provider adapter

Status: Accepted

Decision:
Provider-specific browser behavior lives in small adapter modules inside the browser-extension layer, such as `chatgpt.ts`, `deepseek.ts`, `qwen.ts`, and `glm.ts`. An adapter is not a separate project.

Reason:
Website DOM and interaction details differ by provider. Isolating them keeps the bridge generic and limits the blast radius of a broken site.

## DEC-012 — A broken provider adapter degrades to manual operation

Status: Accepted

Decision:
If a provider adapter fails, that provider falls back to manual transport. A broken adapter must not stop the debate.

Reason:
One website change must not block the Operator or other agents.

## DEC-013 — Browser captures initially require Operator confirmation

Status: Accepted

Decision:
The first browser MVP captures a response only after the Operator confirms it.

Reason:
Automatic capture is unreliable across providers. Explicit confirmation keeps attribution correct until reliability is proven.

## DEC-014 — Automatic completion detection is not required for the first browser MVP

Status: Accepted

Decision:
The first browser MVP does not need to detect when a provider has finished generating a response.

Reason:
Completion detection is provider-specific and error-prone. Operator-triggered capture is enough for the first bridge.

## DEC-015 — First shared package is packages/protocol

Status: Accepted

Decision:
The first implementation package is `packages/protocol`. It holds shared protocol and domain types. Do not use `packages/orchestrator` or `packages/core` for this layer. Later applications such as the orchestrator and browser extension will live under `apps/` and depend on this package.

Reason:
These types are shared debate concepts, not the orchestrator implementation. `core` is too generic and tends to become a catch-all. The orchestrator, extension, dashboard, and transports should all be able to depend on one portable protocol package.

## DEC-016 — MessageKind remains a closed set

Status: Accepted

Decision:
`MessageKind` stays the current closed set: `input`, `brief`, `query`, `response`, `fact`, `synthesis`. Do not accept arbitrary strings. Add a new kind only when Rayzan genuinely needs one. Routing must not depend heavily on semantic interpretation of `MessageKind`.

Reason:
These values are enough for the current protocol. A loose string field would hide new kinds instead of forcing a deliberate change.

## DEC-017 — MessageEnvelope recipients are always concrete Agent IDs

Status: Accepted

Decision:
Canonical `MessageEnvelope.recipientIds` always contains concrete Agent IDs. Do not support role or group targets such as `all-watchers` on the envelope. Broadcast or group addressing is expanded before the envelope becomes official.

Reason:
The exposure ledger must be able to state exactly which agents received a message.

## DEC-018 — Every MessageEnvelope belongs to a Debate

Status: Accepted

Decision:
Every `MessageEnvelope` requires a `debateId`. Operator intake creates a Debate with status `pending` first. There are no protocol messages outside a Debate.

Reason:
A floating message cannot be attributed, stored, or exposed against a debate. "Pre-debate intake" is the start of that pending Debate.

## DEC-019 — Application commands are not debate messages

Status: Accepted

Decision:
Operations such as create debate, add watcher, and bind browser tab are application/domain commands. They must not be modeled as `MessageEnvelope`.

Reason:
Debate messages carry attributed conversation content. Mixing control commands into that type would blur protocol state with application control.

## DEC-020 — Transports live in packages/transport

Status: Accepted

Decision:
Transport code lives in `packages/transport` (`@rayzan/transport`). It may depend on `@rayzan/protocol`. `@rayzan/protocol` must not depend on transport.

Reason:
Protocol types and stores are delivery-independent. Browser, API, and manual transports should share one protocol model without pulling transport concerns into it.

## DEC-021 — Transports deliver per recipient

Status: Accepted

Decision:
A canonical `MessageEnvelope` may list multiple concrete recipients. Transport-level delivery records are one outbound delivery per recipient. The canonical envelope is not duplicated or mutated to accomplish this.

Reason:
Manual copy/paste, browser tabs, and API requests all happen per agent. The exposure ledger and response attribution also need a single recipient per delivery.

## DEC-022 — Delivery IDs correlate outbound requests to responses

Status: Accepted

Decision:
Every per-recipient outbound delivery has a stable delivery/correlation ID. A submitted response refers to that ID. Rayzan does not infer the responder, debate, or outbound request from response text.

Reason:
Structural correlation prevents misattribution, including one Watcher's response satisfying another Watcher's delivery.

## DEC-023 — Delivery lifecycle is pending → delivered → responded

Status: Accepted

Decision:
An outbound delivery moves `pending` → `delivered` → `responded`. `pending` means queued, not received. `delivered` means delivery was explicitly confirmed. `responded` means a valid correlated response was submitted. A response is accepted only from `delivered`. Duplicate delivery confirmation and `pending → responded` are rejected.

Reason:
Queued dispatch and actual receipt are different events. The same lifecycle will apply to browser and API transports even though confirmation works differently internally.

## DEC-024 — Exposure means confirmed delivery, not queued dispatch

Status: Accepted

Decision:
Creating or queuing an outbound delivery does not mean the recipient was exposed to the message. Exposure is recorded only after successful delivery confirmation. Transport does not write the Exposure Ledger. The future orchestrator connects `delivered` to an ExposureRecord.

Reason:
The ledger must stay truthful. A message waiting for the Operator to paste it has not been seen by the recipient.

## DEC-025 — Orchestrator connects protocol state to transports

Status: Accepted

Decision:
`@rayzan/orchestrator` is the coordination layer. It may depend on `@rayzan/protocol` and `@rayzan/transport`. Protocol and transport must not depend on orchestrator. Orchestrator is constructed with injected `MessageStore`, `ExposureLedgerStore`, and `Transport` contracts. It does not instantiate concrete stores.

Confirmed delivery causes Orchestrator to record an ExposureRecord. Accepted inbound responses are stored as canonical MessageEnvelopes. Transport owns delivery and correlation validation. Orchestrator owns coordination between subsystems. It does not decide debate semantics.

Reason:
Protocol objects and transports were independent. A thin coordination layer is needed to store messages, confirm deliveries, and record exposure without putting those duties into transport or a future UI.

## DEC-026 — Orchestrator tracks mechanical round execution only

Status: Accepted

Decision:
`Round` remains a protocol object. `RoundWorkflow` in `@rayzan/orchestrator` tracks one running round: explicit participants, associated deliveries, and who has responded. Coordinator chooses participants and message content. Orchestrator does not discover Watchers by role, does not inspect bodies, and does not decide convergence. `progress.complete` means all expected responses arrived. That is not debate convergence. The next round is created only by an explicit later call, never automatically. One round may contain multiple canonical messages.

Reason:
Rayzan needs to know who is still waiting without taking semantic authority from the Coordinator.

## DEC-027 — Exposure references are declared at dispatch

Status: Accepted

Decision:
`referencedMessageIds` are declared on `DispatchIntent` at dispatch time, not on `confirmDelivery` and not on `MessageEnvelope`. Dispatch is the intended exposure. Confirm delivery is whether that intended exposure happened. Metadata is kept in memory per delivery inside the orchestrator. After `markDelivered` succeeds, Orchestrator copies those IDs onto the ExposureRecord. Duplicate, unknown, or cross-debate references are rejected. A reference is Coordinator's explicit declaration, not a claim that Rayzan inspected message text.

Reason:
Coordinator already knows which prior messages a Round 2 prompt draws from before anyone is delivered. Confirming delivery should not invent or restate that semantic metadata.

## DEC-028 — Coordinator is an external transport-connected Agent

Status: Accepted

Decision:
Coordinator intelligence is external to Rayzan. `coordinator` is an Agent role. A Coordinator may use any supported AI provider or model. Provider and role are independent: never infer role from provider, and never bind a provider to a role. Multiple conversations from the same provider may represent different Rayzan Agents and roles. Coordinator uses the same transport abstraction as other agents. Rayzan does not perform semantic debate reasoning. Future structured Coordinator commands are an interface between the external Coordinator and Rayzan, not an internal LLM. Provider and conversation binding belong to a later connection layer, not to `Agent`, `MessageEnvelope`, `DispatchPlan`, `DispatchIntent`, `Round`, or `Debate`.

Reason:
Rayzan is mechanical control. The debate is conducted by connected chatbots. Treating Coordinator as a special in-process engine, or as “whatever DeepSeek is,” would collapse role, provider, transport, and conversation.

## DEC-029 — Recipient routing is mechanical and provider-agnostic

Status: Accepted

Decision:
Group addressing is resolved by `DispatchPlanner` from a `DispatchPlan` and `RecipientSelector` into a `DispatchIntent` with concrete `recipientIds`. `round-watchers` means Watcher participants of that round, not every registered Watcher, and the sender must exist with role `coordinator`. `explicit-agents` means the listed Agent IDs and does not require a Coordinator sender. The planner does not depend on a Coordinator provider. Other mechanically valid plans, including Operator → Coordinator and Coordinator → Coder, use the same planner. Canonical `MessageEnvelope` objects still never carry `all-watchers` or role-based addressing.

Reason:
Broadcast aliases belong above the protocol message. Routing must stay reusable before any Coordinator chatbot, browser binding, or API transport exists.

## DEC-030 — Coordinator communicates through a versioned command protocol

Status: Accepted

Decision:
The external Coordinator produces explicit machine-readable commands. v1 is a JSON document `{ version: 1, commands: CoordinatorCommand[] }`. Commands are a closed union: `dispatch`, `complete-round`, and `finalize-debate`. `dispatch` does not include `senderId`; the future executor supplies it from the inbound Coordinator message. `complete-round` requests later mechanical round closure, not debate convergence. `finalize-debate` carries the Coordinator's synthesis text without semantic validation. `start-round` is deferred because it mixes entity creation, round numbering, and participant selection. Phase 2E parses only. It does not execute.

Reason:
Rayzan must not infer actions from arbitrary chatbot prose. A versioned, explicit command list is the interface between the external Coordinator and existing orchestration.

## DEC-031 — Coordinator output is untrusted

Status: Accepted

Decision:
Coordinator chatbot output is untrusted input even though Coordinator is a Rayzan Agent. Raw text is parsed strictly into a closed command union before Rayzan can act. The parser validates shape and syntax only: invalid JSON, unknown fields, unknown command types, wrong primitives, empty required bodies, invalid selectors, and duplicate IDs are rejected. The parser does not consult stores or invoke orchestration. There is no `eval`, no dynamic method dispatch, and no generic tool/shell/HTTP command.

Reason:
A connected model can emit anything. Mechanical safety depends on parsing into known commands, then executing those commands later against protocol state.

## DEC-032 — Coordinator command protocol is provider-independent

Status: Accepted

Decision:
DeepSeek, ChatGPT, Qwen, GLM, tests, and future API Coordinators use the same command schema. Provider adapters may later handle how text is delivered and captured. They do not define Rayzan commands.

Reason:
Role, provider, and transport stay independent. Command meaning belongs to Rayzan, not to a vendor-specific formatter.

## DEC-033 — Trusted Coordinator identity comes from transport/message context

Status: Accepted

Decision:
Coordinator command JSON must not contain `senderId`. `CoordinatorCommandExecutor` receives a trusted `CoordinatorExecutionContext` whose `coordinatorId` and `debateId` come from the inbound Coordinator message, not from parsed commands. The Agent must exist and have `role: 'coordinator'`. Provider names are never inspected. Every command in the batch must target that trusted Debate; a mismatch rejects the whole batch before side effects.

Reason:
A Coordinator chatbot must not impersonate another Agent or mutate another Debate by emitting JSON.

## DEC-034 — Coordinator command execution is ordered, fail-fast, and non-transactional

Status: Accepted

Decision:
Commands execute in array order. If one command fails, later commands are not run. Earlier successful commands are not rolled back. v1 has no transaction or undo infrastructure. Whole-batch preflight covers trusted sender, debate scope, and `finalize-debate` placement before any mutation.

Reason:
Ordered mechanical execution is enough to connect the parser to existing orchestration. Transactions would be a new subsystem.

## DEC-035 — finalize-debate closes a Debate only after existing rounds are completed

Status: Accepted

Decision:
`finalize-debate` is not convergence analysis. It requires Debate status `active` and every existing Round record for that Debate to be `completed`, then sets Debate status to `completed`. `finalize-debate` may appear at most once and must be last in the batch. `complete-round` still means close this collection round. No next round is created automatically.

Reason:
A completed Debate with an open round would be an inconsistent protocol state. Round creation remains a later command design.

## DEC-036 — Final synthesis is returned by execution; durable persistence is deferred

Status: Accepted

Decision:
`finalize-debate.body` is the Coordinator's synthesis for Rayzan/Operator. Phase 2F returns it on the execution result. It is not stored as a `MessageEnvelope` and there is no `DebateResultStore` yet. Callers/dashboard later decide display and persistence.

Reason:
A synthesis has no concrete protocol recipients yet. Forcing it into `MessageEnvelope` would invent a fake Operator message.
