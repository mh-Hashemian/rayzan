import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { asDebateId } from '@rayzan/protocol';
import { InMemoryEventStore } from '@rayzan/storage';

import { RayzanRuntime } from '../src/runtime.js';

function registerTrio(runtime: RayzanRuntime) {
  const coordinator = runtime.registerAgent(
    'DeepSeek Coordinator',
    'coordinator',
  );
  const qwen = runtime.registerAgent('Qwen', 'watcher');
  const glm = runtime.registerAgent('GLM', 'watcher');
  return { coordinator, qwen, glm };
}

describe('RayzanRuntime Round 1', () => {
  it('bootstraps a visible Round 1 without sending browser deliveries', () => {
    const runtime = new RayzanRuntime();
    const { coordinator, qwen, glm } = registerTrio(runtime);
    runtime.createRound1('Is automatic capture useful?');

    const snap = runtime.snapshot();
    assert.equal(snap.restoredFromHistory, false);
    assert.equal(snap.debate?.status, 'active');
    assert.equal(snap.round?.number, 1);
    assert.equal(snap.round?.status, 'active');
    assert.deepEqual(
      snap.participants.map((participant) => participant.id),
      [qwen.id, glm.id],
    );
    assert.equal(
      snap.participants.some(
        (participant) => participant.id === coordinator.id,
      ),
      false,
    );
    assert.equal(snap.roundProgress?.responded, 0);
    assert.equal(snap.roundProgress?.expected, 2);
    assert.equal(snap.protocol.messages, 0);
    assert.equal(snap.protocol.deliveries, 0);
    assert.equal(snap.protocol.exposures, 0);
    assert.equal(runtime.nextPendingForAgent(coordinator.id), undefined);
    assert.equal(runtime.nextPendingForAgent(qwen.id), undefined);
    assert.equal(runtime.nextPendingForAgent(glm.id), undefined);
    const createdTypes = runtime.events.listAll().map((event) => event.type);
    assert.equal(createdTypes.includes('AGENT_REGISTERED'), true);
    assert.equal(createdTypes.includes('DEBATE_CREATED'), true);
    assert.equal(createdTypes.includes('ROUND_CREATED'), true);
    assert.match(snap.eventLog.join('\n'), /DEBATE_CREATED/);
  });

  it('sends a test message through BrowserTransport pending → delivered only', () => {
    const runtime = new RayzanRuntime();
    registerTrio(runtime);
    const qwen = runtime.agents.listByRole('watcher')[0]!;
    const glm = runtime.agents.listByRole('watcher')[1]!;
    runtime.createRound1('Binding checkpoint');
    runtime.noteBinding({
      agentId: qwen.id,
      provider: 'Qwen',
      tabId: '12',
      available: true,
    });

    runtime.sendTestMessage(qwen.id, 'Reply only with: QWEN_RAYZAN_OK');
    const qwenJob = runtime.nextPendingForAgent(qwen.id);
    assert.ok(qwenJob);
    assert.equal(runtime.nextPendingForAgent(glm.id), undefined);
    assert.equal(runtime.snapshot().roundProgress?.responded, 0);

    runtime.acknowledgeDelivery(qwen.id, qwenJob.deliveryId);
    const afterAck = runtime.snapshot();
    assert.equal(
      afterAck.deliveries.find((delivery) => delivery.id === qwenJob.deliveryId)
        ?.status,
      'delivered',
    );
    assert.equal(afterAck.roundProgress?.responded, 0);
    assert.equal(runtime.nextPendingForAgent(qwen.id), undefined);

    assert.throws(() =>
      runtime.acknowledgeDelivery(qwen.id, qwenJob.deliveryId),
    );
    assert.throws(() =>
      runtime.acknowledgeDelivery(glm.id, qwenJob.deliveryId),
    );
  });
});

