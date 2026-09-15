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

## DEC-037 — BrowserTransport is provider-independent

Status: Accepted

Decision:
`BrowserTransport` implements the same pending → delivered → responded lifecycle as ManualTransport. It exposes a per-agent outbox. It does not contain tab IDs, provider names, URLs, or DOM selectors. The extension reports successful submission before Rayzan marks a delivery `delivered`. Failed injection leaves the delivery pending.

Reason:
Provider DOM changes must not leak into protocol or transport.

## DEC-038 — Tab binding and provider DOM live only in the browser layer

Status: Accepted

Decision:
The extension binds a tab to a Rayzan Agent ID. Protocol `Agent` remains `id`, `name`, `role`. Adapter modules own `canHandle`, `sendPrompt`, and `captureLatestResponse`. Manual Capture is the MVP completion signal. Phase 3A demo bootstraps one active Debate/Round in `apps/rayzan-local` because `start-round` is deferred. `Continue Coordinator` is a temporary application relay of an already-stored Watcher response.

Reason:
The first usable slice must prove provider ≠ Agent ≠ role without expanding the protocol model.

## DEC-039 — Automatic capture is the default browser behavior

Status: Accepted

Decision:
Browser adapters snapshot assistant-turn state, send the prompt, wait for a **new** assistant turn, then wait for provider-specific generation completion plus a short text-stability window. Manual Capture and Retry Auto Capture are fallback/debug actions only. Completion detection and DOM selectors stay in adapter modules. Responses are submitted against the delivery ID from that send cycle, never inferred from response text.

Reason:
Capturing the last message after an arbitrary timeout can steal an older turn.

## DEC-040 — Round 1 application auto-closes collection when complete

Status: Accepted

Decision:
`rayzan-local` calls `RoundWorkflow.completeRound` when `progress.complete` becomes true after Watcher responses. This is application automation for the Round 1 MVP. `RoundWorkflow` does not globally auto-complete. This is not debate convergence and does not create Round 2.

Reason:
All-responses-received is mechanical collection, not semantic consensus.

## DEC-041 — V1 debate topology (Round 2 not implemented)

Status: Accepted as documentation; Round 2 is not implemented in Phase 3A

Decision:
Default v1 deliberation:

- Round 1: independent parallel Watcher responses
- Round 2: mechanically complete common evidence packet plus Coordinator personalized challenges
- Then Coordinator synthesis

For 2–4 Watchers, the intended Round 2 common packet is the full attributed Round 1 responses. Coordinator cannot hide baseline Round 1 evidence.

Phase 3A stops after a complete real Round 1. Round 2 is not implemented yet.

Reason:
The Operator wants a usable Round 1 before any later-round automation.

## DEC-042 — Application-layer Round 2 common evidence and personalized dispatch

Status: Accepted

Decision:
After Round 1 collection completes, `rayzan-local` auto-closes Round 1, bootstraps Round 2 (Watchers only; not a `start-round` command), and sends the full attributed Round 1 responses to the Coordinator. Parsed Coordinator challenges are not sent as-is. The application prepends one common Round 1 evidence packet to every Watcher Round 2 body and augments `referencedMessageIds` with both Round 1 response IDs if the Coordinator omitted them. Round 2 Watcher responses are captured. Coordinator final synthesis is a separate debate artifact (`DebateSynthesis`), not another round.

Reason:
Coordinator may choose personalized challenges but must not hide the Round 1 baseline. This policy lives in the MVP application layer, not in `MessageEnvelope`.

## DEC-043 — Coordinator final synthesis is a debate artifact

Status: Accepted

Decision:
After Round 2 Watcher responses are captured, Rayzan sends one synthesis packet to the Coordinator (original problem, Round 1 brief, Round 1 responses, Round 2 plan, Round 2 responses). The Coordinator returns a structured Operator report. That report is stored as `DebateSynthesis` (`debateId`, `coordinatorId`, `body`, `createdAt`), not as another debate round and not as the canonical conversation object. Messages remain the audit trail. The Coordinator recommends; the Operator decides. Round 3 is not started.

Reason:
The Operator should understand the debate from one report without reading Watcher tabs or the raw timeline. Mixing that report into inter-agent `MessageEnvelope` traffic would confuse conversation with conclusion.

## DEC-046 — Rayzan records system evolution through append-only events

Status: Accepted

