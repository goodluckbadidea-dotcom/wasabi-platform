// Run: node mcp-server/lib/query-shape.test.js
import {
  applyPostSorts, buildColumnIndex, normalizeFields, normalizeFilters,
  normalizeRowUpdateBody, normalizeSorts,
} from "./query-shape.js";

const schema = {
  columns: [
    { id: "col_name", name: "Project name", type: "text" },
    { id: "col_123", name: "Current Status", type: "status" },
    { id: "Vendor Name", name: "Vendor Name", type: "title" },
  ],
};
const index = buildColumnIndex(schema);

let passed = 0, failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++; console.log("PASS", name);
  } catch (e) {
    failed++; console.log("FAIL", name, "—", e.message);
  }
}
function assertEq(a, b) {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(`expected ${jb}, got ${ja}`);
}
function assertThrows(fn, needle) {
  try { fn(); } catch (e) {
    if (String(e.message).includes(needle)) return;
    throw new Error(`threw, but message lacked "${needle}": ${e.message}`);
  }
  throw new Error("did not throw");
}

check("object filter by name resolves to id + op mapped", () =>
  assertEq(normalizeFilters({ "Current Status": { eq: "Shipping" } }, index),
    [{ column: "col_123", op: "equals", value: "Shipping" }]));

check("shorthand value means equals", () =>
  assertEq(normalizeFilters({ "Vendor Name": "Treeform" }, index),
    [{ column: "Vendor Name", op: "equals", value: "Treeform" }]));

check("eq null becomes is_empty; ne null becomes is_not_empty", () =>
  assertEq(normalizeFilters({ col_name: { eq: null }, col_123: { ne: null } }, index),
    [{ column: "col_name", op: "is_empty" }, { column: "col_123", op: "is_not_empty" }]));

check("array filter form accepted", () =>
  assertEq(normalizeFilters([{ field: "Project name", op: "contains", value: "Tote" }], index),
    [{ column: "col_name", op: "contains", value: "Tote" }]));

check("unknown column throws loudly", () =>
  assertThrows(() => normalizeFilters({ Nope: { eq: 1 } }, index), 'unknown column "Nope"'));

check("unknown op throws loudly", () =>
  assertThrows(() => normalizeFilters({ col_name: { like: "x" } }, index), 'unknown op "like"'));

check("op in throws loudly", () =>
  assertThrows(() => normalizeFilters({ col_name: { in: ["a"] } }, index), '"in" is not supported'));

check("sorts resolve names and split system fields", () => {
  const r = normalizeSorts(
    [{ field: "Current Status", direction: "desc" }, { field: "_created_time", direction: "desc" }],
    index);
  assertEq(r.workerSorts, [{ column: "col_123", direction: "desc" }]);
  assertEq(r.postSorts, [{ rowField: "created_at", direction: "desc" }]);
});

check("unknown sort column throws", () =>
  assertThrows(() => normalizeSorts([{ field: "ghost" }], index), 'unknown column "ghost"'));

check("post-sort orders by row field desc", () => {
  const rows = [{ id: "a", created_at: "2026-01-01" }, { id: "b", created_at: "2026-02-01" }];
  assertEq(applyPostSorts(rows, [{ rowField: "created_at", direction: "desc" }]).map((r) => r.id),
    ["b", "a"]);
});

check("fields resolve, keep requested token, throw on unknown", () => {
  assertEq(normalizeFields("Project name, col_123", index),
    [{ token: "Project name", id: "col_name" }, { token: "col_123", id: "col_123" }]);
  assertThrows(() => normalizeFields("Vendor", index), 'unknown column "Vendor"');
});

check("update body: {cells} gets merge_cells true by default", () =>
  assertEq(normalizeRowUpdateBody({ cells: { col_name: "X" } }),
    { cells: { col_name: "X" }, merge_cells: true }));

check("update body: bare map wraps into merged cells", () =>
  assertEq(normalizeRowUpdateBody({ col_name: "X" }),
    { cells: { col_name: "X" }, merge_cells: true }));

check("update body: explicit merge_cells false respected (full replace)", () =>
  assertEq(normalizeRowUpdateBody({ cells: { a: 1 }, merge_cells: false }),
    { cells: { a: 1 }, merge_cells: false }));

check("update body: non-cell keys pass through untouched", () =>
  assertEq(normalizeRowUpdateBody({ archived: true }), { archived: true }));

check("update body: empty object throws", () =>
  assertThrows(() => normalizeRowUpdateBody({}), "nothing to write"));

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
