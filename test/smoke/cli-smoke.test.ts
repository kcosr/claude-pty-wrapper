import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
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
      { cwd: workspace, env: { HOME: home }, timeoutMs: 10_000 },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("first answer\n\nsecond answer\n");
    const invocation = JSON.parse(await readFile(fakeClaude.logPath, "utf8"));
    expect(invocation.isTTY).toBe(true);
    expect(invocation.stdinIsTTY).toBe(true);
    expect(invocation.cwd).toBe(await realpath(workspace));
    expect(invocation.args).toEqual([
      "--session-id",
      sessionId,
      "--ax-screen-reader",
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

  it("completes when Claude flushes the session file only after PTY turn completion", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-delayed-work-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "claude-pty-delayed-home-"));
    const fakeClaude = await createFakeClaudeBin();
    const sessionId = "d51afd62-57c8-4f08-ad09-05f9846212bc";
    await writeFile(fakeClaude.modePath, "delayed-session-file\n", "utf8");

    const result = await runCli(
      [
        "--claude-bin",
        fakeClaude.binPath,
        "--cwd",
        workspace,
        "--session-id",
        sessionId,
        "--timeout",
        "2",
        "-p",
        "Summarize this repository",
      ],
      { cwd: workspace, env: { HOME: home }, timeoutMs: 10_000 },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("first answer\n\nsecond answer\n");
    const invocation = JSON.parse(await readFile(fakeClaude.logPath, "utf8"));
    expect(invocation.args).toContain("--ax-screen-reader");
  });

  it("falls back to PTY assistant text when no session file is written", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-pty-only-work-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "claude-pty-pty-only-home-"));
    const fakeClaude = await createFakeClaudeBin();
    const sessionId = "5da9ecad-1c81-47ec-b348-8d0a1be56efa";
    await writeFile(fakeClaude.modePath, "pty-only\n", "utf8");

    const result = await runCli(
      [
        "--claude-bin",
        fakeClaude.binPath,
        "--cwd",
        workspace,
        "--session-id",
        sessionId,
        "--timeout",
        "2",
        "-p",
        "Summarize this repository",
      ],
      { cwd: workspace, env: { HOME: home }, timeoutMs: 10_000 },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("first answer\nsecond answer\n");
  });

  it("falls back to PTY assistant text for json output when no session file is written", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-pty-json-work-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "claude-pty-pty-json-home-"));
    const fakeClaude = await createFakeClaudeBin();
    const sessionId = "e617cb62-d0f5-4660-9d1b-4d6b7c380b2d";
    await writeFile(fakeClaude.modePath, "pty-only\n", "utf8");

    const result = await runCli(
      [
        "--claude-bin",
        fakeClaude.binPath,
        "--cwd",
        workspace,
        "--session-id",
        sessionId,
        "--timeout",
        "2",
        "-p",
        "--output-format",
        "json",
        "Summarize this repository",
      ],
      { cwd: workspace, env: { HOME: home }, timeoutMs: 10_000 },
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      type: "result",
      subtype: "success",
      result: "first answer\nsecond answer",
      session_id: sessionId,
      terminal_reason: "completed",
    });
  });

  it("ignores tool and status output when falling back to PTY assistant text", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-pty-tool-work-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "claude-pty-pty-tool-home-"));
    const fakeClaude = await createFakeClaudeBin();
    const sessionId = "c264be02-bb19-4d49-b837-cb0f8e355f32";
    await writeFile(fakeClaude.modePath, "pty-only-tool\n", "utf8");

    const result = await runCli(
      [
        "--claude-bin",
        fakeClaude.binPath,
        "--cwd",
        workspace,
        "--session-id",
        sessionId,
        "--timeout",
        "2",
        "-p",
        "Use a tool",
      ],
      { cwd: workspace, env: { HOME: home }, timeoutMs: 10_000 },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("final answer\n");
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
      cwd: await realpath(workspace),
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
    const sessionPath = testClaudeSessionFilePath(home, await realpath(workspace), sessionId);
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
    expect(result.stdout.replace(/\r\n/g, "\n")).toBe("passthrough output\n");
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
    expect(invocation.isTTY).toBe(true);
    expect(invocation.stdinIsTTY).toBe(true);
  });

  it("relays user stdin to bare passthrough Claude", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-stdin-work-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "claude-pty-stdin-home-"));
    const fakeClaude = await createFakeClaudeBin();
    await writeFile(fakeClaude.modePath, "passthrough-stdin-count:1\n", "utf8");

    const result = await runCli(
      ["--claude-bin", fakeClaude.binPath, "--cwd", workspace, "--", "Start interactively"],
      { cwd: workspace, env: { HOME: home }, input: "hello from user\n" },
    );

    expect(result.exitCode).toBe(0);
    const chunks = await readStdinLog(fakeClaude.stdinLogPath);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].data).toContain("hello from user");
  });

  it("relays split multibyte stdin to bare passthrough Claude", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-utf8-work-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "claude-pty-utf8-home-"));
    const fakeClaude = await createFakeClaudeBin();
    await writeFile(fakeClaude.modePath, "passthrough-stdin-count:1\n", "utf8");

    const euro = Buffer.from("€\n", "utf8");
    const result = await runCli(
      ["--claude-bin", fakeClaude.binPath, "--cwd", workspace, "--", "Start interactively"],
      {
        cwd: workspace,
        env: { HOME: home },
        timedInput: [
          { delayMs: 10, data: euro.subarray(0, 1) },
          { delayMs: 20, data: euro.subarray(1) },
        ],
      },
    );

    expect(result.exitCode).toBe(0);
    const chunks = await readStdinLog(fakeClaude.stdinLogPath);
    expect(chunks.map((chunk) => chunk.data).join("")).toContain("€");
  });

  it("propagates non-zero bare passthrough exit codes", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-exit-work-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "claude-pty-exit-home-"));
    const fakeClaude = await createFakeClaudeBin();
    await writeFile(fakeClaude.modePath, "passthrough-exit-code:3\n", "utf8");

    const result = await runCli(["--claude-bin", fakeClaude.binPath, "--cwd", workspace], {
      cwd: workspace,
      env: { HOME: home },
      reject: false,
    });

    expect(result.exitCode).toBe(3);
  });

  it("maps bare passthrough signal exits to shell-style exit codes", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-signal-work-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "claude-pty-signal-home-"));
    const fakeClaude = await createFakeClaudeBin();
    await writeFile(fakeClaude.modePath, "passthrough-signal:SIGKILL\n", "utf8");

    const result = await runCli(["--claude-bin", fakeClaude.binPath, "--cwd", workspace], {
      cwd: workspace,
      env: { HOME: home },
      reject: false,
    });

    expect(result.exitCode).toBe(137);
  });

  it("injects the default freshness message after passthrough idle", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-fresh-default-work-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "claude-pty-fresh-default-home-"));
    const fakeClaude = await createFakeClaudeBin();
    await writeFile(fakeClaude.modePath, "passthrough-stdin-count:1\n", "utf8");

    const result = await runCli(
      [
        "--claude-bin",
        fakeClaude.binPath,
        "--cwd",
        workspace,
        "--freshness-interval",
        "0.05",
        "Start interactively",
      ],
      { cwd: workspace, env: { HOME: home } },
    );

    expect(result.exitCode).toBe(0);
    const chunks = await readStdinLog(fakeClaude.stdinLogPath);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].data).toContain("Please wait for further instructions.");
  });

  it("injects a custom freshness message after passthrough idle", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-fresh-custom-work-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "claude-pty-fresh-custom-home-"));
    const fakeClaude = await createFakeClaudeBin();
    await writeFile(fakeClaude.modePath, "passthrough-stdin-count:1\n", "utf8");

    const result = await runCli(
      [
        "--claude-bin",
        fakeClaude.binPath,
        "--cwd",
        workspace,
        "--freshness-interval",
        "0.05",
        "--freshness-message",
        "Still here; wait for more input.",
      ],
      { cwd: workspace, env: { HOME: home } },
    );

    expect(result.exitCode).toBe(0);
    const chunks = await readStdinLog(fakeClaude.stdinLogPath);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].data).toContain("Still here; wait for more input.");
  });

  it("resets the freshness timer on passthrough PTY output activity", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-fresh-output-work-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "claude-pty-fresh-output-home-"));
    const fakeClaude = await createFakeClaudeBin();
    await writeFile(fakeClaude.modePath, "passthrough-periodic-output:50:3\n", "utf8");
    const startedAt = Date.now();

    const result = await runCli(
      ["--claude-bin", fakeClaude.binPath, "--cwd", workspace, "--freshness-interval", "0.6"],
      { cwd: workspace, env: { HOME: home } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.replace(/\r\n/g, "\n")).toContain("activity 3\n");
    const chunks = await readStdinLog(fakeClaude.stdinLogPath);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].data).toContain("Please wait for further instructions.");
    expect(chunks[0].time - startedAt).toBeGreaterThanOrEqual(650);
  });

  it("resets the freshness timer on user stdin activity", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-fresh-stdin-work-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "claude-pty-fresh-stdin-home-"));
    const fakeClaude = await createFakeClaudeBin();
    await writeFile(fakeClaude.modePath, "passthrough-stdin-count:2\n", "utf8");
    const startedAt = Date.now();

    const result = await runCli(
      ["--claude-bin", fakeClaude.binPath, "--cwd", workspace, "--freshness-interval", "0.08"],
      {
        cwd: workspace,
        env: { HOME: home },
        timedInput: [{ delayMs: 40, data: "human input\n" }],
      },
    );

    expect(result.exitCode).toBe(0);
    const chunks = await readStdinLog(fakeClaude.stdinLogPath);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].data).toContain("human input");
    expect(chunks[1].data).toContain("Please wait for further instructions.");
    expect(chunks[1].time - startedAt).toBeGreaterThanOrEqual(100);
  });

  it("stops freshness injection after the maximum iterations", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-fresh-max-work-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "claude-pty-fresh-max-home-"));
    const fakeClaude = await createFakeClaudeBin();
    await writeFile(fakeClaude.modePath, "passthrough-exit-after:220\n", "utf8");

    const result = await runCli(
      [
        "--claude-bin",
        fakeClaude.binPath,
        "--cwd",
        workspace,
        "--freshness-interval",
        "0.04",
        "--freshness-max-iterations",
        "2",
      ],
      { cwd: workspace, env: { HOME: home } },
    );

    expect(result.exitCode).toBe(0);
    const chunks = await readStdinLog(fakeClaude.stdinLogPath);
    expect(chunks).toHaveLength(2);
    expect(chunks.every((chunk) => chunk.data.includes("Please wait"))).toBe(true);
  });

  it("stops freshness injection after the maximum duration", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-fresh-duration-work-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "claude-pty-fresh-duration-home-"));
    const fakeClaude = await createFakeClaudeBin();
    await writeFile(fakeClaude.modePath, "passthrough-exit-after:160\n", "utf8");

    const result = await runCli(
      [
        "--claude-bin",
        fakeClaude.binPath,
        "--cwd",
        workspace,
        "--freshness-interval",
        "0.08",
        "--freshness-max-duration",
        "0.05",
      ],
      { cwd: workspace, env: { HOME: home } },
    );

    expect(result.exitCode).toBe(0);
    await expect(readStdinLog(fakeClaude.stdinLogPath)).resolves.toEqual([]);
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

  it.each([
    {
      name: "message without interval",
      args: ["--freshness-message", "wait"],
      stderr: "--freshness-message requires --freshness-interval",
    },
    {
      name: "max iterations without interval",
      args: ["--freshness-max-iterations", "1"],
      stderr: "--freshness-max-iterations requires --freshness-interval",
    },
    {
      name: "max duration without interval",
      args: ["--freshness-max-duration", "1"],
      stderr: "--freshness-max-duration requires --freshness-interval",
    },
    {
      name: "max iterations with max duration",
      args: [
        "--freshness-interval",
        "1",
        "--freshness-max-iterations",
        "1",
        "--freshness-max-duration",
        "1",
      ],
      stderr: "choose either --freshness-max-iterations or --freshness-max-duration",
    },
    {
      name: "invalid interval",
      args: ["--freshness-interval", "0"],
      stderr: "freshness interval must be a positive number of seconds",
    },
    {
      name: "invalid max iterations",
      args: ["--freshness-interval", "1", "--freshness-max-iterations", "1.5"],
      stderr: "freshness max iterations must be a positive integer",
    },
    {
      name: "invalid max duration",
      args: ["--freshness-interval", "1", "--freshness-max-duration", "0"],
      stderr: "freshness max duration must be a positive number of seconds",
    },
    {
      name: "interval with wrapper mode",
      args: ["-p", "--freshness-interval", "1"],
      stderr:
        "--freshness-interval requires passthrough mode and cannot be used with wrapper output mode",
    },
    {
      name: "message with wrapper mode",
      args: ["-p", "--freshness-message", "wait"],
      stderr:
        "--freshness-message requires passthrough mode and cannot be used with wrapper output mode",
    },
    {
      name: "max iterations with wrapper mode",
      args: ["-p", "--freshness-max-iterations", "1"],
      stderr:
        "--freshness-max-iterations requires passthrough mode and cannot be used with wrapper output mode",
    },
    {
      name: "max duration with wrapper mode",
      args: ["-p", "--freshness-max-duration", "1"],
      stderr:
        "--freshness-max-duration requires passthrough mode and cannot be used with wrapper output mode",
    },
  ])("rejects invalid freshness flags: $name", async ({ args, stderr }) => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-fresh-invalid-work-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "claude-pty-fresh-invalid-home-"));
    const fakeClaude = await createFakeClaudeBin();

    const result = await runCli(
      ["--claude-bin", fakeClaude.binPath, "--cwd", workspace, ...args, "Prompt"],
      { cwd: workspace, env: { HOME: home }, reject: false },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(stderr);
  });
});

interface StdinLogEntry {
  data: string;
  time: number;
}

async function readStdinLog(path: string): Promise<StdinLogEntry[]> {
  try {
    const text = await readFile(path, "utf8");
    return text
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as StdinLogEntry);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
