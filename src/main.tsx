import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "./styles/app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { TooltipHost } from "./ui/components/Tooltip";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <TooltipHost />
  </StrictMode>,
);

// Offline-first: cache the app shell so the board opens without network (data lives in IndexedDB).
if (import.meta.env.PROD && "serviceWorker" in navigator && !navigator.webdriver) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* the app works without it */
    });
  });
}
