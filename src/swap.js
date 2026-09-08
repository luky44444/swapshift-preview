import { randomUUID } from "node:crypto";
import { mondayOf, hoursMapFromShifts, shiftHours, todayYmd, addDays, timesOverlap } from "./hours.js";
import { validateFullName } from "./auth.js";
import { evaluateClaim } from "./rules.js";
import { notify } from "./mail.js";
import { statsFor } from "./stats.js";
import {
  canManage,
  deleteShift,
  getPerson,
  getShift,
  getShop,
  insertShift,
  insertSwap,
  listActiveSwapsForShift,
  listCategories,
  listPeople,
  listPendingJoinsForShop,
  listPendingSwaps,
  listPersonRoles,
  listRoles,
  listShifts,
  listShiftsBetween,
  listShiftsForPersonFrom,
  listSwapsBetween,
  nowIso,
  openSwapForShift,
  pendingCount,
  insertNotice,
  updatePerson,
  updateShift,
  updateSwap,
  withTx,
} from "./db.js";

function personView(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    roles: listPersonRoles(row.id),
    maxHours: row.max_hours,
    email: row.email,
    userId: row.user_id || "",
    leftAt: row.left_at || "",
    isOwner: Boolean(row.is_owner),
    elevated: Boolean(row.elevated),
    canManage: canManage(row),
  };
}

function roleView(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, elevated: Boolean(row.elevated) };
}

function categoryView(row) {
  if (!row) return null;
  return { id: row.id, name: row.name };
}

function shiftView(row) {
  if (!row) return null;
  return {
    id: row.id,
    weekStart: row.week_start,
    date: row.date,
    start: row.start,
    end: row.end,
    role: row.role,
    personId: row.person_id || "",
    open: !row.person_id,
    offered: Boolean(row.offered),
    hours: shiftHours(row.start, row.end),
  };
}

function swapView(row) {
  if (!row) return null;
  return {
    id: row.id,
    shiftId: row.shift_id,
    offeredBy: row.offered_by,
    claimedBy: row.claimed_by,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    reason: row.reason || "",
    offerReason: row.offer_reason || "",
  };
}

function activeRow(row) {
  return !row.left_at;
}

export function loadState(weekStart, me, range) {
  const week = mondayOf(weekStart) ?? mondayOf(todayYmd());
  const from = range?.from || week;
  const to = range?.to || addDays(week, 6);
  const shop = getShop();
  const people = listPeople().map(personView);
  const shifts = listShiftsBetween(from, to).map(shiftView);
  const weekShifts = listShifts(week).map(shiftView);
  const swaps = listSwapsBetween(from, to).map(swapView);
  const manage = canManage(me);
  const pending = manage
    ? listPendingSwaps().map((row) => ({
        ...swapView(row),
        shift: shiftView(getShift(row.shift_id)),
      }))
    : [];
  const joinRequests = manage ? listPendingJoinsForShop() : [];
  return {
    shop: shop
      ? {
          id: shop.id,
          name: shop.name,
          lang: shop.lang,
          theme: shop.theme || "system",
          kind: shop.kind || "cafe",
          categoryId: shop.category_id,
          joinCode: manage ? shop.join_code : "",
          hoursCap: Number(shop.hours_cap) !== 0,
        }
      : null,
    me: personView(me),
    weekStart: week,
    from,
    to,
    people,
    roles: listRoles().map(roleView),
    categories: listCategories().map(categoryView),
    shifts,
    swaps,
    pending,
    joinRequests,
    pendingCount: manage ? pendingCount() : 0,
    hours: hoursMapFromShifts(weekShifts),
    stats: statsFor(me),
  };
}

