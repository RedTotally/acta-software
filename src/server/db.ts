import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Board, BoardMember, GroupSummary, PublicUser } from "../types.ts";

export type DB = DatabaseSync;

type UserRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
};

type SessionRow = { user_id: string; expires_at: string };

type MemberStandingRow = { standing: number | null };

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  join_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
  group_id TEXT NOT NULL REFERENCES groups(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,
  standing INTEGER,
  standing_updated_at TEXT,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE TABLE IF NOT EXISTS logs (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  outcome TEXT NOT NULL,
  score INTEGER,
  FOREIGN KEY (group_id, user_id) REFERENCES memberships(group_id, user_id)
);
`;

export function openDatabase(dbPath: string): DB {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  if (dbPath !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec(schema);
  return db;
}

export function getUserByEmail(db: DB, email: string): UserRow | undefined {
  return db.prepare("SELECT id, email, name, password_hash FROM users WHERE email = ?").get(email) as
    | UserRow
    | undefined;
}

export function getUserById(db: DB, id: string): PublicUser | undefined {
  return db.prepare("SELECT id, email, name FROM users WHERE id = ?").get(id) as PublicUser | undefined;
}

export function insertUser(db: DB, user: { id: string; email: string; name: string; passwordHash: string; createdAt: string }): void {
  db.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)").run(
    user.id,
    user.email,
    user.name,
    user.passwordHash,
    user.createdAt,
  );
}

export function insertSession(db: DB, session: { tokenHash: string; userId: string; expiresAt: string }): void {
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(
    session.tokenHash,
    session.userId,
    session.expiresAt,
  );
}

export function deleteSession(db: DB, tokenHash: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

export function userIdForSession(db: DB, tokenHash: string, nowIso: string): string | undefined {
  const row = db.prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?").get(tokenHash) as
    | SessionRow
    | undefined;
  if (!row) return undefined;
  if (row.expires_at <= nowIso) {
    deleteSession(db, tokenHash);
    return undefined;
  }
  return row.user_id;
}

export function insertGroup(
  db: DB,
  group: { id: string; name: string; ownerId: string; joinToken: string; createdAt: string },
): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO groups (id, name, owner_id, join_token, created_at) VALUES (?, ?, ?, ?, ?)").run(
      group.id,
      group.name,
      group.ownerId,
      group.joinToken,
      group.createdAt,
    );
    db.prepare(
      "INSERT INTO memberships (group_id, user_id, role, standing, standing_updated_at, joined_at) VALUES (?, ?, 'owner', NULL, NULL, ?)",
    ).run(group.id, group.ownerId, group.createdAt);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listGroups(db: DB, userId: string): GroupSummary[] {
  return db
    .prepare(
      `SELECT g.id AS id, g.name AS name
       FROM memberships m
       JOIN groups g ON g.id = m.group_id
       WHERE m.user_id = ?
       ORDER BY m.joined_at DESC`,
    )
    .all(userId) as GroupSummary[];
}

export function groupByToken(db: DB, token: string): { id: string; name: string } | undefined {
  return db.prepare("SELECT id, name FROM groups WHERE join_token = ?").get(token) as
    | { id: string; name: string }
    | undefined;
}

export function membership(db: DB, groupId: string, userId: string): { standing: number | null } | undefined {
  return db
    .prepare("SELECT standing FROM memberships WHERE group_id = ? AND user_id = ?")
    .get(groupId, userId) as MemberStandingRow | undefined;
}

export function joinGroup(db: DB, groupId: string, userId: string, joinedAt: string): void {
  const existing = membership(db, groupId, userId);
  if (existing) return;
  db.prepare(
    "INSERT INTO memberships (group_id, user_id, role, standing, standing_updated_at, joined_at) VALUES (?, ?, 'member', NULL, NULL, ?)",
  ).run(groupId, userId, joinedAt);
}

export function readBoard(db: DB, userId: string, groupId: string, publicOrigin: string | null): Board | null {
  if (!membership(db, groupId, userId)) return null;
  const group = db.prepare("SELECT id, name, join_token AS joinToken FROM groups WHERE id = ?").get(groupId) as
    | { id: string; name: string; joinToken: string }
    | undefined;
  if (!group) return null;
  const rows = db
    .prepare(
      `SELECT u.id AS userId, u.name AS name, m.standing AS standing
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.group_id = ?`,
    )
    .all(groupId) as BoardMember[];
  rows.sort((a, b) => {
    if (a.standing === null && b.standing === null) return a.name.localeCompare(b.name);
    if (a.standing === null) return 1;
    if (b.standing === null) return -1;
    if (a.standing !== b.standing) return b.standing - a.standing;
    return a.name.localeCompare(b.name);
  });
  return { group, viewerId: userId, publicOrigin, members: rows };
}