function submitRound1CoordinatorBrief(
  runtime: RayzanRuntime,
  coordinatorId: string,
  debateId: string,
  roundId: string,
  body: string,
): void {
  const job = runtime.nextPendingForAgent(coordinatorId);
  assert.ok(job);
  runtime.acknowledgeDelivery(coordinatorId, job.deliveryId);
  runtime.submitCapturedResponse(
    coordinatorId,
    job.deliveryId,
    JSON.stringify({
      version: 1,
      commands: [
        {
          type: 'dispatch',
          messageId: 'round1-brief',
          debateId,
          roundId,
          recipients: { type: 'round-watchers' },
          kind: 'brief',
          body,
          referencedMessageIds: [],
        },
      ],
    }),
  );
}

describe('live Round 1 → Coordinator → personalized Round 2', () => {
  it.skip('lets Coordinator rephrase the brief, then captures Watchers, then Round 2', () => {
    const runtime = new RayzanRuntime();
    const { coordinator, qwen, glm } = registerTrio(runtime);
    const problem =
      'Should Rayzan use SQLite or PostgreSQL for its future persistent local state?';
    runtime.runLiveRound1(problem);

    const afterStart = runtime.snapshot();
    const coordinatorBrief = runtime.nextPendingForAgent(coordinator.id);
    assert.ok(coordinatorBrief);
    assert.equal(runtime.nextPendingForAgent(qwen.id), undefined);
    assert.equal(runtime.nextPendingForAgent(glm.id), undefined);
    assert.match(coordinatorBrief.body, /Rephrase/);
    assert.match(coordinatorBrief.body, new RegExp(qwen.id));
    assert.match(coordinatorBrief.body, new RegExp(glm.id));

    const briefBody =
      'Rephrased: pick SQLite or PostgreSQL. Qwen and GLM are independent Round 1 watchers; do not assume you saw the other answer.';
    submitRound1CoordinatorBrief(
      runtime,
      coordinator.id,
      afterStart.debate!.id,
      afterStart.round1!.id,
      briefBody,
    );

    const afterDispatch = runtime.snapshot();
    assert.equal(afterDispatch.round1?.status, 'collecting');
    const qwenJob = runtime.nextPendingForAgent(qwen.id);
    const glmJob = runtime.nextPendingForAgent(glm.id);
    assert.ok(qwenJob);
    assert.ok(glmJob);
    assert.notEqual(qwenJob.deliveryId, glmJob.deliveryId);
    assert.equal(qwenJob.body, briefBody);
    assert.equal(glmJob.body, briefBody);
    assert.equal(qwenJob.capture, true);
    const briefMessage = afterDispatch.messages.find(
      (message) => message.kind === 'brief',
    );
    assert.equal(briefMessage?.senderId, coordinator.id);
    assert.equal(afterDispatch.roundProgress?.responded, 0);

    runtime.acknowledgeDelivery(qwen.id, qwenJob.deliveryId);
    runtime.acknowledgeDelivery(glm.id, glmJob.deliveryId);
    runtime.submitCapturedResponse(
      qwen.id,
      qwenJob.deliveryId,
      'Qwen says SQLite.',
    );
    const afterOne = runtime.snapshot();
    assert.equal(afterOne.roundProgress?.responded, 1);
    assert.equal(afterOne.round1?.status, 'collecting');
    assert.equal(runtime.nextPendingForAgent(coordinator.id), undefined);

    runtime.submitCapturedResponse(
      glm.id,
      glmJob.deliveryId,
      'GLM says PostgreSQL.',
    );
    const afterRound1 = runtime.snapshot();
    assert.equal(afterRound1.roundProgress?.responded, 2);
    assert.equal(afterRound1.roundProgress?.complete, true);
    assert.equal(afterRound1.round1?.status, 'completed');
    assert.equal(afterRound1.round2?.status, 'active');
    assert.deepEqual(
      afterRound1.round1Responses.map((item) => item.name),
      ['Qwen', 'GLM'],
    );
    assert.match(afterRound1.round1Responses[0]?.body ?? '', /SQLite/);
    assert.match(afterRound1.round1Responses[1]?.body ?? '', /PostgreSQL/);

    const coordinatorJob = runtime.nextPendingForAgent(coordinator.id);
    assert.ok(coordinatorJob);
    assert.equal(coordinatorJob.capture, true);
    assert.match(coordinatorJob.body, /Original Operator Problem/);
    assert.match(coordinatorJob.body, /Coordinator Round 1 Brief/);
    assert.match(coordinatorJob.body, /Qwen says SQLite/);
    assert.match(coordinatorJob.body, /GLM says PostgreSQL/);
    assert.match(coordinatorJob.body, new RegExp(afterRound1.debate!.id));
    assert.match(coordinatorJob.body, new RegExp(afterRound1.round2!.id));
    assert.match(coordinatorJob.body, new RegExp(qwen.id));
    assert.match(coordinatorJob.body, new RegExp(glm.id));

    runtime.acknowledgeDelivery(coordinator.id, coordinatorJob.deliveryId);
    const qwenR1 = afterRound1.messages.find(
      (message) => message.kind === 'response' && message.senderId === qwen.id,
    );
    const glmR1 = afterRound1.messages.find(
      (message) => message.kind === 'response' && message.senderId === glm.id,
    );
    assert.ok(qwenR1);
    assert.ok(glmR1);

    runtime.submitCapturedResponse(
      coordinator.id,
      coordinatorJob.deliveryId,
      JSON.stringify({
        version: 1,
        commands: [
          {
            type: 'dispatch',
            messageId: 'r2-qwen',
            debateId: afterRound1.debate!.id,
            roundId: afterRound1.round2!.id,
            recipients: {
              type: 'explicit-agents',
              agentIds: [qwen.id],
            },
            kind: 'query',
            body: 'Challenge Qwen on durability.',
            referencedMessageIds: [qwenR1.id],
          },
          {
            type: 'dispatch',
            messageId: 'r2-glm',
            debateId: afterRound1.debate!.id,
            roundId: afterRound1.round2!.id,
            recipients: {
              type: 'explicit-agents',
              agentIds: [glm.id],
            },
            kind: 'query',
            body: 'Challenge GLM on operational complexity.',
          },
        ],
      }),
    );

    const done = runtime.snapshot();
    assert.equal(done.coordinatorPlan?.parsed, true);
    assert.equal(done.round2Messages.length, 2);
    const qwenRound2 = done.round2Messages.find((item) => item.name === 'Qwen');
    const glmRound2 = done.round2Messages.find((item) => item.name === 'GLM');
    assert.ok(qwenRound2);
    assert.ok(glmRound2);
    assert.match(qwenRound2.body, /You are Qwen, a Watcher in Round 2/);
    assert.match(glmRound2.body, /You are GLM, a Watcher in Round 2/);
    assert.match(qwenRound2.body, /COMMON ROUND 1 EVIDENCE/);
    assert.match(glmRound2.body, /COMMON ROUND 1 EVIDENCE/);
    assert.equal(qwenRound2.body.includes('Qwen says SQLite.'), true);
    assert.equal(glmRound2.body.includes('Qwen says SQLite.'), true);
    assert.equal(qwenRound2.body.includes('GLM says PostgreSQL.'), true);
    assert.equal(glmRound2.body.includes('GLM says PostgreSQL.'), true);
    assert.match(qwenRound2.body, /Challenge Qwen on durability/);
    assert.match(glmRound2.body, /Challenge GLM on operational complexity/);
    assert.equal(qwenRound2.body.includes('Challenge GLM'), false);
    assert.equal(glmRound2.body.includes('Challenge Qwen'), false);

    const qwenR2 = runtime.nextPendingForAgent(qwen.id);
    const glmR2 = runtime.nextPendingForAgent(glm.id);
    assert.ok(qwenR2);
    assert.ok(glmR2);
    assert.equal(qwenR2.capture, true);
    assert.equal(glmR2.capture, true);
    assert.equal(qwenR2.body, qwenRound2.body);
    assert.equal(glmR2.body, glmRound2.body);

    runtime.acknowledgeDelivery(qwen.id, qwenR2.deliveryId);
    runtime.acknowledgeDelivery(glm.id, glmR2.deliveryId);
    const delivered = runtime.snapshot();
    assert.equal(
      delivered.agents.find((agent) => agent.id === qwen.id)?.round2Status,
      'generating',
    );
    assert.equal(
      delivered.agents.find((agent) => agent.id === glm.id)?.round2Status,
      'generating',
    );
    assert.equal(delivered.round1?.status, 'completed');
    assert.match(delivered.timeline.join('\n'), /COMPLETED/);
    assert.match(
      delivered.timeline.join('\n'),
      /Personalized prompt delivered/,
    );

    const qwenR2Message = delivered.messages.find(
      (message) =>
        message.kind === 'query' && message.recipientIds.includes(qwen.id),
    );
    assert.ok(qwenR2Message);
    assert.equal(qwenR2Message.body.includes('COMMON ROUND 1 EVIDENCE'), true);
  });

  it('accepts the same Coordinator example messageId on a later debate', () => {
    const runtime = new RayzanRuntime();
    const { coordinator, qwen, glm } = registerTrio(runtime);
    runtime.runLiveRound1('First debate with fixed brief id');
    const first = runtime.snapshot();
    submitRound1CoordinatorBrief(
      runtime,
      coordinator.id,
      first.debate!.id,
      first.round1!.id,
      'First independent brief.',
    );
    const firstQwen = runtime.nextPendingForAgent(qwen.id);
    const firstGlm = runtime.nextPendingForAgent(glm.id);
    assert.ok(firstQwen);
    assert.ok(firstGlm);
    runtime.acknowledgeDelivery(qwen.id, firstQwen.deliveryId);
    runtime.acknowledgeDelivery(glm.id, firstGlm.deliveryId);
    runtime.submitCapturedResponse(qwen.id, firstQwen.deliveryId, 'Qwen first');
    runtime.submitCapturedResponse(glm.id, firstGlm.deliveryId, 'GLM first');
    runtime.archiveActiveDebate();

    runtime.runLiveRound1('Second debate reuses example messageId');
    const second = runtime.snapshot();
    submitRound1CoordinatorBrief(
      runtime,
      coordinator.id,
      second.debate!.id,
      second.round1!.id,
      'Second independent brief.',
    );
    const qwenJob = runtime.nextPendingForAgent(qwen.id);
    const glmJob = runtime.nextPendingForAgent(glm.id);
    assert.ok(qwenJob);
    assert.ok(glmJob);
    assert.equal(qwenJob.body, 'Second independent brief.');
    assert.equal(runtime.snapshot().lastError, undefined);
    const briefs = runtime
      .snapshot()
      .messages.filter((message) => message.kind === 'brief');
    assert.equal(briefs.length >= 1, true);
    assert.match(briefs.at(-1)!.id, /^msg-round1-brief-/);
    assert.notEqual(briefs.at(-1)!.id, 'round1-brief');
  });

  it('retryCoordinatorDispatch fails closed on bad stored Coordinator JSON', () => {
    const runtime = new RayzanRuntime();
    const { coordinator, qwen } = registerTrio(runtime);
    runtime.runLiveRound1('Need retry after bad JSON');
    const job = runtime.nextPendingForAgent(coordinator.id);
    assert.ok(job);
    runtime.acknowledgeDelivery(coordinator.id, job.deliveryId);
    runtime.submitCapturedResponse(coordinator.id, job.deliveryId, 'not-json');
    assert.ok(runtime.snapshot().lastError);
    assert.equal(runtime.snapshot().canRetryCoordinatorDispatch, true);
    assert.equal(runtime.nextPendingForAgent(qwen.id), undefined);
    assert.throws(() => runtime.retryCoordinatorDispatch(), /.+/);
    assert.equal(runtime.nextPendingForAgent(qwen.id), undefined);
  });

  it('does not send Round 2 evidence when only one Watcher has responded', () => {
    const runtime = new RayzanRuntime();
    const { coordinator, qwen, glm } = registerTrio(runtime);
    runtime.runLiveRound1('One watcher only');
    const started = runtime.snapshot();
    submitRound1CoordinatorBrief(
      runtime,
      coordinator.id,
      started.debate!.id,
      started.round1!.id,
      'Independent brief for Qwen and GLM.',
    );
    const qwenJob = runtime.nextPendingForAgent(qwen.id);
    const glmJob = runtime.nextPendingForAgent(glm.id);
    assert.ok(qwenJob);
    assert.ok(glmJob);
    runtime.acknowledgeDelivery(qwen.id, qwenJob.deliveryId);
    runtime.submitCapturedResponse(qwen.id, qwenJob.deliveryId, 'Qwen only');
    assert.equal(runtime.snapshot().roundProgress?.responded, 1);
    assert.equal(runtime.nextPendingForAgent(coordinator.id), undefined);
  });

  it.skip('keeps Round 1 completed and does not dispatch Round 2 when Coordinator JSON fails', () => {
    const runtime = new RayzanRuntime();
    const { coordinator, qwen, glm } = registerTrio(runtime);
    runtime.runLiveRound1('Parse failure path');
    const started = runtime.snapshot();
    submitRound1CoordinatorBrief(
      runtime,
      coordinator.id,
      started.debate!.id,
      started.round1!.id,
      'Independent brief for Qwen and GLM.',
    );
    const qwenJob = runtime.nextPendingForAgent(qwen.id)!;
    const glmJob = runtime.nextPendingForAgent(glm.id)!;
    runtime.acknowledgeDelivery(qwen.id, qwenJob.deliveryId);
    runtime.acknowledgeDelivery(glm.id, glmJob.deliveryId);
    runtime.submitCapturedResponse(qwen.id, qwenJob.deliveryId, 'Qwen');
    runtime.submitCapturedResponse(glm.id, glmJob.deliveryId, 'GLM');
    const coordinatorJob = runtime.nextPendingForAgent(coordinator.id)!;
    runtime.acknowledgeDelivery(coordinator.id, coordinatorJob.deliveryId);
    runtime.submitCapturedResponse(
      coordinator.id,
      coordinatorJob.deliveryId,
      'This is prose, not JSON.',
    );
    const failed = runtime.snapshot();
    assert.equal(failed.round1?.status, 'completed');
    assert.equal(failed.coordinatorPlan?.parsed, false);
    assert.match(failed.coordinatorPlan?.error ?? '', /JSON|parse|command/i);
    assert.equal(failed.round2Messages.length, 0);
    assert.equal(runtime.nextPendingForAgent(qwen.id), undefined);
    assert.equal(runtime.nextPendingForAgent(glm.id), undefined);
  });

  it.skip('captures Round 2 replies and stores Coordinator synthesis without Round 3', () => {
    const runtime = new RayzanRuntime();
    const { coordinator, qwen, glm } = registerTrio(runtime);
    runtime.runLiveRound1('SQLite or PostgreSQL?');
    const started = runtime.snapshot();
    submitRound1CoordinatorBrief(
      runtime,
      coordinator.id,
      started.debate!.id,
      started.round1!.id,
      'Independent brief for Qwen and GLM.',
    );
    const qwenR1 = runtime.nextPendingForAgent(qwen.id)!;
    const glmR1 = runtime.nextPendingForAgent(glm.id)!;
    runtime.acknowledgeDelivery(qwen.id, qwenR1.deliveryId);
    runtime.acknowledgeDelivery(glm.id, glmR1.deliveryId);
    runtime.submitCapturedResponse(qwen.id, qwenR1.deliveryId, 'Qwen: SQLite.');
    runtime.submitCapturedResponse(
      glm.id,
      glmR1.deliveryId,
      'GLM: PostgreSQL.',
    );
    const afterRound1 = runtime.snapshot();
    const coordinatorPlanJob = runtime.nextPendingForAgent(coordinator.id)!;
    runtime.acknowledgeDelivery(coordinator.id, coordinatorPlanJob.deliveryId);
    runtime.submitCapturedResponse(
      coordinator.id,
      coordinatorPlanJob.deliveryId,
      JSON.stringify({
        version: 1,
        commands: [
          {
            type: 'dispatch',
            messageId: 'r2-qwen',
            debateId: afterRound1.debate!.id,
            roundId: afterRound1.round2!.id,
            recipients: {
              type: 'explicit-agents',
              agentIds: [qwen.id],
            },
            kind: 'query',
            body: 'Challenge Qwen on durability.',
            referencedMessageIds: [],
          },
          {
            type: 'dispatch',
            messageId: 'r2-glm',
            debateId: afterRound1.debate!.id,
            roundId: afterRound1.round2!.id,
            recipients: {
              type: 'explicit-agents',
              agentIds: [glm.id],
            },
            kind: 'query',
            body: 'Challenge GLM on complexity.',
            referencedMessageIds: [],
          },
        ],
      }),
    );
    const qwenR2 = runtime.nextPendingForAgent(qwen.id)!;
    const glmR2 = runtime.nextPendingForAgent(glm.id)!;
    assert.equal(qwenR2.capture, true);
    runtime.acknowledgeDelivery(qwen.id, qwenR2.deliveryId);
    runtime.acknowledgeDelivery(glm.id, glmR2.deliveryId);
    runtime.submitCapturedResponse(
      qwen.id,
      qwenR2.deliveryId,
      'Qwen Round 2: SQLite still, with WAL.',
    );
    assert.equal(runtime.nextPendingForAgent(coordinator.id), undefined);
    runtime.submitCapturedResponse(
      glm.id,
      glmR2.deliveryId,
      'GLM Round 2: PostgreSQL still, managed.',
    );

    const afterRound2 = runtime.snapshot();
    assert.equal(afterRound2.round2?.status, 'completed');
    const synthesisJob = runtime.nextPendingForAgent(coordinator.id);
    assert.ok(synthesisJob);
    assert.equal(synthesisJob.capture, true);
    assert.match(synthesisJob.body, /final synthesis stage/i);
    assert.match(synthesisJob.body, /Do not start Round 3/);
    assert.match(synthesisJob.body, /Original Operator Problem/);
    assert.match(synthesisJob.body, /Independent brief for Qwen and GLM/);
    assert.match(synthesisJob.body, /Qwen: SQLite/);
    assert.match(synthesisJob.body, /GLM: PostgreSQL/);
    assert.match(synthesisJob.body, /Challenge Qwen on durability/);
    assert.match(synthesisJob.body, /Challenge GLM on complexity/);
    assert.match(synthesisJob.body, /Qwen Round 2: SQLite still/);
    assert.match(synthesisJob.body, /GLM Round 2: PostgreSQL still/);
    assert.equal(runtime.nextPendingForAgent(qwen.id), undefined);
    assert.equal(runtime.nextPendingForAgent(glm.id), undefined);

    runtime.acknowledgeDelivery(coordinator.id, synthesisJob.deliveryId);
    runtime.submitCapturedResponse(
      coordinator.id,
      synthesisJob.deliveryId,
      `Problem:
SQLite or PostgreSQL?

Process:
1. Independent analysis.
2. Qwen proposed SQLite.
3. GLM proposed PostgreSQL.
4. Main disagreement was operational complexity.
5. Round 2 kept both positions, with more detail.

Consensus:
Local-first storage matters.

Differences:
SQLite vs PostgreSQL operations.

Rejected ideas:
None material.

Final recommendation:
Start with SQLite.

Confidence:
Medium.

Suggested next action:
Prototype the local schema.`,
    );

    const done = runtime.snapshot();
    assert.ok(done.synthesis);
    assert.equal(done.synthesis?.debateId, afterRound2.debate!.id);
    assert.equal(done.synthesis?.coordinatorId, coordinator.id);
    assert.match(done.synthesis?.body ?? '', /Final recommendation:/);
    assert.match(done.synthesis?.body ?? '', /Start with SQLite/);
    assert.equal(done.debate?.status, 'completed');
    assert.equal(done.round2?.status, 'completed');
    assert.equal(runtime.nextPendingForAgent(qwen.id), undefined);
    assert.equal(runtime.nextPendingForAgent(glm.id), undefined);
    assert.match(done.timeline.join('\n'), /Final Coordinator Report stored/);
    assert.equal(
      done.messages.some((message) =>
        message.body.includes('Start with SQLite'),
      ),
      true,
    );
    const eventTypes = runtime.events
      .listByDebate(asDebateId(done.debate!.id))
      .map((event) => event.type);
    assert.equal(eventTypes.includes('MESSAGE_DISPATCHED'), true);
    assert.equal(eventTypes.includes('RESPONSE_CAPTURED'), true);
    assert.equal(eventTypes.includes('SYNTHESIS_CREATED'), true);
    assert.match(done.eventLog.join('\n'), /SYNTHESIS_CREATED/);
  });

  it.skip('bootstraps Round 2 on a second debate after the first completes', () => {
    const runtime = new RayzanRuntime();
    const { coordinator, qwen, glm } = registerTrio(runtime);

    function finishDebate(topic: string): void {
      runtime.runLiveRound1(topic);
      const started = runtime.snapshot();
      const coordJob = runtime.nextPendingForAgent(coordinator.id)!;
      runtime.acknowledgeDelivery(coordinator.id, coordJob.deliveryId);
      runtime.submitCapturedResponse(
        coordinator.id,
        coordJob.deliveryId,
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
              body: 'Independent brief.',
              referencedMessageIds: [],
            },
          ],
        }),
      );
      const qwenR1 = runtime.nextPendingForAgent(qwen.id)!;
      const glmR1 = runtime.nextPendingForAgent(glm.id)!;
      runtime.acknowledgeDelivery(qwen.id, qwenR1.deliveryId);
      runtime.acknowledgeDelivery(glm.id, glmR1.deliveryId);
      runtime.submitCapturedResponse(qwen.id, qwenR1.deliveryId, 'Qwen R1');
      runtime.submitCapturedResponse(glm.id, glmR1.deliveryId, 'GLM R1');
      const afterR1 = runtime.snapshot();
      assert.ok(afterR1.round2, 'Round 2 must bootstrap after Round 1');
      const planJob = runtime.nextPendingForAgent(coordinator.id)!;
      runtime.acknowledgeDelivery(coordinator.id, planJob.deliveryId);
      runtime.submitCapturedResponse(
        coordinator.id,
        planJob.deliveryId,
        JSON.stringify({
          version: 1,
          commands: [
            {
              type: 'dispatch',
              messageId: 'r2-qwen',
              debateId: afterR1.debate!.id,
              roundId: afterR1.round2!.id,
              recipients: {
                type: 'explicit-agents',
                agentIds: [qwen.id],
              },
              kind: 'query',
              body: 'Challenge Qwen.',
              referencedMessageIds: [],
            },
            {
              type: 'dispatch',
              messageId: 'r2-glm',
              debateId: afterR1.debate!.id,
              roundId: afterR1.round2!.id,
              recipients: {
                type: 'explicit-agents',
                agentIds: [glm.id],
              },
              kind: 'query',
              body: 'Challenge GLM.',
              referencedMessageIds: [],
            },
          ],
        }),
      );
      const qwenR2 = runtime.nextPendingForAgent(qwen.id)!;
      const glmR2 = runtime.nextPendingForAgent(glm.id)!;
      runtime.acknowledgeDelivery(qwen.id, qwenR2.deliveryId);
      runtime.acknowledgeDelivery(glm.id, glmR2.deliveryId);
      runtime.submitCapturedResponse(qwen.id, qwenR2.deliveryId, 'Qwen R2');
      runtime.submitCapturedResponse(glm.id, glmR2.deliveryId, 'GLM R2');
      const synthJob = runtime.nextPendingForAgent(coordinator.id)!;
      runtime.acknowledgeDelivery(coordinator.id, synthJob.deliveryId);
      runtime.submitCapturedResponse(
        coordinator.id,
        synthJob.deliveryId,
        `Problem:\n${topic}\n\nFinal recommendation:\nDone.`,
      );
      assert.equal(runtime.snapshot().debate?.status, 'completed');
      assert.equal(runtime.snapshot().canRetryCoordinatorDispatch, undefined);
    }

    finishDebate('First debate topic');
    const firstId = runtime.snapshot().debateHistory.at(-1)?.id;
    finishDebate('Second debate topic');
    const second = runtime.snapshot();
    assert.notEqual(second.debateHistory.at(-1)?.id, firstId);
    assert.equal(second.debateHistory.length >= 2, true);
  });
});

