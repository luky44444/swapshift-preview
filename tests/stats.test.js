import { test } from "node:test";
import assert from "node:assert/strict";
import { periodAfter, periodBefore, periodRange } from "../src/hours.js";

test("period day 1 is a calendar month", () => {
  assert.deepEqual(periodRange(1, "2026-09-01"), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(periodRange(1, "2026-09-02"), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(periodRange(1, "2026-02-10"), { from: "2026-02-01", to: "2026-02-28" });
});

test("period day 15 spans two months", () => {
  assert.deepEqual(periodRange(15, "2026-09-15"), { from: "2026-09-15", to: "2026-10-14" });
  assert.deepEqual(periodRange(15, "2026-09-14"), { from: "2026-08-15", to: "2026-09-14" });
  assert.deepEqual(periodRange(15, "2026-10-14"), { from: "2026-09-15", to: "2026-10-14" });
});

test("period after and before walk reset-day boundaries", () => {
  const cur = periodRange(1, "2026-09-02");
  assert.deepEqual(periodAfter(1, cur.to), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(periodBefore(1, cur.from), { from: "2026-08-01", to: "2026-08-31" });
});

test("period day 31 clamps to the last day of short months", () => {
  assert.deepEqual(periodRange(31, "2026-01-31"), { from: "2026-01-31", to: "2026-02-27" });
  assert.deepEqual(periodRange(31, "2026-02-10"), { from: "2026-01-31", to: "2026-02-27" });
  assert.deepEqual(periodRange(31, "2026-04-15"), { from: "2026-03-31", to: "2026-04-29" });
});
