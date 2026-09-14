export interface ConversationSnapshot {
  readonly assistantTurnCount: number;
  readonly lastAssistantText?: string;
}

export interface PromptSendResult {
  readonly snapshot: ConversationSnapshot;
}

export interface ResponseWaitContext {
  readonly snapshot: ConversationSnapshot;
  readonly timeoutMs?: number;
}

export interface CapturedResponse {
  readonly text: string;
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
  snapshotConversation(): ConversationSnapshot;
  sendPrompt(text: string): Promise<PromptSendResult>;
  waitForResponse(context: ResponseWaitContext): Promise<CapturedResponse>;
  captureLatestResponse(): Promise<string>;
  diagnostics(): AdapterDiagnostics;
}
