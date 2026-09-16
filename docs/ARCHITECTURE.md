# Architecture

Rayzan is local-first. The Operator runs debates on a local machine. The Orchestrator is the software system that enforces protocol mechanics; it is not a remote service.

This repository is a pnpm TypeScript workspace.

```text
rayzan/
├── packages/
│   ├── protocol/        # shared protocol/domain model
│   ├── events/          # append-only event model and EventStore contract
│   ├── storage/         # InMemoryEventStore + SqliteEventStore
│   ├── transport/       # ManualTransport + provider-independent BrowserTransport
│   └── orchestrator/    # stores, routing, command parse/execute, event replay
├── apps/
│   ├── rayzan-local/    # composition root, HTTP bridge, debug dashboard, CLI
│   ├── rayzan-desktop/  # Electron + React product shell
│   └── browser-extension/
└── docs/
```

`packages/protocol` defines portable debate types, invariants, and in-memory stores. It has no dependency on browsers, UI, databases, networks, or AI providers. It does not deliver messages. It must not import `@rayzan/transport` or `@rayzan/orchestrator`.

## Event Layer

Purpose: immutable history of system evolution.

Events record what happened. They do not decide meaning. There is no AI analysis, sentiment, agreement detection, or position extraction in this layer. The Coordinator remains responsible for semantic interpretation.

Current production CLI (`pnpm start:local`): append-only `SqliteEventStore` at `apps/rayzan-local/data/rayzan.sqlite` (gitignored). Rayzan Desktop uses `<userData>/rayzan.sqlite` via `app.getPath('userData')`. Tests inject `InMemoryEventStore` or a temporary SQLite file. `createRayzanServer({ databasePath, host, port })` is the shared bootstrap; Orchestrator does not create the database. CLI Node loads `better-sqlite3` at ABI 115. Electron 32 loads a separate copy rebuilt under `apps/rayzan-desktop/.electron-native/` for ABI 128. The workspace CLI binary is never overwritten. The Electron renderer is a React product shell that reads `/api/status` and `/api/state`; `/debug` remains the engineering dashboard.

`listAll()` and `listByDebate()` return events in `sequence` order (`INTEGER PRIMARY KEY AUTOINCREMENT`), not timestamp order. Payloads are stored as JSON. Timestamps are ISO-8601 and reconstructed as the original `Date`. Duplicate event IDs are rejected. There is no update or delete on `EventStore`.

The event envelope is versioned (`schemaVersion`). Newly emitted events use `schemaVersion = 1`. Historical rows from before 3B.4 are read as legacy (`schemaVersion = 0`) without rewriting stored JSON. Optional `causationEventId` is a direct causal edge to an earlier event. Optional `correlationId` groups one logical operation. SQLite `sequence` is storage order, not domain causality. Causation is validated at append: the cause must already exist (so it is earlier in sequence), must not be the same event, and must not belong to a different debate. Cycles are impossible because a cause can only point backward.

Checkpoint 3B.3 reconstructs in-memory protocol stores by replaying that sequence. Persistent events are the durable history. In-memory stores are runtime projections. There are no `agents` / `debates` / `messages` SQLite tables. Replay performs no browser send, HTTP send, or capture. Interrupted deliveries are restored as frozen unresolved jobs; the Operator must not expect automatic resend. Rayzan preserves multiple debates historically but permits at most one active debate. A completed or archived debate does not block a new debate. An incomplete restored debate remains the active debate until the Operator ends or archives it. Start live debate does not resend Coordinator Round 1 into that existing thread.

External browser actions use request/confirmed/failed lifecycle events (`PROMPT_DISPATCH_*`, `CAPTURE_REQUESTED`, `RESPONSE_CAPTURED`, `CAPTURE_FAILED`). After replay, a request without a later terminal is `IN_DOUBT`. Replay never retries those actions.

See `docs/EVENT-CATALOG.md` for per-type payload, causation, correlation, and replay effects.

SQLite `PRAGMA user_version = 2` adds nullable `schema_version`, `causation_event_id`, and `correlation_id` columns. Existing v1 databases are migrated in place. Old rows keep NULL envelope columns.

The event log is generic. It does not carry provider or browser fields.

