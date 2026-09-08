import { randomUUID } from "node:crypto";
import { makePasswordRecord, validateEmail, validatePassword } from "./auth.js";
import {
  currentShopId,
  getUserByEmail,
  insertUser,
  linkInvitesToUser,
  listOpenInvitesByEmail,
  personForUserInShop,
} from "./db.js";
import { notifyShop } from "./live.js";

export function userLinkForEmail(email) {
  const want = String(email ?? "").trim().toLowerCase();
  if (!want) return { userId: null };
  const existing = getUserByEmail(want);
  if (!existing) return { userId: null };
  if (personForUserInShop(existing.id, currentShopId())) return { error: "already_member" };
  return { userId: existing.id };
}

export function inviteStatus(emailRaw) {
  const email = validateEmail(emailRaw);
  if (typeof email !== "string") return { error: email.error };
  if (getUserByEmail(email)) return { existing: true, email };
  const invites = listOpenInvitesByEmail(email);
  if (invites.length) return { claim: true, email, name: invites[0].name };
  return { none: true, email };
}

export async function claimInvite(emailRaw, passwordRaw) {
  const status = inviteStatus(emailRaw);
  if (status.error) return status;
  if (!status.claim) return { error: "login_wrong" };
  const password = validatePassword(passwordRaw);
  if (typeof password !== "string") return { error: password.error };
  const record = await makePasswordRecord(password);
  if (record.error) return record;
  const user = insertUser({
    id: randomUUID(),
    email: status.email,
    name: status.name,
    passwordHash: record.passwordHash,
    passwordSalt: record.passwordSalt,
  });
  notifyLinkedShops(linkInvitesToUser(user.id, status.email));
  return { user };
}

export function linkInvitesAfterSignup(userId, email) {
  notifyLinkedShops(linkInvitesToUser(userId, email));
}

function notifyLinkedShops(shopIds) {
  for (const id of shopIds || []) notifyShop(id);
}
