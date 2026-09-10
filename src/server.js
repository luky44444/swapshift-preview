import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import {
  allowAttempt,
  makePasswordRecord,
  newSessionToken,
  passwordMatches,
  sessionCookieName,
  validateEmail,
  validateFullName,
  validatePassword,
} from "./auth.js";
import {
  canManage,
  createShop,
  currentShopId,
  deleteSession,
  getPerson,
  getSession,
  getShop,
  getUserByEmail,
  insertPerson,
  insertSession,
  insertUser,
  listPendingJoinsForUser,
  listShopsForUser,
  listUnreadNotices,
  ackNotices,
  personForUserInShop,
  pendingCount,
  regenerateJoinCode,
  runWithDb,
  runWithShop,
  updatePerson,
  updateSessionShop,
  updateShop,
  userFromSession,
} from "./db.js";
import { addDays, mondayOf, todayYmd } from "./hours.js";
import { parseKind } from "./kinds.js";
import {
    addRole,
    applyKind,
    addCategory,
    editCategory,
    editRole,
    ensureRole,
    removeCategoryById,
    removeRoleById,
    seedCatalog,
} from "./catalog.js";
import { seedTestData } from "./seed.js";
import { PREVIEW_COOKIE, runWithPreview } from "./preview.js";
import { approveJoin, rejectJoin, requestJoin } from "./join.js";
import { notifyShop, shopRevision, subscribeShop } from "./live.js";
import { notify } from "./mail.js";
import { claimInvite, inviteStatus, linkInvitesAfterSignup, userLinkForEmail } from "./invite.js";
import { applyResetDay, setCurrentPeriod, statsFor } from "./stats.js";
import {
  addShift,
  cancelOffer,
  claimShift,
  copyDay,
  decideSwap,
  editShift,
  findClashes,
  kickPerson,
  loadState,
  offerShift,
  removeShift,
  savePerson,
} from "./swap.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
const PUBLIC_DIR = join(import.meta.dirname || ".", "../public");
const REMEMBER_MAX_AGE = 30 * 24 * 60 * 60;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  const isJson = typeof body !== "string" && !Buffer.isBuffer(body);
  res.writeHead(status, {
    "content-type": isJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...withPreviewCookies(res, headers),
  });
  res.end(payload);
}

function isHttps(req) {
  if (process.env.NODE_ENV === "production") return true;
  const proto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  return proto === "https";
}

function cookieHeader(req, token, remember) {
  const secure = isHttps(req) ? "; Secure" : "";
  const age = remember ? `; Max-Age=${REMEMBER_MAX_AGE}` : "";
  return `${sessionCookieName()}=${token}; HttpOnly; SameSite=Lax; Path=/${age}${secure}`;
}

