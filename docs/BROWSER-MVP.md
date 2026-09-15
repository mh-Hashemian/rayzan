# Browser MVP (Phase 3A)

Success criterion for Coordinator final synthesis: after Round 2 Watcher replies are auto-captured, DeepSeek receives the complete debate evidence and returns one structured report. Rayzan stores it as `DebateSynthesis` and shows **Final Coordinator Report** on the dashboard. The Operator can understand the debate without opening Watcher messages. Round 3 is not started.

Checkpoint 3A.3 (already shipped): DeepSeek receives the Operator problem, rephrases it, names each Watcher's Round 1 role, and returns a `round-watchers` dispatch. That brief is sent in parallel to Qwen and GLM. Both Watcher responses are auto-captured, Round 1 closes at 2/2, DeepSeek receives the evidence, its JSON plan is parsed, and personalized Round 2 prompts are sent.

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
10. Observe each Watcher tab receive common Round 1 evidence plus its own challenge. Both Round 2 replies auto-capture.
11. Watch DeepSeek receive the synthesis packet and auto-capture.
12. Read **Final Coordinator Report** on the dashboard. Do not open Watcher tabs to understand the conclusion.

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

## Live DOM notes (re-verified 2026-09-15)

### ChatGPT (`chatgpt.com`, `chat.openai.com`)

- Identity: `data-turn-id` on `section[data-turn="assistant"]`, else `data-message-id` on the inner assistant node
- Assistant turn: `section[data-turn="assistant"]` (`data-testid="conversation-turn-N"`). Fallback: `[data-message-author-role="assistant"]`. User turns use `data-turn="user"` / `role="user"` and must be excluded. ChatGPT virtualizes older turns, so capture must follow a new `data-turn-id` / `data-message-id` even when it is the only assistant node in the DOM.
- Thinking: `[data-testid="thoughts"]` / `[data-testid="thought-process"]` / `[data-testid="reasoning-summary"]` / `.result-thinking` (stripped, not captured)
- Final answer: `.markdown` inside the assistant turn
- Input: ProseMirror `div#prompt-textarea[contenteditable=true]` (empty placeholder paragraph; hidden fallback textarea is not the composer)
- Send: wait for `#composer-submit-button[data-testid="send-button"][aria-label="Send prompt"]`. The empty-composer control is **Start Voice** and must not be clicked. Do not ack until the composer clears or generation starts.
- Generating: visible Stop control (`data-testid="stop-button"` / `aria-label="Stop streaming"`). Streaming may create the `section[data-turn="assistant"]` wrapper before the inner author-role node exists.

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
