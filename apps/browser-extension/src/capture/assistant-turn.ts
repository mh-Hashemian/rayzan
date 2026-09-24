import type { CaptureTurn } from '@rayzan/capture';

/** Extension assistant turn with a live DOM element. */
export interface AssistantTurn extends CaptureTurn {
  readonly element: Element;
}
