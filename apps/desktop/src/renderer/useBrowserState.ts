import { useEffect, useState } from "react";
import type { BrowserAppState } from "../shared/types.js";

export function useBrowserState(): BrowserAppState | null {
  const [state, setState] = useState<BrowserAppState | null>(null);

  useEffect(() => {
    let mounted = true;
    void window.locusBrowser.getState().then((next) => {
      if (mounted) setState(next);
    });
    const unsubscribe = window.locusBrowser.subscribe(setState);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return state;
}