`packages/events` (`@rayzan/events`) depends on `@rayzan/protocol` for branded IDs. `packages/storage` (`@rayzan/storage`) implements `EventStore` (`InMemoryEventStore` and `SqliteEventStore`). `@rayzan/orchestrator` emits mechanical events; it does not require storage to dispatch.

`packages/transport` (`@rayzan/transport`) depends on `@rayzan/protocol`. It delivers and receives messages. It does not decide debate semantics. It must not import `@rayzan/orchestrator`.

`packages/orchestrator` (`@rayzan/orchestrator`) depends on protocol, transport, and the event store contract. Low-level `Orchestrator` is constructed with injected store, transport, and optional `EventStore` contracts. It stores canonical messages, asks transport to send and confirm them, records exposure after `delivered`, stores accepted inbound responses, and appends mechanical events. Events do not change dispatch behavior.

Rayzan is not the intelligence that conducts a debate. Coordinator, Watchers, and Coder are external agents connected through transports. Rayzan only manages protocol state, routing, deliveries, exposure, correlation, and workflow bookkeeping.

```text
               external AI agents

        ┌────────────┬────────────┐
        │            │            │
        ▼            ▼            ▼
 Coordinator       Watchers      Coder
   chatbot         chatbots    coding agent
        │            │            │
        └────────────┼────────────┘
                     │
                     ▼
                   Rayzan
             mechanical control
```

`coordinator` is an Agent role, not a provider and not a Rayzan-built reasoning engine. The same AI provider may host different Rayzan agents and roles at once (for example a DeepSeek Coordinator conversation and a DeepSeek Reviewer Watcher). Role, provider, transport, and browser conversation are independent. Protocol and routing code must not infer role from provider, and must not carry `browserTabId`, `providerName`, `conversationUrl`, or DOM selectors on `Agent`, `MessageEnvelope`, `DispatchPlan`, `DispatchIntent`, `Round`, or `Debate`.

Future Coordinator commands are a structured interface between that external chatbot and Rayzan. `start-round` is intentionally deferred until round-creation semantics are designed.

```text
Coordinator Agent
    ↓
raw response
    ↓
CoordinatorCommandParser
    ↓
CoordinatorCommandBatch
    ↓
CoordinatorCommandExecutor
    ↓
DispatchPlan / RoundWorkflow / Orchestrator / DebateStore
```

A Coordinator response is raw text. A `CoordinatorCommand` is a validated mechanical instruction. Rayzan does not infer actions from prose. v1 requires the entire response to be JSON; wrapped or mixed prose is rejected. Coordinator output is untrusted: it never goes through `eval`, dynamic method dispatch, or arbitrary tool execution. The command vocabulary is a closed union (`dispatch`, `complete-round`, `finalize-debate`) and is the same for every Coordinator provider.

`dispatch` omits `senderId`. The executor binds the sender from trusted execution context (`InboundResponse.senderId` / Coordinator Agent ID, plus the inbound `debateId`). Command JSON cannot impersonate another Agent.

Command batches are ordered and fail-fast. They are not transactional in v1: an earlier command may have already taken effect when a later command fails. Cheap whole-batch checks run first: trusted Coordinator identity, debate scope, and `finalize-debate` placement (`finalize-debate` at most once, and only last).

Round-bound `dispatch` goes through `RoundWorkflow.dispatchPlan`. A dispatch without `roundId` goes through `DispatchPlanner` and `Orchestrator.dispatch` so Coordinator → Coder handoff is not forced into a Watcher round.

`complete-round` closes mechanical collection for that round. It is not debate convergence.

`finalize-debate` may run only when the Debate is `active` and every existing Round record is `completed`. It then sets Debate status to `completed`. The synthesis `body` is returned on the execution result. Durable synthesis persistence is deferred. No next round is created.

Addressing is expanded before a canonical message exists:

```text
DispatchPlan
        ↓
DispatchPlanner
        ↓
DispatchIntent
        ↓
RoundWorkflow / Orchestrator
```

`DispatchPlan` names a sender and a `RecipientSelector`. `DispatchPlanner` resolves that selector into concrete `recipientIds` and produces a `DispatchIntent`. The planner is mechanical and provider-agnostic. It does not care whether the plan came from DeepSeek, ChatGPT, Qwen, Claude, a test, or a future API integration.

Supported selectors:

