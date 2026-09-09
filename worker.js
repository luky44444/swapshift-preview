import { DurableObject } from "cloudflare:workers";
import { sessionCookieName } from "./src/auth.js";
import { openDb, previewOwnerUser, runWithDb } from "./src/db.js";
import { fetchResponseFrom, nodeRequestFrom, nodeResponse } from "./src/http-shim.js";
import {
  PREVIEW_COOKIE,
  newPreviewId,
  previewIdFromCookieHeader,
  seedPreview,
} from "./src/preview.js";
import { handlePreviewHttp } from "./src/server.js";

export class PreviewApp extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const isShell = request.method === "GET" && (path === "/" || path === "/index.html");
    const db = openDb(":memory:", this.ctx.storage.sql);
    const id = this.ctx.id.name || newPreviewId();
    let session = runWithDb(db, () => {
      const owner = previewOwnerUser();
      return owner ? { token: "", userId: owner.id } : null;
    });
    if (isShell || !session) {
      session = await seedPreview(db);
    }

    if (isShell) {
      const page = await this.env.ASSETS.fetch(new URL("/index.html", request.url));
      const headers = new Headers(page.headers);
      headers.set("cache-control", "no-store");
      const secure = "; Secure";
      headers.append(
        "set-cookie",
        `${PREVIEW_COOKIE}=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600${secure}`,
      );
      headers.append(
        "set-cookie",
        `${sessionCookieName()}=${session.token}; HttpOnly; SameSite=Lax; Path=/${secure}`,
      );
      return new Response(page.body, { status: page.status, headers });
    }

    const body = request.method === "GET" || request.method === "HEAD" ? null : await request.arrayBuffer();
    const req = nodeRequestFrom(request, body);
    const res = nodeResponse();
    await handlePreviewHttp(req, res, { db, box: { id, token: session.token, fresh: false } });
    return fetchResponseFrom(res);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/health") return new Response("ok");
    if (path === "/" || path === "/index.html" || path.startsWith("/api/")) {
      const id = previewIdFromCookieHeader(request.headers.get("cookie") || "") || newPreviewId();
      return env.PREVIEW_APP.getByName(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
