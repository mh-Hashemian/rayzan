# Status

Current phase: Phase 3C.6 — Agentic Coordinator Runtime + Rayzan Action Protocol (awaiting Operator validation)

Completed:

- Initial workspace setup through Phase 3C.5
- Managed provider browser foundation (3D.1 in progress in parallel)

Currently being worked on:

- 3C.6 action protocol: dispatch, forward, ask_operator, checkpoint; evidence refs; Desktop ask_operator UX
- Capture reliability hardening: shared `@rayzan/capture` machine; managed browser uses extension-semantics (new turn + generation end); MutationObserver wake; timers are watchdogs only

Next:

- Operator validates live Desktop acceptance **without** manual API salvage:
  DeepSeek→GLM, DeepSeek→GLM→Qwen, parallel Watchers, ask_operator, restart during pending action
- Continue 3D.1 managed provider validation

Do **not** commit 3C.6 until capture passes the live suite without salvage.