describe('presence', () => {
  it('keeps a failed capture visible after a later waiting heartbeat', () => {
    const runtime = new RayzanRuntime();
    const { coordinator } = registerTrio(runtime);
    runtime.createRound1('Keep failed capture visible');
    runtime.notePresence({
      agentId: coordinator.id,
      phase: 'error',
      error: 'DeepSeek send button stayed disabled after filling the input.',
      capture: { phase: 'failed', reason: 'empty-response' },
    });
    runtime.notePresence({
      agentId: coordinator.id,
      phase: 'waiting',
    });
    const row = runtime
      .snapshot()
      .agents.find((agent) => agent.id === coordinator.id);
    assert.equal(row?.phase, 'error');
    assert.equal(row?.capture?.phase, 'failed');
    assert.match(
      String(runtime.snapshot().lastError),
      /send button stayed disabled/,
    );
  });
});

describe('changeCoordinator', () => {
  it('swaps roles, keeps history, and does not rewrite an existing debate', () => {
    const runtime = new RayzanRuntime();
    const { coordinator, qwen, glm } = registerTrio(runtime);
    runtime.createRound1('Keep existing debate participants');
    const before = runtime.snapshot();
    runtime.changeCoordinator(qwen.id);
    const after = runtime.snapshot();
    assert.equal(
      after.agents.find((agent) => agent.id === coordinator.id)?.role,
      'watcher',
    );
    assert.equal(
      after.agents.find((agent) => agent.id === qwen.id)?.role,
      'coordinator',
    );
    assert.equal(
      after.agents.filter((agent) => agent.role === 'coordinator').length,
      1,
    );
    assert.deepEqual(
      after.participants.map((participant) => participant.id),
      before.participants.map((participant) => participant.id),
    );
    assert.equal(glm.role, 'watcher');
    const changed = runtime.events
      .listAll()
      .filter((event) => event.type === 'COORDINATOR_CHANGED');
    assert.equal(changed.length, 1);
    const payload = changed[0]!.payload as {
      previousAgentId: string;
      newAgentId: string;
      timestamp: string;
    };
    assert.equal(payload.previousAgentId, coordinator.id);
    assert.equal(payload.newAgentId, qwen.id);
    assert.ok(payload.timestamp);
  });

  it('refuses to make the Operator the Coordinator', () => {
    const runtime = new RayzanRuntime();
    registerTrio(runtime);
    assert.throws(
      () => runtime.changeCoordinator('operator'),
      /Operator cannot become Coordinator/,
    );
  });
});

