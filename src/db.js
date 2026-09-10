import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomInt } from "node:crypto";
import { DoSqlite } from "./do-sqlite.js";

const DatabaseSync = await loadNodeSqlite();

async function loadNodeSqlite() {
  try {
    const spec = "node:" + "sqlite";
    return (await import(spec)).DatabaseSync;
  } catch {
    return null;
  }
}

let db;
let fallbackShopId = null;
const als = new AsyncLocalStorage();

const JOIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function getDb() {
  const fromAls = als.getStore()?.db;
  const active = fromAls || db;
  if (!active) throw new Error("database not open");
  return active;
}

export function runWithDb(database, fn) {
  const parent = als.getStore() || {};
  return als.run({ ...parent, db: database }, fn);
}

export function runWithShop(shopId, fn) {
  const parent = als.getStore() || {};
  return als.run({ ...parent, shopId }, fn);
}

export function currentShopId() {
  const store = als.getStore();
  if (store) return store.shopId || null;
  return fallbackShopId || null;
}

function requireShopId() {
  const id = currentShopId();
  if (!id) throw new Error("no shop");
  return id;
}

function tableExists(database, name) {
  return Boolean(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function createSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shops (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      lang TEXT NOT NULL DEFAULT 'cs',
      kind TEXT NOT NULL DEFAULT 'cafe',
      category_id TEXT,
      theme TEXT NOT NULL DEFAULT 'system',
      join_code TEXT NOT NULL UNIQUE,
      hours_cap INTEGER NOT NULL DEFAULT 1,
      overtime_on INTEGER NOT NULL DEFAULT 0,
      stats_reset_day INTEGER NOT NULL DEFAULT 1,
      stats_period_start TEXT,
      stats_period_end TEXT,
      stats_hold INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (shop_id) REFERENCES shops(id)
    );
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      name TEXT NOT NULL,
      elevated INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (shop_id) REFERENCES shops(id)
    );
    CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      user_id TEXT,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      max_hours REAL NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      is_owner INTEGER NOT NULL DEFAULT 0,
      elevated INTEGER NOT NULL DEFAULT 0,
      left_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (shop_id) REFERENCES shops(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_people_shop_user ON people(shop_id, user_id) WHERE user_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      shop_id TEXT,
      remember INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS join_requests (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      FOREIGN KEY (shop_id) REFERENCES shops(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_join_pending ON join_requests(shop_id, user_id) WHERE status = 'pending';
    CREATE TABLE IF NOT EXISTS shifts (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      week_start TEXT NOT NULL,
      date TEXT NOT NULL,
      start TEXT NOT NULL,
      end TEXT NOT NULL,
      role TEXT NOT NULL,
      person_id TEXT,
      offered INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (shop_id) REFERENCES shops(id),
      FOREIGN KEY (person_id) REFERENCES people(id)
    );
    CREATE TABLE IF NOT EXISTS swaps (
      id TEXT PRIMARY KEY,
      shift_id TEXT NOT NULL,
      offered_by TEXT NOT NULL,
      claimed_by TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      reason TEXT NOT NULL DEFAULT '',
      offer_reason TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (shift_id) REFERENCES shifts(id),
      FOREIGN KEY (offered_by) REFERENCES people(id),
      FOREIGN KEY (claimed_by) REFERENCES people(id)
    );
    CREATE INDEX IF NOT EXISTS idx_shifts_week ON shifts(shop_id, week_start);
    CREATE INDEX IF NOT EXISTS idx_swaps_status ON swaps(status);
    CREATE TABLE IF NOT EXISTS person_roles (
      person_id TEXT NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY (person_id, role),
      FOREIGN KEY (person_id) REFERENCES people(id)
    );
    CREATE TABLE IF NOT EXISTS notices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      shop_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      read_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_notices_user ON notices(user_id, read_at);
  `);
}

export function openDb(path = ":memory:", sqlStorage = null, durableStorage = null) {
  if (sqlStorage) {
    const database = new DoSqlite(sqlStorage, durableStorage);
    prepareOpenedDb(database, true);
    return database;
  }
  if (!DatabaseSync) throw new Error("sqlite backend missing");
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const database = new DatabaseSync(path);
  prepareOpenedDb(database, path === ":memory:");
  return database;
}

function prepareOpenedDb(database, memory) {
  if (!memory) database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  if (!tableExists(database, "users") || !tableExists(database, "shops")) {
    database.exec("PRAGMA foreign_keys = OFF");
    for (const name of [
      "person_roles",
      "swaps",
      "shifts",
      "sessions",
      "people",
      "roles",
      "categories",
      "join_requests",
      "notices",
      "shop",
      "shops",
      "users",
    ]) {
      database.exec(`DROP TABLE IF EXISTS ${name}`);
    }
    database.exec("PRAGMA foreign_keys = ON");
  }
  createSchema(database);
  const shopCols = database.prepare("PRAGMA table_info(shops)").all();
  if (!shopCols.some((col) => col.name === "hours_cap")) {
    database.exec("ALTER TABLE shops ADD COLUMN hours_cap INTEGER NOT NULL DEFAULT 1");
  }
  if (!shopCols.some((col) => col.name === "stats_reset_day")) {
    database.exec("ALTER TABLE shops ADD COLUMN stats_reset_day INTEGER NOT NULL DEFAULT 1");
  }
  if (!shopCols.some((col) => col.name === "stats_period_start")) {
    database.exec("ALTER TABLE shops ADD COLUMN stats_period_start TEXT");
  }
  if (!shopCols.some((col) => col.name === "stats_period_end")) {
    database.exec("ALTER TABLE shops ADD COLUMN stats_period_end TEXT");
  }
  if (!shopCols.some((col) => col.name === "stats_hold")) {
    database.exec("ALTER TABLE shops ADD COLUMN stats_hold INTEGER NOT NULL DEFAULT 0");
  }
  if (!shopCols.some((col) => col.name === "overtime_on")) {
    database.exec("ALTER TABLE shops ADD COLUMN overtime_on INTEGER NOT NULL DEFAULT 0");
  }
  const peopleCols = database.prepare("PRAGMA table_info(people)").all();
  if (!peopleCols.some((col) => col.name === "left_at")) {
    database.exec("ALTER TABLE people ADD COLUMN left_at TEXT");
  }
  return database;
}

export function initDb(path = process.env.SWAPSHIFT_DB ?? ".data/swapshift.db") {
  db = openDb(path);
  fallbackShopId = getDb().prepare("SELECT id FROM shops LIMIT 1").get()?.id ?? null;
  return db;
}

export function wipeData() {
  getDb().exec("PRAGMA foreign_keys = OFF");
  getDb().exec(`
    DELETE FROM person_roles;
    DELETE FROM swaps;
    DELETE FROM shifts;
    DELETE FROM join_requests;
    DELETE FROM notices;
    DELETE FROM sessions;
    DELETE FROM people;
    DELETE FROM roles;
    DELETE FROM categories;
    DELETE FROM shops;
    DELETE FROM users;
  `);
  getDb().exec("PRAGMA foreign_keys = ON");
  fallbackShopId = null;
}

export function nowIso() {
  return new Date().toISOString();
}

export function newJoinCode() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let code = "";
    for (let i = 0; i < 6; i += 1) code += JOIN_ALPHABET[randomInt(JOIN_ALPHABET.length)];
    if (!getDb().prepare("SELECT id FROM shops WHERE join_code = ?").get(code)) return code;
  }
  throw new Error("join_code");
}

export function getShop(id = currentShopId()) {
  if (!id) return null;
  return getDb().prepare("SELECT * FROM shops WHERE id = ?").get(id) ?? null;
}

export function getShopByJoinCode(code) {
  const want = String(code ?? "").trim().toUpperCase();
  if (!want) return null;
  return getDb().prepare("SELECT * FROM shops WHERE join_code = ?").get(want) ?? null;
}

export function createShop({ id, name, lang, kind, categoryId, theme, createdBy, joinCode }) {
  const code = joinCode || newJoinCode();
  getDb().prepare(
    `INSERT INTO shops (id, name, lang, kind, category_id, theme, join_code, hours_cap, overtime_on, stats_reset_day, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    name,
    lang,
    kind ?? "cafe",
    categoryId ?? null,
    theme ?? "system",
    code,
    1,
    0,
    1,
    createdBy ?? null,
    nowIso(),
  );
  if (!currentShopId()) fallbackShopId = id;
  return getShop(id);
}

export function updateShop(patch) {
  const current = getShop();
  if (!current) return null;
  getDb().prepare(
    `UPDATE shops SET name = ?, lang = ?, kind = ?, category_id = ?, theme = ?, join_code = ?, hours_cap = ?,
      overtime_on = ?, stats_reset_day = ?, stats_period_start = ?, stats_period_end = ?, stats_hold = ? WHERE id = ?`,
  ).run(
    patch.name ?? current.name,
    patch.lang ?? current.lang,
    patch.kind ?? current.kind,
    patch.categoryId === undefined ? current.category_id : patch.categoryId,
    patch.theme ?? current.theme,
    patch.joinCode ?? current.join_code,
    patch.hoursCap === undefined ? current.hours_cap : Number(patch.hoursCap) ? 1 : 0,
    current.overtime_on,
    patch.statsResetDay === undefined ? current.stats_reset_day : patch.statsResetDay,
    patch.statsPeriodStart === undefined ? current.stats_period_start : patch.statsPeriodStart,
    patch.statsPeriodEnd === undefined ? current.stats_period_end : patch.statsPeriodEnd,
    patch.statsHold === undefined ? current.stats_hold : patch.statsHold ? 1 : 0,
    current.id,
  );
  return getShop(current.id);
}

export function regenerateJoinCode() {
  return updateShop({ joinCode: newJoinCode() });
}

export function listCategories() {
  return getDb()
    .prepare("SELECT * FROM categories WHERE shop_id = ? ORDER BY name COLLATE NOCASE")
    .all(requireShopId());
}

export function getCategory(id) {
  return getDb().prepare("SELECT * FROM categories WHERE id = ? AND shop_id = ?").get(id, requireShopId()) ?? null;
}

export function insertCategory(row) {
  const shopId = row.shopId || requireShopId();
  getDb().prepare("INSERT INTO categories (id, shop_id, name, created_at) VALUES (?, ?, ?, ?)").run(
    row.id,
    shopId,
    row.name,
    nowIso(),
  );
  return getCategory(row.id) || getDb().prepare("SELECT * FROM categories WHERE id = ?").get(row.id);
}

export function updateCategory(id, name) {
  getDb().prepare("UPDATE categories SET name = ? WHERE id = ? AND shop_id = ?").run(name, id, requireShopId());
  return getCategory(id);
}

export function deleteCategory(id) {
  getDb().prepare("DELETE FROM categories WHERE id = ? AND shop_id = ?").run(id, requireShopId());
}

export function listRoles() {
  return getDb()
    .prepare("SELECT * FROM roles WHERE shop_id = ? ORDER BY elevated DESC, name COLLATE NOCASE")
    .all(requireShopId());
}

export function getRole(id) {
  return getDb().prepare("SELECT * FROM roles WHERE id = ? AND shop_id = ?").get(id, requireShopId()) ?? null;
}

export function findRoleByName(name) {
  const want = String(name ?? "").trim().toLowerCase();
  return listRoles().find((r) => r.name.trim().toLowerCase() === want) ?? null;
}

export function insertRole(row) {
  const shopId = row.shopId || requireShopId();
  getDb().prepare("INSERT INTO roles (id, shop_id, name, elevated, created_at) VALUES (?, ?, ?, ?, ?)").run(
    row.id,
    shopId,
    row.name,
    row.elevated ? 1 : 0,
    nowIso(),
  );
  return getDb().prepare("SELECT * FROM roles WHERE id = ?").get(row.id);
}

export function updateRoleRow(id, { name, elevated }) {
  const current = getRole(id);
  if (!current) return null;
  getDb().prepare("UPDATE roles SET name = ?, elevated = ? WHERE id = ?").run(
    name ?? current.name,
    elevated == null ? current.elevated : elevated ? 1 : 0,
    id,
  );
  return getRole(id);
}

export function deleteRole(id) {
  getDb().prepare("DELETE FROM roles WHERE id = ? AND shop_id = ?").run(id, requireShopId());
}

export function renameRoleEverywhere(oldName, newName) {
  const shopId = requireShopId();
  getDb().prepare("UPDATE people SET role = ? WHERE shop_id = ? AND role = ?").run(newName, shopId, oldName);
  getDb().prepare("UPDATE shifts SET role = ? WHERE shop_id = ? AND role = ?").run(newName, shopId, oldName);
  getDb().prepare(
    `UPDATE person_roles SET role = ? WHERE role = ? AND person_id IN (SELECT id FROM people WHERE shop_id = ?)`,
  ).run(newName, oldName, shopId);
}

export function roleInUse(name) {
  const shopId = requireShopId();
  const people = getDb().prepare("SELECT COUNT(*) AS n FROM people WHERE shop_id = ? AND role = ?").get(shopId, name).n;
  const extra = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM person_roles pr JOIN people p ON p.id = pr.person_id WHERE p.shop_id = ? AND pr.role = ?`,
    )
    .get(shopId, name).n;
  const shifts = getDb().prepare("SELECT COUNT(*) AS n FROM shifts WHERE shop_id = ? AND role = ?").get(shopId, name).n;
  return people + extra + shifts > 0;
}

export function listPersonRoles(personId) {
  if (!personId) return [];
  const rows = getDb().prepare("SELECT role FROM person_roles WHERE person_id = ? ORDER BY role COLLATE NOCASE").all(personId);
  if (rows.length) return rows.map((r) => r.role);
  const person = getPerson(personId);
  return person?.role ? [person.role] : [];
}

export function setPersonRoles(personId, rolesRaw) {
  const roles = [];
  for (const raw of rolesRaw || []) {
    const name = String(raw ?? "").trim();
    if (!name) continue;
    if (!roles.some((r) => r.toLowerCase() === name.toLowerCase())) roles.push(name);
  }
  if (!roles.length) return listPersonRoles(personId);
  getDb().prepare("DELETE FROM person_roles WHERE person_id = ?").run(personId);
  const insert = getDb().prepare("INSERT INTO person_roles (person_id, role) VALUES (?, ?)");
  for (const role of roles) insert.run(personId, role);
  getDb().prepare("UPDATE people SET role = ? WHERE id = ?").run(roles[0], personId);
  return roles;
}

export function canManage(person) {
  if (!person) return false;
  if (person.is_owner) return true;
  if (person.elevated) return true;
  const names = person.id ? listPersonRoles(person.id) : person.role ? [person.role] : [];
  return names.some((name) => Boolean(findRoleByName(name)?.elevated));
}

export function insertUser(row) {
  getDb().prepare(
    `INSERT INTO users (id, email, name, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.email, row.name, row.passwordHash, row.passwordSalt, nowIso());
  return getUser(row.id);
}

export function getUser(id) {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) ?? null;
}

export function getUserByEmail(email) {
  return getDb().prepare("SELECT * FROM users WHERE email = ?").get(String(email ?? "").trim().toLowerCase()) ?? null;
}

export function insertNotice(row) {
  getDb().prepare(
    `INSERT INTO notices (id, user_id, kind, shop_name, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.userId, row.kind, row.shopName || "", row.createdAt || nowIso(), row.readAt ?? null);
}

export function listUnreadNotices(userId) {
  return getDb()
    .prepare("SELECT * FROM notices WHERE user_id = ? AND read_at IS NULL ORDER BY created_at")
    .all(userId)
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      shopName: row.shop_name,
      createdAt: row.created_at,
    }));
}

export function ackNotices(userId, ids) {
  const list = Array.isArray(ids) ? ids : [];
  const stmt = getDb().prepare("UPDATE notices SET read_at = ? WHERE user_id = ? AND id = ? AND read_at IS NULL");
  const now = nowIso();
  for (const id of list.slice(0, 50)) {
    const noticeId = String(id ?? "").trim();
    if (noticeId) stmt.run(now, userId, noticeId);
  }
}

export function insertPerson(row) {
  const shopId = row.shopId || requireShopId();
  getDb().prepare(
    `INSERT INTO people (id, shop_id, user_id, name, role, max_hours, email, is_owner, elevated, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    shopId,
    row.userId || null,
    row.name,
    row.role,
    row.maxHours,
    row.email ?? "",
    row.isOwner ? 1 : 0,
    row.elevated ? 1 : 0,
    nowIso(),
  );
  setPersonRoles(row.id, row.roles?.length ? row.roles : [row.role]);
  return getPerson(row.id);
}

export function updatePerson(id, patch) {
  const current = getPerson(id);
  if (!current) return null;
  getDb().prepare(
    `UPDATE people SET name = ?, role = ?, max_hours = ?, email = ?, elevated = ?, user_id = ?, left_at = ?
     WHERE id = ?`,
  ).run(
    patch.name ?? current.name,
    patch.role ?? current.role,
    patch.maxHours ?? current.max_hours,
    patch.email ?? current.email,
    patch.elevated === undefined ? current.elevated : patch.elevated ? 1 : 0,
    patch.userId === undefined ? current.user_id : patch.userId || null,
    patch.leftAt === undefined ? current.left_at : patch.leftAt,
    id,
  );
  if (patch.roles) setPersonRoles(id, patch.roles);
  return getPerson(id);
}

export function getPerson(id) {
  if (!id) return null;
  const shopId = currentShopId();
  if (shopId) {
    return getDb().prepare("SELECT * FROM people WHERE id = ? AND shop_id = ?").get(id, shopId) ?? null;
  }
  return getDb().prepare("SELECT * FROM people WHERE id = ?").get(id) ?? null;
}

export function personForUserInShop(userId, shopId) {
  if (!userId || !shopId) return null;
  return getDb().prepare("SELECT * FROM people WHERE user_id = ? AND shop_id = ? AND left_at IS NULL").get(userId, shopId) ?? null;
}

export function listOpenInvitesByEmail(email) {
  const want = String(email ?? "").trim().toLowerCase();
  if (!want) return [];
  return getDb()
    .prepare(
      `SELECT * FROM people WHERE lower(email) = ? AND (user_id IS NULL OR user_id = '') AND left_at IS NULL`,
    )
    .all(want);
}

export function linkInvitesToUser(userId, email) {
  const want = String(email ?? "").trim().toLowerCase();
  const shops = getDb()
    .prepare(
      `SELECT DISTINCT shop_id AS shopId FROM people
       WHERE lower(email) = ? AND (user_id IS NULL OR user_id = '') AND left_at IS NULL`,
    )
    .all(want);
  getDb().prepare(
    `UPDATE people SET user_id = ? WHERE lower(email) = ? AND (user_id IS NULL OR user_id = '') AND left_at IS NULL`,
  ).run(userId, want);
  return shops.map((row) => row.shopId);
}

export function listShiftsForPersonFrom(personId, fromDate) {
  return getDb()
    .prepare("SELECT * FROM shifts WHERE shop_id = ? AND person_id = ? AND date >= ?")
    .all(requireShopId(), personId, fromDate);
}

export function listActiveSwapsForShift(shiftId) {
  return getDb()
    .prepare("SELECT * FROM swaps WHERE shift_id = ? AND status IN ('open', 'pending')")
    .all(shiftId);
}

export function listPeople() {
  return getDb()
    .prepare("SELECT * FROM people WHERE shop_id = ? ORDER BY is_owner DESC, name COLLATE NOCASE")
    .all(requireShopId());
}

export function listShopsForUser(userId) {
  return getDb()
    .prepare(
      `SELECT sh.*, p.id AS person_id, p.is_owner, p.role, p.elevated
       FROM people p JOIN shops sh ON sh.id = p.shop_id
       WHERE p.user_id = ? AND p.left_at IS NULL
       ORDER BY p.is_owner DESC, sh.name COLLATE NOCASE`,
    )
    .all(userId);
}

export function insertSession(token, userId, { shopId, remember } = {}) {
  const now = nowIso();
  getDb().prepare(
    "INSERT INTO sessions (token, user_id, shop_id, remember, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(token, userId, shopId ?? null, remember ? 1 : 0, now, now);
}

export function getSession(token) {
  if (!token) return null;
  return getDb().prepare("SELECT * FROM sessions WHERE token = ?").get(token) ?? null;
}

export function userFromSession(token) {
  if (!token) return null;
  return (
    getDb()
      .prepare(
        `SELECT u.*, s.shop_id AS session_shop_id, s.remember
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
      )
      .get(token) ?? null
  );
}

export function updateSessionShop(token, shopId) {
  if (!token) return;
  getDb().prepare("UPDATE sessions SET shop_id = ?, last_seen = ? WHERE token = ?").run(shopId, nowIso(), token);
}

export function deleteSession(token) {
  if (!token) return;
  getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function insertJoinRequest(row) {
  getDb().prepare(
    `INSERT INTO join_requests (id, shop_id, user_id, name, email, status, created_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.shopId, row.userId, row.name, row.email, row.status || "pending", nowIso(), null);
  return getJoinRequest(row.id);
}

export function getJoinRequest(id) {
  return getDb().prepare("SELECT * FROM join_requests WHERE id = ?").get(id) ?? null;
}

export function getPendingJoin(shopId, userId) {
  return (
    getDb()
      .prepare("SELECT * FROM join_requests WHERE shop_id = ? AND user_id = ? AND status = 'pending'")
      .get(shopId, userId) ?? null
  );
}

export function listPendingJoinsForShop(shopId = currentShopId()) {
  if (!shopId) return [];
  return getDb()
    .prepare("SELECT * FROM join_requests WHERE shop_id = ? AND status = 'pending' ORDER BY created_at ASC")
    .all(shopId);
}

export function listPendingJoinsForUser(userId) {
  return getDb()
    .prepare(
      `SELECT jr.*, sh.name AS shop_name, sh.join_code
       FROM join_requests jr JOIN shops sh ON sh.id = jr.shop_id
       WHERE jr.user_id = ? AND jr.status = 'pending'
       ORDER BY jr.created_at DESC`,
    )
    .all(userId);
}

export function updateJoinRequest(id, patch) {
  const current = getJoinRequest(id);
  if (!current) return null;
  getDb().prepare("UPDATE join_requests SET status = ?, resolved_at = ? WHERE id = ?").run(
    patch.status ?? current.status,
    patch.resolvedAt === undefined ? current.resolved_at : patch.resolvedAt,
    id,
  );
  return getJoinRequest(id);
}

export function insertShift(row) {
  const shopId = row.shopId || requireShopId();
  getDb().prepare(
    `INSERT INTO shifts (id, shop_id, week_start, date, start, end, role, person_id, offered, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  ).run(row.id, shopId, row.weekStart, row.date, row.start, row.end, row.role, row.personId || null, nowIso());
  return getShift(row.id);
}

export function getShift(id) {
  const shopId = currentShopId();
  if (shopId) {
    return getDb().prepare("SELECT * FROM shifts WHERE id = ? AND shop_id = ?").get(id, shopId) ?? null;
  }
  return getDb().prepare("SELECT * FROM shifts WHERE id = ?").get(id) ?? null;
}

export function listShifts(weekStart) {
  return getDb()
    .prepare("SELECT * FROM shifts WHERE shop_id = ? AND week_start = ? ORDER BY date, start, role")
    .all(requireShopId(), weekStart);
}

export function listShiftsBetween(from, to) {
  return getDb()
    .prepare("SELECT * FROM shifts WHERE shop_id = ? AND date >= ? AND date <= ? ORDER BY date, start, role")
    .all(requireShopId(), from, to);
}

export function updateShift(id, patch) {
  const current = getShift(id);
  if (!current) return null;
  getDb().prepare(
    `UPDATE shifts SET date = ?, start = ?, end = ?, role = ?, person_id = ?, week_start = ?, offered = ?
     WHERE id = ?`,
  ).run(
    patch.date ?? current.date,
    patch.start ?? current.start,
    patch.end ?? current.end,
    patch.role ?? current.role,
    patch.personId === undefined ? current.person_id : patch.personId || null,
    patch.weekStart ?? current.week_start,
    patch.offered == null ? current.offered : patch.offered ? 1 : 0,
    id,
  );
  return getShift(id);
}

export function deleteShift(id) {
  getDb().prepare("DELETE FROM swaps WHERE shift_id = ?").run(id);
  getDb().prepare("DELETE FROM shifts WHERE id = ?").run(id);
}

export function insertSwap(row) {
  getDb().prepare(
    `INSERT INTO swaps (id, shift_id, offered_by, claimed_by, status, created_at, resolved_at, reason, offer_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.shiftId,
    row.offeredBy,
    row.claimedBy ?? null,
    row.status,
    nowIso(),
    row.resolvedAt ?? null,
    row.reason ?? "",
    row.offerReason ?? "",
  );
  return getSwap(row.id);
}

export function getSwap(id) {
  return getDb().prepare("SELECT * FROM swaps WHERE id = ?").get(id) ?? null;
}

export function openSwapForShift(shiftId) {
  return (
    getDb().prepare("SELECT * FROM swaps WHERE shift_id = ? AND status IN ('open', 'pending') LIMIT 1").get(shiftId) ?? null
  );
}

export function updateSwap(id, patch) {
  const current = getSwap(id);
  if (!current) return null;
  getDb().prepare(
    `UPDATE swaps SET claimed_by = ?, status = ?, resolved_at = ?, reason = ?, offer_reason = ? WHERE id = ?`,
  ).run(
    patch.claimedBy === undefined ? current.claimed_by : patch.claimedBy,
    patch.status ?? current.status,
    patch.resolvedAt === undefined ? current.resolved_at : patch.resolvedAt,
    patch.reason === undefined ? current.reason ?? "" : patch.reason,
    patch.offerReason === undefined ? current.offer_reason ?? "" : patch.offerReason,
    id,
  );
  return getSwap(id);
}

export function listSwapsBetween(from, to) {
  return getDb()
    .prepare(
      `SELECT sw.* FROM swaps sw
       JOIN shifts sh ON sh.id = sw.shift_id
       WHERE sh.shop_id = ? AND sh.date >= ? AND sh.date <= ?
       ORDER BY sw.created_at DESC`,
    )
    .all(requireShopId(), from, to);
}

export function listPendingSwaps() {
  return getDb()
    .prepare(
      `SELECT sw.* FROM swaps sw
       JOIN shifts sh ON sh.id = sw.shift_id
       WHERE sh.shop_id = ? AND sw.status = 'pending'
       ORDER BY sw.created_at ASC`,
    )
    .all(requireShopId());
}

export function pendingCount() {
  const shopId = requireShopId();
  const swaps = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM swaps sw JOIN shifts sh ON sh.id = sw.shift_id
       WHERE sh.shop_id = ? AND sw.status = 'pending'`,
    )
    .get(shopId).n;
  const joins = getDb()
    .prepare("SELECT COUNT(*) AS n FROM join_requests WHERE shop_id = ? AND status = 'pending'")
    .get(shopId).n;
  return swaps + joins;
}

export function withTx(fn) {
  const database = getDb();
  if (typeof database.storage?.transactionSync === "function") {
    return database.storage.transactionSync(fn);
  }
  if (database.noExplicitTx) return fn();
  database.exec("BEGIN");
  try {
    const result = fn();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function previewOwnerUser() {
  return (
    getDb()
      .prepare(
        `SELECT u.* FROM users u
         JOIN people p ON p.user_id = u.id
         WHERE p.is_owner = 1
         ORDER BY p.created_at ASC
         LIMIT 1`,
      )
      .get() ?? null
  );
}

export function previewHomeShopId(userId) {
  if (!userId) return "";
  return (
    getDb()
      .prepare(
        `SELECT shop_id FROM people
         WHERE user_id = ? AND is_owner = 1 AND left_at IS NULL
         ORDER BY created_at ASC
         LIMIT 1`,
      )
      .get(userId)?.shop_id || ""
  );
}
