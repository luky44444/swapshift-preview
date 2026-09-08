import { shiftHours } from "./hours.js";

export function rolesMatch(a, b) {
  return String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
}

export function personHasRole(rolesOrPerson, shiftRole) {
  if (typeof rolesOrPerson === "string") return rolesMatch(rolesOrPerson, shiftRole);
  const names = Array.isArray(rolesOrPerson)
    ? rolesOrPerson
    : rolesOrPerson?.roles?.length
      ? rolesOrPerson.roles
      : rolesOrPerson?.role
        ? [rolesOrPerson.role]
        : [];
  return names.some((name) => rolesMatch(name, shiftRole));
}

export function weekHoursFor(shifts, personId) {
  return shifts
    .filter((s) => s.personId === personId)
    .reduce((sum, s) => sum + (shiftHours(s.start, s.end) || 0), 0);
}

export function evaluateClaim({ shift, claimer, weekShifts }) {
  const extra = shiftHours(shift.start, shift.end);
  const current = weekHoursFor(weekShifts, claimer.id);
  const after = current + (extra || 0);
  const roleMatch = personHasRole(claimer.roles?.length ? claimer.roles : claimer.role, shift.role);
  const cap = Number(claimer.maxHours);
  const capOn = Number.isFinite(cap) && cap > 0;
  const hoursOk = extra != null && (!capOn || after <= cap);
  return {
    roleMatch,
    hoursOk,
    auto: Boolean(roleMatch && hoursOk),
    claimerHoursNow: current,
    claimerHoursAfter: after,
    shiftHours: extra,
    maxHours: capOn ? cap : 0,
  };
}
