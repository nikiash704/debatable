import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function Hello() {
  return <h1 style={{ fontFamily: "system-ui", padding: 24 }}>Debatable — hello from Cloudflare</h1>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Hello />
  </StrictMode>,
);
