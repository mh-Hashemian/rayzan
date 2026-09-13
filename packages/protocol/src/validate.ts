export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

export function requireNonEmptyString(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ProtocolError(`${field} cannot be empty`);
  }
  return trimmed;
}

export function requireAllowedValue<T extends string>(
  value: T,
  allowed: readonly T[],
  field: string,
): T {
  if (!allowed.includes(value)) {
    throw new ProtocolError(`${field} is not a recognized value`);
  }
  return value;
}
