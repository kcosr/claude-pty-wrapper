import { randomUUID } from "node:crypto";
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
import { ClaudePtyWrapperError } from "./errors.js";
import { type PtyHandle, openRawPtyLog, spawnPty } from "./pty-runner.js";

export type OutputMode = "text" | "session-jsonl";

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
  rawPtyLog?: string;
  debug?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface RunStreams {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

type RaceResult =
  | { type: "complete" }
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
  if (options.outputMode !== "text" && options.outputMode !== "session-jsonl") {
    throw new ClaudePtyWrapperError(`unsupported output mode: ${options.outputMode}`);
  }

  const cwd = resolve(options.cwd);
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
  });

  debug(options, streams, `session id: ${sessionId}`);
  debug(options, streams, `session path: ${sessionPath}`);
  debug(options, streams, `claude args: ${JSON.stringify(args)}`);

  const controller = new AbortController();
  const rawLog = openRawPtyLog(options.rawPtyLog);
  let ptyHandle: PtyHandle;
  try {
    ptyHandle = spawnPty({
      command: options.claudeBin,
      args,
      cwd,
      env: options.env ?? process.env,
      onData: (data) => {
        rawLog?.write(data);
        if (options.debug) {
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
    signal: controller.signal,
    streams,
  }).then<RaceResult, RaceResult>(
    () => ({ type: "complete" }),
    (error) => ({ type: "tail-error", error }),
  );
  const exitPromise = ptyHandle.waitForExit().then<RaceResult>(() => ({ type: "exit" }));
  const timeoutPromise = delay(options.timeoutMs).then<RaceResult>(() => ({ type: "timeout" }));

  const first = await Promise.race([tailPromise, exitPromise, timeoutPromise]);
  let exitCode: number;
  if (first.type === "complete") {
    await closeClaudePty(ptyHandle);
    exitCode = 0;
  } else if (first.type === "exit") {
    const graceResult = await Promise.race([tailPromise, delay(1_000).then(() => null)]);
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
    throw asWrapperError(first.error);
  }

  controller.abort();
  rawLog?.end();
  return exitCode;
}

export function buildClaudeArgs(options: {
  prompt: string;
  resumeSessionId?: string;
  sessionId?: string;
  model?: string;
  effort?: string;
  name?: string;
  dangerouslySkipPermissions?: boolean;
}): string[] {
  const args: string[] = [];
  if (options.resumeSessionId) {
    args.push("--resume", options.resumeSessionId);
  } else if (options.sessionId) {
    args.push("--session-id", options.sessionId);
  }
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
  args.push(options.prompt);
  return args;
}

async function streamTurnFromSessionFile(options: {
  sessionPath: string;
  startOffset: number;
  outputMode: OutputMode;
  signal: AbortSignal;
  streams: RunStreams;
}): Promise<void> {
  let inTurn = false;
  let emittedText = "";

  for await (const { line, record } of tailJsonl({
    path: options.sessionPath,
    startOffset: options.startOffset,
    signal: options.signal,
  })) {
    if (options.outputMode === "session-jsonl") {
      options.streams.stdout.write(`${line}\n`);
    }

    if (realClaudeUserText(record) !== null) {
      inTurn = true;
      continue;
    }

    if (!inTurn) {
      continue;
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
      return;
    }
  }
}

async function closeClaudePty(handle: PtyHandle): Promise<void> {
  try {
    handle.write("\x04");
    await delay(250);
    handle.write("\x04");
  } catch {
    return;
  }
  await Promise.race([handle.waitForExit(), delay(1_000)]);
  await terminateClaudePty(handle);
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

async function delay(ms: number): Promise<void> {
  await new Promise((resolveDelay) => {
    const timeout = setTimeout(resolveDelay, ms);
    timeout.unref();
  });
}

function debug(options: ClaudePtyWrapperOptions, streams: RunStreams, message: string): void {
  if (options.debug) {
    streams.stderr.write(`claude-pty-wrapper: ${message}\n`);
  }
}

function asWrapperError(error: unknown): ClaudePtyWrapperError {
  if (error instanceof ClaudePtyWrapperError) {
    return error;
  }
  return new ClaudePtyWrapperError(errorMessage(error));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
