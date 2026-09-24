import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createAgent } from '@rayzan/protocol';

import { RayzanRuntime } from '../src/runtime.js';
import {
  COORDINATOR_SYSTEM_CONTRACT,
  coordinatorRound1Prompt,
} from '../src/coordinator-prompt.js';
import { composeRoundWatcherBody } from '../src/round2-policy.js';

function registerTrio(runtime: RayzanRuntime) {
  const coordinator = runtime.registerAgent('DeepSeek', 'coordinator');
  const qwen = runtime.registerAgent('Qwen', 'watcher');
  const glm = runtime.registerAgent('GLM', 'watcher');
  return { coordinator, qwen, glm };
}

describe('3C.5 coordinator-centric orchestration', () => {
  it('keeps Round 1 Watcher body equal to the Coordinator-authored brief', () => {
    const runtime = new RayzanRuntime();
    const { coordinator, qwen, glm } = registerTrio(runtime);
    runtime.runLiveRound1(
      'Coordinator, every Watcher should respond with just one random word, without markdown or extra explanation.',
    );
    const started = runtime.snapshot();
    const brief =
      'Reply with exactly one random word. No markdown, label, explanation, or additional text.';
    const job = runtime.nextPendingForAgent(coordinator.id);
    assert.ok(job);
    runtime.acknowledgeDelivery(coordinator.id, job.deliveryId);
    runtime.submitCapturedResponse(
      coordinator.id,
      job.deliveryId,
      JSON.stringify({
        version: 1,
        commands: [
          {
            type: 'dispatch',
            messageId: 'round1-brief',
            debateId: started.debate!.id,
            roundId: started.round1!.id,
            recipients: { type: 'round-watchers' },
            kind: 'brief',
            body: brief,
            referencedMessageIds: [],
          },
        ],
      }),
    );

    const qwenJob = runtime.nextPendingForAgent(qwen.id);
    const glmJob = runtime.nextPendingForAgent(glm.id);
    assert.ok(qwenJob);
    assert.ok(glmJob);
    assert.equal(qwenJob.body, brief);
    assert.equal(glmJob.body, brief);
    assert.equal(qwenJob.body.includes('material assumptions'), false);
    assert.equal(qwenJob.body.includes('candidate deliverable'), false);

    runtime.acknowledgeDelivery(qwen.id, qwenJob.deliveryId);
    runtime.acknowledgeDelivery(glm.id, glmJob.deliveryId);
    runtime.submitCapturedResponse(qwen.id, qwenJob.deliveryId, 'Cobalt');
    runtime.submitCapturedResponse(glm.id, glmJob.deliveryId, 'Juniper');

    const snap = runtime.snapshot();
    assert.equal(snap.watcherContributions.length, 2);
    assert.equal(snap.watcherContributions[0]?.prompt, brief);
    assert.equal(
      snap.watcherContributions.find((item) => item.name === 'Qwen')?.response,
      'Cobalt',
    );
    assert.equal(
      snap.watcherContributions.find((item) => item.name === 'GLM')?.response,
      'Juniper',
    );

    const checkpointJob = runtime.nextPendingForAgent(coordinator.id);
    assert.ok(checkpointJob);
    assert.match(checkpointJob.body, /self-contained Operator-facing update/i);
    assert.equal(
      /# Coordinator's Current Judgment/.test(checkpointJob.body),
      false,
    );
    runtime.acknowledgeDelivery(coordinator.id, checkpointJob.deliveryId);
    runtime.submitCapturedResponse(
      coordinator.id,
      checkpointJob.deliveryId,
      `Qwen: Cobalt
GLM: Juniper

Coordinator recommendation: FINISH
All Watchers returned one word as requested.`,
    );
    const gated = runtime.snapshot();
    assert.equal(gated.awaitingOperator, true);
    assert.ok(gated.checkpoint?.body.includes('Cobalt'));
    assert.equal(gated.checkpoint?.recommendation, 'finish');
  });

  it('does not append a generic intellectual contract after Coordinator challenges', () => {
    const body = composeRoundWatcherBody(
      2,
      'Qwen',
      'COMMON\nQwen: Cobalt\nGLM: Juniper',
      'Give another random word.',
    );
    assert.match(body, /Give another random word/);
    assert.equal(body.includes('RESPONSE CONTRACT'), false);
    assert.equal(body.includes('Strongest challenge'), false);
  });

  it('embeds the Coordinator system contract without forced Round 1 analysis sections', () => {
    assert.match(COORDINATOR_SYSTEM_CONTRACT, /intellectual orchestrator/i);
    const prompt = coordinatorRound1Prompt({
      problem: 'one random word from each',
      coordinatorId: 'c1',
      debateId: 'd1',
      roundId: 'r1',
      watchers: [
        createAgent({ id: 'qwen', name: 'Qwen', role: 'watcher' }),
        createAgent({ id: 'glm', name: 'GLM', role: 'watcher' }),
      ],
    });
    assert.match(prompt, /Do not impose a generic analysis template/i);
    assert.equal(/multiple viable approaches/i.test(prompt), false);
  });
});
