import type { Agent } from '@rayzan/protocol';

import type { AttributedWatcherResponse } from './round2-policy.js';

export function coordinatorRound1Prompt(input: {
  problem: string;
  coordinatorId: string;
  debateId: string;
  roundId: string;
  watchers: readonly Agent[];
}): string {
  const watcherLines = input.watchers
    .map((watcher) => `- ${watcher.name} (id ${watcher.id}, role watcher)`)
    .join('\n');

  return `You are the Rayzan Coordinator for this debate.

Your role = coordinator
Your agent ID = ${input.coordinatorId}
Debate ID = ${input.debateId}
Round ID = ${input.roundId}

Copy debateId and roundId exactly. Do not invent ids. Do not use round-2.

Round 1 Watcher participants:
${watcherLines}

Reply with JSON only. No markdown. No prose.

Allowed command for this step: dispatch.

referencedMessageIds is required and must be [] for Round 1.

Return exactly one dispatch command that sends the same independent-analysis brief to every current-round Watcher (recipients.type = "round-watchers").

The body is what Qwen and GLM will see. You are the sender. In that body you MUST:

1. Rephrase the Operator's problem in your own words (do not paste it unchanged).
2. Tell each Watcher they are an independent Round 1 analyst.
3. Name each Watcher and their agent id from the list above.
4. Tell them they must not assume they have seen another Watcher's answer.
5. Ask for a complete independent analysis.

{
  "version": 1,
  "commands": [
    {
      "type": "dispatch",
      "messageId": "round1-brief",
      "debateId": "${input.debateId}",
      "roundId": "${input.roundId}",
      "recipients": { "type": "round-watchers" },
      "kind": "brief",
      "body": "<rephrased problem + Watcher roles + independent-analysis instructions>",
      "referencedMessageIds": []
    }
  ]
}

PROBLEM:
${input.problem}`;
}

export function coordinatorRound2Prompt(input: {
  problem: string;
  coordinatorId: string;
  debateId: string;
  round2Id: string;
  watchers: readonly Agent[];
  responses: readonly AttributedWatcherResponse[];
  coordinatorBrief?: string;
  evidencePacket: string;
}): string {
  const watcherLines = input.watchers
    .map((watcher) => `- ${watcher.name} (id ${watcher.id}, role watcher)`)
    .join('\n');
  const responseIds = input.responses
    .map((response) => `- ${response.name} response id ${response.messageId}`)
    .join('\n');
  const referenced = input.responses
    .map((response) => `"${response.messageId}"`)
    .join(', ');
  const exampleCommands = input.watchers
    .map(
      (watcher) => `{
      "type": "dispatch",
      "messageId": "round2-${watcher.id}",
      "debateId": "${input.debateId}",
      "roundId": "${input.round2Id}",
      "recipients": {
        "type": "explicit-agents",
        "agentIds": ["${watcher.id}"]
      },
      "kind": "query",
      "body": "<${watcher.name}-specific challenge>",
      "referencedMessageIds": [${referenced}]
    }`,
    )
    .join(',\n    ');

  return `You are the Rayzan Coordinator for this debate.

Your role = coordinator
Your agent ID = ${input.coordinatorId}

Round 1 is complete.

Debate ID = ${input.debateId}
Round 2 ID = ${input.round2Id}

Copy debateId and roundId exactly. Use Round 2 ID ${input.round2Id}. Do not invent ids.

Round 2 Watcher participants:
${watcherLines}

Round 1 response message ids (must appear in referencedMessageIds):
${responseIds}

Below are the complete attributed Round 1 materials. Do not summarize them. Do not omit either Watcher.

Create one personalized Round 2 challenge for each Watcher. Each should:
- address that Watcher's actual Round 1 reasoning,
- challenge assumptions / omissions / disagreements,
- preserve important minority positions,
- output strict Rayzan JSON only.

Rayzan will prepend the common Round 1 evidence packet itself. Your body should be only the personalized challenge for that Watcher.

Reply with JSON only. No markdown. No prose.

Allowed command for this step: dispatch.

Return an ordered batch similar to:

{
  "version": 1,
  "commands": [
    ${exampleCommands}
  ]
}

${input.evidencePacket}`;
}

export function unwrapCoordinatorJson(text: string): string {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
  if (fenced?.[1]) {
    const inner = fenced[1].trim();
    if (looksLikeJsonObject(inner)) {
      return inner;
    }
  }
  if (looksLikeJsonObject(trimmed)) {
    return trimmed;
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const slice = trimmed.slice(start, end + 1);
    if (looksLikeJsonObject(slice)) {
      return slice;
    }
  }
  return trimmed;
}

function looksLikeJsonObject(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    return (
      parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    );
  } catch {
    return false;
  }
}
