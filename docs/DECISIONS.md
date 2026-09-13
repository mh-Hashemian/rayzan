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
