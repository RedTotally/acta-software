import { join } from "node:path";
import { readPublicOrigin } from "../link.ts";
import { scoreLog, stopScoreEngine, warmScoreEngine } from "./score.ts";
import { startServer } from "./start.ts";

const host = process.env.ACTA_HOST || "127.0.0.1";
const port = Number(process.env.ACTA_PORT || 4730);
const dbPath = process.env.ACTA_DB || join(process.cwd(), "data", "acta.sqlite");

void warmScoreEngine();

const server = await startServer({
  host,
  port,
  dev: process.env.ACTA_DEV !== "0",
  dbPath,
  publicOrigin: readPublicOrigin(process.env.ACTA_PUBLIC_ORIGIN),
  score: scoreLog,
});

console.log(`Acta listening on http://${host}:${server.port}`);

async function shutdown(): Promise<void> {
  stopScoreEngine();
  await server.close();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
