import { randomUUID } from "node:crypto";
import { addRole, ensureRole, seedCatalog } from "./catalog.js";
import {
  createShop,
  insertJoinRequest,
  insertPerson,
  insertShift,
  insertSwap,
  insertUser,
  listPeople,
  listShifts,
  runWithShop,
  updateShift,
  deleteShift,
  wipeData,
} from "./db.js";
import { addDays, mondayOf, todayYmd } from "./hours.js";

const STAFF = [
  { name: "Eva Nováková", role: "Vedoucí", maxHours: 40, elevated: true },
  { name: "Anna Horáková", role: "Barista", maxHours: 30 },
  { name: "Petr Svoboda", role: "Barista", maxHours: 40 },
  { name: "Jana Králová", role: "Kuchyně", maxHours: 25 },
  { name: "Marek Dvořák", role: "Sál", maxHours: 35 },
  { name: "Klára Malá", role: "Pokladna", maxHours: 28 },
];

function personByName(name) {
  return listPeople().find((p) => p.name === name) ?? null;
}

function clearWeek(weekStart) {
  for (const shift of listShifts(weekStart)) deleteShift(shift.id);
}

function weekSlots({ anna, petr, jana, marek, klara, eva, owner }, variant = 0) {
  const morningBarista = variant === 1 ? petr : anna;
  const afternoonFloor = variant === 1 ? klara : marek;
  const sundayPerson = variant === -1 ? marek : variant === 1 ? anna : klara;
  const sundayRole = variant === -1 ? "Sál" : variant === 1 ? "Barista" : "Pokladna";
  return [
    { day: 0, start: "07:00", end: "15:00", person: morningBarista, role: "Barista" },
    { day: 0, start: "15:00", end: "21:00", person: jana, role: "Kuchyně" },
    { day: 1, start: "07:00", end: "15:00", person: petr, role: "Barista" },
    { day: 1, start: "15:00", end: "21:00", person: afternoonFloor, role: afternoonFloor?.role || "Sál" },
    { day: 2, start: "09:00", end: "17:00", person: klara, role: "Pokladna" },
    { day: 2, start: "07:00", end: "15:00", person: anna, role: "Barista" },
    { day: 3, start: "07:00", end: "15:00", person: eva, role: "Vedoucí" },
    { day: 3, start: "12:00", end: "20:00", person: petr, role: "Barista" },
    { day: 4, start: "07:00", end: "15:00", person: owner, role: owner?.role },
    { day: 4, start: "15:00", end: "21:00", person: jana, role: "Kuchyně" },
    { day: 5, start: "09:00", end: "15:00", person: marek, role: "Sál" },
    { day: 5, start: "09:00", end: "17:00", person: klara, role: "Pokladna" },
    { day: 6, start: "10:00", end: "16:00", person: sundayPerson, role: sundayRole },
  ];
}

function fillWeek(week, slots) {
  clearWeek(week);
  const created = [];
  for (const slot of slots) {
    if (!slot.person) continue;
    created.push(
      insertShift({
        id: randomUUID(),
        weekStart: week,
        date: addDays(week, slot.day),
        start: slot.start,
        end: slot.end,
        role: slot.role || slot.person.role,
        personId: slot.person.id,
      }),
    );
  }
  return created;
}

async function makeUser(name, emailPrefix) {
  const email = `${emailPrefix}@preview.swapshift.local`;
  const user = insertUser({
    id: randomUUID(),
    email,
    name,
    passwordHash: "preview",
    passwordSalt: "preview",
  });
  return { user, email, password: "preview" };
}

export async function seedTestData(weekStart) {
  const week = mondayOf(weekStart) ?? mondayOf(todayYmd());
  const people = listPeople();
  if (!people.length) return { error: "no_people" };
  addRole("Vedoucí", true);
  for (const row of STAFF) ensureRole(row.role);

  const anna = personByName("Anna Horáková") || people.find((p) => p.role === "Barista");
  const petr = personByName("Petr Svoboda") || people.filter((p) => p.role === "Barista")[1];
  const jana = personByName("Jana Králová") || people.find((p) => /kuch|kitchen/i.test(p.role));
  const marek = personByName("Marek Dvořák") || people.find((p) => /sál|floor/i.test(p.role));
  const klara = personByName("Klára Malá") || people.find((p) => /poklad|till/i.test(p.role));
  const eva = personByName("Eva Nováková") || people.find((p) => p.elevated && !p.is_owner);
  const owner = people.find((p) => p.is_owner) || people[0];

  const peopleMap = { anna, petr, jana, marek, klara, eva, owner };
  const past = addDays(week, -7);
  const upcoming = addDays(week, 7);

  fillWeek(past, weekSlots(peopleMap, -1));
  const created = fillWeek(week, weekSlots(peopleMap, 0));
  fillWeek(upcoming, weekSlots(peopleMap, 1));

  const offerable = created.find((s) => s.person_id === anna?.id && s.start === "07:00");
  if (offerable && petr) {
    updateShift(offerable.id, { offered: true });
    insertSwap({
      id: randomUUID(),
      shiftId: offerable.id,
      offeredBy: anna.id,
      status: "open",
      offerReason: "Rodinná oslava v pondělí ráno.",
    });
  }

  const mismatch = created.find((s) => s.person_id === petr?.id && s.start === "07:00");
  if (mismatch && jana) {
    updateShift(mismatch.id, { offered: true });
    insertSwap({
      id: randomUUID(),
      shiftId: mismatch.id,
      offeredBy: petr.id,
      claimedBy: jana.id,
      status: "pending",
      reason: "Lékař v úterý dopoledne, Petrovu směnu zvládnu.",
      offerReason: "Potřebuju to úterý volné.",
    });
  }

  return { ok: true, weekStart: week, from: past, to: addDays(upcoming, 6) };
}