describe('watcher participation', () => {
  it('lets the Operator exclude a Watcher from the next debate only', () => {
    const runtime = new RayzanRuntime();
    const { qwen, glm } = registerTrio(runtime);
    runtime.createRound1('Keep existing debate participants');
    const before = runtime.snapshot();
    runtime.setWatcherParticipation(glm.id, false);
    assert.equal(
      runtime.snapshot().agents.find((agent) => agent.id === glm.id)?.enabled,
      false,
    );
    assert.deepEqual(
      runtime.snapshot().participants.map((participant) => participant.id),
      before.participants.map((participant) => participant.id),
    );
    runtime.archiveActiveDebate();
    runtime.createRound1('Only included Watchers join');
    assert.deepEqual(
      runtime.snapshot().participants.map((participant) => participant.id),
      [qwen.id],
    );
  });

  it('refuses to toggle the Coordinator or Operator', () => {
    const runtime = new RayzanRuntime();
    const { coordinator } = registerTrio(runtime);
    assert.throws(
      () => runtime.setWatcherParticipation(coordinator.id, false),
      /Only Watchers/,
    );
    assert.throws(
      () => runtime.setWatcherParticipation('operator', false),
      /Only Watchers/,
    );
  });

  it('restores excluded Watchers from the event log', () => {
    const events = new InMemoryEventStore();
    const first = new RayzanRuntime(events);
    const { glm } = registerTrio(first);
    first.setWatcherParticipation(glm.id, false);
    const restored = new RayzanRuntime(events);
    assert.equal(
      restored.snapshot().agents.find((agent) => agent.id === glm.id)?.enabled,
      false,
    );
  });
});
