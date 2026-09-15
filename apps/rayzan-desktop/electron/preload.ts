import { contextBridge, ipcRenderer } from 'electron';

export interface DesktopInfo {
  readonly userDataPath: string;
  readonly databasePath: string;
  readonly port: number;
  readonly ownsRuntime: boolean;
  readonly runtimeError?: string;
}

contextBridge.exposeInMainWorld('rayzanDesktop', {
  getInfo: (): Promise<DesktopInfo> => ipcRenderer.invoke('desktop:info'),
  retryRuntime: (): Promise<DesktopInfo> => ipcRenderer.invoke('desktop:retry'),
  openDebug: (): Promise<void> => ipcRenderer.invoke('desktop:open-debug'),
});