export function validateShiftInput(body) {
  const date = String(body.date ?? "");
  const start = String(body.start ?? "");
  const end = String(body.end ?? "");
  const role = String(body.role ?? "").trim();
  const rawPerson = String(body.personId ?? "").trim();
  const personId = rawPerson && getPerson(rawPerson) ? rawPerson : null;
  const weekStart = mondayOf(date);
  if (!weekStart) return { error: "date_invalid" };
  if (shiftHours(start, end) == null) return { error: "time_invalid" };
  if (!role) return { error: "role_required" };
  if (rawPerson && !personId) return { error: "person_missing" };
  return { date, start, end, role, personId, weekStart };
}

function extraDatesFrom(body, sourceDate) {
  const raw = body.copyDates ?? body.dates ?? [];
  const list = Array.isArray(raw) ? raw : [raw];
  const dates = [];
  for (const item of list) {
    const date = String(item ?? "").slice(0, 10);
    if (!mondayOf(date)) continue;
    if (date === sourceDate) continue;
    if (!dates.includes(date)) dates.push(date);
  }
  return dates.slice(0, 31);
}

function clashView(personId, date, start, end) {
  const person = getPerson(personId);
  return { name: person?.name || "", date, start, end };
}

function clashesOnDate(personId, date, start, end, excludeId) {
  if (!personId || !mondayOf(date)) return [];
  return listShiftsBetween(date, date)
    .filter(
      (row) =>
        row.person_id === personId &&
        row.id !== excludeId &&
        timesOverlap(start, end, row.start, row.end),
    )
    .map((row) => clashView(personId, date, row.start, row.end));
}

function copyDayClashes(fromRaw, datesRaw) {
  const from = String(fromRaw ?? "").slice(0, 10);
  if (!mondayOf(from)) return { error: "date_invalid" };
  const sources = listShiftsBetween(from, from).filter((row) => row.person_id);
  const dates = extraDatesFrom({ dates: datesRaw }, from);
  if (!dates.length) return { error: "date_invalid" };
  const clashes = [];
  const seen = new Set();
  for (const date of dates) {
    const existing = listShiftsBetween(date, date);
    for (const src of sources) {
      for (const row of existing) {
        if (row.person_id !== src.person_id) continue;
        if (!timesOverlap(src.start, src.end, row.start, row.end)) continue;
        const clash = clashView(src.person_id, date, row.start, row.end);
        const key = `${clash.name}|${clash.date}|${clash.start}|${clash.end}`;
        if (seen.has(key)) continue;
        seen.add(key);
        clashes.push(clash);
      }
    }
  }
  return { clashes };
}

