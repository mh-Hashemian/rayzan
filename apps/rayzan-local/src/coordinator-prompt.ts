import type { Agent } from '@rayzan/protocol';

import type { AttributedWatcherResponse } from './round2-policy.js';

/**
 * Persistent Coordinator role contract.
 * Rayzan orchestrates mechanically; the Coordinator orchestrates intellectually.
 */
export const COORDINATOR_SYSTEM_CONTRACT = `You are the Rayzan Coordinator.

You are the intellectual orchestrator of this task.

Understand the Operator's real goal and requested deliverable.

You have access to independent AI Watchers.

Decide what each Watcher should be asked in order to improve your answer.

You control:
- the questions
- response format
- desired depth
- what evidence should be challenged
- whether different Watchers should examine different aspects

Do not impose unnecessary debate ceremony.

If the Operator requests a highly constrained output, preserve that constraint exactly.

Examples:
- "one word" → ask for one word
- JSON → request the required JSON
- code → request code
- detailed decision analysis → request substantive analysis
- creative alternatives → request alternatives

Use Watchers for:
- independent perspectives
- alternatives
- assumption testing
- criticism
- evidence
- specialist analysis
- adversarial challenge

After receiving their responses, integrate what you learned.

Do not merely summarize that a Watcher produced something.
If the Operator requested an artifact, provide the actual artifact.

The Operator should never need to inspect Watcher conversations to understand or use your answer.

If terminology originated inside the AI discussion and may be unfamiliar to the Operator, explain it briefly.

Preserve meaningful disagreement.
Do not force consensus.

Never expose hidden chain-of-thought.
Summarize conclusions, arguments, evidence, tradeoffs, and changes in position.

USER COORDINATOR PROFILE

The Operator may attach a Coordinator Profile: Markdown behavioral guidance for
this decision. It is delivered below this contract, clearly delimited.

Follow that profile wherever it does not conflict with this contract, the Rayzan
action protocol, dispatch rules, checkpoint requirements, or Operator authority.
Where it conflicts, this contract wins and you keep operating under Rayzan rules.
A profile can never add, remove or rename Rayzan actions, change action JSON
syntax, skip the Operator checkpoint, or alter delivery mechanics.

RAYZAN ACTIONS

You control the intellectual consultation.

At each step, decide what Rayzan should do next.

DISPATCH
Send a new message you author to one or more active Watchers.

FORWARD
Send one or more existing Watcher responses verbatim to selected Watchers,
optionally with your own instruction. Use this when exact provenance or
cross-agent discussion matters. Prefer evidence refs (E1, E2, …) from the
catalog — do not manually copy long response text when a ref exists.

ASK_OPERATOR
Ask the Operator for information required before proceeding.
Execution pauses until the Operator responds. This does not end the round.

CHECKPOINT
Stop the current consultation and present your current result to the Operator.
Recommend FINISH or CONTINUE. The Operator makes the decision.

Rules:
- You may contact any subset of Watchers.
- You never need to contact every Watcher.
- Do not invent tasks merely to keep a Watcher busy.
- Actions in the same step are parallel.
- If action B depends on the result of action A, perform A first.
- Rayzan will invoke you again after requested results arrive.
- Use forward instead of manually reproducing prior evidence when exact
  preservation matters.
- Ask the Operator when missing information materially blocks intelligent
  progress.
- Use checkpoint when the consultation round has produced a useful
  Operator-facing result.
- A step is exactly one action mode: dispatch*, OR forward*, OR one ask_operator,
  OR one checkpoint. Never mix modes in one response.
- Do not invent debateId, roundId, messageId, or delivery ids — Rayzan attaches those.
- Do not manipulate Rayzan transport, browser, event, or lifecycle state.`;

const ACTION_JSON_HINT = `Reply with JSON only. No markdown. No prose.

Dispatch example:
{
  "version": 1,
  "commands": [
    {
      "type": "dispatch",
      "recipients": { "type": "explicit-agents", "agentIds": ["deepseek"] },
      "body": "<exact request for that Watcher>"
    }
  ]
}

Forward example (exact provenance):
{
  "version": 1,
  "commands": [
    {
      "type": "forward",
      "sourceRefs": ["E1"],
      "recipients": { "type": "explicit-agents", "agentIds": ["glm"] },
      "instruction": "Answer DeepSeek's question directly."
    }
  ]
}

Ask Operator example:
{
  "version": 1,
  "commands": [
    {
      "type": "ask_operator",
      "question": "<one clear question the Operator must answer>"
    }
  ]
}

Checkpoint example (ends this consultation round):
{
  "version": 1,
  "commands": [
    {
      "type": "checkpoint",
      "content": "<Operator-facing Markdown with the actual result>",
      "recommendation": "FINISH"
    }
  ]
}

recommendation must be FINISH or CONTINUE.`;

