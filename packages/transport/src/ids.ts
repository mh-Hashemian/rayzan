import { TransportError } from './error.js';

declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

export type DeliveryId = Brand<string, 'DeliveryId'>;

export function asDeliveryId(value: string): DeliveryId {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new TransportError('delivery id cannot be empty');
  }
  return trimmed as DeliveryId;
}

export function newDeliveryId(): DeliveryId {
  return crypto.randomUUID() as DeliveryId;
}
