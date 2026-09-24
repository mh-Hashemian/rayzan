import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryEventStore } from '@rayzan/storage';

import { RayzanRuntime } from '../src/runtime.js';

function respond(runtime: RayzanRuntime, agentId: string, body: string): void {
  const job = runtime.nextPendingForAgent(agentId);
  assert.ok(job, `expected pending for ${agentId}`);
  runtime.acknowledgeDelivery(agentId, job.deliveryId);
  runtime.submitCapturedResponse(agentId, job.deliveryId, body);
}

describe('3C.6 agentic Coordinator action loop', () => {
  it('runs DeepSeek → GLM sequentially without contacting Qwen', () => {
    const runtime = new RayzanRuntime(new InMemoryEventStore());
    const coordinator = runtime.registerAgent('ChatGPT', 'coordinator');
    const deepseek = runtime.registerAgent('DeepSeek', 'watcher');
    const qwen = runtime.registerAgent('Qwen', 'watcher');
    const glm = runtime.registerAgent('GLM', 'watcher');

    runtime.runLiveRound1(
      'I want DeepSeek to ask a random question from GLM and GLM respond to that.',
    );
    // Round 1: establish roles for everyone (optional broadcast).
    respond(
      runtime,
      coordinator.id,
      JSON.stringify({
        version: 1,
        commands: [
          {
            type: 'dispatch',
            recipients: { type: 'round-watchers' },
            body: 'You are an independent Watcher. State your agent id and wait for task-specific instructions.',
          },
        ],
      }),
    );
    respond(runtime, deepseek.id, 'DeepSeek ready.');
    respond(runtime, qwen.id, 'Qwen ready.');
    respond(runtime, glm.id, 'GLM ready.');
    respond(
      runtime,
      coordinator.id,
      JSON.stringify({
        version: 1,
        commands: [
          {
            type: 'checkpoint',
            content: 'Roles established.',
            recommendation: 'CONTINUE',
          },
        ],
      }),
    );

    runtime.continueDebate();
    // Round 2 step 1: DeepSeek only.
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
              agentIds: [deepseek.id],
            },
            body: 'Ask exactly one random question for GLM. Return only the question.',
          },
        ],
      }),
    );
    assert.equal(runtime.nextPendingForAgent(qwen.id), undefined);
    assert.equal(runtime.nextPendingForAgent(glm.id), undefined);
    const deepseekJob = runtime.nextPendingForAgent(deepseek.id);
    assert.ok(deepseekJob);
    assert.match(deepseekJob.body, /Ask exactly one random question/);
    respond(
      runtime,
      deepseek.id,
      'What is one belief you hold that is hard to explain across cultures?',
    );

    // Step 2: Coordinator re-invoked — send DeepSeek's question to GLM only.
    const step2 = runtime.nextPendingForAgent(coordinator.id);
    assert.ok(step2);
    assert.match(step2.body, /hard to explain across cultures/i);
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
              agentIds: [glm.id],
            },
            body: 'DeepSeek asked: "What is one belief you hold that is hard to explain across cultures?" Answer that question directly.',
          },
        ],
      }),
    );
    assert.equal(runtime.nextPendingForAgent(qwen.id), undefined);
    assert.equal(runtime.nextPendingForAgent(deepseek.id), undefined);
    const glmJob = runtime.nextPendingForAgent(glm.id);
    assert.ok(glmJob);
    assert.match(glmJob.body, /hard to explain across cultures/);
    respond(runtime, glm.id, 'Hospitality as moral duty.');

    // Step 3: checkpoint with attribution.
    respond(
      runtime,
      coordinator.id,
      JSON.stringify({
        version: 1,
        commands: [
          {
            type: 'checkpoint',
            content:
              'DeepSeek asked about cross-cultural beliefs. GLM answered: Hospitality as moral duty.',
            recommendation: 'FINISH',
          },
        ],
      }),
    );
    const state = runtime.snapshot();
    assert.equal(state.awaitingOperator, true);
    assert.equal(state.checkpoint?.recommendation, 'finish');
    assert.match(state.checkpoint?.body ?? '', /Hospitality as moral duty/);
    const round2 = state.rounds.find((round) => round.number === 2);
    const qwenRound2 = state.watcherContributions.filter(
      (item) => item.name === 'Qwen' && item.roundNumber === 2,
    );
    assert.equal(qwenRound2.length, 0);
    assert.ok(round2);
    assert.equal(round2.status, 'completed');
  });

  it('exposes every per-step Watcher contribution in the same round', () => {
    const runtime = new RayzanRuntime(new InMemoryEventStore());
    const coordinator = runtime.registerAgent('ChatGPT', 'coordinator');
    const deepseek = runtime.registerAgent('DeepSeek', 'watcher');
    const glm = runtime.registerAgent('GLM', 'watcher');

    runtime.runLiveRound1('Sequential contributions visibility');
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
              agentIds: [deepseek.id],
            },
            body: 'Ask one question.',
          },
        ],
      }),
    );
    respond(runtime, deepseek.id, 'What is 2+2?');
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
              agentIds: [glm.id],
            },
            body: 'Answer: What is 2+2?',
          },
        ],
      }),
    );
    respond(runtime, glm.id, '4');
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
              agentIds: [deepseek.id],
            },
            body: 'Verify GLM said 4.',
          },
        ],
      }),
    );
    respond(runtime, deepseek.id, 'Verified correct.');
    const deepseekItems = runtime
      .snapshot()
      .watcherContributions.filter((item) => item.name === 'DeepSeek');
    assert.equal(deepseekItems.length, 2);
    assert.match(deepseekItems[0]?.prompt ?? '', /Ask one question/);
    assert.match(deepseekItems[0]?.response ?? '', /What is 2\+2/);
    assert.match(deepseekItems[1]?.prompt ?? '', /Verify GLM said 4/);
    assert.match(deepseekItems[1]?.response ?? '', /Verified correct/);
  });

  it('supports parallel independent dispatches in one step', () => {
    const runtime = new RayzanRuntime(new InMemoryEventStore());
    const coordinator = runtime.registerAgent('ChatGPT', 'coordinator');
    const chatgpt = runtime.registerAgent('WatcherGPT', 'watcher');
    // Use stable ids matching names used in agent registry
    const deepseek = runtime.registerAgent('DeepSeek', 'watcher');
    const qwen = runtime.registerAgent('Qwen', 'watcher');

    runtime.runLiveRound1('Ask each for one random word.');
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
              agentIds: [chatgpt.id, deepseek.id, qwen.id],
            },
            body: 'Reply with exactly one random word.',
          },
        ],
      }),
    );
    assert.ok(runtime.nextPendingForAgent(chatgpt.id));
    assert.ok(runtime.nextPendingForAgent(deepseek.id));
    assert.ok(runtime.nextPendingForAgent(qwen.id));
    respond(runtime, chatgpt.id, 'Cobalt');
    respond(runtime, deepseek.id, 'Lantern');
    respond(runtime, qwen.id, 'Juniper');
    const after = runtime.nextPendingForAgent(coordinator.id);
    assert.ok(after);
    assert.match(after.body, /Cobalt/);
    assert.match(after.body, /Lantern/);
    assert.match(after.body, /Juniper/);
  });

  it('runs DeepSeek → GLM → Qwen multi-step then checkpoints', () => {
    const runtime = new RayzanRuntime(new InMemoryEventStore());
    const coordinator = runtime.registerAgent('ChatGPT', 'coordinator');
    const deepseek = runtime.registerAgent('DeepSeek', 'watcher');
    const glm = runtime.registerAgent('GLM', 'watcher');
    const qwen = runtime.registerAgent('Qwen', 'watcher');

    runtime.runLiveRound1(
      'Ask DeepSeek for a question. Send that question to GLM. Then send GLM answer to Qwen to critique.',
    );
    respond(
      runtime,
      coordinator.id,
      JSON.stringify({
        version: 1,
        commands: [
          {
            type: 'checkpoint',
            content: 'Skip framing; begin dependent chain.',
            recommendation: 'CONTINUE',
          },
        ],
      }),
    );
    runtime.continueDebate();

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
              agentIds: [deepseek.id],
            },
            body: 'Ask one question for GLM.',
          },
        ],
      }),
    );
    respond(runtime, deepseek.id, 'What is trust?');
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
              agentIds: [glm.id],
            },
            body: 'DeepSeek asked: What is trust? Answer.',
          },
        ],
      }),
    );
    respond(runtime, glm.id, 'Trust is earned reliability.');
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
              agentIds: [qwen.id],
            },
            body: 'Critique GLM: Trust is earned reliability.',
          },
        ],
      }),
    );
    respond(runtime, qwen.id, 'Too narrow; trust also includes vulnerability.');
    respond(
      runtime,
      coordinator.id,
      JSON.stringify({
        version: 1,
        commands: [
          {
            type: 'checkpoint',
            content:
              'DeepSeek asked about trust. GLM answered reliability. Qwen critiqued narrowness.',
            recommendation: 'FINISH',
          },
        ],
      }),
    );
    const state = runtime.snapshot();
    assert.equal(state.awaitingOperator, true);
    assert.match(state.checkpoint?.body ?? '', /Qwen critiqued narrowness/i);
    assert.equal(state.coordinatorAction?.decisionPending, false);
  });

  it('does not advance to GLM when DeepSeek capture fails', () => {
    const runtime = new RayzanRuntime(new InMemoryEventStore());
    const coordinator = runtime.registerAgent('ChatGPT', 'coordinator');
    const deepseek = runtime.registerAgent('DeepSeek', 'watcher');
    const glm = runtime.registerAgent('GLM', 'watcher');

    runtime.runLiveRound1('Dependent failure');
    respond(
      runtime,
      coordinator.id,
      JSON.stringify({
        version: 1,
        commands: [
          {
            type: 'checkpoint',
            content: 'Ready.',
            recommendation: 'CONTINUE',
          },
        ],
      }),
    );
    runtime.continueDebate();
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
              agentIds: [deepseek.id],
            },
            body: 'Ask GLM a question.',
          },
        ],
      }),
    );
    const job = runtime.nextPendingForAgent(deepseek.id);
    assert.ok(job);
    runtime.acknowledgeDelivery(deepseek.id, job.deliveryId);
    runtime.notePresence({
      agentId: deepseek.id,
      phase: 'error',
      error: 'capture failed',
      capture: {
        phase: 'failed',
        deliveryId: job.deliveryId,
        promptSubmitted: true,
        reason: 'capture failed',
      },
    });
    assert.equal(runtime.nextPendingForAgent(glm.id), undefined);
    assert.equal(runtime.nextPendingForAgent(coordinator.id), undefined);
    const state = runtime.snapshot();
    assert.ok(state.coordinatorAction?.pendingDeliveryIds?.length);
    assert.equal(state.coordinatorAction?.decisionPending, false);
    assert.match(state.lastError ?? '', /capture failed/i);
  });
});
