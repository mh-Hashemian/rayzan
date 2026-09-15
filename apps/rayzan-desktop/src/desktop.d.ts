export interface DesktopInfo {
  readonly userDataPath: string;
  readonly databasePath: string;
  readonly port: number;
  readonly ownsRuntime: boolean;
  readonly runtimeError?: string;
}

export interface DesktopApi {
  getInfo(): Promise<DesktopInfo>;
  retryRuntime(): Promise<DesktopInfo>;
  openDebug(): Promise<void>;
}

declare global {
  interface Window {
    readonly rayzanDesktop: DesktopApi;
  }
}

export {};
