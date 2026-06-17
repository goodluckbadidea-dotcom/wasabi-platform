// ─── Forms feature — shared field-block taxonomy ───
// Source of truth for what blocks exist, their picker grouping, the
// icon/label/description used in the "+ Add" dropdown, and the column-
// type mapping for the "Link to column" feature.

// Maps block.type → the Wasabi column type it can link to.
// `null` means the block can never link to a column (layout blocks,
// or types Wasabi doesn't have a column for yet).
export const BLOCK_TYPE_TO_COLUMN_TYPE = {
  short_text: "text",
  long_text: "text",
  number: "number",
  date: "date",
  date_range: "date",
  single_select: "select",
  multi_select: "multi_select",
  status: "status",
  checkbox: "checkbox",
  url: "url",
  email: "email",
  phone: "phone_number",
  person: "people",
  linked_record: "relation",
  file_upload: null,
  figma_file: "figma_files",
  // Layout blocks
  section_header: null,
  description_text: null,
  divider: null,
};

// All block definitions, ordered as they appear in the "+ Add" picker.
export const BLOCK_LIBRARY = [
  // Form fields
  { type: "short_text",     kind: "field",  label: "Short text",      group: "Form fields",  description: "Single-line text input",      icon: "AA" },
  { type: "long_text",      kind: "field",  label: "Long text",       group: "Form fields",  description: "Multi-line textarea",          icon: "¶" },
  { type: "number",         kind: "field",  label: "Number",          group: "Form fields",  description: "Numeric input",                 icon: "#" },
  { type: "date",           kind: "field",  label: "Date",            group: "Form fields",  description: "Single calendar picker",        icon: "📅" },
  { type: "date_range",     kind: "field",  label: "Date range",      group: "Form fields",  description: "Start and end dates",           icon: "📅" },
  { type: "single_select",  kind: "field",  label: "Single-select",   group: "Form fields",  description: "Pick one option",               icon: "●" },
  { type: "multi_select",   kind: "field",  label: "Multi-select",    group: "Form fields",  description: "Pick many options",             icon: "☷" },
  { type: "status",         kind: "field",  label: "Status",          group: "Form fields",  description: "Single-select with pills",      icon: "●" },
  { type: "checkbox",       kind: "field",  label: "Checkbox",        group: "Form fields",  description: "Yes/no toggle",                 icon: "☑" },
  { type: "url",            kind: "field",  label: "URL",             group: "Form fields",  description: "Validated URL input",           icon: "🔗" },
  { type: "email",          kind: "field",  label: "Email",           group: "Form fields",  description: "Validated email input",         icon: "✉" },
  { type: "phone",          kind: "field",  label: "Phone",           group: "Form fields",  description: "Formatted phone input",         icon: "☎" },
  { type: "person",         kind: "field",  label: "Person",          group: "Form fields",  description: "Pick from team directory",      icon: "👤" },
  { type: "linked_record",  kind: "field",  label: "Linked record",   group: "Form fields",  description: "Pick a row from another table", icon: "↗" },
  { type: "file_upload",    kind: "field",  label: "File upload",     group: "Form fields",  description: "Attach files",                   icon: "📎" },
  { type: "figma_file",     kind: "field",  label: "Figma file",      group: "Form fields",  description: "Paste a Figma URL",             icon: "⬡" },
  // Layout
  { type: "section_header", kind: "layout", label: "Section header",  group: "Layout",       description: "Bold label between groups",     icon: "H" },
  { type: "description_text", kind: "layout", label: "Description",   group: "Layout",       description: "Plain-text explanation",        icon: "¶" },
  { type: "divider",        kind: "layout", label: "Divider",         group: "Layout",       description: "Horizontal line",               icon: "—" },
];

export function findBlockDef(type) {
  return BLOCK_LIBRARY.find((b) => b.type === type);
}

export function makeField(type, overrides = {}) {
  const def = findBlockDef(type);
  return {
    id: `fld_${crypto.randomUUID().slice(0, 8)}`,
    kind: def?.kind || "field",
    type,
    label: def?.label || "Untitled",
    linked_column_id: null,
    required: false,
    helper_text: "",
    placeholder: "",
    default_value: null,
    options: [],
    ...overrides,
  };
}

// Group blocks for the "+ Add" picker
export function groupBlocks() {
  const groups = {};
  for (const b of BLOCK_LIBRARY) {
    (groups[b.group] ||= []).push(b);
  }
  return groups;
}
