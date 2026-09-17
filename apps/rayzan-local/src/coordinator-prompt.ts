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
5. Ask for a complete independent analysis with these visible sections: interpretation
   of the problem, material assumptions, multiple viable approaches, analysis of
   benefits and drawbacks, risks or failure modes, a recommendation, a candidate
   deliverable, and uncertainties that need resolving.
6. Tell Watchers to preserve the Operator's requested output and constraints, and
   to give direct reasoning rather than hidden chain-of-thought or a mechanical log.

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
      "body": "<rephrased problem + deliverable contract + independent-analysis response contract>",
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
- identify shared evidence, the strongest opposing argument, and an unresolved assumption,
- include a specific question and request a novel analysis or deliverable improvement,
- apply any relevant Operator intervention,
- preserve important minority positions,
- preserve the original requested deliverable and constraints,
- output strict Rayzan JSON only, without chain-of-thought or routing metadata.

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

/** Coordinator prompt for every post-Round-1 challenge round. */
export function coordinatorRoundPrompt(input: {
  problem: string;
  coordinatorId: string;
  debateId: string;
  roundId: string;
  roundNumber: number;
  watchers: readonly Agent[];
  evidencePacket: string;
  latestCheckpoint?: string;
  intervention?: string;
}): string {
  const watcherLines = input.watchers
    .map((watcher) => `- ${watcher.name} (id ${watcher.id})`)
    .join('\n');
  const commands = input.watchers
    .map(
      (watcher) => `{
      "type": "dispatch",
      "messageId": "round${input.roundNumber}-${watcher.id}",
      "debateId": "${input.debateId}",
      "roundId": "${input.roundId}",
      "recipients": { "type": "explicit-agents", "agentIds": ["${watcher.id}"] },
      "kind": "query",
      "body": "<${watcher.name}-specific challenge>",
      "referencedMessageIds": []
    }`,
    )
    .join(',\n    ');
  return `You are the Rayzan Coordinator for debate ${input.debateId}.

Create Round ${input.roundNumber} challenges for every active Watcher. Round 1 was independent; this round must produce fresh substantive analysis, not a restatement of prior answers. Preserve important disagreement and the Operator Deliverable Contract: the original goal, requested artifact/output, and every stated constraint.

Each personalized challenge body must explicitly include:
- the relevant shared evidence and the Watcher's current position or meaningful change;
- the strongest opposing argument or evidence the Watcher must answer;
- an unresolved assumption or uncertainty to test;
- any Operator intervention that applies;
- at least one specific question for that Watcher; and
- a request for a new analysis, comparison, test, design move, or other novel contribution.

Do not include dispatch metadata, routing logs, or chain-of-thought in a challenge body. The platform will provide semantic evidence separately.

Watchers:
${watcherLines}

${input.latestCheckpoint ? `Latest Coordinator checkpoint:\n${input.latestCheckpoint}\n` : ''}${input.intervention ? `Operator intervention (apply exactly as relevant):\n${input.intervention}\n` : ''}
Reply with JSON only, using exactly one dispatch command per Watcher:
{
  "version": 1,
  "commands": [
    ${commands}
  ]
}

Evidence packet (bounded to relevant prior evidence):
${input.evidencePacket}

Original problem:
${input.problem}`;
}

export function coordinatorCheckpointPrompt(input: {
  coordinatorId: string;
  debateId: string;
  roundId: string;
  roundNumber: number;
  evidencePacket: string;
}): string {
  return `You are the Rayzan Coordinator for debate ${input.debateId}.

Round ${input.roundNumber} (${input.roundId}) is complete. Do not dispatch Watchers and do not write JSON commands. Produce a substantial, self-contained operator report in Markdown. It must be useful without opening any Watcher message, while avoiding a mechanical transcript or hidden chain-of-thought.

Preserve the Operator Deliverable Contract throughout: state the goal, identify the actual requested output/artifact, and retain every stated output constraint. Include the fullest usable candidate artifact that the evidence supports; do not replace it with a vague promise.

Use exactly these headings, in this order:

# Coordinator's Current Judgment
# Requested Deliverable
# What Happened This Round
# Ideas Compared
# Challenges and Responses
# Position Changes
# Remaining Disagreements
# Important Terms
# What Changed Since Last Round
# Coordinator Recommendation

Under Ideas Compared, include a Markdown comparison table whenever two or more approaches can reasonably be compared. Explain terms or context needed by a non-specialist under Important Terms. Identify direct challenges, responses, tradeoffs, evidence, and position changes rather than merely listing messages.

Under # Coordinator Recommendation, include this exact machine-readable line followed by a reason and, for CONTINUE, a concrete next-round agenda:
Coordinator recommendation: FINISH | CONTINUE

The Current Judgment is provisional at a checkpoint. The Operator, not you, decides whether to continue.

Relevant evidence:
${input.evidencePacket}`;
}

export function synthesisEvidencePacket(input: {
  problem: string;
  coordinatorBrief?: string;
  round1Responses: readonly AttributedWatcherResponse[];
  round2Plan?: readonly { name: string; challenge: string }[];
  round2Responses: readonly AttributedWatcherResponse[];
}): string {
  const round1 = input.round1Responses
    .map(
      (response) => `${response.name} Round 1 Response
=======================
${response.body}`,
    )
    .join('\n\n');
  const plan =
    input.round2Plan
      ?.map(
        (item) => `${item.name} Round 2 Challenge
=======================
${item.challenge}`,
      )
      .join('\n\n') || '(none)';
  const round2 = input.round2Responses
    .map(
      (response) => `${response.name} Round 2 Response
=======================
${response.body}`,
    )
    .join('\n\n');
  return `Original Operator Problem
=======================
${input.problem}

Coordinator Round 1 Brief
=======================
${input.coordinatorBrief?.trim() || '(none)'}

${round1}

Coordinator Round 2 Plan
=======================
${plan}

${round2}`;
}

export function coordinatorSynthesisPrompt(input: {
  coordinatorId: string;
  debateId: string;
  evidencePacket: string;
}): string {
  return `You are the Rayzan Coordinator for this debate.

Your role = coordinator
Your agent ID = ${input.coordinatorId}
Debate ID = ${input.debateId}

All completed debate rounds are available below. This is the final synthesis stage, not a new debate round.

Do not emit JSON commands. Do not dispatch Watchers. Do not start Round 3.
The Operator decides. You recommend.

Write one complete, self-contained final report the Operator can use without opening any Watcher message. Preserve the Operator Deliverable Contract: goal, requested output/artifact, and every output constraint. Include the fullest usable final artifact supported by the evidence.

Use exactly these headings, in this order:

# Coordinator's Final Judgment
# Requested Deliverable
# Debate Summary
# Ideas Compared
# Challenges and Responses
# Position Changes
# Remaining Disagreements
# Important Terms
# What Changed Across Rounds
# Final Recommendation

Under Ideas Compared, include a Markdown comparison table whenever applicable. Cover the independent analyses, the meaningful challenges and responses, tradeoffs, unresolved uncertainty, and why the recommendation follows. Do not include routing metadata, a mechanical transcript, or hidden chain-of-thought.

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
