import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { makePasswordRecord } from "../src/auth.js";
import {
  createShop,
  getDb,
  getPerson,
  initDb,
  insertPerson,
  insertUser,
  listShifts,
  getShift,
  runWithShop,
  updatePerson,
  updateShop,
  getShop,
  listUnreadNotices,
  ackNotices,
} from "../src/db.js";
import { seedCatalog } from "../src/catalog.js";
import { approveJoin, requestJoin } from "../src/join.js";
import { addShift, cancelOffer, claimShift, copyDay, decideSwap, findClashes, offerShift, kickPerson, loadState, savePerson } from "../src/swap.js";
import { addDays, periodBefore, periodRange, todayYmd } from "../src/hours.js";
import { claimInvite, inviteStatus } from "../src/invite.js";
import { setCurrentPeriod, statsFor } from "../src/stats.js";

let shop;
let owner;
let anna;
let petr;
let jana;
let monday;
let waiter;

before(async () => {
  initDb(":memory:");
  shop = createShop({ id: randomUUID(), name: "Test Café", lang: "en", kind: "cafe" });
  await runWithShop(shop.id, async () => {
    seedCatalog("cafe", "en");
    const pwd = await makePasswordRecord("secret1");
    const ownerUser = insertUser({
      id: randomUUID(),
      email: "owner@test.local",
      name: "Owner",
      passwordHash: pwd.passwordHash,
      passwordSalt: pwd.passwordSalt,
    });
    owner = insertPerson({
      id: randomUUID(),
      userId: ownerUser.id,
      name: "Owner",
      role: "Barista",
      maxHours: 40,
      email: ownerUser.email,
      isOwner: true,
    });
    anna = insertPerson({
      id: randomUUID(),
      name: "Anna",
      role: "Barista",
      maxHours: 20,
      email: "",
      isOwner: false,
    });
    petr = insertPerson({
      id: randomUUID(),
      name: "Petr",
      role: "Barista",
      maxHours: 40,
      email: "",
      isOwner: false,
    });
    jana = insertPerson({
      id: randomUUID(),
      name: "Jana",
      role: "Kitchen",
      maxHours: 40,
      email: "",
      isOwner: false,
    });
    const waitPwd = await makePasswordRecord("secret2");
    waiter = insertUser({
      id: randomUUID(),
      email: "wait@test.local",
      name: "Waiter",
      passwordHash: waitPwd.passwordHash,
      passwordSalt: waitPwd.passwordSalt,
    });
  });
  monday = "2026-08-24";
});

function inShop(fn) {
  return runWithShop(shop.id, fn);
}

function pendingId(shiftId) {
  return getDb()
    .prepare("SELECT id FROM swaps WHERE shift_id = ? AND status = 'pending'")
    .get(shiftId)?.id;
}

test("offer then claim auto-approves same role under cap", async () => {
  await inShop(async () => {
    const added = addShift({
      date: monday,
      start: "07:00",
      end: "15:00",
      role: "Barista",
      personId: anna.id,
    });
    const id = added.shift.id;
    assert.equal(offerShift(anna, id).ok, true);
    const claim = await claimShift(petr, id);
    assert.equal(claim.auto, true);
    const shift = listShifts(monday).find((s) => s.id === id);
    assert.equal(shift.person_id, petr.id);
    assert.equal(shift.offered, 0);
  });
});

test("role mismatch goes to owner queue, approve reassigns", async () => {
  await inShop(async () => {
    const added = addShift({
      date: "2026-08-25",
      start: "07:00",
      end: "15:00",
      role: "Barista",
      personId: anna.id,
    });
    const id = added.shift.id;
    offerShift(anna, id);
    const claim = await claimShift(jana, id);
    assert.equal(claim.auto, false);
    let shift = listShifts(monday).find((s) => s.id === id);
    assert.equal(shift.person_id, anna.id);
    const decided = await decideSwap(owner, pendingId(id), true);
    assert.equal(decided.ok, true);
    shift = listShifts(monday).find((s) => s.id === id);
    assert.equal(shift.person_id, jana.id);
  });
});

