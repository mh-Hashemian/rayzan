import type { CapturePhase, CaptureReport } from '@rayzan/capture';

export interface CaptureJob {
  readonly deliveryId: string;
  readonly agentId: string;
  readonly provider: string;
  phase: CapturePhase;
  trackedIdentity?: string;
  readonly startedAt: number;
  report: CaptureReport;
}
