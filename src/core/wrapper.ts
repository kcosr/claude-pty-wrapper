import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertExistingSessionFileUnderProjectDir,
  claudeSessionFilePath,
  fileSizeIfExists,
  validateClaudeSessionId,
} from "./claude-paths.js";
import {
  claudeAssistantRecordText,
  isClaudeTurnTerminalRecord,
  realClaudeUserText,
  streamBoundarySeparator,
} from "./claude-records.js";
import { tailJsonl } from "./claude-session-tail.js";
import { ClaudePtyWrapperError, errorMessage } from "./errors.js";
import { type PtyHandle, openRawPtyLog, spawnPty } from "./pty-runner.js";
import {
  createSyntheticStreamJsonState,
  noteSyntheticUserTurn,
  syntheticStreamEventForRecord,
  syntheticStreamInitEvent,
  syntheticStreamResultEvent,
} from "./stream-json.js";

export type OutputMode = "text" | "json" | "stream-json" | "session-jsonl";

export interface ClaudePtyWrapperOptions {
  prompt: string;
  outputMode: OutputMode;
  cwd: string;
  claudeBin: string;
  timeoutMs: number;
  resumeSessionId?: string;
  sessionId?: string;
  model?: string;
  effort?: string;
  name?: string;
  dangerouslySkipPermissions?: boolean;
  claudeArgs?: string[];
  rawPtyLog?: string;
  wrapperDebug?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface RunStreams {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

type RaceResult =
  | { type: "complete" }
  | { type: "pty-complete" }
  | { type: "exit" }
  | { type: "timeout" }
  | { type: "tail-error"; error: unknown };

export async function runClaudePtyWrapper(
  options: ClaudePtyWrapperOptions,
  streams: RunStreams = { stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
  if (options.prompt.trim().length === 0) {
    throw new ClaudePtyWrapperError("prompt is required");
  }
  if (
    options.outputMode !== "text" &&
    options.outputMode !== "json" &&
    options.outputMode !== "session-jsonl" &&
    options.outputMode !== "stream-json"
  ) {
    throw new ClaudePtyWrapperError(`unsupported output mode: ${options.outputMode}`);
  }

  const cwd = realpathSync(resolve(options.cwd));
  const sessionId = options.resumeSessionId ?? options.sessionId ?? randomUUID();
  validateClaudeSessionId(sessionId);
  const sessionPath = claudeSessionFilePath(cwd, sessionId);

  if (options.resumeSessionId) {
    assertExistingSessionFileUnderProjectDir(cwd, sessionPath);
  }

  const startOffset = fileSizeIfExists(sessionPath);
  const args = buildClaudeArgs({
    prompt: options.prompt,
    resumeSessionId: options.resumeSessionId,
    sessionId: options.resumeSessionId ? undefined : sessionId,
    model: options.model,
    effort: options.effort,
    name: options.name,
    dangerouslySkipPermissions: options.dangerouslySkipPermissions,
    claudeArgs: options.claudeArgs ?? [],
  });

  debug(options, streams, `session id: ${sessionId}`);
  debug(options, streams, `session path: ${sessionPath}`);
  debug(options, streams, `session start offset: ${startOffset}`);
  debug(options, streams, `claude args: ${JSON.stringify(args)}`);

  const controller = new AbortController();
  const rawLog = openRawPtyLog(options.rawPtyLog);
  const ptyOutput = createPtyOutputObserver();
  let ptyHandle: PtyHandle;
  try {
    ptyHandle = spawnPty({
      command: options.claudeBin,
      args,
      cwd,
      env: options.env ?? process.env,
      onData: (data) => {
        rawLog?.write(data);
        ptyOutput.observe(data);
        if (options.wrapperDebug) {
          streams.stderr.write(data);
        }
      },
    });
  } catch (error) {
    rawLog?.end();
    throw new ClaudePtyWrapperError(`failed to spawn Claude: ${errorMessage(error)}`);
  }

  const tailPromise = streamTurnFromSessionFile({
    sessionPath,
    startOffset,
    outputMode: options.outputMode,
    cwd,
    sessionId,
    signal: controller.signal,
    streams,
    debug: (message) => debug(options, streams, message),
  }).then<RaceResult, RaceResult>(
    () => ({ type: "complete" }),
    (error) => ({ type: "tail-error", error }),
  );
  const ptyCompletionPromise = ptyOutput.completionPromise.then<RaceResult>(() => ({
    type: "pty-complete",
  }));
  const exitPromise = ptyHandle.waitForExit().then<RaceResult>(() => ({ type: "exit" }));
  const timeoutPromise = delay(options.timeoutMs, { ref: false }).then<RaceResult>(() => ({
    type: "timeout",
  }));

  try {
    const first = await Promise.race([
      tailPromise,
      ptyCompletionPromise,
      exitPromise,
      timeoutPromise,
    ]);
    let exitCode: number;
    if (first.type === "complete") {
      await closeClaudePty(ptyHandle);
      exitCode = 0;
    } else if (first.type === "pty-complete") {
      debug(options, streams, "observed PTY turn completion marker");
      await requestClaudePtyExit(ptyHandle);
      if (!(await waitForSessionGrowth(sessionPath, startOffset, 1_000))) {
        debug(options, streams, "Claude completed in the PTY, but no new session records appeared");
        exitCode = emitPtyFallbackOutput({
          outputMode: options.outputMode,
          text: ptyOutput.assistantText(),
          cwd,
          sessionId,
          streams,
        });
      } else {
        const graceResult = await Promise.race([tailPromise, delay(5_000).then(() => null)]);
        debug(options, streams, `post-PTY session tail result: ${graceResult?.type ?? "missing"}`);
        if (graceResult?.type === "complete") {
          exitCode = 0;
        } else if (graceResult?.type === "tail-error") {
          await terminateClaudePty(ptyHandle);
          throw asWrapperError(graceResult.error);
        } else {
          debug(
            options,
            streams,
            "Claude completed in the PTY, but no session completion record appeared",
          );
          exitCode = emitPtyFallbackOutput({
            outputMode: options.outputMode,
            text: ptyOutput.assistantText(),
            cwd,
            sessionId,
            streams,
          });
        }
      }
      await terminateClaudePty(ptyHandle);
    } else if (first.type === "exit") {
      const graceResult = await Promise.race([tailPromise, delay(2_000).then(() => null)]);
      if (graceResult?.type === "complete") {
        exitCode = 0;
      } else if (graceResult?.type === "tail-error") {
        throw asWrapperError(graceResult.error);
      } else {
        debug(options, streams, "Claude exited before a turn_duration record was observed");
        exitCode = 1;
      }
    } else if (first.type === "timeout") {
      debug(options, streams, `timed out after ${options.timeoutMs}ms`);
      await terminateClaudePty(ptyHandle);
      exitCode = 2;
    } else {
      await terminateClaudePty(ptyHandle);
      throw asWrapperError(first.error);
    }
    return exitCode;
  } finally {
    controller.abort();
    rawLog?.end();
  }
}

export function buildClaudeArgs(options: {
  prompt: string;
  resumeSessionId?: string;
  sessionId?: string;
  model?: string;
  effort?: string;
  name?: string;
  dangerouslySkipPermissions?: boolean;
  claudeArgs?: string[];
}): string[] {
  const args: string[] = [];
  if (options.resumeSessionId) {
    args.push("--resume", options.resumeSessionId);
  } else if (options.sessionId) {
    args.push("--session-id", options.sessionId);
  }
  args.push("--ax-screen-reader");
  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.effort) {
    args.push("--effort", options.effort);
  }
  if (options.name) {
    args.push("--name", options.name);
  }
  if (options.dangerouslySkipPermissions) {
    args.push("--dangerously-skip-permissions");
  }
  args.push(...(options.claudeArgs ?? []));
  args.push("--");
  args.push(options.prompt);
  return args;
}

async function streamTurnFromSessionFile(options: {
  sessionPath: string;
  startOffset: number;
  outputMode: OutputMode;
  cwd: string;
  sessionId: string;
  signal: AbortSignal;
  streams: RunStreams;
  debug?: (message: string) => void;
}): Promise<void> {
  let inTurn = false;
  let emittedText = "";
  const structuredState = createSyntheticStreamJsonState(options.sessionId);

  for await (const { line, record } of tailJsonl({
    path: options.sessionPath,
    startOffset: options.startOffset,
    signal: options.signal,
  })) {
    options.debug?.(
      `session record: ${String(record.type)}${
        typeof record.subtype === "string" ? `/${record.subtype}` : ""
      }`,
    );
    if (options.outputMode === "session-jsonl") {
      options.streams.stdout.write(`${line}\n`);
    }
    if (
      options.outputMode === "stream-json" &&
      !structuredState.emittedInit &&
      record.type === "system" &&
      record.subtype === "init"
    ) {
      writeJsonLine(
        options.streams,
        syntheticStreamInitEvent({
          cwd: options.cwd,
          sessionId: options.sessionId,
          source: record,
        }),
      );
      structuredState.emittedInit = true;
      continue;
    }

    if (realClaudeUserText(record) !== null) {
      inTurn = true;
      if (options.outputMode === "stream-json" || options.outputMode === "json") {
        noteSyntheticUserTurn(structuredState, record);
      }
      if (
        (options.outputMode === "stream-json" || options.outputMode === "json") &&
        !structuredState.emittedInit
      ) {
        if (options.outputMode === "stream-json") {
          writeJsonLine(
            options.streams,
            syntheticStreamInitEvent({
              cwd: options.cwd,
              sessionId: options.sessionId,
              source: null,
            }),
          );
        }
        structuredState.emittedInit = true;
      }
      continue;
    }

    if (!inTurn) {
      continue;
    }

    if (options.outputMode === "stream-json" || options.outputMode === "json") {
      const event = syntheticStreamEventForRecord(structuredState, record);
      if (event !== null) {
        if (options.outputMode === "stream-json") {
          writeJsonLine(options.streams, event);
        }
        continue;
      }
    }

    const assistantText = claudeAssistantRecordText(record);
    if (assistantText !== null) {
      if (options.outputMode === "text") {
        const separator = streamBoundarySeparator(emittedText, assistantText);
        options.streams.stdout.write(separator);
        options.streams.stdout.write(assistantText);
        emittedText += separator;
        emittedText += assistantText;
      }
      continue;
    }

    if (isClaudeTurnTerminalRecord(record)) {
      if (options.outputMode === "text" && emittedText.length > 0 && !emittedText.endsWith("\n")) {
        options.streams.stdout.write("\n");
      }
      if (options.outputMode === "stream-json") {
        writeJsonLine(options.streams, syntheticStreamResultEvent(structuredState, record));
      }
      if (options.outputMode === "json") {
        writeJsonLine(options.streams, syntheticStreamResultEvent(structuredState, record));
      }
      return;
    }
  }
  throw new ClaudePtyWrapperError("Claude session history ended before a turn_duration record");
}

function writeJsonLine(streams: RunStreams, value: Record<string, unknown>): void {
  streams.stdout.write(`${JSON.stringify(value)}\n`);
}

function createPtyOutputObserver(): {
  completionPromise: Promise<void>;
  observe(data: string): void;
  assistantText(): string | null;
} {
  let resolveCompletion: (() => void) | null = null;
  let completed = false;
  let raw = "";
  let completionIndex: number | null = null;
  const promise = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  return {
    completionPromise: promise,
    observe(data) {
      raw += data;
      if (raw.length > 1024 * 1024) {
        const trimmedBy = raw.length - 1024 * 1024;
        raw = raw.slice(trimmedBy);
        if (completionIndex !== null) {
          completionIndex = Math.max(0, completionIndex - trimmedBy);
        }
      }
      if (completed) {
        return;
      }
      const markerIndex = raw.indexOf("\x1b]133;D");
      if (markerIndex >= 0) {
        completed = true;
        completionIndex = markerIndex;
        resolveCompletion?.();
      }
    },
    assistantText() {
      return extractAssistantTextFromPty(raw.slice(0, completionIndex ?? raw.length));
    },
  };
}

function emitPtyFallbackOutput(options: {
  outputMode: OutputMode;
  text: string | null;
  cwd: string;
  sessionId: string;
  streams: RunStreams;
}): number {
  if (options.text === null) {
    return 1;
  }
  const text = options.text;
  if (options.outputMode === "text") {
    options.streams.stdout.write(text);
    if (!text.endsWith("\n")) {
      options.streams.stdout.write("\n");
    }
    return 0;
  }
  if (options.outputMode === "json") {
    writeJsonLine(options.streams, ptyFallbackResultEvent({ text, sessionId: options.sessionId }));
    return 0;
  }
  if (options.outputMode === "stream-json") {
    writeJsonLine(
      options.streams,
      syntheticStreamInitEvent({ cwd: options.cwd, sessionId: options.sessionId, source: null }),
    );
    writeJsonLine(options.streams, {
      type: "assistant",
      session_id: options.sessionId,
      message: {
        role: "assistant",
        content: [{ type: "text", text }],
      },
    });
    writeJsonLine(options.streams, ptyFallbackResultEvent({ text, sessionId: options.sessionId }));
    return 0;
  }
  return 1;
}

function ptyFallbackResultEvent(options: {
  text: string;
  sessionId: string;
}): Record<string, unknown> {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    api_error_status: null,
    num_turns: 1,
    result: options.text,
    stop_reason: "end_turn",
    session_id: options.sessionId,
    permission_denials: [],
    terminal_reason: "completed",
  };
}

function extractAssistantTextFromPty(raw: string): string | null {
  const cleaned = stripTerminalSequences(raw).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const marker = "claude:";
  const markerIndex = cleaned.lastIndexOf(marker);
  if (markerIndex < 0) {
    return null;
  }
  const lines = cleaned
    .slice(markerIndex + marker.length)
    .replace(/^ /, "")
    .split("\n");
  const answerLines: string[] = [];
  for (const line of lines) {
    if (answerLines.length > 0 && isPostAssistantUiLine(line)) {
      break;
    }
    answerLines.push(line);
  }
  const text = trimTrailingBlankLines(answerLines).join("\n");
  return text.length > 0 ? text : null;
}

function stripTerminalSequences(value: string): string {
  const esc = String.fromCharCode(0x1b);
  const bell = String.fromCharCode(0x07);
  return value
    .replace(new RegExp(`${esc}\\][\\s\\S]*?(?:${bell}|${esc}\\\\)`, "g"), "")
    .replace(new RegExp(`${esc}\\[[0-?]*[ -/]*[@-~]`, "g"), "")
    .replace(new RegExp(`${esc}[()][A-Za-z0-9]`, "g"), "")
    .replace(new RegExp(`${esc}[=>][0-9;?]*[A-Za-z]?`, "g"), "")
    .replace(new RegExp(`${esc}.`, "g"), "")
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 0x09 || code === 0x0a || code === 0x0d || (code >= 0x20 && code !== 0x7f);
    })
    .join("");
}

function isPostAssistantUiLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed === "$" ||
    trimmed.startsWith("-- INSERT --") ||
    trimmed.startsWith("Press Ctrl-D") ||
    trimmed.startsWith("Resume this session with:") ||
    trimmed.includes("running stop hooks") ||
    isTuiStatusLine(trimmed)
  );
}

function isTuiStatusLine(trimmedLine: string): boolean {
  return /^[^\s(]+…\s+\(\s*\d+s\b[^)]*\btokens\b[^)]*\)\s*$/u.test(trimmedLine);
}

function trimTrailingBlankLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") {
    end -= 1;
  }
  return lines.slice(0, end);
}

async function closeClaudePty(handle: PtyHandle): Promise<void> {
  await requestClaudePtyExit(handle);
  await Promise.race([handle.waitForExit(), delay(1_000)]);
  await terminateClaudePty(handle);
}

async function requestClaudePtyExit(handle: PtyHandle): Promise<void> {
  try {
    // Claude is running in an interactive PTY; EOT asks it to leave the input
    // prompt after we have already observed the durable turn completion marker.
    handle.write("\x04");
    await delay(250);
    handle.write("\x04");
  } catch {
    return;
  }
}

async function terminateClaudePty(handle: PtyHandle): Promise<void> {
  try {
    handle.kill("SIGTERM");
  } catch {}
  await Promise.race([handle.waitForExit(), delay(500)]);
  try {
    handle.kill("SIGKILL");
  } catch {}
}

async function delay(ms: number, options: { ref?: boolean } = {}): Promise<void> {
  await new Promise((resolveDelay) => {
    const timeout = setTimeout(resolveDelay, ms);
    if (options.ref === false) {
      timeout.unref();
    }
  });
}

async function waitForSessionGrowth(
  sessionPath: string,
  startOffset: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fileSizeIfExists(sessionPath) > startOffset) {
      return true;
    }
    await delay(25);
  }
  return fileSizeIfExists(sessionPath) > startOffset;
}

function debug(options: ClaudePtyWrapperOptions, streams: RunStreams, message: string): void {
  if (options.wrapperDebug) {
    streams.stderr.write(`claude-pty-wrapper: ${message}\n`);
  }
}

function asWrapperError(error: unknown): ClaudePtyWrapperError {
  if (error instanceof ClaudePtyWrapperError) {
    return error;
  }
  return new ClaudePtyWrapperError(errorMessage(error));
}
