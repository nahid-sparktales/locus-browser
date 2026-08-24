import type { LocusBrowserAPI, LocusRecorderAPI } from "../preload/index.js";

declare global {
  interface Window {
    locusBrowser: LocusBrowserAPI;
    locusRecorder: LocusRecorderAPI;
  }
}

export {};
