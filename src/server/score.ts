import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import type { ScoreResult } from "../types.ts";

const rubric = `You are the score step for Acta, a group board. Members log what they actually did. Standing changes only when a log records real work and the score is new.

Reply with JSON only, no markdown.
{"applies":false} when the log does not record real work. Updating a CV, resume, profile, or job application is not real work. A note with no actual deed is not real work.
{"applies":true,"score":N} when the log records real work. N is an integer from 0 to 100 for how much specific work it describes. The same log must always get the same N. A different deed may get a different N.

Log: updated my CV
{"applies":false}

Log: Rehearsed the set with Noor for two hours and cut one song.
{"applies":true,"score":64}

Log: Rewrote the onboarding notes and tried them with a new member.
{"applies":true,"score":71}`;

let child: ChildProcess | null = null;
let baseUrl: string | null = null;
let modelName = "local";
let apiKey = "";
let ready: Promise<void> | null = null;

function localPaths(): { bin: string; model: string } {
  const root = join(process.cwd(), "data", "score");
  return {
    bin: process.env.ACTA_LLAMA_SERVER || join(root, "llama-server"),
    model: process.env.ACTA_SCORE_GGUF || join(root, "model.gguf"),
  };
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child && child.exitCode !== null) throw new Error("score engine exited");
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("score engine did not start");
}

async function init(): Promise<void> {
  modelName = process.env.ACTA_SCORE_MODEL || "local";
  apiKey = process.env.ACTA_SCORE_API_KEY || "";
  if (process.env.ACTA_SCORE_BASE_URL) {
    baseUrl = process.env.ACTA_SCORE_BASE_URL.replace(/\/$/, "");
    return;
  }

  const { bin, model } = localPaths();
  if (!existsSync(bin) || !existsSync(model)) {
    console.log("Score engine is not configured. A log will not move standing. Run npm run score-engine, or set ACTA_SCORE_BASE_URL.");
    return;
  }

  const port = Number(process.env.ACTA_SCORE_PORT || 8091);
  const threads = Math.max(1, Math.min(4, availableParallelism()));
  const logPath = join(process.cwd(), "data", "score", "llama.log");
  const logFd = openSync(logPath, "a");
  child = spawn(
    bin,
    [
      "-m",
      model,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "-c",
      "2048",
      "-t",
      String(threads),
      "-np",
      "1",
      "-a",
      "local",
      "--reasoning",
      "off",
    ],
    { stdio: ["ignore", logFd, logFd] },
  );
  child.on("exit", () => {
    child = null;
    baseUrl = null;
  });
  await waitFor(`http://127.0.0.1:${port}/health`, 120_000);
  if (!child || child.exitCode !== null) throw new Error("score engine exited");
  baseUrl = `http://127.0.0.1:${port}/v1`;
  console.log(`Score engine ready (${baseUrl})`);
}

export function warmScoreEngine(): Promise<void> {
  ready ??= init().catch((error: unknown) => {
    baseUrl = null;
    console.log(`Score engine is not available (${error instanceof Error ? error.message : "failed"}). A log will not move standing.`);
  });
  return ready;
}

export function stopScoreEngine(): void {
  if (child && child.exitCode === null) child.kill("SIGTERM");
  child = null;
  baseUrl = null;
}

function parseScore(raw: string): ScoreResult {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false };
  let data: unknown;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return { ok: false };
  }
  if (!data || typeof data !== "object") return { ok: false };
  const record = data as { applies?: unknown; score?: unknown };
  if (record.applies === false) return { ok: true, applies: false };
  if (record.applies !== true) return { ok: false };
  if (typeof record.score !== "number" || !Number.isFinite(record.score)) return { ok: false };
  return { ok: true, applies: true, score: record.score };
}

export async function scoreLog(text: string): Promise<ScoreResult> {
  await warmScoreEngine();
  if (!baseUrl) return { ok: false };
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: modelName,
        temperature: 0,
        max_tokens: 40,
        messages: [
          { role: "system", content: rubric },
          { role: "user", content: text },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) return { ok: false };
    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return { ok: false };
    return parseScore(content);
  } catch {
    return { ok: false };
  }
}