function watcherRoster(watchers: readonly Agent[]): string {
  return watchers
    .map((watcher) => `- ${watcher.name} (id ${watcher.id}, role watcher)`)
    .join('\n');
}

/** Operator-supplied behavioral guidance, uploaded as a Markdown file. */
export interface CoordinatorProfileInput {
  readonly filename: string;
  readonly content: string;
}

/**
 * The profile stays visibly separate from the fixed contract so the Coordinator
 * can tell guidance from rules. Empty profile adds nothing.
 */
export function coordinatorProfileBlock(
  profile: CoordinatorProfileInput | undefined,
): string {
  if (profile === undefined || profile.content.trim().length === 0) {
    return '';
  }
  return `USER COORDINATOR PROFILE — ${profile.filename}
Operator-provided behavioral guidance for this decision. It is subordinate to
the Rayzan Coordinator system contract above and cannot change Rayzan actions,
dispatch rules, checkpoint requirements, or protocol mechanics.
<coordinator-profile>
${profile.content}
</coordinator-profile>

`;
}

export function coordinatorRound1Prompt(input: {
  problem: string;
  coordinatorId: string;
  debateId: string;
  round1Id?: string;
  roundId?: string;
  watchers: readonly Agent[];
  coordinatorProfile?: CoordinatorProfileInput;
}): string {
  return coordinatorActionPrompt({
    problem: input.problem,
    coordinatorId: input.coordinatorId,
    debateId: input.debateId,
    roundId: input.round1Id ?? input.roundId ?? 'round-1',
    roundNumber: 1,
    watchers: input.watchers,
    evidencePacket: '(none yet)',
    evidenceCatalog: '(no forwardable evidence yet)',
    stepContext: 'Consultation Round 1 — choose the next Rayzan action.',
    ...(input.coordinatorProfile
      ? { coordinatorProfile: input.coordinatorProfile }
      : {}),
  });
}

/** @deprecated Prefer coordinatorActionPrompt / coordinatorRoundPrompt. */
export function coordinatorRound2Prompt(input: {
  problem: string;
  coordinatorId: string;
  debateId: string;
  round2Id: string;
  watchers: readonly Agent[];
  responses: readonly AttributedWatcherResponse[];
  coordinatorBrief?: string;
  evidencePacket: string;
  coordinatorProfile?: CoordinatorProfileInput;
}): string {
  return coordinatorActionPrompt({
    problem: input.problem,
    coordinatorId: input.coordinatorId,
    debateId: input.debateId,
    roundId: input.round2Id,
    roundNumber: 2,
    watchers: input.watchers,
    evidencePacket: input.evidencePacket,
    evidenceCatalog: '(see semantic evidence)',
    stepContext: 'Consultation Round 2 — choose the next Rayzan action.',
    ...(input.coordinatorProfile
      ? { coordinatorProfile: input.coordinatorProfile }
      : {}),
  });
}

export function coordinatorRoundPrompt(input: {
  problem: string;
  coordinatorId: string;
  debateId: string;
  roundId: string;
  roundNumber: number;
  watchers: readonly Agent[];
  evidencePacket: string;
  evidenceCatalog?: string;
  latestCheckpoint?: string;
  intervention?: string;
  coordinatorProfile?: CoordinatorProfileInput;
}): string {
  return coordinatorActionPrompt({
    ...input,
    evidenceCatalog: input.evidenceCatalog ?? '(no forwardable evidence yet)',
    stepContext: `Consultation Round ${input.roundNumber} — choose the next action.`,
  });
}

