import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "data", "score");
const modelUrl =
  "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf";
const llamaUrl =
  "https://github.com/ggml-org/llama.cpp/releases/download/b12244/llama-b12244-bin-ubuntu-x64.tar.gz";
const modelPath = join(root, "model.gguf");
const binDir = join(root, "llama-b12244");
const binPath = join(binDir, "llama-server");
const wrapperPath = join(root, "llama-server");

mkdirSync(root, { recursive: true });

function download(url, dest) {
  const result = spawnSync("curl", ["-fL", "--retry", "5", "--retry-delay", "2", "-o", dest, url], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync(binPath)) {
  const tarPath = join(tmpdir(), "llama-b12244-bin-ubuntu-x64.tar.gz");
  console.log("Downloading llama.cpp…");
  download(llamaUrl, tarPath);
  const extracted = spawnSync("tar", ["-xzf", tarPath, "-C", root], { stdio: "inherit" });
  if (extracted.status !== 0) process.exit(extracted.status ?? 1);
}

if (!existsSync(modelPath) || statSync(modelPath).size < 100_000_000) {
  console.log("Downloading the score model…");
  download(modelUrl, modelPath);
}

writeFileSync(
  wrapperPath,
  `#!/bin/sh
cd "$(dirname "$0")"
exec "./llama-b12244/llama-server" "$@"
`,
);
chmodSync(wrapperPath, 0o755);
console.log("Score engine files are in data/score.");
console.log("Start Acta with npm run dev and it will use them.");
