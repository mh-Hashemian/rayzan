import { requireNonEmptyString } from './validate.js';

declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

export type AgentId = Brand<string, 'AgentId'>;
export type DebateId = Brand<string, 'DebateId'>;
export type RoundId = Brand<string, 'RoundId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type ExposureId = Brand<string, 'ExposureId'>;

export function asAgentId(value: string): AgentId {
  return requireNonEmptyString(value, 'agent id') as AgentId;
}

export function asDebateId(value: string): DebateId {
  return requireNonEmptyString(value, 'debate id') as DebateId;
}

export function asRoundId(value: string): RoundId {
  return requireNonEmptyString(value, 'round id') as RoundId;
}

export function asMessageId(value: string): MessageId {
  return requireNonEmptyString(value, 'message id') as MessageId;
}

export function asExposureId(value: string): ExposureId {
  return requireNonEmptyString(value, 'exposure id') as ExposureId;
}
