import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryEventStore } from '@rayzan/storage';

import { RayzanRuntime } from '../src/runtime.js';

function team(runtime: RayzanRuntime) {
  const coordinator = runtime.registerAgent('Coordinator', 'coordinator');
  const qwen = runtime.registerAgent('Qwen', 'watcher');
  const glm = runtime.registerAgent('GLM', 'watcher');
  return { coordinator, qwen, glm };
}

function respond(runtime: RayzanRuntime, agentId: string, body: string): void {
  const job = runtime.nextPendingForAgent(agentId);
  assert.ok(job, `expected pending job for ${agentId}`);
  runtime.acknowledgeDelivery(agentId, job.deliveryId);
  runtime.submitCapturedResponse(agentId, job.deliveryId, body);
}

function round1Brief(snapshot: ReturnType<RayzanRuntime['snapshot']>) {
  return JSON.stringify({
    version: 1,
    commands: [
      {
        type: 'dispatch',
        recipients: { type: 'round-watchers' },
        body: 'Analyze independently. Do not assume another Watcher response.',
      },
    ],
  });
}

function plan() {
  return JSON.stringify({
    version: 1,
    commands: [
      {
        type: 'dispatch',
        recipients: { type: 'explicit-agents', agentIds: ['qwen'] },
        body: 'Challenge Qwen using shared evidence.',
      },
      {
        type: 'dispatch',
        recipients: { type: 'explicit-agents', agentIds: ['glm'] },
        body: 'Challenge GLM using shared evidence.',
      },
    ],
  });
}

function checkpointCommand(recommendation: 'CONTINUE' | 'FINISH', content: string) {
  return JSON.stringify({
    version: 1,
    commands: [
      {
        type: 'checkpoint',
        content,
        recommendation,
      },
    ],
  });
}

const CHECKPOINT_BODY = `Current provisional recommendation:
SQLite for the first release.
Coordinator recommendation: CONTINUE
Resolve operational complexity.`;

describe('operator-gated iterative debate', () => {
  it('persists a checkpoint, waits for the Operator, continues with exact guidance, and only synthesizes after finish', () => {
    const events = new InMemoryEventStore();
    const runtime = new RayzanRuntime(events);
    const { coordinator, qwen, glm } = team(runtime);
    runtime.runLiveRound1('SQLite or PostgreSQL?');
    respond(runtime, coordinator.id, round1Brief(runtime.snapshot()));
    const r1Qwen = runtime.nextPendingForAgent(qwen.id)!;
    const r1Glm = runtime.nextPendingForAgent(glm.id)!;
    assert.equal(r1Qwen.body.includes('COMMON'), false);
    assert.equal(r1Glm.body.includes('COMMON'), false);
    respond(runtime, qwen.id, 'SQLite is operationally simple.');
    respond(runtime, glm.id, 'PostgreSQL handles concurrency.');
    // Action loop re-invokes Coordinator; emit checkpoint to end Round 1.
    respond(
      runtime,
      coordinator.id,
      checkpointCommand('CONTINUE', CHECKPOINT_BODY),
    );

    let state = runtime.snapshot();
    assert.equal(state.rounds.length, 1);
    assert.equal(state.awaitingOperator, true);
    assert.equal(state.checkpoint?.recommendation, 'continue');
    assert.equal(state.synthesis, undefined);
    assert.equal(
      events.listAll().some((event) => event.type === 'COORDINATOR_CHECKPOINT_CREATED'),
      true,
    );
    assert.equal(
      events.listAll().some((event) => event.type === 'COORDINATOR_ACTION_CREATED'),
      true,
    );

    runtime.continueDebate('Assume the company has only one DevOps engineer.');
    state = runtime.snapshot();
    assert.equal(state.rounds.at(-1)?.number, 2);
    assert.equal(state.awaitingOperator, false);
    const coordinatorPlan = runtime.nextPendingForAgent(coordinator.id)!;
    assert.match(coordinatorPlan.body, /only one DevOps engineer/);
    respond(runtime, coordinator.id, plan());
    respond(runtime, qwen.id, 'SQLite still fits the constrained team.');
    respond(runtime, glm.id, 'PostgreSQL remains viable but heavier.');
    respond(
      runtime,
      coordinator.id,
      checkpointCommand('CONTINUE', CHECKPOINT_BODY),
    );

    state = runtime.snapshot();
    assert.equal(state.awaitingOperator, true);
    assert.equal(state.synthesis, undefined);
    runtime.finishDebate();
    assert.equal(
      events.listAll().some((event) => event.type === 'DEBATE_FINISH_REQUESTED'),
      true,
    );
    respond(runtime, coordinator.id, 'Final recommendation:\nStart with SQLite.');
    state = runtime.snapshot();
    assert.equal(state.synthesis?.body, 'Final recommendation:\nStart with SQLite.');
    assert.equal(state.debate?.status, 'completed');
  });

  it('replays a checkpoint gate without automatically continuing browser work', () => {
    const events = new InMemoryEventStore();
    const runtime = new RayzanRuntime(events);
    const { coordinator, qwen, glm } = team(runtime);
    runtime.runLiveRound1('Replay checkpoint');
    respond(runtime, coordinator.id, round1Brief(runtime.snapshot()));
    respond(runtime, qwen.id, 'Qwen independent analysis');
    respond(runtime, glm.id, 'GLM independent analysis');
    respond(
      runtime,
      coordinator.id,
      checkpointCommand('CONTINUE', CHECKPOINT_BODY),
    );
    const restored = new RayzanRuntime(events);
    assert.equal(restored.snapshot().awaitingOperator, true);
    assert.equal(restored.snapshot().checkpoint?.body, CHECKPOINT_BODY);
    assert.equal(restored.nextPendingForAgent(coordinator.id), undefined);
  });
});
