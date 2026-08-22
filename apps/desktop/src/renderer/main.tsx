import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Shell } from "./Shell.js";
import { WorkDock } from "./WorkDock.js";
import "./styles.css";

const surface = new URLSearchParams(window.location.search).get("surface");

createRoot(document.getElementById("root")!).render(
  <StrictMode>{surface === "work" ? <WorkDock /> : <Shell />}</StrictMode>,
);
