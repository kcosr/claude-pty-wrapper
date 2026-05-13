import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface FakeClaudeBin {
  binPath: string;
  logPath: string;
  modePath: string;
}

export async function createFakeClaudeBin(): Promise<FakeClaudeBin> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fake-claude-bin-"));
  const binPath = path.join(dir, "claude");
  const logPath = path.join(dir, "invocation.json");
  const modePath = path.join(dir, "mode.txt");
  await writeFile(
    binPath,
    `#!/usr/bin/env node
import { mkdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const logPath = ${JSON.stringify(logPath)};
const modePath = ${JSON.stringify(modePath)};
const args = process.argv.slice(2);
const mode = readFileSync(modePath, "utf8").trim();
const cwd = process.cwd();
const sessionArg = valueAfter("--session-id");
const resumeArg = valueAfter("--resume") ?? valueAfter("-r");
const sessionId = resumeArg ?? sessionArg;
if (!sessionId) {
  throw new Error("fake Claude expected --session-id or --resume");
}

writeFileSync(logPath, JSON.stringify({
  args,
  cwd,
  isTTY: Boolean(process.stdout.isTTY),
  stdinIsTTY: Boolean(process.stdin.isTTY),
}, null, 2));

if (mode === "hang") {
  setInterval(() => {}, 1000);
} else {
  const projectDir = join(homedir(), ".claude", "projects", resolve(cwd).replace(/[/.]/g, "-"));
  mkdirSync(projectDir, { recursive: true });
  const sessionPath = join(projectDir, sessionId + ".jsonl");
  const userText = args[args.length - 1] ?? "";
  const lines = [
    { type: "system", subtype: "init", sessionId },
    { type: "user", isSidechain: false, sessionId, timestamp: new Date().toISOString(), message: { role: "user", content: userText } },
    { type: "assistant", isSidechain: false, sessionId, timestamp: new Date().toISOString(), message: { role: "assistant", content: [{ type: "text", text: resumeArg ? "resumed answer" : "first answer" }] } },
    { type: "assistant", isSidechain: false, sessionId, timestamp: new Date().toISOString(), message: { role: "assistant", content: [{ type: "thinking", thinking: "Need a shell command." }, { type: "tool_use", id: "toolu_fake", name: "Bash", input: { command: "pwd" } }] } },
    { type: "user", isSidechain: false, sessionId, timestamp: new Date().toISOString(), message: { role: "user", content: [{ type: "tool_result", content: "tool output" }] } },
    { type: "assistant", isSidechain: false, sessionId, timestamp: new Date().toISOString(), message: { role: "assistant", content: [{ type: "text", text: resumeArg ? "done" : "second answer" }] } },
    { type: "system", subtype: "turn_duration", isSidechain: false, sessionId, timestamp: new Date().toISOString(), durationMs: 25 },
  ];
  const offsetBefore = statMaybe(sessionPath);
  for (const line of lines) {
    appendFileSync(sessionPath, JSON.stringify(line) + "\\n");
  }
  if (mode === "exit") {
    process.exit(0);
  }
  setInterval(() => {}, 1000);
}

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(130));

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function statMaybe(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}
`,
    "utf8",
  );
  await chmod(binPath, 0o755);
  await writeFile(modePath, "hold\n", "utf8");
  return { binPath, logPath, modePath };
}
