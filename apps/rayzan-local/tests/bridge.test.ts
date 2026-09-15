import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';

import { asDeliveryId } from '@rayzan/transport';

import { startRayzanLocal } from '../src/server.js';

interface PendingJobResponse {
  job: { deliveryId: string } | null;
}

describe('local bridge protocol', () => {
  const { runtime, server } = startRayzanLocal(0);
  const started = new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });

  after(() => {
    server.close();
  });

  it('isolates pending deliveries by Agent and rejects cross-agent actions', async () => {
    const base = await started;
    const coordinator = await fetch(`${base}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'DeepSeek Coordinator',
        role: 'coordinator',
      }),
    }).then((response) => response.json() as Promise<{ id: string }>);
    const qwen = await fetch(`${base}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Qwen', role: 'watcher' }),
    }).then((response) => response.json() as Promise<{ id: string }>);
    await fetch(`${base}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'GLM', role: 'watcher' }),
    });

    const start = await fetch(`${base}/api/session/start-round`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problem: 'Bridge isolation test' }),
    });
    assert.equal(start.status, 200);

    const coordinatorPending = (await fetch(
      `${base}/api/deliveries/pending?agentId=${coordinator.id}`,
    ).then((response) => response.json())) as PendingJobResponse;
    assert.ok(coordinatorPending.job);
    const deliveryId = coordinatorPending.job.deliveryId;

    const watcherPending = (await fetch(
      `${base}/api/deliveries/pending?agentId=${qwen.id}`,
    ).then((response) => response.json())) as PendingJobResponse;
    assert.equal(watcherPending.job, null);

    const unknownAck = await fetch(`${base}/api/deliveries/missing/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: coordinator.id }),
    });
    assert.equal(unknownAck.status, 400);

    const wrongAgentAck = await fetch(
      `${base}/api/deliveries/${deliveryId}/ack`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: qwen.id }),
      },
    );
    assert.equal(wrongAgentAck.status, 400);

    const ack = await fetch(`${base}/api/deliveries/${deliveryId}/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: coordinator.id }),
    });
    assert.equal(ack.status, 200);

    const duplicateAck = await fetch(
      `${base}/api/deliveries/${deliveryId}/ack`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: coordinator.id }),
      },
    );
    assert.equal(duplicateAck.status, 400);

    const wrongResponse = await fetch(
      `${base}/api/deliveries/${deliveryId}/response`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: qwen.id,
          body: 'stolen response',
        }),
      },
    );
    assert.equal(wrongResponse.status, 400);
    assert.equal(
      runtime.transport.getDelivery(asDeliveryId(deliveryId))?.status,
      'delivered',
    );
  });
});

describe('test-send bridge path', () => {
  const { runtime, server } = startRayzanLocal(0);
  const started = new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });

  after(() => {
    server.close();
  });

  it('creates a pending test delivery that only the recipient can ack', async () => {
    const base = await started;
    await fetch(`${base}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'DeepSeek Coordinator',
        role: 'coordinator',
      }),
    });
    const qwen = await fetch(`${base}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Qwen', role: 'watcher' }),
    }).then((response) => response.json() as Promise<{ id: string }>);
    const glm = await fetch(`${base}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'GLM', role: 'watcher' }),
    }).then((response) => response.json() as Promise<{ id: string }>);

    const created = await fetch(`${base}/api/session/create-round`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problem: 'Test send' }),
    });
    assert.equal(created.status, 200);

    const send = await fetch(`${base}/api/session/test-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: qwen.id,
        body: 'Reply only with: QWEN_RAYZAN_OK',
      }),
    });
    assert.equal(send.status, 200);

    const glmPending = (await fetch(
      `${base}/api/deliveries/pending?agentId=${glm.id}`,
    ).then((response) => response.json())) as PendingJobResponse;
    assert.equal(glmPending.job, null);

    const qwenPending = (await fetch(
      `${base}/api/deliveries/pending?agentId=${qwen.id}`,
    ).then((response) => response.json())) as PendingJobResponse;
    assert.ok(qwenPending.job);
    const deliveryId = qwenPending.job.deliveryId;

    const wrongAck = await fetch(`${base}/api/deliveries/${deliveryId}/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: glm.id }),
    });
    assert.equal(wrongAck.status, 400);

    const ack = await fetch(`${base}/api/deliveries/${deliveryId}/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: qwen.id }),
    });
    assert.equal(ack.status, 200);
    assert.equal(
      runtime.transport.getDelivery(asDeliveryId(deliveryId))?.status,
      'delivered',
    );

    const duplicateAck = await fetch(
      `${base}/api/deliveries/${deliveryId}/ack`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: qwen.id }),
      },
    );
    assert.equal(duplicateAck.status, 400);
  });
});