Decision:
Rayzan records system evolution through append-only events. The event log is the source of truth for debate history, future replay, and a visible timeline. Events are generic (`type`, optional `debateId` / `roundId` / `agentId`, `timestamp`, `payload`) and do not carry provider or browser fields. `OPERATOR_INTERVENTION` is a reserved type; intervention behavior is not implemented in 3B.1. The in-memory store is append-only and returns copies. Persistent storage is deferred to a later checkpoint.

Reason:
Debate transparency, replay, and auditability require an immutable history of what happened. Semantic interpretation stays with the Coordinator. Events record facts; they do not decide meaning.

## DEC-047 — Event history is persisted through an append-only SQLite store

Status: Accepted

Decision:
Event history is persisted through an append-only SQLite store. `SqliteEventStore` implements the existing `EventStore` contract beside `InMemoryEventStore`. Production `rayzan-local` (`pnpm start:local`) injects SQLite at `apps/rayzan-local/data/rayzan.sqlite`. Tests keep `InMemoryEventStore` or a temporary database. The SQLite library is `better-sqlite3` 12.11.1 (Node 20 compatible; v13 requires Node 22). No ORM. The table is:

```sql
create table events (
    sequence integer primary key autoincrement,
    id text not null unique,
    type text not null,
    debate_id text,
    round_id text,
    agent_id text,
    timestamp text not null,
    payload_json text not null
);
```

Sequence is storage metadata; callers do not generate it. Duplicate IDs are rejected. Payloads stay generic JSON. Timestamps are stored as ISO-8601 and reconstructed from that stored string, not from the current clock. Schema version was `PRAGMA user_version = 1` at 3B.2. Envelope versioning and causal columns are 3B.4 (`PRAGMA user_version = 2`).

Reasons:

- durability
- auditability
- deterministic ordering
- foundation for replay/crash recovery

## DEC-048 — Runtime state is reconstructed by deterministic replay of the append-only event log

Status: Accepted

Decision:
Runtime state is reconstructed by deterministic replay of the append-only event log. Persistent events are the durable history. In-memory protocol stores are runtime projections. `EventReplayer` applies `SqliteEventStore.listAll()` (sequence order, never timestamp order) onto fresh AgentRegistry, DebateStore, RoundStore, MessageStore, ExposureLedger, DebateSynthesis, and a frozen delivery projection. Replay mutates state only; it does not append events and does not trigger browser/HTTP/capture side effects. Replay restores known state. Replay does not automatically resume interrupted browser deliveries. After a debate is restored, Start live debate and Create Round 1 are refused so Rayzan cannot inject a second Coordinator Round 1 prompt into an existing chatbot thread.

Reason:
Crash recovery must reproduce the same logical Rayzan state from the same event stream without duplicating prompts or inventing missing historical fields.

## DEC-049 — Events use an explicit versioned envelope with causal and correlation metadata

Status: Accepted

Decision:
Events use an explicit versioned envelope with causal and correlation metadata. Newly emitted events set `schemaVersion = 1`. Optional `causationEventId` is the previous event that directly caused this event. Optional `correlationId` groups events that belong to one logical operation. SQLite `sequence` remains authoritative event order and is not domain causality. Causation is validated at append against already-stored earlier events; timestamps are never used to resolve causality. Historical events from before 3B.4 may lack these fields and are read as legacy schema version 0. Existing rows are not rewritten. SQLite migrates `PRAGMA user_version` from 1 to 2 by adding nullable `schema_version`, `causation_event_id`, and `correlation_id` columns.

Reason:
The Observatory and crash recovery need a stable, versioned event contract with explicit causal edges rather than inferred timelines.

## DEC-050 — External side effects use requested/confirmed/failed lifecycle events and unresolved operations become IN_DOUBT after recovery

Status: Accepted

Decision:
External side effects use requested/confirmed/failed lifecycle events. Prompt send is `PROMPT_DISPATCH_REQUESTED` then `PROMPT_DISPATCH_CONFIRMED` or `PROMPT_DISPATCH_FAILED`. Capture is `CAPTURE_REQUESTED` then `RESPONSE_CAPTURED` or `CAPTURE_FAILED`. If restart happens after a request and before any terminal event, recovery classifies the action `IN_DOUBT`. Replay remains side-effect free: it does not resend, retry, or start capture. The crash test approximates process death by closing the SQLite store and reopening the same file; it is not a full OS-level `kill -9` harness.

Reason:
Browser and other external actions are not replayable. The Operator must see incomplete external work explicitly instead of silent duplication.