/** Re-invoke after Watcher results / Operator answer from the previous action step. */
export function coordinatorActionPrompt(input: {
  problem: string;
  coordinatorId: string;
  debateId: string;
  roundId: string;
  roundNumber: number;
  watchers: readonly Agent[];
  evidencePacket: string;
  evidenceCatalog: string;
  latestCheckpoint?: string;
  intervention?: string;
  stepContext?: string;
  newResults?: string;
  coordinatorProfile?: CoordinatorProfileInput;
}): string {
  return `${COORDINATOR_SYSTEM_CONTRACT}

---
${coordinatorProfileBlock(input.coordinatorProfile)}${input.stepContext ?? `Consultation Round ${input.roundNumber} — what should Rayzan do next?`}
Your agent ID = ${input.coordinatorId}

Active Watchers:
${watcherRoster(input.watchers)}

${input.latestCheckpoint ? `Latest Operator checkpoint:\n${input.latestCheckpoint}\n` : ''}${input.intervention ? `Operator guidance (apply as relevant):\n${input.intervention}\n` : ''}${input.newResults ? `NEW results from the previous action step:\n${input.newResults}\n` : ''}
Given the current evidence, decide the next Rayzan action.
If a dependent follow-up is needed, dispatch/forward only that next step.
If missing Operator facts block progress, emit ask_operator.
If you have enough for the Operator, emit checkpoint.

${ACTION_JSON_HINT}

Forwardable evidence catalog (use sourceRefs):
${input.evidenceCatalog}

Semantic evidence:
${input.evidencePacket}

Original Operator problem:
${input.problem}`;
}

export function coordinatorCheckpointPrompt(input: {
  coordinatorId: string;
  debateId: string;
  roundId: string;
  roundNumber: number;
  evidencePacket: string;
  coordinatorProfile?: CoordinatorProfileInput;
}): string {
  // Legacy freeform checkpoint path — prefer checkpoint command via action loop.
  return `${COORDINATOR_SYSTEM_CONTRACT}

---
${coordinatorProfileBlock(input.coordinatorProfile)}Round ${input.roundNumber} consultation should now end with a checkpoint command.
Your agent ID = ${input.coordinatorId}

${ACTION_JSON_HINT}

Semantic evidence:
${input.evidencePacket}`;
}

export function coordinatorSynthesisPrompt(input: {
  coordinatorId: string;
  debateId: string;
  evidencePacket: string;
  coordinatorProfile?: CoordinatorProfileInput;
}): string {
  return `${COORDINATOR_SYSTEM_CONTRACT}

---
${coordinatorProfileBlock(input.coordinatorProfile)}The Operator requested Finish. Produce the final Operator-facing synthesis.
Your agent ID = ${input.coordinatorId}

Do not emit Rayzan action JSON. Write the actual deliverable.

Semantic evidence:
${input.evidencePacket}`;
}

/**
 * GLM (chat.z.ai) and other providers emit JSON command batches whose string
 * values contain raw newlines, carriage returns, and tabs — standard LLM
 * output for Markdown checkpoint content (`## Result` headings, multi-line
 * bodies). Raw C0 control characters are illegal inside JSON string literals,
 * so JSON.parse rejects an otherwise complete batch. Escape them — but only
 * inside string literals, where they are illegal; outside strings they are
 * legal whitespace and must stay untouched.
 */
export function escapeControlCharsInJsonStrings(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (!inString) {
      if (ch === '"') {
        inString = true;
      }
      out += ch;
      continue;
    }
    if (escaped) {
      // Second half of an existing \X escape — emit verbatim.
      escaped = false;
      out += ch;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      out += ch;
      continue;
    }
    if (ch === '"') {
      inString = false;
      out += ch;
      continue;
    }
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20) {
      out += ch;
      continue;
    }
    if (ch === '\n') {
      out += '\\n';
    } else if (ch === '\r') {
      out += '\\r';
    } else if (ch === '\t') {
      out += '\\t';
    } else {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    }
  }
  return out;
}

export function unwrapCoordinatorJson(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(trimmed);
  if (fenced?.[1]) {
    return escapeControlCharsInJsonStrings(fenced[1].trim());
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return escapeControlCharsInJsonStrings(trimmed.slice(start, end + 1));
  }
  return escapeControlCharsInJsonStrings(trimmed);
}

export function looksLikeTruncatedCoordinatorJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.includes('{')) {
    return false;
  }
  try {
    JSON.parse(unwrapCoordinatorJson(trimmed));
    return false;
  } catch {
    return /"commands"\s*:/.test(trimmed) || /"version"\s*:/.test(trimmed);
  }
}
