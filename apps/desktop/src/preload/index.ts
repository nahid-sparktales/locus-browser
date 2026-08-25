import { contextBridge, ipcRenderer } from "electron";
import type { BrowserAppState } from "../shared/types.js";
import { ipcChannels } from "../shared/channels.js";
import type { BrowserCommand, BrowserQuery } from "../shared/ipc.js";

const api = {
  getState: (): Promise<BrowserAppState> => ipcRenderer.invoke(ipcChannels.getState),
  command: (command: BrowserCommand): Promise<BrowserAppState> =>
    ipcRenderer.invoke(ipcChannels.command, command),
  query: (query: BrowserQuery): Promise<unknown> => ipcRenderer.invoke(ipcChannels.query, query),
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

const recorderApi = {
  send: (message: unknown): void => ipcRenderer.send(ipcChannels.recorderMessage, message),
  subscribe: (listener: (message: unknown) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: unknown) => listener(message);
    ipcRenderer.on(ipcChannels.recorderEvent, handler);
    return () => ipcRenderer.removeListener(ipcChannels.recorderEvent, handler);
  },
};

contextBridge.exposeInMainWorld("locusBrowser", api);
contextBridge.exposeInMainWorld("locusRecorder", recorderApi);

export type LocusBrowserAPI = typeof api;
export type LocusRecorderAPI = typeof recorderApi;