function clearCookieHeader(req) {
  const secure = isHttps(req) ? "; Secure" : "";
  return `${sessionCookieName()}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

function withPreviewCookies(res, headers) {
  const extra = res.__previewCookies;
  if (!extra?.length) return headers;
  const existing = headers["set-cookie"];
  return {
    ...headers,
    "set-cookie": existing ? [].concat(existing, extra) : extra,
  };
}

function readCookies(req) {
  const header = req.headers.cookie ?? "";
  const out = {};
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key) out[key] = rest.join("=");
  }
  return out;
}

function sessionToken(req) {
  return readCookies(req)[sessionCookieName()] || "";
}

function currentUser(req) {
  return userFromSession(sessionToken(req));
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = chunks.map(chunkToText).join("");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return Object.fromEntries(new URLSearchParams(raw));
  }
}

function chunkToText(chunk) {
  if (!chunk) return "";
  if (typeof chunk === "string") return chunk;
  if (typeof Buffer !== "undefined") {
    if (chunk instanceof ArrayBuffer) return Buffer.from(new Uint8Array(chunk)).toString("utf8");
    return Buffer.from(chunk).toString("utf8");
  }
  if (chunk instanceof ArrayBuffer) return new TextDecoder().decode(chunk);
  if (chunk instanceof Uint8Array) return new TextDecoder().decode(chunk);
  return String(chunk);
}

function serveStatic(urlPath, res) {
  const relative = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = normalize(join(PUBLIC_DIR, relative));
  if (!filePath.startsWith(normalize(PUBLIC_DIR))) {
    send(res, 403, { error: "forbidden" });
    return;
  }
  if (!existsSync(filePath)) {
    send(res, 404, { error: "not_found" });
    return;
  }
  const type = TYPES[extname(filePath)] ?? "application/octet-stream";
  res.writeHead(200, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...withPreviewCookies(res, {}),
  });
  res.end(readFileSync(filePath));
}

function managerOnly(person) {
  return canManage(person);
}

function weekFrom(url) {
  return mondayOf(url.searchParams.get("week") || todayYmd());
}

function rangeFrom(url) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  if (ymd.test(from || "") && ymd.test(to || "") && from <= to) {
    return { from, to };
  }
  const week = weekFrom(url);
  return { from: week, to: addDays(week, 6) };
}

function stateFor(url, person) {
  return loadState(weekFrom(url), person, rangeFrom(url));
}

function sendShopState(res, url, person) {
  notifyShop(currentShopId());
  send(res, 200, stateFor(url, person));
}

function userView(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email };
}

function shopListFor(user) {
  return listShopsForUser(user.id).map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    isOwner: Boolean(row.is_owner),
    role: row.role,
  }));
}

function pendingJoinsFor(user) {
  return listPendingJoinsForUser(user.id).map((row) => ({
    id: row.id,
    shopId: row.shop_id,
    shopName: row.shop_name,
    status: row.status,
  }));
}

function noticesFor(user) {
  return user ? listUnreadNotices(user.id) : [];
}

function authPayload(user) {
  return {
    user: userView(user),
    shops: shopListFor(user),
    pendingJoins: pendingJoinsFor(user),
    notices: noticesFor(user),
  };
}

function resolveShopId(req, user, hinted) {
  const header = String(req.headers["x-shop-id"] ?? "").trim();
  if (header && personForUserInShop(user.id, header)) return header;
  const hint = String(hinted ?? "").trim();
  if (hint && personForUserInShop(user.id, hint)) return hint;
  const session = getSession(sessionToken(req));
  if (session?.shop_id && personForUserInShop(user.id, session.shop_id)) return session.shop_id;
  return listShopsForUser(user.id)[0]?.id || "";
}

export async function handlePreviewHttp(req, res, injected = null) {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    if (path === "/health") {
      send(res, 200, "ok");
      return;
    }

    const isShell = method === "GET" && (path === "/" || path === "/index.html");
    const isApi = path.startsWith("/api/");
    if (!isShell && !isApi) {
      serveStatic(path, res);
      return;
    }

    const runSession = async (box) => {
      if (box.fresh) {
        const secure = isHttps(req) ? "; Secure" : "";
        res.__previewCookies = [
          `${PREVIEW_COOKIE}=${box.id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600${secure}`,
          cookieHeader(req, box.token, false),
        ];
      }

      const user = currentUser(req);
      const shopId = user ? resolveShopId(req, user, url.searchParams.get("shop")) : "";
      const me = shopId && user ? personForUserInShop(user.id, shopId) : null;

      await runWithShop(shopId || null, async () => {
      if (path.startsWith("/api/")) {
        if (path === "/api/bootstrap" && method === "GET") {
          send(res, 200, {
            user: userView(user),
            shops: user ? shopListFor(user) : [],
            pendingJoins: user ? pendingJoinsFor(user) : [],
            notices: noticesFor(user),
            shopId: me ? shopId : "",
            lang: getShop()?.lang || "cs",
            preview: true,
          });
          return;
        }

        if (
          (path === "/api/signup" ||
            path === "/api/login" ||
            path === "/api/invite" ||
            path === "/api/invite-check") &&
          (method === "POST" || method === "GET")
        ) {
          send(res, 200, { ...authPayload(user), preview: true });
          return;
        }

        if (path === "/api/logout" && method === "POST") {
          send(res, 200, { ok: true, preview: true });
          return;
        }

        if (path === "/api/notices/ack" && method === "POST") {
          if (!user) {
            send(res, 401, { error: "unauthorized" });
            return;
          }
          const body = await readBody(req);
          ackNotices(user.id, body.ids);
          send(res, 200, { ok: true });
          return;
        }

        if (path === "/api/signup" && method === "POST") {
          if (!allowAttempt(clientIp(req))) {
            send(res, 429, { error: "too_many" });
            return;
          }
          const body = await readBody(req);
          const email = validateEmail(body.email);
          const password = validatePassword(body.password);
          const name = validateFullName(body.name);
          if (typeof email !== "string") {
            send(res, 400, { error: email.error });
            return;
          }
          if (typeof password !== "string") {
            send(res, 400, { error: password.error });
            return;
          }
          if (typeof name !== "string") {
            send(res, 400, { error: name.error });
            return;
          }
          if (getUserByEmail(email)) {
            send(res, 400, { error: "email_taken" });
            return;
          }
          const record = await makePasswordRecord(password);
          const created = insertUser({
            id: randomUUID(),
            email,
            name,
            passwordHash: record.passwordHash,
            passwordSalt: record.passwordSalt,
          });
          linkInvitesAfterSignup(created.id, email);
          const token = newSessionToken();
          const remember = Boolean(body.remember);
          insertSession(token, created.id, { remember });
          send(res, 200, authPayload(created), { "set-cookie": cookieHeader(req, token, remember) });
          return;
        }

        if (path === "/api/login" && method === "POST") {
          if (!allowAttempt(clientIp(req))) {
            send(res, 429, { error: "too_many" });
            return;
          }
          const body = await readBody(req);
          const email = validateEmail(body.email);
          if (typeof email !== "string") {
            send(res, 400, { error: email.error });
            return;
          }
          const account = getUserByEmail(email);
          const checking = !body.claim && (body.password == null || body.password === "");
          if (!account) {
            const status = inviteStatus(email);
            if (status.claim) {
              if (!body.claim) {
                send(res, 200, { claim: true, email });
                return;
              }
              const claimed = await claimInvite(email, body.password);
              if (claimed.error) {
                send(res, claimed.error === "login_wrong" ? 401 : 400, { error: claimed.error });
                return;
              }
              const token = newSessionToken();
              const remember = Boolean(body.remember);
              insertSession(token, claimed.user.id, { remember });
              send(res, 200, authPayload(claimed.user), { "set-cookie": cookieHeader(req, token, remember) });
              return;
            }
            if (checking) {
              send(res, 200, { none: true, email });
              return;
            }
            send(res, 401, { error: "login_wrong" });
            return;
          }
          if (checking) {
            send(res, 200, { existing: true, email });
            return;
          }
          const ok = await passwordMatches(body.password, account.password_hash, account.password_salt);
          if (!ok) {
            send(res, 401, { error: "login_wrong" });
            return;
          }
          const token = newSessionToken();
          const remember = Boolean(body.remember);
          insertSession(token, account.id, { remember });
          send(res, 200, authPayload(account), { "set-cookie": cookieHeader(req, token, remember) });
          return;
        }

        if (path === "/api/invite-check" && method === "POST") {
          if (!allowAttempt(clientIp(req))) {
            send(res, 429, { error: "too_many" });
            return;
          }
          const body = await readBody(req);
          const status = inviteStatus(body.email);
          if (status.error) {
            send(res, 400, { error: status.error });
            return;
          }
          if (status.claim) {
            send(res, 200, { claim: true, email: status.email });
            return;
          }
          if (status.existing) {
            send(res, 200, { existing: true, email: status.email });
            return;
          }
          send(res, 200, { none: true, email: status.email });
          return;
        }

        if (!user) {
          send(res, 401, { error: "unauthorized" });
          return;
        }

        if (path === "/api/setup" && method === "POST") {
          const body = await readBody(req);
          const name = String(body.shopName ?? "").trim();
          const ownerName = String(body.ownerName ?? user.name).trim();
          const lang = body.lang === "en" ? "en" : "cs";
          const kind = parseKind(body.kind);
          if (!name) {
            send(res, 400, { error: "shop_name" });
            return;
          }
          if (!ownerName) {
            send(res, 400, { error: "name_required" });
            return;
          }
          const shop = createShop({
            id: randomUUID(),
            name,
            lang,
            kind,
            createdBy: user.id,
          });
          await runWithShop(shop.id, async () => {
            seedCatalog(kind, lang);
            const firstRole = String(body.role ?? "").trim() || "Staff";
            ensureRole(firstRole);
            insertPerson({
              id: randomUUID(),
              shopId: shop.id,
              userId: user.id,
              name: ownerName,
              role: firstRole,
              roles: [firstRole],
              maxHours: Number(body.maxHours) > 0 ? Number(body.maxHours) : 40,
              email: user.email,
              isOwner: true,
            });
            updateSessionShop(sessionToken(req), shop.id);
            const person = personForUserInShop(user.id, shop.id);
            send(res, 200, { ...authPayload(user), ...loadState(todayYmd(), person) });
          });
          return;
        }

        if (path === "/api/join" && method === "POST") {
          const body = await readBody(req);
          const result = requestJoin(user, body.code);
          if (result.error) {
            send(res, 400, { error: result.error });
            return;
          }
          send(res, 200, { ...authPayload(user), ...result });
          return;
        }

        if (path === "/api/select-shop" && method === "POST") {
          const body = await readBody(req);
          const next = personForUserInShop(user.id, String(body.shopId ?? ""));
          if (!next) {
            send(res, 403, { error: "no_shop" });
            return;
          }
          updateSessionShop(sessionToken(req), next.shop_id);
          await runWithShop(next.shop_id, async () => {
            send(res, 200, { ...authPayload(user), ...loadState(todayYmd(), next) });
          });
          return;
        }

        if (!me) {
          send(res, 403, { error: "no_shop" });
          return;
        }

        if (path === "/api/state" && method === "GET") {
          send(res, 200, stateFor(url, me));
          return;
        }

        if (path === "/api/stats" && method === "GET") {
          const from = url.searchParams.get("from");
          const to = url.searchParams.get("to");
          const result = statsFor(me, from || to ? { from, to } : null);
          if (result.error) {
            send(res, 400, { error: result.error });
            return;
          }
          send(res, 200, result);
          return;
        }

        if (path === "/api/stats/current" && method === "POST") {
          if (!managerOnly(me)) {
            send(res, 403, { error: "owner_only" });
            return;
          }
          const body = await readBody(req);
          const result = setCurrentPeriod({
            from: String(body.from ?? ""),
            to: String(body.to ?? ""),
            absorb: Boolean(body.absorb),
          });
          if (result.error) {
            send(res, 400, { error: result.error });
            return;
          }
          sendShopState(res, url, getPerson(me.id));
          return;
        }

        if (path === "/api/tick" && method === "GET") {
          send(res, 200, {
            revision: shopRevision(shopId),
            pendingCount: managerOnly(me) ? pendingCount() : 0,
          });
          return;
        }

        if (path === "/api/events" && method === "GET") {
          req.socket.setTimeout(0);
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
            "x-accel-buffering": "no",
          });
          res.write(`data: ${JSON.stringify({ revision: shopRevision(shopId) })}\n\n`);
          subscribeShop(shopId, res);
          return;
        }

        if (path === "/api/shop" && method === "PATCH") {
          if (!managerOnly(me)) {
            send(res, 403, { error: "owner_only" });
            return;
          }
          const body = await readBody(req);
          const patch = {};
          if (body.name != null) {
            const name = String(body.name).trim();
            if (!name) {
              send(res, 400, { error: "shop_name" });
              return;
            }
            patch.name = name;
          }
          if (body.lang != null) patch.lang = body.lang === "en" ? "en" : "cs";
          if (body.theme != null) {
            const theme = String(body.theme);
            if (theme !== "system" && theme !== "light" && theme !== "dark") {
              send(res, 400, { error: "server" });
              return;
            }
            patch.theme = theme;
          }
          if (body.categoryId != null) patch.categoryId = String(body.categoryId);
          if (body.kind != null) applyKind(body.kind, getShop()?.lang || "cs");
          if (Object.hasOwn(body, "hoursCap")) patch.hoursCap = Boolean(body.hoursCap);
          if (Object.hasOwn(body, "statsResetDay")) {
            applyResetDay(body.statsResetDay);
          }
          if (Object.keys(patch).length) updateShop(patch);
          sendShopState(res, url, getPerson(me.id));
          return;
        }

        if (path === "/api/shop/join-code" && method === "POST") {
          if (!managerOnly(me)) {
            send(res, 403, { error: "owner_only" });
            return;
          }
          regenerateJoinCode();
          sendShopState(res, url, me);
          return;
        }

        if (path === "/api/categories" && method === "POST") {
          if (!managerOnly(me)) {
            send(res, 403, { error: "owner_only" });
            return;
          }
          const body = await readBody(req);
          const result = addCategory(body.name);
          if (result.error) {
            send(res, 400, { error: result.error });
            return;
          }
          sendShopState(res, url, getPerson(me.id));
          return;
        }

        if (path.startsWith("/api/categories/") && method === "PATCH") {
          if (!managerOnly(me)) {
            send(res, 403, { error: "owner_only" });
            return;
          }
          const id = decodeURIComponent(path.slice("/api/categories/".length));
          const body = await readBody(req);
          const result = editCategory(id, body.name);
          if (result.error) {
            send(res, 400, { error: result.error });
            return;
          }
          sendShopState(res, url, getPerson(me.id));
          return;
        }

        if (path.startsWith("/api/categories/") && method === "DELETE") {
          if (!managerOnly(me)) {
            send(res, 403, { error: "owner_only" });
            return;
          }
          const id = decodeURIComponent(path.slice("/api/categories/".length));
          const result = removeCategoryById(id);
          if (result.error) {
            send(res, 400, { error: result.error });
            return;
          }
          sendShopState(res, url, me);
          return;
        }

        if (path === "/api/lang" && method === "PATCH") {
          if (!managerOnly(me)) {
            send(res, 403, { error: "owner_only" });
            return;
          }
          const body = await readBody(req);
          updateShop({ lang: body.lang === "en" ? "en" : "cs" });
          sendShopState(res, url, getPerson(me.id));
          return;
        }

        if (path === "/api/roles" && method === "POST") {
          if (!managerOnly(me)) {
            send(res, 403, { error: "owner_only" });
            return;
          }
          const body = await readBody(req);
          const result = addRole(body.name, body.elevated);
          if (result.error) {
            send(res, 400, { error: result.error });
            return;
          }
          sendShopState(res, url, getPerson(me.id));
          return;
        }

        if (path.startsWith("/api/roles/") && method === "PATCH") {
          if (!managerOnly(me)) {
            send(res, 403, { error: "owner_only" });
            return;
          }
          const id = decodeURIComponent(path.slice("/api/roles/".length));
          const body = await readBody(req);
          const result = editRole(id, { name: body.name, elevated: body.elevated });
          if (result.error) {
            send(res, 400, { error: result.error });
            return;
          }
          sendShopState(res, url, getPerson(me.id));
          return;
        }

        if (path.startsWith("/api/roles/") && method === "DELETE") {
          if (!managerOnly(me)) {
            send(res, 403, { error: "owner_only" });
            return;
          }
          const id = decodeURIComponent(path.slice("/api/roles/".length));
          const result = removeRoleById(id);
          if (result.error) {
            send(res, 400, { error: result.error });
            return;
          }
          sendShopState(res, url, getPerson(me.id));
          return;
        }

        if (path.match(/^\/api\/join-requests\/[^/]+\/approve$/) && method === "POST") {
          if (!managerOnly(me)) {
            send(res, 403, { error: "owner_only" });
            return;
          }
          const id = decodeURIComponent(path.slice("/api/join-requests/".length, -"/approve".length));
          const body = await readBody(req);
          const result = approveJoin(id, body);
          if (result.error) {
            send(res, 400, { error: result.error });
            return;
          }
          sendShopState(res, url, me);
          return;
        }

        if (path.match(/^\/api\/join-requests\/[^/]+\/reject$/) && method === "POST") {
          if (!managerOnly(me)) {
            send(res, 403, { error: "owner_only" });
            return;
          }
          const id = decodeURIComponent(path.slice("/api/join-requests/".length, -"/reject".length));
          const result = rejectJoin(id);
          if (result.error) {
            send(res, 400, { error: result.error });
            return;
          }
          sendShopState(res, url, me);
          return;
        }

        if (path === "/api/people" && method === "POST") {
          if (!managerOnly(me)) {
            send(res, 403, { error: "owner_only" });
            return;
          }
          const body = await readBody(req);
          const parsed = savePerson(body);
          if (parsed.error) {
            send(res, 400, { error: parsed.error });
            return;
          }
          for (const role of parsed.roles) ensureRole(role);
          const link = userLinkForEmail(parsed.email);
          if (link.error) {
            send(res, 400, { error: link.error });
            return;
          }
          insertPerson({
            id: randomUUID(),
            name: parsed.name,
            role: parsed.role,
            roles: parsed.roles,
            maxHours: parsed.maxHours ?? 40,
            email: parsed.email,
            userId: link.userId,
            isOwner: false,
            elevated: Boolean(body.elevated),
          });
          sendShopState(res, url, getPerson(me.id));
          return;
        }

        if (path.startsWith("/api/people/") && method === "PATCH") {
          if (!managerOnly(me)) {
            send(res, 403, { error: "owner_only" });
            return;
          }
          const id = decodeURIComponent(path.slice("/api/people/".length));
          const body = await readBody(req);
          const current = getPerson(id);
          if (!current) {
            send(res, 404, { error: "person_missing" });
            return;
          }
          const parsed = savePerson(body);
          if (parsed.error) {
            send(res, 400, { error: parsed.error });
            return;
          }
          for (const role of parsed.roles) ensureRole(role);
          const patchPerson = {
            name: parsed.name,
            role: parsed.role,
            roles: parsed.roles,
            maxHours: parsed.maxHours,
            email: parsed.email,
            elevated: current.is_owner ? Boolean(current.elevated) : Boolean(body.elevated),
          };
          if (!current.user_id && parsed.email) {
            const link = userLinkForEmail(parsed.email);
            if (link.error) {
              send(res, 400, { error: link.error });
              return;
            }
            if (link.userId) patchPerson.userId = link.userId;
          }
          updatePerson(id, patchPerson);
          sendShopState(res, url, getPerson(me.id));
          return;
        }

        if (path.match(/^\/api\/people\/[^/]+\/kick$/) && method === "POST") {
          if (!managerOnly(me)) {
            send(res, 403, { error: "owner_only" });
            return;
          }
          const id = decodeURIComponent(path.slice("/api/people/".length, -"/kick".length));
          const result = kickPerson(me, id);
          if (result.error) {
            send(res, result.error === "person_missing" ? 404 : 400, { error: result.error });
            return;
          }
          if (result.notifyTo) {
            const cs = result.lang === "cs";
            await notify({
              to: result.notifyTo,
              subject: cs ? `Odebrání z ${result.shopName}` : `Removed from ${result.shopName}`,
              text: cs
                ? `Byli jste odebráni z provozovny ${result.shopName}.`
                : `You were removed from ${result.shopName}.`,
            });
          }
          sendShopState(res, url, getPerson(me.id));
          return;
        }

        if (path === "/api/copy-day" && method === "POST") {
          if (!managerOnly(me)) {
            send(res, 403, { error: "owner_only" });
            return;
          }
          const body = await readBody(req);
          const result = copyDay(body.from, body.dates);
          if (result.error) {
            send(res, 400, { error: result.error });
            return;
          }
          sendShopState(res, url, me);
          return;
        }

        if (path === "/api/clashes" && method === "POST") {
          if (!managerOnly(me)) {
            send(res, 403, { error: "owner_only" });
            return;
          }
          const result = findClashes(await readBody(req));
          if (result.error) {
            send(res, 400, { error: result.error });
            return;
          }
          send(res, 200, result);
          return;
        }

        if (path === "/api/shifts" && method === "POST") {
          if (!managerOnly(me)) {
            send(res, 403, { error: "owner_only" });
            return;
          }
          const result = addShift(await readBody(req));
          if (result.error) {
            send(res, 400, { error: result.error });
            return;
          }
          sendShopState(res, url, me);
          return;
        }

        if (path.startsWith("/api/shifts/") && method === "PATCH" && !path.includes("/offer") && !path.includes("/claim") && !path.includes("/cancel")) {
          if (!managerOnly(me)) {
            send(res, 403, { error: "owner_only" });
            return;
          }
          const id = decodeURIComponent(path.slice("/api/shifts/".length));
          const result = editShift(id, await readBody(req));
          if (result.error) {
            send(res, 400, { error: result.error });
            return;
          }
          sendShopState(res, url, me);
          return;
        }

        if (path.startsWith("/api/shifts/") && method === "DELETE") {
          if (!managerOnly(me)) {
            send(res, 403, { error: "owner_only" });
            return;
          }
          const id = decodeURIComponent(path.slice("/api/shifts/".length));
          const result = removeShift(id);
          if (result.error) {
            send(res, 400, { error: result.error });
            return;
          }
          sendShopState(res, url, me);
          return;
        }

        if (path.match(/^\/api\/shifts\/[^/]+\/offer$/) && method === "POST") {
          const id = decodeURIComponent(path.slice("/api/shifts/".length, -"/offer".length));
          const body = await readBody(req);
          const result = offerShift(me, id, body.reason);
          if (result.error) {
            send(res, 400, { error: result.error });
            return;
          }
          sendShopState(res, url, me);
          return;
        }

        if (path.match(/^\/api\/shifts\/[^/]+\/cancel-offer$/) && method === "POST") {
          const id = decodeURIComponent(path.slice("/api/shifts/".length, -"/cancel-offer".length));
          const result = cancelOffer(me, id);
          if (result.error) {
            send(res, 400, { error: result.error });
            return;
          }
          sendShopState(res, url, me);
          return;
        }

        if (path.match(/^\/api\/shifts\/[^/]+\/claim$/) && method === "POST") {
          const id = decodeURIComponent(path.slice("/api/shifts/".length, -"/claim".length));
          const body = await readBody(req);
          const result = await claimShift(me, id, body.reason);
          if (result.error) {
            send(res, 400, { error: result.error });
            return;
          }
          notifyShop(shopId);
          send(res, 200, { ...stateFor(url, getPerson(me.id)), claim: result });
          return;
        }

        if (path.match(/^\/api\/swaps\/[^/]+\/approve$/) && method === "POST") {
          const id = decodeURIComponent(path.slice("/api/swaps/".length, -"/approve".length));
          const result = await decideSwap(me, id, true);
          if (result.error) {
            send(res, 400, { error: result.error });
            return;
          }
          sendShopState(res, url, me);
          return;
        }

        if (path.match(/^\/api\/swaps\/[^/]+\/reject$/) && method === "POST") {
          const id = decodeURIComponent(path.slice("/api/swaps/".length, -"/reject".length));
          const result = await decideSwap(me, id, false);
          if (result.error) {
            send(res, 400, { error: result.error });
            return;
          }
          sendShopState(res, url, me);
          return;
        }

        if (path === "/api/demo" && method === "POST") {
          if (!managerOnly(me)) {
            send(res, 403, { error: "owner_only" });
            return;
          }
          const body = await readBody(req);
          const result = await seedTestData(body.week || weekFrom(url));
          if (result.error) {
            send(res, 400, { error: result.error });
            return;
          }
          notifyShop(shopId);
          send(res, 200, loadState(result.weekStart, me, rangeFrom(url)));
          return;
        }

        send(res, 404, { error: "not_found" });
        return;
      }

      serveStatic(path, res);
    });
    };

    if (injected?.box) {
      await runWithDb(injected.db, () => runSession(injected.box));
      return;
    }

    await runWithPreview(req, { reset: isShell }, runSession);
  } catch (error) {
    console.error(error);
    send(res, 500, { error: "server" });
  }
}

const runningOnWorker = typeof WebSocketPair !== "undefined";
const server = runningOnWorker ? null : createServer(handlePreviewHttp);

function listen(port, attempt = 0) {
  const onError = (error) => {
    server.off("error", onError);
    const canRetry = error.code === "EADDRINUSE" && process.env.NODE_ENV !== "production" && attempt < 9;
    if (canRetry) {
      const next = port + 1;
      console.error(`Port ${port} in use, trying ${next}`);
      listen(next, attempt + 1);
      return;
    }
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use.`);
      process.exit(1);
    }
    throw error;
  };
  server.on("error", onError);
  server.listen(port, HOST, () => {
    console.log(`SWAPSHIFT preview on http://127.0.0.1:${port}`);
  });
}

if (server) listen(PORT);