export function findClashes(body) {
  const from = String(body.from ?? "").slice(0, 10);
  if (from) return copyDayClashes(from, body.dates);
  const personId = String(body.personId ?? "").trim();
  if (!personId) return { clashes: [] };
  const date = String(body.date ?? "").slice(0, 10);
  const start = String(body.start ?? "");
  const end = String(body.end ?? "");
  const excludeId = String(body.excludeId ?? "").trim();
  const dates = [];
  if (mondayOf(date)) dates.push(date);
  for (const extra of extraDatesFrom(body, date)) {
    if (!dates.includes(extra)) dates.push(extra);
  }
  const clashes = [];
  const seen = new Set();
  for (const d of dates) {
    for (const clash of clashesOnDate(personId, d, start, end, excludeId)) {
      const key = `${clash.name}|${clash.date}|${clash.start}|${clash.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      clashes.push(clash);
    }
  }
  return { clashes };
}

export function addShift(body) {
  const parsed = validateShiftInput(body);
  if (parsed.error) return parsed;
  const dates = [parsed.date, ...extraDatesFrom(body, parsed.date)];
  const shifts = dates.map((date) =>
    insertShift({
      id: randomUUID(),
      weekStart: mondayOf(date),
      date,
      start: parsed.start,
      end: parsed.end,
      role: parsed.role,
      personId: parsed.personId,
    }),
  );
  return { shift: shiftView(shifts[0]), count: shifts.length };
}

export function copyDay(fromRaw, datesRaw) {
  const from = String(fromRaw ?? "").slice(0, 10);
  if (!mondayOf(from)) return { error: "date_invalid" };
  const sources = listShiftsBetween(from, from);
  if (!sources.length) return { error: "no_shifts" };
  const dates = extraDatesFrom({ dates: datesRaw }, from);
  if (!dates.length) return { error: "date_invalid" };
  let count = 0;
  for (const date of dates) {
    const weekStart = mondayOf(date);
    for (const row of sources) {
      insertShift({
        id: randomUUID(),
        weekStart,
        date,
        start: row.start,
        end: row.end,
        role: row.role,
        personId: row.person_id,
      });
      count += 1;
    }
  }
  return { ok: true, count };
}

export function editShift(id, body) {
  const current = getShift(id);
  if (!current) return { error: "shift_missing" };
  const parsed = validateShiftInput({
    date: body.date ?? current.date,
    start: body.start ?? current.start,
    end: body.end ?? current.end,
    role: body.role ?? current.role,
    personId: body.personId ?? current.person_id,
  });
  if (parsed.error) return parsed;
  const personChanged = parsed.personId !== (current.person_id || null);
  if (personChanged || parsed.date !== current.date) {
    const open = openSwapForShift(id);
    if (open) {
      updateSwap(open.id, { status: "cancelled", resolvedAt: nowIso() });
    }
  }
  const shift = updateShift(id, {
    date: parsed.date,
    start: parsed.start,
    end: parsed.end,
    role: parsed.role,
    personId: parsed.personId,
    weekStart: parsed.weekStart,
    offered: personChanged ? false : undefined,
  });
  return { shift: shiftView(shift) };
}

export function removeShift(id) {
  if (!getShift(id)) return { error: "shift_missing" };
  deleteShift(id);
  return { ok: true };
}

export function clipReason(raw) {
  return String(raw ?? "").trim().slice(0, 280);
}

export function offerShift(me, shiftId, reasonRaw = "") {
  const shift = getShift(shiftId);
  if (!shift) return { error: "shift_missing" };
  if (shift.person_id !== me.id) return { error: "not_yours" };
  if (shift.offered) return { error: "already_offered" };
  const offerReason = clipReason(reasonRaw);
  return withTx(() => {
    updateShift(shiftId, { offered: true });
    insertSwap({
      id: randomUUID(),
      shiftId,
      offeredBy: me.id,
      status: "open",
      offerReason,
    });
    return { ok: true };
  });
}

export function cancelOffer(me, shiftId) {
  const shift = getShift(shiftId);
  if (!shift) return { error: "shift_missing" };
  const open = openSwapForShift(shiftId);
  if (!open || open.status !== "open") return { error: "not_open" };
  if (open.offered_by !== me.id && !canManage(me)) return { error: "not_yours" };
  return withTx(() => {
    updateSwap(open.id, { status: "cancelled", resolvedAt: nowIso() });
    updateShift(shiftId, { offered: false });
    return { ok: true };
  });
}

export async function claimShift(me, shiftId, reasonRaw = "") {
  const shift = getShift(shiftId);
  if (!shift) return { error: "shift_missing" };
  if (shift.person_id === me.id) return { error: "own_shift" };
  const openSlot = !shift.person_id;
  const open = openSwapForShift(shiftId);
  if (!openSlot) {
    if (!shift.offered) return { error: "not_offered" };
    if (!open || open.status !== "open") return { error: "already_claimed" };
  } else if (open?.status === "pending") {
    return { error: "already_claimed" };
  }
  const reason = clipReason(reasonRaw);

  const weekShifts = listShifts(shift.week_start).map((row) => ({
    personId: row.person_id,
    start: row.start,
    end: row.end,
  }));
  const check = evaluateClaim({
    shift: { start: shift.start, end: shift.end, role: shift.role },
    claimer: { id: me.id, role: me.role, roles: listPersonRoles(me.id), maxHours: Number(getShop()?.hours_cap) === 0 ? 0 : me.max_hours },
    weekShifts,
  });

  const auto = check.auto;
  const result = withTx(() => {
    if (openSlot) {
      if (auto) {
        if (open) updateSwap(open.id, { claimedBy: me.id, status: "auto", resolvedAt: nowIso(), reason });
        updateShift(shiftId, { personId: me.id, offered: false });
      } else {
        const owner =
          listPeople().find((p) => activeRow(p) && p.is_owner) ||
          listPeople().find((p) => activeRow(p) && canManage(p));
        if (open) {
          updateSwap(open.id, { claimedBy: me.id, status: "pending", reason });
        } else {
          insertSwap({
            id: randomUUID(),
            shiftId,
            offeredBy: owner?.id || me.id,
            claimedBy: me.id,
            status: "pending",
            reason,
          });
        }
      }
      return { ok: true, auto, check };
    }
    if (auto) {
      updateSwap(open.id, {
        claimedBy: me.id,
        status: "auto",
        resolvedAt: nowIso(),
        reason,
      });
      updateShift(shiftId, { personId: me.id, offered: false });
    } else {
      updateSwap(open.id, { claimedBy: me.id, status: "pending", reason });
    }
    return { ok: true, auto, check };
  });

  const offerer = getPerson(shift.person_id);
  const managers = listPeople().filter((p) => activeRow(p) && canManage(p) && p.email);
  const shop = getShop();
  const label = `${shift.date} ${shift.start}–${shift.end} ${shift.role}`;
  if (auto) {
    await notify({
      to: managers[0]?.email,
      subject: `${shop?.name ?? "SWAPSHIFT"}: auto swap`,
      text: openSlot
        ? `${me.name} took open ${label}. Role matched, hours under cap.`
        : `${me.name} took ${offerer?.name}'s ${label}. Role matched, hours under cap.`,
    });
    if (offerer?.email) {
      await notify({
        to: offerer.email,
        subject: `${shop?.name ?? "SWAPSHIFT"}: shift taken`,
        text: `${me.name} took your ${label}.`,
      });
    }
    await notify({
      to: me.email,
      subject: `${shop?.name ?? "SWAPSHIFT"}: you have the shift`,
      text: `You now have ${label}.`,
    });
  } else {
    for (const mgr of managers) {
      await notify({
        to: mgr.email,
        subject: `${shop?.name ?? "SWAPSHIFT"}: swap needs you`,
        text: openSlot
          ? `${me.name} wants the open ${label}. ${reason ? `Reason: ${reason}. ` : ""}${check.roleMatch ? "" : "Role mismatch. "}${check.hoursOk ? "" : "Over weekly hours. "}Open SWAPSHIFT to approve or reject.`
          : `${me.name} wants to swap ${label} with ${offerer?.name}. ${reason ? `Reason: ${reason}. ` : ""}${check.roleMatch ? "" : "Role mismatch. "}${check.hoursOk ? "" : "Over weekly hours. "}Open SWAPSHIFT to approve or reject.`,
      });
    }
  }
  return result;
}

