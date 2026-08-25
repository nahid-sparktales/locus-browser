export const ipcChannels = {
  getState: "browser:get-state",
  command: "browser:command",
  query: "browser:query",
  state: "browser:state",
  focusAddress: "browser:focus-address",
  recorderEvent: "browser:recorder-event",
  recorderMessage: "browser:recorder-message",
} as const;
