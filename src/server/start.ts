import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { copy } from "../copy.ts";
import { safeNext } from "../link.ts";
import type { Me, ScoreEngine } from "../types.ts";
import { submitLog } from "./apply.ts";
import {
  deleteSession,
  getUserByEmail,
  getUserById,
  groupByToken,
  insertGroup,
  insertSession,
  insertUser,
  joinGroup,
  listGroups,
  openDatabase,
  readBoard,
  userIdForSession,
  type DB,
} from "./db.ts";
import { hashPassword, verifyPassword } from "./passwords.ts";

const cookieName = "acta_session";
const sessionMs = 30 * 24 * 60 * 60 * 1000;

export type ServerOptions = {
  port: number;
  host: string;
  dev: boolean;
  dbPath: string;
  publicOrigin: string | null;
  score: ScoreEngine;
};

type ViteMiddleware = {
  middlewares: (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
  close: () => Promise<void>;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function readCookie(req: IncomingMessage): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === cookieName) return rest.join("=") || null;
  }
  return null;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 32_000) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  const data = JSON.parse(raw) as unknown;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("bad json");
  return data as Record<string, unknown>;
}

function textField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function meFor(db: DB, userId: string | undefined, publicOrigin: string | null): Me {
  if (!userId) return { user: null, groups: [], publicOrigin };
  const user = getUserById(db, userId);
  if (!user) return { user: null, groups: [], publicOrigin };
  return { user, groups: listGroups(db, userId), publicOrigin };
}

function currentUserId(db: DB, req: IncomingMessage): string | undefined {
  const token = readCookie(req);
  if (!token) return undefined;
  return userIdForSession(db, hashToken(token), new Date().toISOString());
}

function setSession(res: ServerResponse, token: string): void {
  res.setHeader(
    "Set-Cookie",
    `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(sessionMs / 1000)}`,
  );
}