test("over hours goes to queue; reject keeps the offer open", async () => {
  await inShop(async () => {
    addShift({
      date: "2026-08-26",
      start: "07:00",
      end: "15:00",
      role: "Barista",
      personId: anna.id,
    });
    addShift({
      date: "2026-08-27",
      start: "07:00",
      end: "15:00",
      role: "Barista",
      personId: anna.id,
    });
    const extra = addShift({
      date: "2026-08-24",
      start: "15:00",
      end: "21:00",
      role: "Barista",
      personId: anna.id,
    });
    assert.equal((await claimShift(anna, extra.shift.id)).error, "own_shift");
    const other = addShift({
      date: "2026-08-29",
      start: "09:00",
      end: "17:00",
      role: "Barista",
      personId: petr.id,
    });
    offerShift(petr, other.shift.id);
    const over = await claimShift(anna, other.shift.id);
    assert.equal(over.auto, false);
    assert.equal(over.check.hoursOk, false);
    await decideSwap(owner, pendingId(other.shift.id), false);
    const still = listShifts(monday).find((s) => s.id === other.shift.id);
    assert.equal(still.person_id, petr.id);
    assert.equal(still.offered, 1);
  });
});

test("cannot offer someone else's shift; cancel offer returns it", async () => {
  await inShop(async () => {
    const added = addShift({
      date: "2026-08-26",
      start: "15:00",
      end: "21:00",
      role: "Kitchen",
      personId: jana.id,
    });
    assert.equal(offerShift(anna, added.shift.id).error, "not_yours");
    assert.equal(offerShift(jana, added.shift.id).ok, true);
    assert.equal(cancelOffer(jana, added.shift.id).ok, true);
    const shift = listShifts(monday).find((s) => s.id === added.shift.id);
    assert.equal(shift.offered, 0);
  });
});

test("open slot can be claimed without a name", async () => {
  await inShop(async () => {
    const added = addShift({
      date: "2026-08-27",
      start: "09:00",
      end: "17:00",
      role: "Barista",
      personId: "",
    });
    assert.equal(added.shift.open, true);
    const claim = await claimShift(petr, added.shift.id);
    assert.equal(claim.auto, true);
    const shift = listShifts(monday).find((s) => s.id === added.shift.id);
    assert.equal(shift.person_id, petr.id);
  });
});

test("addShift copies to extra dates", async () => {
  await inShop(() => {
    const result = addShift({
      date: "2026-08-28",
      start: "12:00",
      end: "20:00",
      role: "Barista",
      personId: "",
      copyDates: ["2026-08-29", "2026-08-30"],
    });
    assert.equal(result.count, 3);
  });
});

test("join code waits for owner approve", async () => {
  await inShop(() => {
    const asked = requestJoin(waiter, shop.join_code);
    assert.equal(asked.ok, true);
    const again = requestJoin(waiter, shop.join_code);
    assert.equal(again.error, "join_pending");
    const pending = getDb()
      .prepare("SELECT id FROM join_requests WHERE user_id = ? AND status = 'pending'")
      .get(waiter.id);
    const ok = approveJoin(pending.id);
    assert.equal(ok.ok, true);
    const member = getDb()
      .prepare("SELECT id, role, elevated FROM people WHERE user_id = ? AND shop_id = ?")
      .get(waiter.id, shop.id);
    assert.ok(member);
    assert.equal(member.elevated, 0);
    assert.notEqual(String(member.role).toLowerCase(), "owner");
  });
});

test("turning off weekly cap keeps stored person hours", async () => {
  await inShop(() => {
    updateShop({ hoursCap: false });
    const parsed = savePerson({ name: "Anna Horáková", roles: ["Barista"], email: anna.email });
    assert.equal(parsed.maxHours, undefined);
    updatePerson(anna.id, {
      name: parsed.name,
      role: parsed.role,
      roles: parsed.roles,
      maxHours: parsed.maxHours,
      email: parsed.email,
    });
    assert.equal(getPerson(anna.id).max_hours, 20);
    updateShop({ hoursCap: true });
    const withCap = savePerson({
      name: "Anna Horáková",
      roles: ["Barista"],
      email: anna.email,
      maxHours: 20,
    });
    assert.equal(withCap.maxHours, 20);
  });
});

test("turning off weekly cap is stored and returned on state", async () => {
  await inShop(() => {
    updateShop({ hoursCap: 0 });
    assert.equal(Number(getShop().hours_cap), 0);
    const off = loadState(monday, owner);
    assert.equal(off.shop.hoursCap, false);
    updateShop({ hoursCap: 1 });
    const on = loadState(monday, owner);
    assert.equal(on.shop.hoursCap, true);
  });
});

