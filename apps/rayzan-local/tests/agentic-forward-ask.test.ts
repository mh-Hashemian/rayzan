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

describe('3C.6 expanded action protocol', () => {
  it('forwards DeepSeek → GLM with exact provenance then checkpoints', () => {
    const runtime = new RayzanRuntime(new InMemoryEventStore());
    const coordinator = runtime.registerAgent('ChatGPT', 'coordinator');
    const deepseek = runtime.registerAgent('DeepSeek', 'watcher');
    const qwen = runtime.registerAgent('Qwen', 'watcher');
    const glm = runtime.registerAgent('GLM', 'watcher');

    runtime.runLiveRound1(
      'DeepSeek asks GLM a random question; GLM answers; checkpoint.',
    );
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
    respond(
      runtime,
      deepseek.id,
      'What is your favorite season and why?',
    );

    const step2 = runtime.nextPendingForAgent(coordinator.id);
    assert.ok(step2);
    assert.match(step2.body, /\[E1\]/);
    assert.match(step2.body, /favorite season/i);
    respond(
      runtime,
      coordinator.id,
      JSON.stringify({
        version: 1,
        commands: [
          {
            type: 'forward',
            sourceRefs: ['E1'],
            recipients: {
              type: 'explicit-agents',
              agentIds: [glm.id],
            },
            instruction: 'Answer DeepSeek\'s question directly.',
          },
        ],
      }),
    );
    assert.equal(runtime.nextPendingForAgent(qwen.id), undefined);
    assert.equal(runtime.nextPendingForAgent(deepseek.id), undefined);
    const glmJob = runtime.nextPendingForAgent(glm.id);
    assert.ok(glmJob);
    assert.match(glmJob.body, /SOURCE/);
    assert.match(glmJob.body, /DeepSeek:/);
    assert.match(glmJob.body, /favorite season/i);
    assert.match(glmJob.body, /Answer DeepSeek's question directly/);
    respond(runtime, glm.id, 'Autumn, because the light softens.');

    respond(
      runtime,
      coordinator.id,
      JSON.stringify({
        version: 1,
        commands: [
          {
            type: 'checkpoint',
            content:
              'DeepSeek asked: "What is your favorite season and why?" GLM answered: Autumn, because the light softens.',
            recommendation: 'FINISH',
          },
        ],
      }),
    );
    const state = runtime.snapshot();
    assert.equal(state.awaitingOperator, true);
    assert.match(state.checkpoint?.body ?? '', /favorite season/i);
    assert.match(state.checkpoint?.body ?? '', /Autumn/);
    assert.equal(
      state.watcherContributions.filter(
        (item) => item.name === 'Qwen' && item.roundNumber === 1,
      ).length,
      0,
    );
  });

  it('pauses on ask_operator and resumes the same round after Operator reply', () => {
    const events = new InMemoryEventStore();
    const runtime = new RayzanRuntime(events);
    const coordinator = runtime.registerAgent('ChatGPT', 'coordinator');
    runtime.registerAgent('DeepSeek', 'watcher');

    runtime.runLiveRound1('Which database architecture should Rayzan use?');
    respond(
      runtime,
      coordinator.id,
      JSON.stringify({
        version: 1,
        commands: [
          {
            type: 'ask_operator',
            question:
              'Do you expect Rayzan to support multiple users sharing one server?',
          },
        ],
      }),
    );
    let state = runtime.snapshot();
    assert.ok(state.operatorQuestion);
    assert.match(
      state.operatorQuestion?.question ?? '',
      /multiple users/i,
    );
    assert.equal(state.awaitingOperator, false);
    assert.notEqual(state.rounds[0]?.status, 'completed');
    assert.equal(
      events.listAll().some(
        (event) => event.type === 'COORDINATOR_OPERATOR_QUESTION_CREATED',
      ),
      true,
    );

    runtime.answerOperatorQuestion('No, local single-user for now.');
    state = runtime.snapshot();
    assert.equal(state.operatorQuestion, undefined);
    const resume = runtime.nextPendingForAgent(coordinator.id);
    assert.ok(resume);
    assert.match(resume.body, /local single-user/i);
    assert.equal(state.rounds.length, 1);

    respond(
      runtime,
      coordinator.id,
      JSON.stringify({
        version: 1,
        commands: [
          {
            type: 'checkpoint',
            content: 'Use SQLite for local single-user.',
            recommendation: 'FINISH',
          },
        ],
      }),
    );
    state = runtime.snapshot();
    assert.equal(state.awaitingOperator, true);
    assert.match(state.checkpoint?.body ?? '', /SQLite/);
  });

  it('replays a pending ask_operator without auto-resuming Coordinator', () => {
    const events = new InMemoryEventStore();
    const runtime = new RayzanRuntime(events);
    const coordinator = runtime.registerAgent('ChatGPT', 'coordinator');
    runtime.registerAgent('DeepSeek', 'watcher');
    runtime.runLiveRound1('Need a clarification');
    respond(
      runtime,
      coordinator.id,
      JSON.stringify({
        version: 1,
        commands: [
          {
            type: 'ask_operator',
            question: 'Is this single-user only?',
          },
        ],
      }),
    );
    const restored = new RayzanRuntime(events);
    assert.ok(restored.snapshot().operatorQuestion);
    assert.match(
      restored.snapshot().operatorQuestion?.question ?? '',
      /single-user/i,
    );
    assert.equal(restored.nextPendingForAgent(coordinator.id), undefined);
  });
});
