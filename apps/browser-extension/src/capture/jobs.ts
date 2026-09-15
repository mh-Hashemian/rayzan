import type { CaptureJob, CapturePhase, CaptureReport } from './types.js';

export function isActiveCapturePhase(phase: CapturePhase): boolean {
  return phase !== 'idle' && phase !== 'captured' && phase !== 'failed';
}

export class CaptureJobRegistry {
  readonly #jobs = new Map<string, CaptureJob>();

  get(deliveryId: string): CaptureJob | undefined {
    return this.#jobs.get(deliveryId);
  }

  isActive(deliveryId: string): boolean {
    const job = this.#jobs.get(deliveryId);
    return job !== undefined && isActiveCapturePhase(job.phase);
  }

  begin(job: CaptureJob): boolean {
    if (this.isActive(job.deliveryId)) {
      return false;
    }
    this.#jobs.set(job.deliveryId, job);
    return true;
  }

  update(
    deliveryId: string,
    patch: Partial<Pick<CaptureJob, 'phase' | 'trackedIdentity' | 'report'>>,
  ): CaptureJob | undefined {
    const current = this.#jobs.get(deliveryId);
    if (current === undefined) {
      return undefined;
    }
    if (patch.phase !== undefined) {
      current.phase = patch.phase;
    }
    if (patch.trackedIdentity !== undefined) {
      current.trackedIdentity = patch.trackedIdentity;
    }
    if (patch.report !== undefined) {
      current.report = patch.report;
    }
    return current;
  }

  finish(
    deliveryId: string,
    phase: 'captured' | 'failed',
    report: CaptureReport,
  ): void {
    const current = this.#jobs.get(deliveryId);
    if (current === undefined) {
      return;
    }
    current.phase = phase;
    current.report = report;
  }

  activeJobs(): readonly CaptureJob[] {
    return [...this.#jobs.values()].filter((job) =>
      isActiveCapturePhase(job.phase),
    );
  }

  hasTerminalFailure(): boolean {
    return [...this.#jobs.values()].some((job) => job.phase === 'failed');
  }
}
