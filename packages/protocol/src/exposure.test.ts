import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { asAgentId } from './ids.js';
import {
  createExposureRecord,
  emptyExposureLedger,
  exposuresForAgent,
  recordExposure,
} from './exposure.js';

describe('ExposureLedger', () => {
  it('starts a fresh Watcher with no protocol exposure', () => {
    const ledger = emptyExposureLedger();
    const deepSeekId = asAgentId('watcher-deepseek');

    assert.deepEqual(exposuresForAgent(ledger, deepSeekId), []);
  });

  it('records structural message exposure without provider-internal context', () => {
    const ledger = recordExposure(
      emptyExposureLedger(),
      createExposureRecord({
        id: 'exp-1',
        agentId: 'watcher-deepseek',
        debateId: 'debate-1',
        roundId: 'round-1',
        messageId: 'msg-abc',
      }),
    );

    const records = exposuresForAgent(ledger, asAgentId('watcher-deepseek'));
    const [record] = records;

    assert.equal(records.length, 1);
    assert.ok(record);
    assert.equal(record.messageId, 'msg-abc');
    assert.deepEqual(record.referencedMessageIds, []);
    assert.deepEqual(Object.keys(record).sort(), [
      'agentId',
      'debateId',
      'id',
      'messageId',
      'referencedMessageIds',
      'roundId',
    ]);
    assert.equal('providerMemory' in record, false);
    assert.equal('customInstructions' in record, false);
    assert.equal('systemPrompt' in record, false);
    assert.equal('conversationHistory' in record, false);
  });

  it('can cite other messages structurally without analyzing their ideas', () => {
    const ledger = recordExposure(
      emptyExposureLedger(),
      createExposureRecord({
        id: 'exp-2',
        agentId: 'watcher-deepseek',
        debateId: 'debate-1',
        roundId: 'round-2',
        messageId: 'msg-xyz',
        referencedMessageIds: ['msg-qwen-r1', 'msg-glm-r1'],
      }),
    );

    const [record] = exposuresForAgent(ledger, asAgentId('watcher-deepseek'));
    assert.ok(record);
    assert.equal(record.messageId, 'msg-xyz');
    assert.deepEqual(record.referencedMessageIds, [
      'msg-qwen-r1',
      'msg-glm-r1',
    ]);
  });

  it('does not copy exposure from one Watcher to another', () => {
    const ledger = recordExposure(
      emptyExposureLedger(),
      createExposureRecord({
        id: 'exp-3',
        agentId: 'watcher-deepseek',
        debateId: 'debate-1',
        messageId: 'msg-abc',
      }),
    );

    assert.deepEqual(exposuresForAgent(ledger, asAgentId('watcher-qwen')), []);
  });
});