test("staff stats hours only include self", async () => {
  await inShop(() => {
    const today = todayYmd();
    const range = periodRange(1, today);
    addShift({ date: range.from, start: "09:00", end: "17:00", role: "Barista", personId: anna.id });
    addShift({ date: range.from, start: "09:00", end: "13:00", role: "Barista", personId: petr.id });
    const staff = loadState(monday, anna);
    assert.deepEqual(Object.keys(staff.stats.hours), [anna.id]);
    assert.equal(staff.stats.hours[anna.id], 8);
    assert.ok(staff.stats.history.every((row) => Object.hasOwn(row, "hours") && !Object.hasOwn(row, "total")));
    const mgr = loadState(monday, owner);
    assert.equal(mgr.stats.hours[anna.id], 8);
    assert.equal(mgr.stats.hours[petr.id], 4);
    assert.ok(mgr.stats.history.every((row) => Object.hasOwn(row, "total") && !Object.hasOwn(row, "hours") && !row.map));
    const currentRow = mgr.stats.history[mgr.stats.history.length - 1];
    assert.equal(currentRow.total, 12);
  });
});

test("savePerson requires a full name", async () => {
  await inShop(() => {
    assert.equal(savePerson({ name: "Klára", roles: ["Barista"] }).error, "full_name");
    const ok = savePerson({ name: "Klára Malá", roles: ["Barista"], maxHours: 40 });
    assert.equal(ok.name, "Klára Malá");
    assert.equal(ok.role, "Barista");
  });
});

test("set current period absorb extends to include newer hours", async () => {
  await inShop(() => {
    const today = todayYmd();
    const current = periodRange(1, today);
    const prev = periodBefore(1, current.from);
    updateShop({ statsResetDay: 1, statsPeriodStart: prev.from, statsPeriodEnd: prev.to, statsHold: 1 });
    const kira = insertPerson({
      id: randomUUID(),
      name: "Kira",
      role: "Barista",
      maxHours: 40,
      email: "",
      isOwner: false,
    });
    addShift({ date: prev.from, start: "10:00", end: "14:00", role: "Barista", personId: kira.id });
    addShift({ date: today, start: "10:00", end: "16:00", role: "Barista", personId: kira.id });
    const held = setCurrentPeriod({ from: prev.from, to: prev.to, absorb: false }, today);
    assert.equal(held.hold, true);
    assert.equal(held.to, prev.to);
    const heldHours = statsFor(owner, { from: prev.from, to: prev.to }, today).hours;
    assert.equal(heldHours[kira.id], 4);
    const absorbed = setCurrentPeriod({ from: prev.from, to: prev.to, absorb: true }, today);
    assert.equal(absorbed.hold, false);
    assert.equal(absorbed.from, prev.from);
    assert.equal(absorbed.to, today);
    const all = statsFor(owner, { from: absorbed.from, to: absorbed.to }, today).hours;
    assert.equal(all[kira.id], 10);
  });
});

test("open invite is claimable by stored email with no user row", async () => {
  await inShop(() => {
    insertPerson({
      id: randomUUID(),
      name: "Nora",
      role: "Barista",
      maxHours: 40,
      email: "nora.stored@test.local",
      isOwner: false,
    });
    const status = inviteStatus("nora.stored@test.local");
    assert.equal(status.claim, true);
    assert.equal(status.email, "nora.stored@test.local");
    assert.equal(Boolean(status.existing), false);
    assert.equal(inviteStatus("owner@test.local").existing, true);
    assert.equal(inviteStatus("nobody@test.local").none, true);
  });
});

test("open invite with blank user_id still claims; login with password would too", async () => {
  await inShop(async () => {
    const invited = insertPerson({
      id: randomUUID(),
      name: "Blank Invite",
      role: "Barista",
      maxHours: 40,
      email: "blank.invite@test.local",
      isOwner: false,
      userId: "",
    });
    assert.equal(getPerson(invited.id).user_id, null);
    const status = inviteStatus("blank.invite@test.local");
    assert.equal(status.claim, true);
    const claimed = await claimInvite("blank.invite@test.local", "secret8");
    assert.equal(getPerson(invited.id).user_id, claimed.user.id);
  });
});