export async function seedWorld() {
  wipeData();
  const week = mondayOf(todayYmd());
  const accounts = [];

  const ownerA = await makeUser("Luka Majitel", "luka");
  const ownerB = await makeUser("Hana Šéfová", "hana");
  const annaAcc = await makeUser("Anna Horáková", "anna");
  const petrAcc = await makeUser("Petr Svoboda", "petr");
  const janaAcc = await makeUser("Jana Králová", "jana");
  const pendingAcc = await makeUser("Tomáš Čeká", "tomas");
  const outsiderAcc = await makeUser("Nora Volná", "nora");

  accounts.push(
    { label: "Owner A (Kavárna Luka + member of Obchod Luka)", ...ownerA },
    { label: "Owner B (Obchod Luka)", ...ownerB },
    { label: "Employee in Kavárna Luka", ...annaAcc },
    { label: "Employee in Kavárna Luka", ...petrAcc },
    { label: "Employee in Kavárna Luka", ...janaAcc },
    { label: "Pending join to Kavárna Luka", ...pendingAcc },
    { label: "No shop yet (try a join code)", ...outsiderAcc },
  );

  const cafe = createShop({
    id: randomUUID(),
    name: "Kavárna Luka",
    lang: "cs",
    kind: "cafe",
    createdBy: ownerA.user.id,
  });
  const shop = createShop({
    id: randomUUID(),
    name: "Obchod Luka",
    lang: "cs",
    kind: "retail",
    createdBy: ownerB.user.id,
  });

  await runWithShop(cafe.id, async () => {
    seedCatalog("cafe", "cs");
    addRole("Vedoucí", true);
    insertPerson({
      id: randomUUID(),
      userId: ownerA.user.id,
      name: ownerA.user.name,
      role: "Barista",
      roles: ["Barista"],
      maxHours: 40,
      email: ownerA.email,
      isOwner: true,
    });
    insertPerson({
      id: randomUUID(),
      userId: annaAcc.user.id,
      name: annaAcc.user.name,
      role: "Barista",
      roles: ["Barista"],
      maxHours: 30,
      email: annaAcc.email,
    });
    insertPerson({
      id: randomUUID(),
      userId: petrAcc.user.id,
      name: petrAcc.user.name,
      role: "Barista",
      roles: ["Barista"],
      maxHours: 40,
      email: petrAcc.email,
    });
    insertPerson({
      id: randomUUID(),
      userId: janaAcc.user.id,
      name: janaAcc.user.name,
      role: "Kuchyně",
      roles: ["Kuchyně"],
      maxHours: 25,
      email: janaAcc.email,
    });
    insertPerson({
      id: randomUUID(),
      name: "Eva Nováková",
      role: "Vedoucí",
      roles: ["Vedoucí"],
      maxHours: 40,
      email: "",
      elevated: true,
    });
    insertPerson({
      id: randomUUID(),
      name: "Marek Dvořák",
      role: "Sál",
      roles: ["Sál"],
      maxHours: 35,
      email: "",
    });
    insertPerson({
      id: randomUUID(),
      name: "Klára Malá",
      role: "Pokladna",
      roles: ["Pokladna"],
      maxHours: 28,
      email: "",
    });
    insertJoinRequest({
      id: randomUUID(),
      shopId: cafe.id,
      userId: pendingAcc.user.id,
      name: pendingAcc.user.name,
      email: pendingAcc.email,
    });
    await seedTestData(week);
  });

  await runWithShop(shop.id, async () => {
    seedCatalog("retail", "cs");
    insertPerson({
      id: randomUUID(),
      userId: ownerB.user.id,
      name: ownerB.user.name,
      role: "Prodejna",
      roles: ["Prodejna"],
      maxHours: 40,
      email: ownerB.email,
      isOwner: true,
    });
    insertPerson({
      id: randomUUID(),
      userId: ownerA.user.id,
      name: ownerA.user.name,
      role: "Pokladna",
      roles: ["Pokladna"],
      maxHours: 20,
      email: ownerA.email,
    });
  });

  return {
    ok: true,
    weekStart: week,
    from: addDays(week, -7),
    to: addDays(week, 13),
    accounts,
    shops: [
      { name: cafe.name, joinCode: cafe.join_code },
      { name: shop.name, joinCode: shop.join_code },
    ],
  };
}
