import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateClaim, rolesMatch, weekHoursFor } from "../src/rules.js";
import { shiftHours, timesOverlap } from "../src/hours.js";

test("shift hours from start and end", () => {
  assert.equal(shiftHours("07:00", "15:00"), 8);
  assert.equal(shiftHours("09:00", "17:30"), 8.5);
  assert.equal(shiftHours("15:00", "07:00"), null);
  assert.equal(shiftHours("nope", "15:00"), null);
});

test("times overlap ignores adjacent edges", () => {
  assert.equal(timesOverlap("07:00", "15:00", "12:00", "20:00"), true);
  assert.equal(timesOverlap("07:00", "15:00", "15:00", "20:00"), false);
  assert.equal(timesOverlap("09:00", "17:00", "07:00", "09:00"), false);
  assert.equal(timesOverlap("07:00", "15:00", "07:00", "15:00"), true);
});

test("roles match ignoring case and space", () => {
  assert.equal(rolesMatch("Barista", "barista"), true);
  assert.equal(rolesMatch("Kitchen", "Barista"), false);
});

test("week hours sum assigned shifts", () => {
  const shifts = [
    { personId: "a", start: "07:00", end: "15:00" },
    { personId: "a", start: "07:00", end: "11:00" },
    { personId: "b", start: "09:00", end: "17:00" },
  ];
  assert.equal(weekHoursFor(shifts, "a"), 12);
  assert.equal(weekHoursFor(shifts, "b"), 8);
});

test("auto-approve when role matches and hours stay under cap", () => {
  const check = evaluateClaim({
    shift: { start: "07:00", end: "15:00", role: "Barista" },
    claimer: { id: "p", role: "Barista", maxHours: 40 },
    weekShifts: [{ personId: "p", start: "07:00", end: "15:00" }],
  });
  assert.equal(check.auto, true);
  assert.equal(check.claimerHoursAfter, 16);
});

test("hours exactly at cap still auto", () => {
  const check = evaluateClaim({
    shift: { start: "07:00", end: "15:00", role: "Barista" },
    claimer: { id: "p", role: "Barista", maxHours: 16 },
    weekShifts: [{ personId: "p", start: "07:00", end: "15:00" }],
  });
  assert.equal(check.hoursOk, true);
  assert.equal(check.auto, true);
});

test("over cap goes to owner", () => {
  const check = evaluateClaim({
    shift: { start: "07:00", end: "15:00", role: "Barista" },
    claimer: { id: "p", role: "Barista", maxHours: 12 },
    weekShifts: [{ personId: "p", start: "07:00", end: "15:00" }],
  });
  assert.equal(check.hoursOk, false);
  assert.equal(check.auto, false);
});

test("role mismatch goes to owner even if hours ok", () => {
  const check = evaluateClaim({
    shift: { start: "07:00", end: "15:00", role: "Barista" },
    claimer: { id: "p", role: "Kitchen", maxHours: 40 },
    weekShifts: [],
  });
  assert.equal(check.roleMatch, false);
  assert.equal(check.auto, false);
});

test("claimer with multiple roles auto-matches any of them", () => {
  const check = evaluateClaim({
    shift: { start: "07:00", end: "15:00", role: "Kitchen" },
    claimer: { id: "p", role: "Barista", roles: ["Barista", "Kitchen"], maxHours: 40 },
    weekShifts: [],
  });
  assert.equal(check.roleMatch, true);
  assert.equal(check.auto, true);
});

test("no weekly cap auto-approves when role matches", () => {
  const check = evaluateClaim({
    shift: { start: "07:00", end: "15:00", role: "Barista" },
    claimer: { id: "p", role: "Barista", maxHours: 0 },
    weekShifts: [{ personId: "p", start: "07:00", end: "15:00" }],
  });
  assert.equal(check.hoursOk, true);
  assert.equal(check.auto, true);
});