- `round-watchers` — Watcher participants of the named round, not every agent with role `watcher`
- `explicit-agents` — the listed Agent IDs

A Coordinator agent may be the sender of a `round-watchers` plan; that selector requires the sender to exist and to have role `coordinator`. The same planner can also resolve Operator → Coordinator and Coordinator → Coder using `explicit-agents`. It does not require every plan to come from a Coordinator.

Dispatch is then expressed as `DispatchIntent`: a `MessageEnvelope` plus `referencedMessageIds`. Those IDs are structural declarations from Coordinator, not a result of reading message text.

```text
DispatchPlan      — sender + recipient selector + message fields
DispatchIntent    — concrete message + intended structural exposure metadata
MessageEnvelope   — the protocol message itself
ExposureRecord    — what was actually exposed after confirmed delivery
```

References are attached to each per-recipient delivery at dispatch and materialized on the ExposureRecord only after `confirmDelivery`. Transport does not store or interpret them.

`RoundWorkflow` tracks mechanical state for one round: who is expected to respond, which deliveries belong to the round, and whether those responses have arrived. Coordinator chooses participants and content. Orchestrator does not decide when another round is needed or whether the debate has converged. All-responses-received is not convergence. A new round is never created automatically.

Documented v1 debate strategy:

```text
Round 1: independent parallel Watcher responses
Round 2: common unfiltered evidence packet + Coordinator personalized challenges
Then Coordinator synthesis
```

Checkpoint 3A.3 implements Round 1 collection, Coordinator evidence intake, and personalized Round 2 dispatch. Coordinator final synthesis then captures Round 2 Watcher responses and stores a `DebateSynthesis` report. That report is not a `MessageEnvelope` between agents and is not Round 3. Round 2 is bootstrapped in `apps/rayzan-local`, not via a Coordinator `start-round` command.

Protocol `Round` status is reused as:

```text
pending     — Round exists, execution has not started
active      — startRound configured participants
collecting  — at least one message has been dispatched
completed   — completeRound closed the collection
```

`active` and `collecting` are kept distinct. One round execution may include several canonical messages (global Round 1 or personalized Round 2).

The in-memory stores hold Agents, Debates, Rounds, MessageEnvelopes, Exposure records, and DebateSynthesis reports. They are temporary memory, not persistence. They do not route messages, expand broadcasts, or advance debate state.

Broadcast or group addressing is expanded into concrete `recipientIds` before a `MessageEnvelope` is stored.

Application commands such as create debate, add watcher, or bind a browser tab are not `MessageEnvelope` objects.

Phase 3A Round 1 vertical slice:

```text
DeepSeek Coordinator
        ↕
DeepSeekAdapter
        ↕
Browser Extension
        ↕
Local Bridge
        ↕
BrowserTransport
        ↕
Orchestrator
        ↓
DispatchPlanner / CoordinatorCommandExecutor
        ↓
Qwen / GLM Browser Deliveries
        ↕
QwenAdapter / GLMAdapter
```

`BrowserTransport` is provider-independent. Automatic capture is the default: adapters snapshot assistant-turn count, send, wait for a **new** turn, then wait for provider completion plus a short stability window. Manual Capture is fallback only. Tab/conversation binding exists only in the browser layer. Protocol `Agent` still has no provider, tab, or URL fields.

Phase 3A demo bootstraps one active Debate/Round 1 from registered Watchers because `start-round` is deferred. When both Watcher responses are recorded, `rayzan-local` calls `completeRound`. That is not debate convergence and does not create Round 2.

## Roles

| Role         | Kind           | Responsibility                                                                                                                                                                               |
| ------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operator     | Human          | Final authority. Introduces the problem, may override any recommendation, and approves implementation.                                                                                       |
| Coordinator  | External agent | Connected chatbot that owns complete debate context, semantic reasoning, debate rounds, synthesis, and convergence decisions. Does not implement. Rayzan does not contain this intelligence. |
| Watchers     | Agents         | Independent reasoning agents. Analyze, challenge, and recommend. Do not implement.                                                                                                           |
| Coder        | Agent          | Codebase authority and the only implementation agent.                                                                                                                                        |
| Orchestrator | Software       | Mechanical protocol concerns: identity, routing, round state, delivery, attribution, exposure, and history.                                                                                  |

