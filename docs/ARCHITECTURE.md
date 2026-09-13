# Architecture

Rayzan is local-first. The Operator runs debates on a local machine. The Orchestrator is the software system that enforces protocol mechanics; it is not a remote service.

This repository is a pnpm TypeScript workspace.

```text
rayzan/
├── packages/
│   ├── protocol/     # shared protocol/domain model
│   └── transport/    # delivery abstraction and ManualTransport
├── apps/             # later: orchestrator, extension, ...
└── docs/
```

`packages/protocol` defines portable debate types, invariants, and in-memory stores. It has no dependency on browsers, UI, databases, networks, or AI providers. It does not deliver messages. It must not import `@rayzan/transport`.

`packages/transport` (`@rayzan/transport`) depends on `@rayzan/protocol`. It delivers and receives messages. It does not decide debate semantics.

The in-memory stores hold Agents, Debates, Rounds, MessageEnvelopes, and Exposure records. They are temporary memory, not persistence. They do not route messages, expand broadcasts, or advance debate state.

Broadcast or group addressing is expanded into concrete `recipientIds` before a `MessageEnvelope` is stored.

Application commands such as create debate, add watcher, or bind a browser tab are not `MessageEnvelope` objects.

Applications under `apps/` are not created yet.

## Roles

| Role         | Kind     | Responsibility                                                                                                             |
| ------------ | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| Operator     | Human    | Final authority. Introduces the problem, may override any recommendation, and approves implementation.                     |
| Coordinator  | Agent    | Owns complete debate context, semantic reasoning, debate rounds, synthesis, and convergence decisions. Does not implement. |
| Watchers     | Agents   | Independent reasoning agents. Analyze, challenge, and recommend. Do not implement.                                         |
| Coder        | Agent    | Codebase authority and the only implementation agent.                                                                      |
| Orchestrator | Software | Mechanical protocol concerns: identity, routing, round state, delivery, attribution, exposure, and history.                |

## Responsibility boundary

**Coordinator owns semantic judgment.** Examples:

- what question is being debated
- what information a Watcher should receive
- how Watcher positions should be interpreted
- whether another debate round is needed
- when the debate has converged
- final synthesis and recommendation

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

Creating or queuing a delivery does not record exposure. Exposure is a protocol fact and is recorded only after `delivered`. Transport does not write the Exposure Ledger. The future orchestrator connects confirmed delivery to an ExposureRecord.

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
