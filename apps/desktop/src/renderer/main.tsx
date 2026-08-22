import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Shell } from "./Shell.js";
import { WorkDock } from "./WorkDock.js";
import { installPreviewBridge } from "./previewBridge.js";
import "./styles.css";

if (["127.0.0.1", "localhost"].includes(window.location.hostname)) {
  installPreviewBridge();
}
const surface = new URLSearchParams(window.location.search).get("surface");

createRoot(document.getElementById("root")!).render(
  <StrictMode>{surface === "work" ? <WorkDock /> : <Shell />}</StrictMode>,
);
