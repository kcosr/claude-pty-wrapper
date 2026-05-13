import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { testClaudeSessionFilePath } from "../helpers/claude-session-path.js";
import { runCli } from "../helpers/cli.js";
import { createFakeClaudeBin } from "../helpers/fake-claude.js";

describe("claude-pty-wrapper CLI smoke", () => {
  it("runs a fresh text turn through a real PTY and forwards Claude flags", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-smoke-work-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "claude-pty-smoke-home-"));
    const fakeClaude = await createFakeClaudeBin();
    const sessionId = "18a18377-217d-4b29-9a68-c70a89b79330";

    const result = await runCli(
      [
        "--claude-bin",
        fakeClaude.binPath,
        "--cwd",
        workspace,
        "--session-id",
        sessionId,
        "--model",
        "sonnet",
        "--effort",
        "high",
        "--name",
        "smoke-test",
        "--dangerously-skip-permissions",
        "-p",
        "Summarize this repository",
      ],
      { cwd: workspace, env: { HOME: home } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("first answer\n\nsecond answer");
    const invocation = JSON.parse(await readFile(fakeClaude.logPath, "utf8"));
    expect(invocation.isTTY).toBe(true);
    expect(invocation.stdinIsTTY).toBe(true);
    expect(invocation.cwd).toBe(workspace);
    expect(invocation.args).toEqual([
      "--session-id",
      sessionId,
      "--model",
      "sonnet",
      "--effort",
      "high",
      "--name",
      "smoke-test",
      "--dangerously-skip-permissions",
      "Summarize this repository",
    ]);
  });

  it("emits raw appended session JSONL records", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-jsonl-work-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "claude-pty-jsonl-home-"));
    const fakeClaude = await createFakeClaudeBin();
    const sessionId = "2a4ff898-605d-4da7-9bea-6818e16222fc";

    const result = await runCli(
      [
        "--claude-bin",
        fakeClaude.binPath,
        "--cwd",
        workspace,
        "--session-id",
        sessionId,
        "--session-jsonl",
        "Show records",
      ],
      { cwd: workspace, env: { HOME: home } },
    );

    const records = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records.map((record) => [record.type, record.subtype ?? null])).toEqual([
      ["system", "init"],
      ["user", null],
      ["assistant", null],
      ["assistant", null],
      ["user", null],
      ["assistant", null],
      ["system", "turn_duration"],
    ]);
  });

  it("resumes from the existing session file offset and does not print prior turns", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-resume-work-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "claude-pty-resume-home-"));
    const fakeClaude = await createFakeClaudeBin();
    const sessionId = "370ac738-80f4-4d5c-9657-03f6b349ac1a";
    const sessionPath = testClaudeSessionFilePath(home, workspace, sessionId);
    await mkdir(path.dirname(sessionPath), { recursive: true });
    await writeFile(
      sessionPath,
      [
        JSON.stringify({
          type: "user",
          isSidechain: false,
          message: { role: "user", content: "old prompt" },
        }),
        JSON.stringify({
          type: "assistant",
          isSidechain: false,
          message: { role: "assistant", content: [{ type: "text", text: "old answer" }] },
        }),
        JSON.stringify({ type: "system", subtype: "turn_duration", isSidechain: false }),
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await runCli(
      ["--claude-bin", fakeClaude.binPath, "--cwd", workspace, "--resume", sessionId, "Continue"],
      { cwd: workspace, env: { HOME: home } },
    );

    expect(result.stdout).toBe("resumed answer\n\ndone");
    const invocation = JSON.parse(await readFile(fakeClaude.logPath, "utf8"));
    expect(invocation.args.slice(0, 2)).toEqual(["--resume", sessionId]);
    expect(invocation.args).not.toContain("--session-id");
  });

  it("returns exit code 2 when the session never completes", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-timeout-work-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "claude-pty-timeout-home-"));
    const fakeClaude = await createFakeClaudeBin();
    await writeFile(fakeClaude.modePath, "hang\n", "utf8");

    const result = await runCli(
      ["--claude-bin", fakeClaude.binPath, "--cwd", workspace, "--timeout", "0.2", "Never finish"],
      { cwd: workspace, env: { HOME: home }, reject: false },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
  });
});
