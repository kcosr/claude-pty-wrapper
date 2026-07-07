import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface FakeClaudeBin {
  binPath: string;
  leakedChildPidPath: string;
  leakedChildSignalPath: string;
  logPath: string;
  modePath: string;
  signalPath: string;
  stdinLogPath: string;
}

export async function createFakeClaudeBin(): Promise<FakeClaudeBin> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fake-claude-bin-"));
  const binPath = path.join(dir, "claude");
  const leakedChildPidPath = path.join(dir, "leaked-child.pid");
  const leakedChildSignalPath = path.join(dir, "leaked-child-signal.txt");
  const logPath = path.join(dir, "invocation.json");
  const modePath = path.join(dir, "mode.txt");
  const signalPath = path.join(dir, "signal.txt");
  const stdinLogPath = path.join(dir, "stdin.jsonl");
  await writeFile(
    binPath,
    `#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const logPath = ${JSON.stringify(logPath)};
const leakedChildPidPath = ${JSON.stringify(leakedChildPidPath)};
const leakedChildSignalPath = ${JSON.stringify(leakedChildSignalPath)};
const modePath = ${JSON.stringify(modePath)};
const signalPath = ${JSON.stringify(signalPath)};
const stdinLogPath = ${JSON.stringify(stdinLogPath)};
const args = process.argv.slice(2);
const mode = readFileSync(modePath, "utf8").trim();
const cwd = process.env.PWD ?? process.cwd();
const sessionArg = valueAfter("--session-id");
const resumeArg = valueAfter("--resume") ?? valueAfter("-r");
const sessionId = resumeArg ?? sessionArg;

writeFileSync(logPath, JSON.stringify({
  args,
  cwd,
  isTTY: Boolean(process.stdout.isTTY),
  stdinIsTTY: Boolean(process.stdin.isTTY),
}, null, 2));

if (mode === "passthrough") {
  console.log("passthrough output");
  setTimeout(() => process.exit(0), 25);
} else if (mode.startsWith("passthrough-exit-code:")) {
  const code = Number(mode.split(":")[1]);
  setTimeout(() => process.exit(code), 25);
} else if (mode.startsWith("passthrough-signal:")) {
  const signal = mode.split(":")[1];
  setTimeout(() => process.kill(process.pid, signal), 25);
} else if (mode.startsWith("passthrough-stdin-count:")) {
  const expectedChunks = Number(mode.split(":")[1]);
  let chunks = 0;
  process.stdin.on("data", (chunk) => {
    chunks += 1;
    appendFileSync(stdinLogPath, JSON.stringify({ data: chunk.toString("utf8"), time: Date.now() }) + "\\n");
    if (chunks >= expectedChunks) {
      process.exit(0);
    }
  });
  setInterval(() => {}, 1000);
} else if (mode.startsWith("passthrough-periodic-output:")) {
  const [, intervalText, countText] = mode.split(":");
  const intervalMs = Number(intervalText);
  const count = Number(countText);
  let emitted = 0;
  const emit = () => {
    emitted += 1;
    process.stdout.write("activity " + emitted + "\\n");
    if (emitted >= count) {
      clearInterval(interval);
    }
  };
  process.stdin.on("data", (chunk) => {
    appendFileSync(stdinLogPath, JSON.stringify({ data: chunk.toString("utf8"), time: Date.now() }) + "\\n");
    process.exit(0);
  });
  const interval = setInterval(emit, intervalMs);
  emit();
  setInterval(() => {}, 1000);
} else if (mode.startsWith("passthrough-exit-after:")) {
  const delayMs = Number(mode.split(":")[1]);
  process.stdin.on("data", (chunk) => {
    appendFileSync(stdinLogPath, JSON.stringify({ data: chunk.toString("utf8"), time: Date.now() }) + "\\n");
  });
  setTimeout(() => process.exit(0), delayMs);
  setInterval(() => {}, 1000);
} else if (!sessionId) {
  throw new Error("fake Claude expected --session-id or --resume");
} else if (mode === "hang") {
  setInterval(() => {}, 1000);
} else {
  const projectDir = join(homedir(), ".claude", "projects", resolve(cwd).replace(/[/.]/g, "-"));
  mkdirSync(projectDir, { recursive: true });
  const sessionPath = join(projectDir, sessionId + ".jsonl");
  if (mode === "malformed") {
    appendFileSync(sessionPath, "{not valid json\\n");
    setInterval(() => {}, 1000);
  } else {
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
    if (mode === "leak-stdio-child") {
      const child = spawn(process.execPath, [
        "-e",
        ${JSON.stringify(`
const { appendFileSync } = require("node:fs");
const signalPath = process.argv[1];
process.on("SIGHUP", () => {});
process.on("SIGTERM", () => {
  appendFileSync(signalPath, "MCP_SIGTERM\\n");
  process.exit(0);
});
setInterval(() => {}, 1000);
`)},
        leakedChildSignalPath,
      ], { stdio: "inherit" });
      if (child.pid === undefined) {
        throw new Error("failed to spawn leaked stdio child");
      }
      writeFileSync(leakedChildPidPath, String(child.pid) + "\\n");
      setInterval(() => {}, 1000);
    } else if (mode === "exit") {
      process.exit(0);
    } else {
      setInterval(() => {}, 1000);
    }
  }
}

process.on("SIGTERM", () => {
  writeFileSync(signalPath, "SIGTERM\\n");
  process.exit(0);
});
process.on("SIGINT", () => {
  writeFileSync(signalPath, "SIGINT\\n");
  process.exit(130);
});

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
  return {
    binPath,
    leakedChildPidPath,
    leakedChildSignalPath,
    logPath,
    modePath,
    signalPath,
    stdinLogPath,
  };
}
