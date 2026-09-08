import { canManage, getShop, listShiftsBetween, updateShop } from "./db.js";
import {
  clampResetDay,
  hoursMapFromShifts,
  isYmd,
  maxDate,
  periodAfter,
  periodBefore,
  periodRange,
  todayYmd,
} from "./hours.js";

export function ensureCurrentPeriod(today = todayYmd()) {
  const shop = getShop();
  if (!shop) return null;
  const resetDay = clampResetDay(shop.stats_reset_day);
  const hold = Boolean(Number(shop.stats_hold));
  let from = shop.stats_period_start;
  let to = shop.stats_period_end;
  if (!isYmd(from) || !isYmd(to) || from > to) {
    const range = periodRange(resetDay, today);
    updateShop({ statsPeriodStart: range.from, statsPeriodEnd: range.to, statsHold: 0 });
    return { resetDay, from: range.from, to: range.to, hold: false };
  }
  if (!hold) {
    let changed = false;
    while (today > to) {
      const next = periodAfter(resetDay, to);
      from = next.from;
      to = next.to;
      changed = true;
    }
    if (changed) {
      updateShop({ statsPeriodStart: from, statsPeriodEnd: to, statsHold: 0 });
    }
  }
  return { resetDay, from, to, hold };
}

export function applyResetDay(day, today = todayYmd()) {
  const resetDay = clampResetDay(day);
  const range = periodRange(resetDay, today);
  updateShop({
    statsResetDay: resetDay,
    statsPeriodStart: range.from,
    statsPeriodEnd: range.to,
    statsHold: 0,
  });
  return ensureCurrentPeriod(today);
}

export function setCurrentPeriod({ from, to, absorb }, today = todayYmd()) {
  if (!isYmd(from) || !isYmd(to) || from > to) return { error: "range_invalid" };
  const current = ensureCurrentPeriod(today);
  if (!current) return { error: "no_shop" };
  if (from === current.from && to === current.to && !absorb) return { ok: true, ...current };
  if (absorb) {
    const end = maxDate(today, current.to);
    updateShop({ statsPeriodStart: from, statsPeriodEnd: maxDate(to, end), statsHold: 0 });
  } else {
    updateShop({ statsPeriodStart: from, statsPeriodEnd: to, statsHold: 1 });
  }
  return { ok: true, ...ensureCurrentPeriod(today) };
}

function scopeHours(hours, me) {
  if (canManage(me)) return hours;
  const id = me?.id;
  return id ? { [id]: hours[id] || 0 } : {};
}

function shopHistory(resetDay, selected, n = 6) {
  const rows = [];
  let range = { from: selected.from, to: selected.to };
  for (let i = 0; i < n && range; i += 1) {
    const map = hoursMapFromShifts(listShiftsBetween(range.from, range.to));
    let total = 0;
    for (const value of Object.values(map)) total += value;
    rows.push({ from: range.from, to: range.to, map, total });
    range = periodBefore(resetDay, range.from);
  }
  return rows.reverse();
}

export function statsFor(me, range, today = todayYmd()) {
  const current = ensureCurrentPeriod(today);
  if (!current) return { error: "no_shop" };
  let from = range?.from;
  let to = range?.to;
  if (from || to) {
    if (!isYmd(from) || !isYmd(to) || from > to) return { error: "range_invalid" };
  } else {
    from = current.from;
    to = current.to;
  }
  const hours = scopeHours(hoursMapFromShifts(listShiftsBetween(from, to)), me);
  const payload = {
    resetDay: current.resetDay,
    from,
    to,
    hours,
    hold: current.hold,
    current: { from: current.from, to: current.to },
  };
  const hist = shopHistory(current.resetDay, { from, to });
  if (canManage(me)) {
    payload.history = hist.map((row) => ({ from: row.from, to: row.to, total: row.total }));
  } else if (me?.id) {
    payload.history = hist.map((row) => ({ from: row.from, to: row.to, hours: row.map[me.id] || 0 }));
  }
  return payload;
}
