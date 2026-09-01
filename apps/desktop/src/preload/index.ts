import { contextBridge, ipcRenderer } from "electron";
import type { AccentSelectionState, ShellState, WorkDockState } from "../shared/types.js";
import { ipcChannels } from "../shared/channels.js";
import type { BrowserCommand, BrowserQuery } from "../shared/ipc.js";

const api = {
  getShellState: (): Promise<ShellState> => ipcRenderer.invoke(ipcChannels.getShellState),
  getWorkState: (): Promise<WorkDockState> => ipcRenderer.invoke(ipcChannels.getWorkState),
  command: (command: BrowserCommand): Promise<void> =>
    ipcRenderer.invoke(ipcChannels.command, command),
  query: (query: BrowserQuery): Promise<unknown> => ipcRenderer.invoke(ipcChannels.query, query),
  subscribeShellState: (listener: (state: ShellState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: ShellState) => listener(state);
    ipcRenderer.on(ipcChannels.shellState, handler);
    return () => ipcRenderer.removeListener(ipcChannels.shellState, handler);
  },
  subscribeWorkState: (listener: (state: WorkDockState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: WorkDockState) => listener(state);
    ipcRenderer.on(ipcChannels.workState, handler);
    return () => ipcRenderer.removeListener(ipcChannels.workState, handler);
  },
  onFocusAddress: (listener: () => void): (() => void) => {
    const handler = () => listener();
    ipcRenderer.on(ipcChannels.focusAddress, handler);
    return () => ipcRenderer.removeListener(ipcChannels.focusAddress, handler);
  },
  onReaderAccent: (listener: (accent: AccentSelectionState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, accent: AccentSelectionState) => listener(accent);
    ipcRenderer.on(ipcChannels.readerAccent, handler);
    return () => ipcRenderer.removeListener(ipcChannels.readerAccent, handler);
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
