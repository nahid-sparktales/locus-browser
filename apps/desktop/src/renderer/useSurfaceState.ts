import { useEffect, useState } from "react";
import type { ShellState, WorkDockState } from "../shared/types.js";

export function useShellState(): ShellState | null {
  const [state, setState] = useState<ShellState | null>(null);

  useEffect(() => subscribeInitialState(
    () => window.locusBrowser.getShellState(),
    (listener) => window.locusBrowser.subscribeShellState(listener),
    setState,
  ), []);

  return state;
}

export function useWorkState(): WorkDockState | null {
  const [state, setState] = useState<WorkDockState | null>(null);

  useEffect(() => subscribeInitialState(
    () => window.locusBrowser.getWorkState(),
    (listener) => window.locusBrowser.subscribeWorkState(listener),
    setState,
  ), []);

  return state;
}

function subscribeInitialState<T>(
  load: () => Promise<T>,
  subscribe: (listener: (state: T) => void) => () => void,
  update: (state: T) => void,
): () => void {
  let mounted = true;
  void load().then((next) => {
    if (mounted) update(next);
  });
  const unsubscribe = subscribe(update);
  return () => {
    mounted = false;
    unsubscribe();
  };
}
