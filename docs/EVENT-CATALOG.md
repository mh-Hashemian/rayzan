# Event catalog

Canonical event types for Rayzan. New events are emitted with `schemaVersion = 1`. Historical rows persisted before 3B.4 may omit envelope fields; they are read as `schemaVersion = 0` (legacy) without rewriting SQLite.

Ordering:

- `sequence` (SQLite AUTOINCREMENT, or in-memory append order) is the authoritative event order.
- `causationEventId` is the direct causal edge to an earlier event.
- `correlationId` groups events of one logical operation (typically `message:{id}` or `delivery:{id}`).
- Timestamps are audit metadata. Replay and causality never use them.

External side effects use request → terminal (`confirmed` or `failed`). A `REQUESTED` event without a later terminal in sequence order is `IN_DOUBT` after recovery. Replay does not retry or resend.

| Event | Purpose | Schema | Canonical payload | Causation | Correlation | Replay effect | External |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `AGENT_REGISTERED` | Record an agent | 1 | `id`, `name`, `role` | none | `agent:{id}` | register agent | no |
| `DEBATE_CREATED` | Record a debate | 1 | `topic`, `status` | none | `debate:{id}` | create debate | no |
| `ROUND_CREATED` | Record a round | 1 | `number`, `participantIds` | debate or previous round completion | `round:{id}` | create round; restore execution when `participantIds` present | no |
| `MESSAGE_CREATED` | Store a canonical message | 1 | `messageId`, `senderId`, `recipientIds`, `kind`, `body` | prior dispatch or `CAPTURE_REQUESTED` for responses | `message:{id}` or `delivery:{id}` | store + hydrate message | no |
| `MESSAGE_DISPATCHED` | Record that transport.send ran | 1 | `messageId`, `senderId`, `recipientIds`, `kind`, `deliveryIds` | `MESSAGE_CREATED` | `message:{id}` | none (bookkeeping) | no |
| `DELIVERY_CREATED` | Record an outbox delivery | 1 | `deliveryId`, `messageId`, `senderId`, `recipientId`, `status`, `referencedMessageIds` | `MESSAGE_DISPATCHED` | `delivery:{id}` | hydrate frozen delivery | no |
| `PROMPT_DISPATCH_REQUESTED` | Browser/external send requested | 1 | `deliveryId`, `messageId`, `recipientId`, `action: prompt-dispatch` | `DELIVERY_CREATED` | `delivery:{id}` | none; used for IN_DOUBT | **yes** (request) |
| `PROMPT_DISPATCH_CONFIRMED` | Browser/external send succeeded | 1 | `deliveryId`, `recipientId`, `action: prompt-dispatch` | `PROMPT_DISPATCH_REQUESTED` | `delivery:{id}` | none | **yes** (terminal) |
| `PROMPT_DISPATCH_FAILED` | Browser/external send failed | 1 | `deliveryId`, `recipientId`, `action: prompt-dispatch`, `reason` | `PROMPT_DISPATCH_REQUESTED` | `delivery:{id}` | none; not retried | **yes** (terminal) |
| `DELIVERY_CONFIRMED` | Mark delivery delivered | 1 | `deliveryId`, `messageId`, `recipientId` | `PROMPT_DISPATCH_REQUESTED` | `delivery:{id}` | set status delivered | no |
| `EXPOSURE_CREATED` | Record exposure after confirm | 1 | `exposureId`, `messageId`, `agentId`, `referencedMessageIds` | `DELIVERY_CONFIRMED` | `delivery:{id}` | record exposure | no |
| `CAPTURE_REQUESTED` | Browser/external capture requested | 1 | `deliveryId`, `recipientId`, `action: capture` | `PROMPT_DISPATCH_CONFIRMED` | `delivery:{id}` | none; used for IN_DOUBT | **yes** (request) |
| `RESPONSE_CAPTURED` | Capture succeeded | 1 | `messageId`, `deliveryId`, `senderId` | response `MESSAGE_CREATED` | `delivery:{id}` | set status responded | **yes** (terminal) |
| `CAPTURE_FAILED` | Capture failed | 1 | `deliveryId`, `recipientId`, `action: capture`, `reason` | `CAPTURE_REQUESTED` | `delivery:{id}` | none; not retried | **yes** (terminal) |
| `ROUND_COMPLETED` | Close a round | 1 | `number`, `status` | last `RESPONSE_CAPTURED` in that round | `round:{id}` | restore completed | no |
| `SYNTHESIS_CREATED` | Store Coordinator report | 1 | `coordinatorId`, `body`, `createdAt` | last `ROUND_COMPLETED` | `debate:{id}` | store synthesis; complete debate | no |
| `OPERATOR_INTERVENTION` | Reserved | 1 | unspecified | unspecified | unspecified | skipped (unsupported) | no |

`OPERATOR_INTERVENTION` remains reserved. Intervention behavior is not implemented.
