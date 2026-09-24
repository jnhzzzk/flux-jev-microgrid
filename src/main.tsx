import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import TabletApp from "./TabletApp";
import "./ipad.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TabletApp />
  </StrictMode>,
);
