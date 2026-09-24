import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryEventStore } from '@rayzan/storage';

import { RayzanRuntime } from '../src/runtime.js';

function respond(runtime: RayzanRuntime, agentId: string, body: string): void {
  const job =
    runtime.nextPendingForAgent(agentId) ??
    runtime.awaitingResponseForAgent(agentId);
  assert.ok(job, `expected pending/awaiting for ${agentId}`);
  if (runtime.nextPendingForAgent(agentId)?.deliveryId === job.deliveryId) {
    runtime.acknowledgeDelivery(agentId, job.deliveryId);
  }
  runtime.submitCapturedResponse(agentId, job.deliveryId, body);
}

describe('capture delivery correlation', () => {
  it('returns no Coordinator awaiting job after checkpoint clears the pointer', () => {
    const runtime = new RayzanRuntime(new InMemoryEventStore());
    const coordinator = runtime.registerAgent('ChatGPT', 'coordinator');
    runtime.registerAgent('DeepSeek', 'watcher');
    runtime.runLiveRound1('What is Ag?');

    respond(
      runtime,
      coordinator.id,
      JSON.stringify({
        version: 1,
        commands: [
          {
            type: 'checkpoint',
            content: 'Done for correlation test.',
            recommendation: 'finish',
          },
        ],
      }),
    );

    assert.equal(runtime.awaitingResponseForAgent(coordinator.id), undefined);
    assert.equal(runtime.nextPendingForAgent(coordinator.id), undefined);
  });

  it('correlates the re-invoked Coordinator prompt after a Watcher step', () => {
    const runtime = new RayzanRuntime(new InMemoryEventStore());
    const coordinator = runtime.registerAgent('ChatGPT', 'coordinator');
    const watcher = runtime.registerAgent('GLM', 'watcher');
    runtime.runLiveRound1('Correlation quarantine');

    respond(
      runtime,
      coordinator.id,
      JSON.stringify({
        version: 1,
        commands: [
          {
            type: 'dispatch',
            recipients: {
              type: 'explicit-agents',
              agentIds: [watcher.id],
            },
            kind: 'brief',
            body: 'Answer briefly.',
          },
        ],
      }),
    );

    respond(runtime, watcher.id, 'Ag');

    const job =
      runtime.nextPendingForAgent(coordinator.id) ??
      runtime.awaitingResponseForAgent(coordinator.id);
    assert.ok(job);
    assert.equal(job.recipientId, coordinator.id);
  });

  it('enters attention when multiple correlated deliveries exist', () => {
    const runtime = new RayzanRuntime(new InMemoryEventStore());
    const coordinator = runtime.registerAgent('ChatGPT', 'coordinator');
    const a = runtime.registerAgent('DeepSeek', 'watcher');
    const b = runtime.registerAgent('GLM', 'watcher');
    runtime.runLiveRound1('parallel attention');

    respond(
      runtime,
      coordinator.id,
      JSON.stringify({
        version: 1,
        commands: [
          {
            type: 'dispatch',
            recipients: {
              type: 'explicit-agents',
              agentIds: [a.id, b.id],
            },
            kind: 'brief',
            body: 'Say hi.',
          },
        ],
      }),
    );

    // Each watcher has exactly one correlated pending — not multiple for one agent.
    const aJob = runtime.nextPendingForAgent(a.id);
    const bJob = runtime.nextPendingForAgent(b.id);
    assert.ok(aJob);
    assert.ok(bJob);
    assert.notEqual(aJob.deliveryId, bJob.deliveryId);
  });
});
