import { turnIdentityFromAttributes } from '@rayzan/capture';

export function turnIdentity(element: Element, index: number): string {
  return turnIdentityFromAttributes(
    (name) => element.getAttribute(name),
    index,
    element.getAttribute('id'),
  );
}

export {
  liveSnapshotFromTurns,
  selectTrackedTurn,
  resolveTrackedTurn,
} from '@rayzan/capture';