export async function decideSwap(me, swapId, approved) {
  if (!canManage(me)) return { error: "owner_only" };
  const swap = withTx(() => {
    const row = listPendingSwaps().find((s) => s.id === swapId);
    if (!row) return { error: "swap_missing" };
    const shift = getShift(row.shift_id);
    if (!shift) return { error: "shift_missing" };
    if (approved) {
      updateSwap(row.id, { status: "approved", resolvedAt: nowIso() });
      updateShift(shift.id, { personId: row.claimed_by, offered: false });
    } else {
      updateSwap(row.id, { status: "rejected", resolvedAt: nowIso() });
      if (shift.person_id) {
        insertSwap({
          id: randomUUID(),
          shiftId: shift.id,
          offeredBy: row.offered_by,
          status: "open",
          offerReason: row.offer_reason || "",
        });
      }
    }
    return { ok: true, approved, shift, row };
  });
  if (swap.error) return swap;

  const claimer = getPerson(swap.row.claimed_by);
  const offerer = getPerson(swap.row.offered_by);
  const shop = getShop();
  const shift = swap.shift;
  const label = `${shift.date} ${shift.start}–${shift.end} ${shift.role}`;
  const decision = approved ? "approved" : "rejected";
  await notify({
    to: claimer?.email,
    subject: `${shop?.name ?? "SWAPSHIFT"}: swap ${decision}`,
    text: approved ? `You have ${label}.` : `The owner rejected ${label}. Still offered.`,
  });
  await notify({
    to: offerer?.email,
    subject: `${shop?.name ?? "SWAPSHIFT"}: swap ${decision}`,
    text: approved
      ? `${claimer?.name} now has your ${label}.`
      : `The owner kept ${label} offered.`,
  });
  return { ok: true };
}

