import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

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

function registerPair(runtime: RayzanRuntime) {
  const coordinator = runtime.registerAgent(
    'DeepSeek Coordinator',
    'coordinator',
  );
  const qwen = runtime.registerAgent('Qwen', 'watcher');
  return { coordinator, qwen };
}

describe('debug providers observatory', () => {
  it('shows honest idle state — no fake delivery, generation, or capture', () => {
    const runtime = new RayzanRuntime();
    registerTrio(runtime);
    const view = runtime.debugProviders();
    const qwen = view.providers.find((card) => card.agentId === 'qwen');
    assert.ok(qwen);
    assert.equal(qwen.delivery.state, 'none');
    assert.equal(qwen.delivery.deliveryId, undefined);
    assert.equal(qwen.capture.state, 'idle');
    assert.equal(qwen.send.state, 'unknown');
    assert.equal(qwen.assistantTurn.state, 'none');
    assert.equal(qwen.coordinatorProtocol.state, 'not_applicable');
    assert.equal(qwen.managed, false);
    assert.equal(qwen.session.state, 'unknown');
    // Coordinator with no activity yet is honestly not_started.
    const coordinatorCard = view.providers.find(
      (card) => card.role === 'coordinator',
    );
    assert.ok(coordinatorCard);
    assert.equal(coordinatorCard.coordinatorProtocol.state, 'not_started');
    assert.equal(view.activeCoordinatorAction, null);
  });

  it('keeps debug reads and managed pushes out of the event log', () => {
    const runtime = new RayzanRuntime();
    registerTrio(runtime);
    const before = runtime.events.listAll().length;
    runtime.debugProviders();
    runtime.noteManagedDebugState({
      pushedAt: Date.now(),
      restoring: false,
      sendTraceEnabled: false,
      providers: [
        {
          providerId: 'qwen',
          session: { state: 'connected' },
          page: { state: 'ready', visible: false },
          send: { state: 'idle' },
          generation: { state: 'idle' },
        },
      ],
    });
    runtime.debugProviders();
    const after = runtime.events.listAll().length;
    assert.equal(after, before);
  });

  it('merges ephemeral managed browser state into provider cards', () => {
    const runtime = new RayzanRuntime();
    const { qwen } = registerTrio(runtime);
    runtime.noteManagedDebugState({
      pushedAt: Date.now(),
      restoring: true,
      sendTraceEnabled: false,
      providers: [
        {
          providerId: 'qwen',
          session: { state: 'restoring', detail: 'Restoring saved session…' },
          page: { state: 'loading', visible: false },
          conversation: { state: 'none' },
          send: { state: 'idle' },
          generation: { state: 'idle' },
        },
      ],
    });
    const card = runtime
      .debugProviders()
      .providers.find((item) => item.agentId === qwen.id);
    assert.ok(card);
    assert.equal(card.managed, true);
    assert.equal(card.session.state, 'restoring');
    assert.equal(card.page.state, 'loading');
    assert.equal(card.conversation.state, 'none');
    assert.equal(card.generation.state, 'idle');
    assert.equal(viewRestoring(runtime.debugProviders()), true);
  });

  it('tracks a delivery through pending → sending → awaiting → responded', () => {
    const runtime = new RayzanRuntime();
    const { qwen } = registerTrio(runtime);
    runtime.createRound1('observatory delivery lifecycle');
    runtime.noteBinding({
      agentId: qwen.id,
      provider: 'Qwen',
      tabId: 'managed:qwen',
      available: true,
    });
    runtime.sendTestMessage(qwen.id, 'Reply only with: QWEN_RAYZAN_OK');
    const job = runtime.nextPendingForAgent(qwen.id);
    assert.ok(job);

    // Queued, not yet picked up by the browser layer.
    let card = cardFor(runtime, qwen.id);
    assert.equal(card.delivery.state, 'pending');

    // Browser layer picked it up and is sending.
    runtime.notePresence({ agentId: qwen.id, phase: 'sending' });
    card = cardFor(runtime, qwen.id);
    assert.equal(card.delivery.state, 'sending');
    assert.equal(card.send.state, 'unknown');

    // Submitted and accepted; the provider is generating a new turn.
    runtime.acknowledgeDelivery(qwen.id, job.deliveryId);
    runtime.notePresence({
      agentId: qwen.id,
      phase: 'generating',
      capture: {
        deliveryId: job.deliveryId,
        phase: 'generating',
        promptSubmitted: true,
        preSendTurnCount: 0,
        trackedIdentity: 'idx:0',
      },
    });
    card = cardFor(runtime, qwen.id);
    assert.equal(card.delivery.state, 'awaiting_response');
    assert.equal(card.assistantTurn.state, 'detected');
    assert.equal(card.generation.state, 'active');
    assert.equal(card.coordinatorProtocol.state, 'not_applicable');

    // Response captured.
    runtime.submitCapturedResponse(qwen.id, job.deliveryId, 'QWEN_RAYZAN_OK');
    card = cardFor(runtime, qwen.id);
    assert.equal(card.delivery.state, 'responded');
  });

  it('distinguishes a watcher response (protocol not applicable) from a Coordinator response', () => {
    const runtime = new RayzanRuntime();
    const { coordinator, qwen } = registerPair(runtime);
    runtime.runLiveRound1('protocol applicability');
    assert.equal(
      cardFor(runtime, qwen.id).coordinatorProtocol.state,
      'not_applicable',
    );

    // Coordinator Round 1 brief is pending; its protocol starts not_started
    // and turns invalid after an unparseable capture.
    const briefJob = runtime.nextPendingForAgent(coordinator.id);
    assert.ok(briefJob);
    assert.equal(
      cardFor(runtime, coordinator.id).coordinatorProtocol.state,
      'not_started',
    );
    runtime.acknowledgeDelivery(coordinator.id, briefJob.deliveryId);
    runtime.notePresence({
      agentId: coordinator.id,
      phase: 'generating',
      capture: {
        deliveryId: briefJob.deliveryId,
        phase: 'generating',
        promptSubmitted: true,
      },
    });
    runtime.submitCapturedResponse(
      coordinator.id,
      briefJob.deliveryId,
      'not json at all',
    );
    const coordinatorCard = cardFor(runtime, coordinator.id);
    assert.equal(coordinatorCard.coordinatorProtocol.state, 'invalid');
    assert.match(
      String(coordinatorCard.coordinatorProtocol.error ?? ''),
      /./,
    );
  });

  it('reports capture failure distinctly and keeps the parser reason', () => {
    const runtime = new RayzanRuntime();
    const { qwen } = registerTrio(runtime);
    runtime.createRound1('capture failure');
    runtime.noteBinding({
      agentId: qwen.id,
      provider: 'Qwen',
      tabId: 'managed:qwen',
      available: true,
    });
    runtime.sendTestMessage(qwen.id, 'Reply only with: QWEN_RAYZAN_OK');
    const job = runtime.nextPendingForAgent(qwen.id);
    assert.ok(job);
    runtime.acknowledgeDelivery(qwen.id, job.deliveryId);
    runtime.notePresence({
      agentId: qwen.id,
      phase: 'attention',
      error: 'generation-timeout — capture failed (attempt 1)',
      capture: {
        deliveryId: job.deliveryId,
        phase: 'failed',
        reason: 'generation-timeout',
        promptSubmitted: true,
        trackedIdentity: 'idx:0',
      },
    });
    runtime.noteManagedDebugState({
      pushedAt: Date.now(),
      restoring: false,
      sendTraceEnabled: true,
      providers: [
        {
          providerId: 'qwen',
          session: { state: 'connected' },
          page: { state: 'ready', visible: true },
          send: { state: 'accepted' },
          generation: { state: 'ended' },
        },
      ],
    });
    const card = cardFor(runtime, qwen.id);
    assert.equal(card.capture.state, 'failed');
    assert.equal(card.capture.reason, 'generation-timeout');
    assert.equal(card.delivery.state, 'failed');
    assert.equal(card.generation.state, 'ended');
    assert.equal(card.send.state, 'accepted');
    assert.equal(card.send.error, undefined);
    const failedStage = card.pipeline.find(
      (stage) => stage.stage === 'Response captured',
    );
    assert.equal(failedStage?.state, 'failed');
  });

  it('exposes managed transitions and coordinator parse results in recent transitions', () => {
    const runtime = new RayzanRuntime();
    const { coordinator } = registerPair(runtime);
    runtime.runLiveRound1('transition visibility');
    const briefJob = runtime.nextPendingForAgent(coordinator.id);
    assert.ok(briefJob);
    runtime.acknowledgeDelivery(coordinator.id, briefJob.deliveryId);
    runtime.notePresence({ agentId: coordinator.id, phase: 'sending' });
    runtime.noteManagedDebugState({
      pushedAt: Date.now(),
      restoring: false,
      sendTraceEnabled: false,
      providers: [
        {
          providerId: coordinator.id,
          session: { state: 'connected' },
          page: { state: 'ready', visible: false },
          transitions: [
            { at: Date.now(), label: 'submit-accepted' },
            { at: Date.now() + 1, label: 'generation-active' },
          ],
        },
      ],
    });
    const labels = runtime
      .debugProviders()
      .recentTransitions.map((item) => item.label);
    assert.equal(labels.includes('delivery-confirmed'), true);
    assert.equal(labels.includes('submit-accepted'), true);
    assert.equal(labels.includes('generation-active'), true);

    // Coordinator parse failure is surfaced with its reason.
    runtime.submitCapturedResponse(
      coordinator.id,
      briefJob.deliveryId,
      'mixed prose {"commands": broken',
    );
    const view = runtime.debugProviders();
    assert.equal(
      view.recentTransitions.some((item) => item.label === 'coordinator-invalid'),
      true,
    );
    const coordinatorCard = cardFor(runtime, coordinator.id);
    assert.equal(coordinatorCard.coordinatorProtocol.state, 'invalid');
  });

  it('ignores malformed managed debug pushes', () => {
    const runtime = new RayzanRuntime();
    registerTrio(runtime);
    runtime.noteManagedDebugState({ garbage: true });
    runtime.noteManagedDebugState({
      providers: [{ providerId: '' }, null, 'nope'],
    });
    runtime.noteManagedDebugState(null);
    const view = runtime.debugProviders();
    assert.equal(
      view.providers.every((card) => card.managed === false),
      true,
    );
  });
});

function cardFor(runtime: RayzanRuntime, agentId: string) {
  const card = runtime
    .debugProviders()
    .providers.find((item) => item.agentId === agentId);
  assert.ok(card, `expected a debug card for ${agentId}`);
  return card;
}

function viewRestoring(view: { restoring: boolean }): boolean {
  return view.restoring;
}
