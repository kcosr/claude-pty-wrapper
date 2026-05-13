import { randomUUID } from "node:crypto";
import { access, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { testClaudeSessionFilePath } from "../helpers/claude-session-path.js";
import { runCli } from "../helpers/cli.js";

const liveSmokeEnabled = process.env.CLAUDE_PTY_WRAPPER_LIVE_SMOKE === "1";
const describeLive = liveSmokeEnabled ? describe : describe.skip;
const claudeBin =
  process.env.CLAUDE_PTY_WRAPPER_LIVE_CLAUDE_BIN ?? process.env.CLAUDE_BIN ?? "claude";
const liveModel = process.env.CLAUDE_PTY_WRAPPER_LIVE_MODEL;
const liveEffort = process.env.CLAUDE_PTY_WRAPPER_LIVE_EFFORT ?? "low";

describeLive("claude-pty-wrapper live Claude smoke", () => {
  it("runs a real fresh text turn and observes the durable session file", async () => {
    await assertClaudeAvailable();
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-live-text-"));
    const sessionId = randomUUID();
    const token = `CLAUDE_PTY_WRAPPER_LIVE_TEXT_${Date.now()}`;

    const result = await runCli(
      [
        "--claude-bin",
        claudeBin,
        "--cwd",
        workspace,
        "--session-id",
        sessionId,
        "--timeout",
        "120",
        ...forwardedLiveModelArgs(),
        "-p",
        `Reply with exactly this token and no extra text: ${token}`,
      ],
      { cwd: workspace },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(token);
    const sessionPath = testClaudeSessionFilePath(os.homedir(), workspace, sessionId);
    const sessionJsonl = await readFile(sessionPath, "utf8");
    expect(sessionJsonl).toContain(sessionId);
    expect(sessionJsonl).toContain("turn_duration");
  });

  it("runs a real session-jsonl turn and emits appended Claude records", async () => {
    await assertClaudeAvailable();
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-live-jsonl-"));
    const sessionId = randomUUID();
    const token = `CLAUDE_PTY_WRAPPER_LIVE_JSONL_${Date.now()}`;

    const result = await runCli(
      [
        "--claude-bin",
        claudeBin,
        "--cwd",
        workspace,
        "--session-id",
        sessionId,
        "--timeout",
        "120",
        ...forwardedLiveModelArgs(),
        "--session-jsonl",
        `Reply with exactly this token and no extra text: ${token}`,
      ],
      { cwd: workspace },
    );

    expect(result.exitCode).toBe(0);
    const records = result.stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
    expect(records.some((record) => record.type === "user")).toBe(true);
    expect(records.some((record) => record.type === "assistant")).toBe(true);
    expect(
      records.some((record) => record.type === "system" && record.subtype === "turn_duration"),
    ).toBe(true);
    expect(result.stdout).toContain(sessionId);
  });
});

function forwardedLiveModelArgs(): string[] {
  const args: string[] = [];
  if (liveModel) {
    args.push("--model", liveModel);
  }
  if (liveEffort) {
    args.push("--effort", liveEffort);
  }
  return args;
}

async function assertClaudeAvailable(): Promise<void> {
  if (claudeBin.includes(path.sep)) {
    await access(claudeBin);
  }
}
