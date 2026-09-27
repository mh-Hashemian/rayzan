/** Persistent key/value settings, stored beside the event history. */
export interface SettingsStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export class InMemorySettingsStore implements SettingsStore {
  readonly #values = new Map<string, string>();

  get(key: string): string | undefined {
    return this.#values.get(key);
  }

  set(key: string, value: string): void {
    this.#values.set(key, value);
  }

  remove(key: string): void {
    this.#values.delete(key);
  }
}
