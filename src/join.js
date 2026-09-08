import { randomUUID } from "node:crypto";
import {
  currentShopId,
  getJoinRequest,
  getPendingJoin,
  getShopByJoinCode,
  getUser,
  insertJoinRequest,
  insertPerson,
  listRoles,
  nowIso,
  personForUserInShop,
  updateJoinRequest,
} from "./db.js";
import { ensureRole } from "./catalog.js";
import { isTitleNotJob } from "./kinds.js";
import { notifyShop } from "./live.js";
import { savePerson } from "./swap.js";

function defaultStaffRole() {
  const jobs = listRoles().filter((r) => !r.elevated && !isTitleNotJob(r.name));
  if (jobs[0]) return jobs[0].name;
  const any = listRoles().find((r) => !r.elevated);
  return any?.name || "Staff";
}

function hasRoleInput(body) {
  if (!body) return false;
  if (body.role || body.extraRole) return true;
  if (Array.isArray(body.roles)) return body.roles.some((r) => String(r ?? "").trim());
  return Boolean(String(body.roles ?? "").trim());
}

export function requestJoin(user, codeRaw) {
  const shop = getShopByJoinCode(codeRaw);
  if (!shop) return { error: "join_code" };
  if (personForUserInShop(user.id, shop.id)) return { error: "already_member" };
  if (getPendingJoin(shop.id, user.id)) return { error: "join_pending" };
  insertJoinRequest({
    id: randomUUID(),
    shopId: shop.id,
    userId: user.id,
    name: user.name,
    email: user.email,
  });
  notifyShop(shop.id);
  return { ok: true, shopName: shop.name };
}

export function approveJoin(requestId, body = {}) {
  const row = getJoinRequest(requestId);
  if (!row || row.status !== "pending") return { error: "not_found" };
  if (row.shop_id !== currentShopId()) return { error: "not_found" };
  if (personForUserInShop(row.user_id, row.shop_id)) {
    updateJoinRequest(row.id, { status: "approved", resolvedAt: nowIso() });
    notifyShop(row.shop_id);
    return { ok: true };
  }
  const user = getUser(row.user_id);
  if (!user) return { error: "not_found" };

  let parsed;
  if (hasRoleInput(body) || body.name || body.maxHours != null || body.email) {
    parsed = savePerson({
      name: body.name || user.name,
      email: body.email ?? user.email,
      maxHours: body.maxHours ?? 40,
      roles: body.roles,
      extraRole: body.extraRole,
      role: body.role,
    });
    if (parsed.error) return parsed;
  } else {
    const role = defaultStaffRole();
    parsed = { name: user.name, email: user.email, maxHours: 40, role, roles: [role] };
  }

  for (const role of parsed.roles) ensureRole(role);
  const person = insertPerson({
    id: randomUUID(),
    shopId: row.shop_id,
    userId: user.id,
    name: parsed.name,
    role: parsed.role,
    roles: parsed.roles,
    maxHours: parsed.maxHours ?? 40,
    email: parsed.email,
    isOwner: false,
    elevated: Boolean(body.elevated),
  });
  updateJoinRequest(row.id, { status: "approved", resolvedAt: nowIso() });
  notifyShop(row.shop_id);
  return { ok: true, personId: person.id };
}

export function rejectJoin(requestId) {
  const row = getJoinRequest(requestId);
  if (!row || row.status !== "pending") return { error: "not_found" };
  if (row.shop_id !== currentShopId()) return { error: "not_found" };
  updateJoinRequest(row.id, { status: "rejected", resolvedAt: nowIso() });
  notifyShop(row.shop_id);
  return { ok: true };
}
