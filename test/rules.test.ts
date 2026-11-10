import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { copy } from "../src/copy.ts";
import { joinLink, readPublicOrigin, safeNext } from "../src/link.ts";

test("locked copy stays exact", () => {
  assert.equal(copy.createGroup, "Create a group.");
  assert.equal(copy.shareLink, "Share this link to join.");
  assert.equal(copy.whatDidYouDo, "What did you do?");
  assert.equal(copy.scoreFailed, "The score could not be worked out.");
  assert.match(copy.firstLook, /already know each other/);
  assert.match(copy.firstLook, /join link/);
  assert.match(copy.firstLook, /what they actually did/);
});

test("next only returns to a join or board path", () => {
  assert.equal(safeNext("/join/abc_DEF-123"), "/join/abc_DEF-123");
  assert.equal(safeNext("/groups/new"), "/groups/new");
  assert.equal(
    safeNext("/groups/11111111-2222-4333-8444-555555555555"),
    "/groups/11111111-2222-4333-8444-555555555555",
  );
  assert.equal(safeNext("https://example.com/join/abc"), null);
  assert.equal(safeNext("//example.com/join/abc"), null);
  assert.equal(safeNext("/join/abc?next=/"), null);
  assert.equal(safeNext("/sign-in"), null);
  assert.equal(safeNext("../join/abc"), null);
  assert.equal(safeNext(null), null);
});

test("join links use the page origin unless an override is set", () => {
  assert.equal(readPublicOrigin(undefined), null);
  assert.equal(readPublicOrigin("   "), null);
  assert.equal(readPublicOrigin("notaurl"), null);
  assert.equal(readPublicOrigin("http://127.0.0.1:4730/extra"), null);
  assert.equal(readPublicOrigin("http://192.168.1.20:4730"), "http://192.168.1.20:4730");
  assert.equal(joinLink("http://127.0.0.1:4730", null, "tok"), "http://127.0.0.1:4730/join/tok");
  assert.equal(
    joinLink("http://127.0.0.1:4730/", "http://192.168.1.20:4730", "tok"),
    "http://192.168.1.20:4730/join/tok",
  );
});

test("controls use rounded-sm and no large radius", () => {
  const app = readFileSync("src/client/App.tsx", "utf8");
  const css = readFileSync("src/client/styles.css", "utf8");
  assert.match(app, /rounded-sm/);
  assert.doesNotMatch(app, /rounded-(?:md|lg|xl|2xl|3xl|full)/);
  const radii = [...css.matchAll(/border-radius:\s*([^;]+)/g)].map((match) => match[1]?.trim());
  assert.ok(radii.length > 0);
  assert.deepEqual(radii, radii.map(() => "0.125rem"));
});

test("the app does not point at another product's database or brand", () => {
  const banned = ["godotwebs.com", ["HP", "SHCC"].join(""), ["pmgiunkurflqrlczaxjf"].join("")];
  const roots = ["src", "electron", "scripts", "test"];
  const files = ["README.md", "package.json", "index.html", ".env.example", ...roots.flatMap((dir) => walk(dir))];
  for (const file of files) {
    if (file.endsWith("rules.test.ts")) continue;
    const text = readFileSync(file, "utf8");
    for (const term of banned) assert.equal(text.includes(term), false, `${file} contains ${term}`);
  }
  const apply = readFileSync("src/server/apply.ts", "utf8");
  assert.doesNotMatch(apply, /updated my CV/i);
  assert.doesNotMatch(apply, /\.includes\(/);
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}
