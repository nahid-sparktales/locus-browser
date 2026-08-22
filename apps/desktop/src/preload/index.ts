import { contextBridge, ipcRenderer } from "electron";
import type { BrowserAppState } from "../shared/types.js";
import { BrowserCommandSchema, ipcChannels, type BrowserCommand } from "../shared/ipc.js";

const api = {
  getState: (): Promise<BrowserAppState> => ipcRenderer.invoke(ipcChannels.getState),
  command: (command: BrowserCommand): Promise<BrowserAppState> =>
    ipcRenderer.invoke(ipcChannels.command, BrowserCommandSchema.parse(command)),
  subscribe: (listener: (state: BrowserAppState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: BrowserAppState) => listener(state);
    ipcRenderer.on(ipcChannels.state, handler);
    return () => ipcRenderer.removeListener(ipcChannels.state, handler);
  },
  onFocusAddress: (listener: () => void): (() => void) => {
    const handler = () => listener();
    ipcRenderer.on(ipcChannels.focusAddress, handler);
    return () => ipcRenderer.removeListener(ipcChannels.focusAddress, handler);
  },
};

contextBridge.exposeInMainWorld("locusBrowser", api);

export type LocusBrowserAPI = typeof api;
