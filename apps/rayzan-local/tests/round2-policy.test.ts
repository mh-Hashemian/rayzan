import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { asAgentId, asMessageId, createAgent } from '@rayzan/protocol';
import { parseCoordinatorCommandBatch } from '@rayzan/orchestrator';

import {
  commonRound1Evidence,
  composeRound2WatcherBody,
  mergeReferencedMessageIds,
  watcherChallengesFromBatch,
} from '../src/round2-policy.js';
import {
  coordinatorCheckpointPrompt,
  coordinatorRound1Prompt,
  coordinatorRoundPrompt,
  coordinatorSynthesisPrompt,
} from '../src/coordinator-prompt.js';

describe('Round 2 common-evidence policy', () => {
  const qwen = createAgent({
    id: 'qwen',
    name: 'Qwen',
    role: 'watcher',
  });
  const glm = createAgent({
    id: 'glm',
    name: 'GLM',
    role: 'watcher',
  });

  it('prepends the same common packet to different challenges', () => {
    const common = commonRound1Evidence({
      responses: [
        {
          agentId: qwen.id,
          name: qwen.name,
          messageId: asMessageId('msg-qwen-r1'),
          body: 'Qwen says SQLite.',
        },
        {
          agentId: glm.id,
          name: glm.name,
          messageId: asMessageId('msg-glm-r1'),
          body: 'GLM says PostgreSQL.',
        },
      ],
    });
    assert.match(common, /Qwen says SQLite/);
    assert.match(common, /GLM says PostgreSQL/);
    const qwenBody = composeRound2WatcherBody(
      qwen.name,
      common,
      'Challenge Qwen.',
    );
    const glmBody = composeRound2WatcherBody(
      glm.name,
      common,
      'Challenge GLM.',
    );
    assert.equal(qwenBody.includes(common), true);
    assert.equal(glmBody.includes(common), true);
    assert.match(qwenBody, /You are Qwen, a Watcher in Round 2/);
    assert.match(glmBody, /Challenge GLM/);
    assert.match(qwenBody, /ROUND 2 RESPONSE CONTRACT/);
    assert.match(qwenBody, /Fresh, substantive analysis/i);
    assert.match(qwenBody, /Strongest challenge to your own position/);
    assert.equal(qwenBody.includes('Challenge GLM.'), false);
  });

  it('uses substantive prompt contracts without changing the debate topology', () => {
    const round1 = coordinatorRound1Prompt({
      problem: 'Design a Rayzan logo with a usable SVG deliverable.',
      coordinatorId: 'coordinator',
      debateId: 'debate-1',
      roundId: 'round-1',
      watchers: [qwen, glm],
    });
    const challenge = coordinatorRoundPrompt({
      problem: 'Design a Rayzan logo with a usable SVG deliverable.',
      coordinatorId: 'coordinator',
      debateId: 'debate-1',
      roundId: 'round-2',
      roundNumber: 2,
      watchers: [qwen, glm],
      evidencePacket: 'Watcher evidence.',
      intervention: 'Make it accessible.',
    });
    const checkpoint = coordinatorCheckpointPrompt({
      coordinatorId: 'coordinator',
      debateId: 'debate-1',
      roundId: 'round-2',
      roundNumber: 2,
      evidencePacket: 'Watcher evidence.',
    });
    const synthesis = coordinatorSynthesisPrompt({
      coordinatorId: 'coordinator',
      debateId: 'debate-1',
      evidencePacket: 'Watcher evidence.',
    });

    assert.match(round1, /multiple viable approaches/i);
    assert.match(round1, /candidate deliverable/i);
    assert.match(challenge, /strongest opposing argument/i);
    assert.match(challenge, /Operator Deliverable Contract/);
    assert.match(checkpoint, /# Coordinator's Current Judgment/);
    assert.match(checkpoint, /Markdown comparison table/i);
    assert.match(checkpoint, /Coordinator recommendation: FINISH \| CONTINUE/);
    assert.match(synthesis, /# Coordinator's Final Judgment/);
    assert.match(synthesis, /fullest usable final artifact/i);
  });

  it('augments omitted Coordinator references with both Round 1 response ids', () => {
    assert.deepEqual(
      mergeReferencedMessageIds([], ['msg-qwen-r1', 'msg-glm-r1']),
      ['msg-qwen-r1', 'msg-glm-r1'],
    );
    assert.deepEqual(
      mergeReferencedMessageIds(['msg-qwen-r1'], ['msg-qwen-r1', 'msg-glm-r1']),
      ['msg-qwen-r1', 'msg-glm-r1'],
    );
  });

  it('extracts one personalized challenge per Watcher', () => {
    const batch = parseCoordinatorCommandBatch(
      JSON.stringify({
        version: 1,
        commands: [
          {
            type: 'dispatch',
            messageId: 'r2-qwen',
            debateId: 'debate-1',
            roundId: 'round-2',
            recipients: {
              type: 'explicit-agents',
              agentIds: ['qwen'],
            },
            kind: 'query',
            body: 'Qwen-specific challenge',
            referencedMessageIds: ['msg-qwen-r1'],
          },
          {
            type: 'dispatch',
            messageId: 'r2-glm',
            debateId: 'debate-1',
            roundId: 'round-2',
            recipients: {
              type: 'explicit-agents',
              agentIds: ['glm'],
            },
            kind: 'query',
            body: 'GLM-specific challenge',
          },
        ],
      }),
    );
    const challenges = watcherChallengesFromBatch({
      batch,
      watchers: [qwen, glm],
    });
    assert.equal(challenges.length, 2);
    assert.equal(
      challenges.find((item) => item.agentId === asAgentId('qwen'))?.challenge,
      'Qwen-specific challenge',
    );
    assert.equal(
      challenges.find((item) => item.agentId === asAgentId('glm'))?.challenge,
      'GLM-specific challenge',
    );
  });
});
