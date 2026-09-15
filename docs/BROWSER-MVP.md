# Browser MVP (Phase 3A)

Success criterion for Checkpoint 3A.3: DeepSeek (Coordinator) receives the Operator problem, rephrases it, names each Watcher's Round 1 role, and returns a `round-watchers` dispatch. That Coordinator brief is sent in parallel to Qwen and GLM (Coordinator is the sender). Both Watcher responses are auto-captured, Round 1 closes at 2/2, DeepSeek receives the concatenated evidence, its JSON plan is parsed, and personalized Round 2 prompts (common evidence + distinct challenges) are sent automatically. Round 2 responses are not collected yet.

Agent registration is manual. Tab binding is manual. Round bootstrap is application-level (`start-round` is still deferred).

## Commands

```text
pnpm install
pnpm build:extension
pnpm start:local
```

Dashboard: http://127.0.0.1:8787

Load the extension from `apps/browser-extension/dist` (Firefox: temporary add-on → `dist/manifest.json`, then Reload after rebuild).

## Operator run

1. Start `pnpm start:local`.
2. Open the dashboard.
3. Add Agents (no provider field):
   - DeepSeek Coordinator / coordinator
   - Qwen / watcher
   - GLM / watcher
4. Load/reload the extension.
5. Bind:
   - `https://chat.deepseek.com/` → DeepSeek Coordinator
   - `https://chat.qwen.ai/` → Qwen
   - `https://chat.z.ai/` → GLM
6. Enter a problem. Click **Start live debate**.
7. Do nothing. Watch DeepSeek receive the Coordinator prompt first, auto-capture its JSON, then Qwen and GLM receive the **same rephrased Coordinator brief** (not the raw Operator text). Both Watcher responses auto-capture, 2/2, Round 1 COMPLETED.
8. Watch DeepSeek receive the Round 1 evidence packet and auto-capture.
9. Read the parsed Qwen-specific and GLM-specific challenges.
10. Observe each Watcher tab receive common Round 1 evidence plus its own challenge.

Fallback on a bound tab popup: **Retry Auto Capture** / **Capture Manually**. The happy path must not need them.

Coordinator must return JSON (a single ` ```json ` fence is unwrapped in the app layer). IDs in that JSON should match the dashboard Debate/Round 2 IDs. The application still binds dispatch to the trusted Round 2 and prepends common evidence. Omitted `referencedMessageIds` is treated as `[]` then augmented with both Round 1 response IDs.

## Bridge

| Method | Path                                | Purpose                                     |
| ------ | ----------------------------------- | ------------------------------------------- |
| GET    | `/api/health`                       | Liveness                                    |
| GET    | `/api/agents`                       | Bindable Agents                             |
| POST   | `/api/agents`                       | `{ name, role }` register Agent             |
| GET    | `/api/state`                        | Dashboard snapshot                          |
| POST   | `/api/presence`                     | Binding/adapter phase from extension        |
| POST   | `/api/bindings`                     | Application-layer tab binding               |
| GET    | `/api/deliveries/pending?agentId=`  | Next pending outbox item                    |
| GET    | `/api/deliveries/awaiting?agentId=` | Delivered, waiting for response             |
| POST   | `/api/session/create-round`         | `{ problem }` bootstrap only, no send       |
| POST   | `/api/session/run-live-round`       | `{ problem }` Operator → Coordinator first  |
| POST   | `/api/session/start-round`          | Alias of `run-live-round`                   |
| POST   | `/api/session/test-send`            | Debug Operator→Agent send                   |
| POST   | `/api/deliveries/:id/ack`           | `{ agentId }` after successful `sendPrompt` |
| POST   | `/api/deliveries/:id/response`      | `{ agentId, body }` correlated capture      |

## Live DOM notes (re-verified 2026-09-14)

### DeepSeek (`chat.deepseek.com`)

- Identity: no stable message id; track the live `.ds-message` element that appears after the pre-send snapshot. User bubbles are also `.ds-message` and MUST be excluded.
- Assistant turn: `.ds-message` that contains `.ds-think-content` and/or `.ds-assistant-message-main-content`
- Thinking: `.ds-think-content` (not captured)
- Final answer: `.ds-markdown.ds-assistant-message-main-content`
- Input: `textarea[placeholder="Message DeepSeek"]`
- Send: `.ds-button.ds-button--primary.ds-button--circle` (disabled class `ds-button--disabled`). Do not ack until the composer clears or generation starts.
- Generating: thinking present without main content

### Qwen (`chat.qwen.ai`)

- Identity: no stable message id; track the new `.qwen-chat-message-assistant` node
- Input: `textarea.message-input-textarea` (placeholder may be "Ask Qwen")
- Send: wait for `button.send-button[aria-label="Send"]`, invoke Qwen’s React click/Enter handlers, and do not ack until the composer clears or generation starts. The empty-composer slot `.message-input-right-button-send` is Voice mode and must not be clicked.
- Final answer: `.response-message-content.phase-answer`
- Generating: visible Stop control

### GLM (`chat.z.ai`)

- Identity: no stable message id; track the new `.chat-assistant` node
- Input: `textarea#chat-input`
- Send: `#send-message-button`
- Thinking: `.thinking-chain-container` (stripped, not captured)
- Final answer: `.chat-assistant` minus thinking chain
- Generating: visible Stop control, or empty new turn with disabled send
