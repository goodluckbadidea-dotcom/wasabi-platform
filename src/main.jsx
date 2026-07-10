import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import DcCollectView from "./features/data-collection/DcCollectView.jsx";

// ─── Route guard: /collect/:slug bypasses auth ───
// Share-link submissions (iPads without a Wasabi account) hit /collect/:slug.
// We short-circuit before the full app boots so the anonymous submit flow
// doesn't need to negotiate with the auth stack.
function pickRoot() {
  const path = typeof window !== "undefined" ? window.location.pathname : "";
  const m = path.match(/^\/collect\/([^/]+)\/?$/);
  if (m) {
    return <DcCollectView extensionSlug={decodeURIComponent(m[1])} />;
  }
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {pickRoot()}
  </React.StrictMode>
);
