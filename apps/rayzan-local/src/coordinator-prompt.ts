import type { Agent } from '@rayzan/protocol';

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

Return exactly one command that sends an independent-analysis brief to the current round Watchers:

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
      "body": "<your independent-analysis prompt for every Round 1 Watcher>",
      "referencedMessageIds": []
    }
  ]
}

PROBLEM:
${input.problem}`;
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
