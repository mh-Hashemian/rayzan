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

    const watcherPending = (await fetch(
      `${base}/api/deliveries/pending?agentId=${qwen.id}`,
    ).then((response) => response.json())) as PendingJobResponse;
    assert.equal(watcherPending.job, null);

    const coordinatorPending = (await fetch(
      `${base}/api/deliveries/pending?agentId=${coordinator.id}`,
    ).then((response) => response.json())) as PendingJobResponse;
    assert.ok(coordinatorPending.job);
    const deliveryId = coordinatorPending.job.deliveryId;

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
