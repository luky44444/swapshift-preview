import { randomBytes } from "node:crypto";
import { newSessionToken } from "./auth.js";
import { insertSession, openDb, previewHomeShopId, previewOwnerUser, runWithDb } from "./db.js";
import { seedWorld } from "./seed.js";

export const PREVIEW_COOKIE = "swapshift_preview";

const MAX_SANDBOXES = 80;
const TTL_MS = 45 * 60 * 1000;
const sandboxes = new Map();

export function previewIdFrom(req) {
  return previewIdFromCookieHeader(req.headers.cookie ?? "");
}

export function previewIdFromCookieHeader(header) {
  for (const part of String(header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === PREVIEW_COOKIE) return rest.join("=").trim();
  }
  return "";
}

export function newPreviewId() {
  return randomBytes(16).toString("hex");
}

function closeBox(id) {
  const box = sandboxes.get(id);
  sandboxes.delete(id);
  try {
    box?.db?.close();
  } catch {
    /* already closed */
  }
}

function evict() {
  const now = Date.now();
  for (const [id, box] of sandboxes) {
    if (now - box.lastSeen > TTL_MS) closeBox(id);
  }
  while (sandboxes.size >= MAX_SANDBOXES) {
    let oldestId = null;
    let oldest = Infinity;
    for (const [id, box] of sandboxes) {
      if (box.lastSeen < oldest) {
        oldest = box.lastSeen;
        oldestId = id;
      }
    }
    if (!oldestId) break;
    closeBox(oldestId);
  }
}

export async function seedPreview(database) {
  return runWithDb(database, async () => {
    await seedWorld();
    const owner = previewOwnerUser();
    if (!owner) throw new Error("preview owner missing");
    const shopId = previewHomeShopId(owner.id);
    const token = newSessionToken();
    insertSession(token, owner.id, { shopId, remember: false });
    return { token, userId: owner.id, shopId };
  });
}

async function seedBox() {
  const db = openDb(":memory:");
  const session = await seedPreview(db);
  return { db, ...session };
}

async function loadPreview(id, { reset }) {
  evict();
  const missing = !sandboxes.has(id);
  if (reset || missing) {
    closeBox(id);
    const seeded = await seedBox();
    sandboxes.set(id, { ...seeded, lastSeen: Date.now() });
    return { id, fresh: true, ...sandboxes.get(id) };
  }
  const box = sandboxes.get(id);
  box.lastSeen = Date.now();
  return { id, fresh: false, ...box };
}

export async function runWithPreview(req, { reset }, fn) {
  const id = previewIdFrom(req) || newPreviewId();
  const box = await loadPreview(id, { reset });
  return runWithDb(box.db, () => fn(box));
}
