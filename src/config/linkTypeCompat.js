// ─── Link Type Compatibility ───
// Defines which field types can be linked to each other.
// Groups types into compatibility categories so number→number, text→text, etc.

export const TYPE_COMPAT_GROUPS = {
  text: new Set(["title", "rich_text", "url", "email", "phone_number"]),
  number: new Set(["number"]),
  select: new Set(["select", "status"]),
  multi_select: new Set(["multi_select"]),
  date: new Set(["date"]),
  checkbox: new Set(["checkbox"]),
  readonly: new Set([
    "formula", "rollup", "relation", "people", "files",
    "created_time", "last_edited_time", "created_by", "last_edited_by", "unique_id",
  ]),
};

/**
 * Get the compatibility group name for a field type.
 * Sheet columns default to "text" since they have no typed schema.
 */
export function getCompatGroup(type) {
  if (!type) return "text"; // default for sheets / unknown
  for (const [group, types] of Object.entries(TYPE_COMPAT_GROUPS)) {
    if (types.has(type)) return group;
  }
  return "text"; // fallback
}

/**
 * Check if a source field type can link to a target field type.
 * Rules:
 * - Same group = compatible
 * - Readonly source → compatible with text targets (resolved values are strings)
 * - Unknown types → treated as text
 */
export function areTypesCompatible(sourceType, targetType) {
  if (!sourceType || !targetType) return true; // no type info = allow (backward compat)

  const sourceGroup = getCompatGroup(sourceType);
  const targetGroup = getCompatGroup(targetType);

  // Same group = always compatible
  if (sourceGroup === targetGroup) return true;

  // Readonly sources resolve to text/number strings — allow linking to text targets
  if (sourceGroup === "readonly" && targetGroup === "text") return true;

  // Number can link to text (toString is lossless)
  if (sourceGroup === "number" && targetGroup === "text") return true;

  return false;
}

/** Human-readable label for a compatibility group */
export function getGroupLabel(group) {
  const labels = {
    text: "Text",
    number: "Number",
    select: "Select",
    multi_select: "Multi-select",
    date: "Date",
    checkbox: "Checkbox",
    readonly: "Read-only",
  };
  return labels[group] || "Unknown";
}
