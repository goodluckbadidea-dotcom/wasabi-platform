// ─── Table Footer ───
// Sticky footer row showing column totals for number fields.

import React from "react";
import { C } from "../../design/tokens.js";
import { getFieldType, readField } from "../_viewHelpers.js";
import { styles } from "./tableStyles.js";

export default function TableFooter({ gtc, columns, schema, processedData }) {
  return (
    <div style={{ ...styles.gridFooter, gridTemplateColumns: gtc }}>
      <div style={{ padding: "4px 8px" }} />
      {columns.map((col) => {
        const type = getFieldType(schema, col);
        let total = null;
        if (type === "number") {
          total = 0;
          for (const page of processedData) {
            const v = readField(page, col);
            if (typeof v === "number") total += v;
          }
        }
        return (
          <div
            key={col}
            style={{
              padding: "4px 12px",
              fontWeight: 600,
              fontSize: 12,
              fontVariantNumeric: "tabular-nums",
              color: total !== null ? C.darkText : "transparent",
            }}
          >
            {total !== null ? total.toLocaleString() : ""}
          </div>
        );
      })}
      <div style={{ padding: "4px 2px" }} />
    </div>
  );
}
