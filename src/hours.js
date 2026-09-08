export function mondayOf(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  if (!y || !m || !d) return null;
  const utc = Date.UTC(y, m - 1, d);
  const day = new Date(utc).getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(utc + diff * 86400000);
  return ymd(mon);
}

export function todayYmd(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return ymd(next);
}

export function monthStart(dateStr) {
  const [y, m] = String(dateStr).split("-");
  if (!y || !m) return null;
  return `${y}-${m}-01`;
}

export function monthEnd(dateStr) {
  const [y, m] = String(dateStr).split("-").map(Number);
  if (!y || !m) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

export function addMonths(dateStr, n) {
  const [y, m] = String(dateStr).split("-").map(Number);
  if (!y || !m) return null;
  const next = new Date(Date.UTC(y, m - 1 + n, 1));
  return monthStart(ymd(next));
}

export function ymd(date) {
  return date.toISOString().slice(0, 10);
}

export function minutes(hhmm) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(hhmm).trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

export function shiftHours(start, end) {
  const a = minutes(start);
  const b = minutes(end);
  if (a == null || b == null || b <= a) return null;
  return (b - a) / 60;
}

export function timesOverlap(aStart, aEnd, bStart, bEnd) {
  const a0 = minutes(aStart);
  const a1 = minutes(aEnd);
  const b0 = minutes(bStart);
  const b1 = minutes(bEnd);
  if (a0 == null || a1 == null || b0 == null || b1 == null) return false;
  return a0 < b1 && b0 < a1;
}

export function hoursMapFromShifts(shifts) {
  const map = {};
  for (const shift of shifts) {
    const id = shift.personId ?? shift.person_id;
    if (!id) continue;
    map[id] = (map[id] || 0) + (shiftHours(shift.start, shift.end) || 0);
  }
  return map;
}

export function isYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
}

export function formatHours(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function clampResetDay(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.min(31, Math.max(1, Math.round(n)));
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function dateOnDay(y, m, day) {
  const d = Math.min(day, daysInMonth(y, m));
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function periodRange(resetDay, dateStr) {
  const D = clampResetDay(resetDay);
  const [y, m, d] = String(dateStr).split("-").map(Number);
  if (!y || !m || !d) return null;
  const startThisMonth = dateOnDay(y, m, D);
  if (dateStr >= startThisMonth) {
    const nextM = m === 12 ? 1 : m + 1;
    const nextY = m === 12 ? y + 1 : y;
    return { from: startThisMonth, to: addDays(dateOnDay(nextY, nextM, D), -1) };
  }
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;
  return { from: dateOnDay(prevY, prevM, D), to: addDays(startThisMonth, -1) };
}

export function periodAfter(resetDay, toStr) {
  return periodRange(resetDay, addDays(toStr, 1));
}

export function periodBefore(resetDay, fromStr) {
  return periodRange(resetDay, addDays(fromStr, -1));
}

export function maxDate(a, b) {
  return a >= b ? a : b;
}
