export class EventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventError';
  }
}
