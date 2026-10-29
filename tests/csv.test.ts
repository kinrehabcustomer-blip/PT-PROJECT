import assert from "node:assert/strict";
import { test } from "node:test";
import { toCsv } from "../src/presentation/lib/csv";

test("csv has a BOM, quotes special cells and defuses spreadsheet formulas", () => {
  const csv = toCsv(["ชื่อ", "หมายเหตุ"], [["สมชาย, ใจดี", 'say "hi"'], ["=HYPERLINK(\"x\")", "-1+2"], [undefined, 5]]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines[1], '"สมชาย, ใจดี","say ""hi"""');
  assert.ok(lines[2].startsWith("\"'=HYPERLINK"));
  assert.ok(lines[2].endsWith(",'-1+2"));
  assert.equal(lines[3], ",5");
});
