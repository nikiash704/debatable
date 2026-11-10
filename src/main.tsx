import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "./styles/app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipHost } from "./ui/components/Tooltip";
import { Gallery } from "./ui/dev/Gallery";

function Root() {
  if (location.pathname === "/dev/gallery") return <Gallery />;
  return <h1 style={{ padding: 24 }}>Debatable</h1>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
    <TooltipHost />
  </StrictMode>,
);
