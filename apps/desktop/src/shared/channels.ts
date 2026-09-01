export const ipcChannels = {
  getShellState: "browser:get-shell-state",
  getWorkState: "browser:get-work-state",
  command: "browser:command",
  query: "browser:query",
  shellState: "browser:shell-state",
  workState: "browser:work-state",
  focusAddress: "browser:focus-address",
  readerAccent: "browser:reader-accent",
  recorderEvent: "browser:recorder-event",
  recorderMessage: "browser:recorder-message",
} as const;
