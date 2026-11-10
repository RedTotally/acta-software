import assert from "node:assert/strict";
import test from "node:test";
import type { ScoreEngine } from "../src/types.ts";
import { startServer } from "../src/server/start.ts";

class Client {
  cookie = "";

  constructor(private base: string) {}

  async call(method: string, path: string, body?: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
    const response = await fetch(this.base + path, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(";")[0] ?? "";
      if (!pair.startsWith("acta_session=")) continue;
      const value = pair.slice("acta_session=".length);
      this.cookie = value ? pair : "";
    }
    return { status: response.status, data: (await response.json().catch(() => ({}))) as Record<string, unknown> };
  }
}

test("two accounts share a board and standing moves only when the score changes", async () => {
  const calls: string[] = [];
  const score: ScoreEngine = async (text) => {
    calls.push(text);
    if (calls.length === 1) return { ok: true, applies: false };
    if (calls.length === 2) return { ok: true, applies: true, score: 61 };
    if (calls.length === 3) return { ok: true, applies: true, score: 61 };
    if (calls.length === 4) return { ok: true, applies: true, score: 48 };
    return { ok: false };
  };

  const server = await startServer({
    port: 0,
    host: "127.0.0.1",
    dev: false,
    dbPath: ":memory:",
    publicOrigin: "http://192.168.1.20:4730",
    score,
  });
  const base = `http://127.0.0.1:${server.port}`;
  const owner = new Client(base);
  const member = new Client(base);

  try {
    const createdAccount = await owner.call("POST", "/api/auth/sign-up", {
      name: "Chan",
      email: "chan@example.com",
      password: "test-pass-1",
    });
    assert.equal(createdAccount.status, 200);
    const ownerUser = createdAccount.data.user as { id: string };
    assert.equal(JSON.stringify(createdAccount.data).includes("password"), false);

    const created = await owner.call("POST", "/api/groups", { name: "Tuesday band" });
    assert.equal(created.status, 200);
    const group = created.data.group as { id: string; joinToken: string; name: string };
    assert.equal(group.name, "Tuesday band");
    assert.match(group.id, /^[0-9a-f-]{36}$/i);

    const ownerBoard = await owner.call("GET", `/api/groups/${group.id}`);
    assert.equal(ownerBoard.status, 200);
    assert.equal(ownerBoard.data.publicOrigin, "http://192.168.1.20:4730");
    assert.equal((ownerBoard.data.members as { standing: number | null }[])[0]?.standing, null);

    const again = await owner.call("POST", "/api/auth/sign-in", { email: "chan@example.com", password: "test-pass-1" });
    assert.equal((again.data.user as { id: string }).id, ownerUser.id);

    const preview = await member.call("GET", `/api/join/${group.joinToken}`);
    assert.equal(preview.status, 200);
    assert.equal(preview.data.groupId, group.id);
    assert.equal(preview.data.name, "Tuesday band");

    const blocked = await member.call("GET", `/api/groups/${group.id}`);
    assert.equal(blocked.status, 401);

    await member.call("POST", "/api/auth/sign-up", {
      name: "Mina",
      email: "mina@example.com",
      password: "test-pass-1",
    });
    const joined = await member.call("POST", `/api/join/${group.joinToken}`);
    assert.equal(joined.status, 200);
    assert.equal(joined.data.groupId, group.id);

    const quietEmpty = await member.call("POST", `/api/groups/${group.id}/logs`, { text: "   " });
    assert.deepEqual(quietEmpty.data, { outcome: "quiet" });
    assert.equal(calls.length, 0);

    const quietCv = await member.call("POST", `/api/groups/${group.id}/logs`, { text: "updated my CV" });
    assert.deepEqual(quietCv.data, { outcome: "quiet" });
    assert.equal(calls[0], "updated my CV");

    const real = "Rehearsed the set with Noor for two hours and cut one song.";
    const changed = await member.call("POST", `/api/groups/${group.id}/logs`, { text: real });
    assert.equal(changed.data.outcome, "changed");
    assert.equal(changed.data.ping, true);
    const changedBoard = changed.data.board as { members: { name: string; standing: number | null }[] };
    assert.equal(changedBoard.members.find((person) => person.name === "Mina")?.standing, 61);

    const sameDay = await member.call("POST", `/api/groups/${group.id}/logs`, { text: real });
    assert.equal(sameDay.data.outcome, "unchanged");
    assert.equal(sameDay.data.ping, false);

    const againDifferent = await member.call("POST", `/api/groups/${group.id}/logs`, {
      text: "Rewrote the onboarding notes and tried them with a new member.",
    });
    assert.equal(againDifferent.data.outcome, "changed");
    assert.equal(againDifferent.data.ping, true);
    const moved = againDifferent.data.board as { members: { name: string; standing: number | null }[] };
    assert.equal(moved.members.find((person) => person.name === "Mina")?.standing, 48);

    const failed = await member.call("POST", `/api/groups/${group.id}/logs`, { text: "Fixed the lights at the hall." });
    assert.equal(failed.status, 200);
    assert.equal(failed.data.outcome, "failed");
    assert.equal(failed.data.message, "The score could not be worked out.");

    const ownerSees = await owner.call("GET", `/api/groups/${group.id}`);
    const people = ownerSees.data.members as { name: string; standing: number | null }[];
    assert.equal(people.find((person) => person.name === "Mina")?.standing, 48);
    assert.equal(people.find((person) => person.name === "Chan")?.standing, null);
    assert.deepEqual(
      people.map((person) => person.name),
      ["Mina", "Chan"],
    );
  } finally {
    await server.close();
  }
});

test("a thrown score engine does not move standing", async () => {
  const server = await startServer({
    port: 0,
    host: "127.0.0.1",
    dev: false,
    dbPath: ":memory:",
    publicOrigin: null,
    score: async () => {
      throw new Error("down");
    },
  });
  const client = new Client(`http://127.0.0.1:${server.port}`);
  try {
    await client.call("POST", "/api/auth/sign-up", { name: "Chan", email: "chan@example.com", password: "test-pass-1" });
    const created = await client.call("POST", "/api/groups", { name: "Tuesday band" });
    const group = created.data.group as { id: string };
    const failed = await client.call("POST", `/api/groups/${group.id}/logs`, { text: "Built the cabinet." });
    assert.equal(failed.data.outcome, "failed");
    assert.equal(failed.data.message, "The score could not be worked out.");
    const board = await client.call("GET", `/api/groups/${group.id}`);
    assert.equal((board.data.members as { standing: number | null }[])[0]?.standing, null);
  } finally {
    await server.close();
  }
});