export function savePerson(body) {
  const name = validateFullName(body.name);
  if (typeof name !== "string") return { error: name.error };
  const email = String(body.email ?? "").trim().toLowerCase();
  const maxHoursRaw = Number(body.maxHours);
  const hoursCap = Number(getShop()?.hours_cap) !== 0;
  const maxHours = hoursCap
    ? maxHoursRaw
    : Number.isFinite(maxHoursRaw) && maxHoursRaw > 0
      ? maxHoursRaw
      : undefined;
  const roles = [];
  const rawList = body.roles;
  const pieces = Array.isArray(rawList)
    ? rawList
    : String(rawList ?? "").split("|");
  for (const piece of [...pieces, body.role, body.extraRole]) {
    const role = String(piece ?? "").trim();
    if (!role) continue;
    if (!roles.some((r) => r.toLowerCase() === role.toLowerCase())) roles.push(role);
  }
  if (!roles.length) return { error: "role_required" };
  if (hoursCap && (!Number.isFinite(maxHours) || maxHours <= 0 || maxHours > 80)) return { error: "hours_cap" };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "email_invalid" };
  return { name, role: roles[0], roles, maxHours, email };
}

export function kickPerson(me, personId) {
  if (!canManage(me)) return { error: "owner_only" };
  const person = getPerson(personId);
  if (!person || person.left_at) return { error: "person_missing" };
  if (person.id === me.id) return { error: "kick_self" };
  if (person.is_owner) return { error: "kick_founder" };
  const today = todayYmd();
  const userId = person.user_id || "";
  const email = String(person.email || "").trim();
  const shop = getShop();
  const shopName = shop?.name || "";
  const lang = shop?.lang === "en" ? "en" : "cs";
  withTx(() => {
    for (const shift of listShiftsForPersonFrom(personId, today)) {
      for (const swap of listActiveSwapsForShift(shift.id)) {
        updateSwap(swap.id, {
          status: swap.status === "pending" ? "rejected" : "cancelled",
          resolvedAt: nowIso(),
        });
      }
      updateShift(shift.id, { personId: null, offered: false });
    }
    if (userId) {
      insertNotice({
        id: randomUUID(),
        userId,
        kind: "kicked",
        shopName,
      });
    }
    updatePerson(personId, { userId: null, leftAt: nowIso() });
  });
  return { ok: true, notifyTo: email || null, shopName, lang };
}

export { personView, shiftView, swapView };

export function demoWeek(weekStart) {
  const week = mondayOf(weekStart) ?? mondayOf(todayYmd());
  const people = listPeople().filter((p) => !p.left_at);
  if (!people.length) return { error: "no_people" };
  const slots = [
    ["07:00", "15:00"],
    ["09:00", "17:00"],
    ["12:00", "20:00"],
  ];
  const morning = slots[0];
  const evening = slots[2];
  const days = [0, 1, 2, 3, 4, 5];
  days.forEach((day, i) => {
    const person = people[i % people.length];
    const time = day % 2 === 0 ? morning : evening;
    insertShift({
      id: randomUUID(),
      weekStart: week,
      date: addDays(week, day),
      start: time[0],
      end: time[1],
      role: person.role,
      personId: person.id,
    });
  });
  return { ok: true, weekStart: week };
}
