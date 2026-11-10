import { randomUUID } from "node:crypto";
import { copy } from "../copy.ts";
import type { Board, LogResult, ScoreEngine } from "../types.ts";
import type { DB } from "./db.ts";
import { readBoard } from "./db.ts";

// A second log on the same day is scored again. Standing moves only when that score differs.
export async function submitLog(
  db: DB,
  input: {
    groupId: string;
    userId: string;
    text: string;
    publicOrigin: string | null;
    score: ScoreEngine;
  },
): Promise<LogResult> {
  const text = input.text.trim();
  const existing = db
    .prepare("SELECT standing FROM memberships WHERE group_id = ? AND user_id = ?")
    .get(input.groupId, input.userId) as { standing: number | null } | undefined;
  if (!existing) return { outcome: "forbidden" };
  if (!text) return { outcome: "quiet" };

  let judged: Awaited<ReturnType<ScoreEngine>>;
  try {
    judged = await input.score(text);
  } catch {
    judged = { ok: false };
  }

  const board = (): Board | null => readBoard(db, input.userId, input.groupId, input.publicOrigin);

  db.exec("BEGIN IMMEDIATE");
  try {
    const current = db
      .prepare("SELECT standing FROM memberships WHERE group_id = ? AND user_id = ?")
      .get(input.groupId, input.userId) as { standing: number | null } | undefined;
    if (!current) {
      db.exec("ROLLBACK");
      return { outcome: "forbidden" };
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    const failed = () => {
      db.prepare(
        "INSERT INTO logs (id, group_id, user_id, body, created_at, outcome, score) VALUES (?, ?, ?, ?, ?, 'failed', NULL)",
      ).run(id, input.groupId, input.userId, text, now);
      db.exec("COMMIT");
      return { outcome: "failed" as const, message: copy.scoreFailed };
    };

    if (!judged.ok) return failed();
    if (!judged.applies) {
      db.prepare(
        "INSERT INTO logs (id, group_id, user_id, body, created_at, outcome, score) VALUES (?, ?, ?, ?, ?, 'quiet', NULL)",
      ).run(id, input.groupId, input.userId, text, now);
      db.exec("COMMIT");
      return { outcome: "quiet" };
    }
    if (!Number.isFinite(judged.score)) return failed();

    const score = Math.max(0, Math.min(100, Math.round(judged.score)));
    if (current.standing === score) {
      db.prepare(
        "INSERT INTO logs (id, group_id, user_id, body, created_at, outcome, score) VALUES (?, ?, ?, ?, ?, 'unchanged', ?)",
      ).run(id, input.groupId, input.userId, text, now, score);
      db.exec("COMMIT");
      return { outcome: "unchanged", ping: false };
    }

    db.prepare(
      "UPDATE memberships SET standing = ?, standing_updated_at = ? WHERE group_id = ? AND user_id = ?",
    ).run(score, now, input.groupId, input.userId);
    db.prepare(
      "INSERT INTO logs (id, group_id, user_id, body, created_at, outcome, score) VALUES (?, ?, ?, ?, ?, 'changed', ?)",
    ).run(id, input.groupId, input.userId, text, now, score);
    db.exec("COMMIT");
    const next = board();
    if (!next) return { outcome: "forbidden" };
    return { outcome: "changed", ping: true, board: next };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // already closed
    }
    throw error;
  }
}
