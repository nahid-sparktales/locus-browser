import type { LocusBrowserAPI } from "../preload/index.js";

declare global {
  interface Window {
    locusBrowser: LocusBrowserAPI;
  }
}

export {};