test("invite claim creates user from person name and links the row", async () => {
  await inShop(async () => {
    const invited = insertPerson({
      id: randomUUID(),
      name: "Iva Invite",
      role: "Barista",
      maxHours: 40,
      email: "iva.invite@test.local",
      isOwner: false,
    });
    const claimed = await claimInvite("iva.invite@test.local", "secret9");
    assert.equal(claimed.user.name, "Iva Invite");
    assert.equal(claimed.user.email, "iva.invite@test.local");
    assert.equal(getPerson(invited.id).user_id, claimed.user.id);
  });
});

test("kick rejects founder and self and opens future shifts", async () => {
  await inShop(() => {
    assert.equal(kickPerson(owner, owner.id).error, "kick_self");
    assert.equal(kickPerson(anna, petr.id).error, "owner_only");
    updatePerson(petr.id, { elevated: true });
    assert.equal(kickPerson(getPerson(petr.id), owner.id).error, "kick_founder");
    const today = todayYmd();
    const past = addDays(today, -1);
    const pastShift = addShift({
      date: past,
      start: "09:00",
      end: "17:00",
      role: "Barista",
      personId: petr.id,
    });
    const futureShift = addShift({
      date: today,
      start: "09:00",
      end: "17:00",
      role: "Barista",
      personId: petr.id,
    });
    assert.equal(kickPerson(owner, petr.id).ok, true);
    assert.ok(getPerson(petr.id).left_at);
    assert.equal(getPerson(petr.id).user_id, null);
    assert.equal(getShift(pastShift.shift.id).person_id, petr.id);
    assert.equal(getShift(futureShift.shift.id).person_id, null);
    const roster = loadState(monday, owner);
    assert.ok(roster.people.find((p) => p.id === petr.id).leftAt);
  });
});

test("findClashes reports overlap not adjacent and skips self", async () => {
  await inShop(() => {
    const day = "2026-10-05";
    addShift({ date: day, start: "07:00", end: "15:00", role: "Barista", personId: anna.id });
    const overlap = findClashes({ personId: anna.id, date: day, start: "12:00", end: "20:00" });
    assert.equal(overlap.clashes.length, 1);
    assert.equal(overlap.clashes[0].name, getPerson(anna.id).name);
    assert.equal(overlap.clashes[0].start, "07:00");
    const adjacent = findClashes({ personId: anna.id, date: day, start: "15:00", end: "20:00" });
    assert.equal(adjacent.clashes.length, 0);
    const open = findClashes({ personId: "", date: day, start: "07:00", end: "15:00" });
    assert.equal(open.clashes.length, 0);
    const created = addShift({ date: day, start: "12:00", end: "16:00", role: "Barista", personId: jana.id });
    const self = findClashes({
      personId: jana.id,
      date: day,
      start: "12:00",
      end: "16:00",
      excludeId: created.shift.id,
    });
    assert.equal(self.clashes.length, 0);
  });
});

test("copy-day clashes list assigned overlaps on the target date", async () => {
  await inShop(() => {
    const from = "2026-10-12";
    const to = "2026-10-13";
    addShift({ date: from, start: "07:00", end: "15:00", role: "Barista", personId: anna.id });
    addShift({ date: to, start: "12:00", end: "20:00", role: "Barista", personId: anna.id });
    const hit = findClashes({ from, dates: [to] });
    assert.equal(hit.clashes.length, 1);
    assert.equal(hit.clashes[0].name, getPerson(anna.id).name);
    assert.equal(hit.clashes[0].date, to);
    const copied = copyDay(from, [to]);
    assert.equal(copied.ok, true);
  });
});

test("kick stores a notice for the linked user", async () => {
  await inShop(async () => {
    const pwd = await makePasswordRecord("secret3");
    const kickedUser = insertUser({
      id: randomUUID(),
      email: "kicked@test.local",
      name: "Kicked User",
      passwordHash: pwd.passwordHash,
      passwordSalt: pwd.passwordSalt,
    });
    const linked = insertPerson({
      id: randomUUID(),
      userId: kickedUser.id,
      name: "Kicked User",
      role: "Barista",
      maxHours: 40,
      email: kickedUser.email,
      isOwner: false,
    });
    const result = kickPerson(owner, linked.id);
    assert.equal(result.ok, true);
    assert.equal(result.notifyTo, kickedUser.email);
    const notices = listUnreadNotices(kickedUser.id);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].kind, "kicked");
    assert.equal(notices[0].shopName, "Test Café");
    ackNotices(kickedUser.id, notices.map((n) => n.id));
    assert.equal(listUnreadNotices(kickedUser.id).length, 0);
  });
});
