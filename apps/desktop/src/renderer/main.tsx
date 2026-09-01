import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";

type RendererSurface = "shell" | "work" | "recorder" | "reader";

const surfaceLoaders: Record<RendererSurface, () => Promise<ComponentType>> = {
  shell: async () => (await import("./Shell.js")).Shell,
  work: async () => (await import("./WorkDock.js")).WorkDock,
  recorder: async () => (await import("./RecorderSurface.js")).RecorderSurface,
  reader: async () => (await import("./ReaderSurface.js")).ReaderSurface,
};

void renderSurface();

async function renderSurface(): Promise<void> {
  if (["127.0.0.1", "localhost"].includes(window.location.hostname)) {
    const { installPreviewBridge } = await import("./previewBridge.js");
    installPreviewBridge();
  }
  await import("./styles.css");
  const requested = new URLSearchParams(window.location.search).get("surface");
  const surface: RendererSurface = requested === "work" || requested === "recorder" || requested === "reader" ? requested : "shell";
  const Surface = await surfaceLoaders[surface]();
  createRoot(document.getElementById("root")!).render(<StrictMode><Surface /></StrictMode>);
}
