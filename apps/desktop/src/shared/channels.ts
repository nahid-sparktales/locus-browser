export const ipcChannels = {
  getState: "browser:get-state",
  command: "browser:command",
  state: "browser:state",
  focusAddress: "browser:focus-address",
} as const;
