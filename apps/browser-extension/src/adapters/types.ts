import type { CaptureSnapshot } from '@rayzan/capture';
import type { AssistantTurn } from '../capture/assistant-turn.js';

export interface ConversationSnapshot {
  readonly assistantTurnCount: number;
  readonly lastAssistantText?: string;
  readonly identities: readonly string[];
  readonly lastIncomplete: boolean;
}

export interface PromptSendResult {
  readonly snapshot: ConversationSnapshot;
}

export interface AdapterDiagnostics {
  readonly provider: string;
  readonly inputFound: boolean;
  readonly sendFound: boolean;
  readonly assistantTurns: number;
  readonly generating: boolean;
  readonly currentTrackedTurn?: string;
}

export interface BrowserAdapter {
  readonly id: string;
  readonly providerLabel: string;
  canHandle(url: string): boolean;
  listAssistantTurns(): readonly AssistantTurn[];
  isGenerating(): boolean;
  snapshotLive(): CaptureSnapshot & {
    readonly turns: readonly AssistantTurn[];
  };
  snapshotConversation(): ConversationSnapshot;
  sendPrompt(text: string): Promise<PromptSendResult>;
  captureLatestResponse(): Promise<string>;
  diagnostics(): AdapterDiagnostics;
}
