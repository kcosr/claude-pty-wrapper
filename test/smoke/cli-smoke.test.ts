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
        "--permission-mode",
        "plan",
        "--append-system-prompt",
        "Prefer concise answers",
        "--allowed-tools",
        "Read",
        "Bash",
        "--debug",
        "api",
        "--verbose",
        "--plugin-dir",
        "/tmp/plugin-a",
        "--plugin-dir",
        "/tmp/plugin-b",
        "-p",
        "Summarize this repository",
      ],
      { cwd: workspace, env: { HOME: home } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("first answer\n\nsecond answer\n");
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
      "--permission-mode",
      "plan",
      "--append-system-prompt",
      "Prefer concise answers",
      "--allowed-tools",
      "Read",
      "Bash",
      "--debug",
      "api",
      "--verbose",
      "--plugin-dir",
      "/tmp/plugin-a",
      "--plugin-dir",
      "/tmp/plugin-b",
      "--",
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

  it("emits synthetic stream-json records preserving tools, tool results, and reasoning blocks", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-stream-work-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "claude-pty-stream-home-"));
    const fakeClaude = await createFakeClaudeBin();
    const sessionId = "496765ae-4ba7-4bfa-92aa-eeeb35db5a7b";

    const result = await runCli(
      [
        "--claude-bin",
        fakeClaude.binPath,
        "--cwd",
        workspace,
        "--session-id",
        sessionId,
        "-p",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
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
      ["assistant", null],
      ["assistant", null],
      ["user", null],
      ["assistant", null],
      ["result", "success"],
    ]);
    expect(records[0]).toMatchObject({
      type: "system",
      subtype: "init",
      cwd: workspace,
      session_id: sessionId,
    });
    expect(records[2]).toMatchObject({
      type: "assistant",
      session_id: sessionId,
      message: {
        content: [
          { type: "thinking", thinking: "Need a shell command." },
          { type: "tool_use", id: "toolu_fake", name: "Bash", input: { command: "pwd" } },
        ],
      },
    });
    expect(records[3]).toMatchObject({
      type: "user",
      session_id: sessionId,
      message: { content: [{ type: "tool_result", content: "tool output" }] },
    });
    expect(records.at(-1)).toMatchObject({
      type: "result",
      subtype: "success",
      is_error: false,
      num_turns: 1,
      result: "first answer\n\nsecond answer",
      stop_reason: "end_turn",
      session_id: sessionId,
      terminal_reason: "completed",
    });
    const invocation = JSON.parse(await readFile(fakeClaude.logPath, "utf8"));
    expect(invocation.args).not.toContain("--output-format");
    expect(invocation.args).not.toContain("--include-partial-messages");
  });

  it("emits Claude-shaped json output as a single result record", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-json-work-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "claude-pty-json-home-"));
    const fakeClaude = await createFakeClaudeBin();
    const sessionId = "690b6a99-4874-48e3-b45e-48f24103798b";

    const result = await runCli(
      [
        "--claude-bin",
        fakeClaude.binPath,
        "--cwd",
        workspace,
        "--session-id",
        sessionId,
        "-p",
        "--output-format",
        "json",
        "Show records",
      ],
      { cwd: workspace, env: { HOME: home } },
    );

    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "first answer\n\nsecond answer",
      session_id: sessionId,
      terminal_reason: "completed",
    });
    const invocation = JSON.parse(await readFile(fakeClaude.logPath, "utf8"));
    expect(invocation.args).not.toContain("--output-format");
    expect(invocation.args).not.toContain("-p");
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
      [
        "--claude-bin",
        fakeClaude.binPath,
        "--cwd",
        workspace,
        "--resume",
        sessionId,
        "-p",
        "Continue",
      ],
      { cwd: workspace, env: { HOME: home } },
    );

    expect(result.stdout).toBe("resumed answer\n\ndone\n");
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
      [
        "--claude-bin",
        fakeClaude.binPath,
        "--cwd",
        workspace,
        "--timeout",
        "0.2",
        "-p",
        "Never finish",
      ],
      { cwd: workspace, env: { HOME: home }, reject: false },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
  });

  it("terminates Claude and reports tail errors", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-tail-error-work-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "claude-pty-tail-error-home-"));
    const fakeClaude = await createFakeClaudeBin();
    const sessionId = "4845afe2-511f-4199-9f04-eec7f872bb61";
    await writeFile(fakeClaude.modePath, "malformed\n", "utf8");

    const result = await runCli(
      [
        "--claude-bin",
        fakeClaude.binPath,
        "--cwd",
        workspace,
        "--session-id",
        sessionId,
        "-p",
        "Break the session",
      ],
      { cwd: workspace, env: { HOME: home }, reject: false },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("invalid JSON");
    await expect(readFile(fakeClaude.signalPath, "utf8")).resolves.toBe("SIGTERM\n");
  });

  it("passes bare prompts through to Claude without wrapper output handling", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-bare-work-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "claude-pty-bare-home-"));
    const fakeClaude = await createFakeClaudeBin();
    await writeFile(fakeClaude.modePath, "passthrough\n", "utf8");

    const result = await runCli(
      [
        "--claude-bin",
        fakeClaude.binPath,
        "--cwd",
        workspace,
        "--model",
        "haiku",
        "--include-partial-messages",
        "--include-hook-events",
        "--",
        "Start interactively",
      ],
      { cwd: workspace, env: { HOME: home } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("passthrough output\n");
    const invocation = JSON.parse(await readFile(fakeClaude.logPath, "utf8"));
    expect(invocation.args).toEqual([
      "--model",
      "haiku",
      "--include-partial-messages",
      "--include-hook-events",
      "--",
      "Start interactively",
    ]);
    expect(invocation.args).not.toContain("--session-id");
  });

  it("rejects continue in wrapper mode", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-continue-work-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "claude-pty-continue-home-"));
    const fakeClaude = await createFakeClaudeBin();

    const result = await runCli(
      ["--claude-bin", fakeClaude.binPath, "--cwd", workspace, "-p", "--continue", "Continue"],
      { cwd: workspace, env: { HOME: home }, reject: false },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--continue is not supported by the PTY wrapper");
  });

  it("rejects stream-json input in wrapper mode", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-input-work-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "claude-pty-input-home-"));
    const fakeClaude = await createFakeClaudeBin();

    const result = await runCli(
      [
        "--claude-bin",
        fakeClaude.binPath,
        "--cwd",
        workspace,
        "-p",
        "--input-format",
        "stream-json",
        "Continue",
      ],
      { cwd: workspace, env: { HOME: home }, reject: false },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--input-format stream-json is not supported");
  });

  it("rejects output-format without print mode", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-format-work-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "claude-pty-format-home-"));
    const fakeClaude = await createFakeClaudeBin();

    const result = await runCli(
      [
        "--claude-bin",
        fakeClaude.binPath,
        "--cwd",
        workspace,
        "--output-format",
        "json",
        "Show records",
      ],
      { cwd: workspace, env: { HOME: home }, reject: false },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--output-format requires -p/--print");
  });
});
