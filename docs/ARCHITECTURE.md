# Architecture

Rayzan is local-first. The Operator runs debates on a local machine. The Orchestrator is the software system that enforces protocol mechanics; it is not a remote service.

This repository is a pnpm TypeScript workspace.

```text
rayzan/
├── packages/
│   ├── protocol/        # shared protocol/domain model
│   ├── transport/       # delivery abstraction and ManualTransport
│   └── orchestrator/    # connects protocol stores to transports
├── apps/                # later: dashboard, extension, ...
└── docs/
```

`packages/protocol` defines portable debate types, invariants, and in-memory stores. It has no dependency on browsers, UI, databases, networks, or AI providers. It does not deliver messages. It must not import `@rayzan/transport` or `@rayzan/orchestrator`.

`packages/transport` (`@rayzan/transport`) depends on `@rayzan/protocol`. It delivers and receives messages. It does not decide debate semantics. It must not import `@rayzan/orchestrator`.

`packages/orchestrator` (`@rayzan/orchestrator`) depends on protocol and transport. Low-level `Orchestrator` is constructed with injected store and transport contracts. It stores canonical messages, asks transport to send and confirm them, records exposure after `delivered`, and stores accepted inbound responses.

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

Future Coordinator commands are a structured interface between that external chatbot and Rayzan. They are not implemented yet.

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

Protocol `Round` status is reused as:

```text
pending     — Round exists, execution has not started
active      — startRound configured participants
collecting  — at least one message has been dispatched
completed   — completeRound closed the collection
```

`active` and `collecting` are kept distinct. One round execution may include several canonical messages (global Round 1 or personalized Round 2).

The in-memory stores hold Agents, Debates, Rounds, MessageEnvelopes, and Exposure records. They are temporary memory, not persistence. They do not route messages, expand broadcasts, or advance debate state.

Broadcast or group addressing is expanded into concrete `recipientIds` before a `MessageEnvelope` is stored.

Application commands such as create debate, add watcher, or bind a browser tab are not `MessageEnvelope` objects.

Applications under `apps/` are not created yet.

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
├── chatgpt.ts
├── deepseek.ts
├── qwen.ts
└── glm.ts
```

An adapter is not a separate project. It is provider-specific source code inside the browser-extension layer.

A broken adapter must not stop the debate. That provider degrades to manual transport.

Browser captures initially require Operator confirmation. Automatic completion detection is not required for the first browser MVP.

## State

There are two kinds of state:

1. **Protocol state** — Rayzan / the Orchestrator is authoritative. This includes agent identity, debate and round state, message routing, attribution, delivery, the exposure ledger, and audit/history.
2. **Provider / ambient context** — provider conversations remain authoritative for provider-specific context such as memories, custom instructions, existing conversation history, and provider settings.

The Orchestrator does not replace a provider's own conversation store. It records what Rayzan sent, received, routed, and exposed.

The exposure ledger records protocol-visible exposure through Rayzan as structural references to messages. It does not claim to know provider memory, custom instructions, old thread history, system prompts, or model-internal state.

A Debate tracks identity, topic, and status. Message history belongs in dedicated stores, not inside the Debate object.

A Round is protocol state (`pending`, `active`, `collecting`, `completed`), not a provider conversation.