## Responsibility boundary

**Coordinator is an external agent.** Semantic judgment lives in the connected Coordinator chatbot, not in Rayzan. Examples:

- what question is being debated
- what information a Watcher should receive
- how Watcher positions should be interpreted
- whether another debate round is needed
- when the debate has converged
- final synthesis and recommendation

Rayzan must not contain a Coordinator engine that analyzes opinions, decides consensus, or chooses the next question.

**Orchestrator owns mechanical protocol invariants.** Examples:

- agent identity
- message routing
- round state
- recipient enforcement
- attribution
- delivery state
- exposure ledger
- audit/history
- Round 1 isolation

## Transports

Transport implementations are pluggable. Planned transports:

- **Manual transport** — permanent fallback. The Operator copies and pastes messages. This remains available even if every browser or API integration is broken.
- **Browser transport** — a browser extension acting as a generic bridge to provider websites.
- **API transport** — later, for providers that expose a usable API.

A transport sees a canonical `MessageEnvelope` and creates one outbound delivery per concrete recipient. Each delivery has its own delivery ID. The original envelope is not mutated.

Delivery lifecycle:

```text
pending → delivered → responded
```

`pending` means Rayzan queued the delivery. `delivered` means receipt was explicitly confirmed. `responded` means a correlated response was submitted. A response is not accepted from `pending`.

Creating or queuing a delivery does not record exposure. Exposure is a protocol fact and is recorded only after `delivered`. Transport does not write the Exposure Ledger. Orchestrator records an ExposureRecord after Transport successfully marks a delivery `delivered`.

There is no transaction across those two steps. If exposure recording failed after `markDelivered` succeeded, the delivery would be `delivered` without an exposure row. Phase 2A does not roll that back. In-memory stores should not fail after validated input except on a duplicate exposure id.

A response is submitted against a delivery ID and becomes an attributed `MessageEnvelope`.

Transports do not know what a round means, whether Watchers may see each other, or whether the debate should continue.

Browser automation is not the core architecture. The Orchestrator remains authoritative regardless of how a message is delivered.

## Browser extension and adapters

The browser extension is a generic browser bridge. It connects a bound tab to an agent and delegates provider-specific behavior to small adapter modules inside the extension layer:

```text
adapters/
├── fixture.ts
├── deepseek.ts
├── qwen.ts
└── glm.ts
```

An adapter is not a separate project. It is provider-specific source code inside the browser-extension layer.

A broken adapter must not stop the debate. That provider degrades to manual capture fallback.

Automatic capture is the default for bound tabs. Manual Capture is fallback/debug only.

## State

There are two kinds of state:

1. **Protocol state** — Rayzan / the Orchestrator is authoritative. This includes agent identity, debate and round state, message routing, attribution, delivery, the exposure ledger, and audit/history.
2. **Provider / ambient context** — provider conversations remain authoritative for provider-specific context such as memories, custom instructions, existing conversation history, and provider settings.

The Orchestrator does not replace a provider's own conversation store. It records what Rayzan sent, received, routed, and exposed.

The exposure ledger records protocol-visible exposure through Rayzan as structural references to messages. It does not claim to know provider memory, custom instructions, old thread history, system prompts, or model-internal state.

A Debate tracks identity, topic, and status (`pending`, `active`, `completed`, `archived`). Message history belongs in dedicated stores, not inside the Debate object. Completed and archived debates remain in history. At most one debate may be `pending` or `active`.

A Round is protocol state (`pending`, `active`, `collecting`, `completed`), not a provider conversation.

## Desktop product shell

Rayzan Desktop (`apps/rayzan-desktop`) is the product shell. Electron main starts `createRayzanServer` from `@rayzan/local`, which is the same runtime as `pnpm start:local`. The React UI is a client of the existing localhost HTTP bridge. The browser extension uses that same bridge. There is one runtime, one SQLite file per environment, and one event history.

CLI development keeps `apps/rayzan-local/data/rayzan.sqlite`. The packaged desktop app stores `<userData>/rayzan.sqlite` (on Windows, under `%APPDATA%\Rayzan`). Debug HTML is passed as `publicDir` so the Vite-bundled Electron main process can still serve `/debug`. The engineering dashboard remains at `/debug` and is not the product home screen.