function clearSession(res: ServerResponse): void {
  res.setHeader("Set-Cookie", `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function startServer(options: ServerOptions): Promise<{ port: number; close: () => Promise<void> }> {
  const db = openDatabase(options.dbPath);
  let vite: ViteMiddleware | null = null;
  if (options.dev) {
    const { createServer: createViteServer } = await import("vite");
    const created = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });
    vite = created as unknown as ViteMiddleware;
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url, db, options);
        return;
      }
      if (vite) {
        vite.middlewares(req, res, () => {
          if (!res.headersSent) {
            res.statusCode = 404;
            res.end("Not found");
          }
        });
        return;
      }
      res.statusCode = 404;
      res.end("Not found");
    } catch (error) {
      console.error(error);
      if (!res.headersSent) send(res, 500, { error: "Something went wrong." });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => resolve());
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;

  return {
    port,
    async close() {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      if (vite) await vite.close();
      db.close();
    },
  };
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  db: DB,
  options: ServerOptions,
): Promise<void> {
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (method === "GET" && path === "/api/health") {
    send(res, 200, { ok: true, product: copy.product });
    return;
  }

  if (method === "GET" && path === "/api/me") {
    send(res, 200, meFor(db, currentUserId(db, req), options.publicOrigin));
    return;
  }

  if (method === "POST" && path === "/api/auth/sign-out") {
    const token = readCookie(req);
    if (token) deleteSession(db, hashToken(token));
    clearSession(res);
    send(res, 200, { ok: true });
    return;
  }

  if (method === "POST" && path === "/api/auth/sign-up") {
    const body = await readJson(req);
    const name = textField(body.name);
    const email = textField(body.email).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    if (!name || name.length > 80 || !validEmail(email) || password.length < 8) {
      send(res, 400, { error: "Enter your name, email, and a password of at least 8 characters." });
      return;
    }
    if (getUserByEmail(db, email)) {
      send(res, 409, { error: "That email already has an account." });
      return;
    }
    const userId = randomUUID();
    const now = new Date().toISOString();
    insertUser(db, { id: userId, email, name, passwordHash: hashPassword(password), createdAt: now });
    const token = randomBytes(32).toString("base64url");
    insertSession(db, { tokenHash: hashToken(token), userId, expiresAt: new Date(Date.now() + sessionMs).toISOString() });
    setSession(res, token);
    send(res, 200, meFor(db, userId, options.publicOrigin));
    return;
  }

  if (method === "POST" && path === "/api/auth/sign-in") {
    const body = await readJson(req);
    const email = textField(body.email).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const user = email ? getUserByEmail(db, email) : undefined;
    if (!user || !verifyPassword(password, user.password_hash)) {
      send(res, 401, { error: "That email and password do not match." });
      return;
    }
    const token = randomBytes(32).toString("base64url");
    insertSession(db, {
      tokenHash: hashToken(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + sessionMs).toISOString(),
    });
    setSession(res, token);
    send(res, 200, meFor(db, user.id, options.publicOrigin));
    return;
  }

  if (method === "POST" && path === "/api/groups") {
    const userId = currentUserId(db, req);
    if (!userId) {
      send(res, 401, { error: "Sign in first." });
      return;
    }
    const body = await readJson(req);
    const name = textField(body.name);
    if (!name || name.length > 80) {
      send(res, 400, { error: "Name the group." });
      return;
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const joinToken = randomBytes(18).toString("base64url");
    insertGroup(db, { id, name, ownerId: userId, joinToken, createdAt: now });
    const board = readBoard(db, userId, id, options.publicOrigin);
    send(res, 200, { group: board?.group });
    return;
  }

  const groupMatch = path.match(/^\/api\/groups\/([^/]+)$/);
  if (method === "GET" && groupMatch) {
    const userId = currentUserId(db, req);
    if (!userId) {
      send(res, 401, { error: "Sign in first." });
      return;
    }
    const groupId = decodeURIComponent(groupMatch[1] ?? "");
    if (!uuid.test(groupId)) {
      send(res, 404, { error: "That board is not here." });
      return;
    }
    const board = readBoard(db, userId, groupId, options.publicOrigin);
    if (!board) {
      send(res, 403, { error: "You are not on this board." });
      return;
    }
    send(res, 200, board);
    return;
  }

  const joinMatch = path.match(/^\/api\/join\/([^/]+)$/);
  if (joinMatch && (method === "GET" || method === "POST")) {
    const token = decodeURIComponent(joinMatch[1] ?? "");
    if (!/^[A-Za-z0-9_-]+$/.test(token)) {
      send(res, 404, { error: "This join link does not match a group." });
      return;
    }
    const group = groupByToken(db, token);
    if (!group) {
      send(res, 404, { error: "This join link does not match a group." });
      return;
    }
    if (method === "GET") {
      send(res, 200, { groupId: group.id, name: group.name });
      return;
    }
    const userId = currentUserId(db, req);
    if (!userId) {
      send(res, 401, { error: "Sign in first." });
      return;
    }
    joinGroup(db, group.id, userId, new Date().toISOString());
    send(res, 200, { groupId: group.id });
    return;
  }

  const logMatch = path.match(/^\/api\/groups\/([^/]+)\/logs$/);
  if (method === "POST" && logMatch) {
    const userId = currentUserId(db, req);
    if (!userId) {
      send(res, 401, { error: "Sign in first." });
      return;
    }
    const groupId = decodeURIComponent(logMatch[1] ?? "");
    if (!uuid.test(groupId)) {
      send(res, 404, { error: "That board is not here." });
      return;
    }
    const body = await readJson(req);
    const text = typeof body.text === "string" ? body.text : "";
    if (text.trim().length > 2000) {
      send(res, 400, { error: "Keep the log short." });
      return;
    }
    const result = await submitLog(db, {
      groupId,
      userId,
      text,
      publicOrigin: options.publicOrigin,
      score: options.score,
    });
    if (result.outcome === "forbidden") {
      send(res, 403, { error: "You are not on this board." });
      return;
    }
    send(res, 200, result);
    return;
  }

  if (method === "GET" && path === "/api/next") {
    send(res, 200, { next: safeNext(url.searchParams.get("next")) });
    return;
  }

  send(res, 404, { error: "Not found." });
}
