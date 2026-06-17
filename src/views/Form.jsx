// ─── Form View (Forms feature entry point) ───
// This file used to be a one-shot create-new-record auto-form. It's now a
// thin wrapper around FormsHub — the directory of forms defined on this
// table. The hub handles three modes: list, designer, fill.
//
// Props are preserved for backwards-compat with PageShell's view contract.

import React, { useState, useEffect } from "react";
import FormsHub from "./forms/FormsHub.jsx";

export default function Form(props) {
  // Listen for fill-context events from RecordDrawer ("attach this form to
  // this record" → close drawer → main panel switches to Form view with
  // record locked in). The drawer dispatches `wasabi:fill-form` with the
  // intent; we capture it here so FormsHub can act on it.
  const [fillContext, setFillContext] = useState(null);

  useEffect(() => {
    const handler = (e) => {
      const detail = e.detail || {};
      if (!detail.formId) return;
      // Only accept if the active table matches the form's table
      if (detail.tableId && props.pageConfig?.id && detail.tableId !== props.pageConfig.id) return;
      setFillContext(detail);
    };
    window.addEventListener("wasabi:fill-form", handler);
    return () => window.removeEventListener("wasabi:fill-form", handler);
  }, [props.pageConfig?.id]);

  return (
    <FormsHub
      {...props}
      fillContext={fillContext}
      onFillContextConsumed={() => setFillContext(null)}
    />
  );
}
