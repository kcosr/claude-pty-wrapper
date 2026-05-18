import { constants as osConstants } from "node:os";
import { resolve } from "node:path";
import { ClaudePtyWrapperError } from "./errors.js";
import { type PtyExit, type PtyHandle, spawnPty } from "./pty-runner.js";

export interface ClaudePassthroughOptions {
  claudeBin: string;
  cwd: string;
  args: string[];
  freshness?: FreshnessOptions;
  env?: NodeJS.ProcessEnv;
}

export interface FreshnessOptions {
  intervalMs: number;
  message: string;
  maxIterations?: number;
  maxDurationMs?: number;
}

export async function runClaudePassthrough(options: ClaudePassthroughOptions): Promise<number> {
  let ptyHandle: PtyHandle;
  const freshness = options.freshness ? createFreshnessController(options.freshness) : null;
  try {
    ptyHandle = spawnPty({
      command: options.claudeBin,
      args: options.args,
      cwd: resolve(options.cwd),
      env: options.env ?? process.env,
      cols: terminalCols(),
      rows: terminalRows(),
      onData: (data) => {
        freshness?.noteActivity();
        process.stdout.write(data);
      },
    });
  } catch (error) {
    throw new ClaudePtyWrapperError(`failed to spawn Claude: ${errorMessage(error)}`);
  }

  const stdin = process.stdin;
  const previousRawMode = stdin.isTTY ? stdin.isRaw : undefined;

  const onStdinData = (chunk: Buffer | string) => {
    freshness?.noteActivity();
    ptyHandle.write(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk);
  };
  const onResize = () => {
    try {
      ptyHandle.resize(terminalCols(), terminalRows());
    } catch {}
  };

  try {
    if (stdin.isTTY && typeof stdin.setRawMode === "function") {
      stdin.setRawMode(true);
    }
    stdin.resume();
    stdin.on("data", onStdinData);
    process.on("SIGWINCH", onResize);
    onResize();
    freshness?.start((message) => ptyHandle.write(`${message}\r`));

    const exit = await ptyHandle.waitForExit();
    return ptyExitCode(exit);
  } finally {
    freshness?.stop();
    stdin.off("data", onStdinData);
    process.off("SIGWINCH", onResize);
    if (
      stdin.isTTY &&
      typeof stdin.setRawMode === "function" &&
      typeof previousRawMode === "boolean"
    ) {
      stdin.setRawMode(previousRawMode);
    }
    stdin.pause();
  }
}

function createFreshnessController(options: FreshnessOptions): {
  start(writeMessage: (message: string) => void): void;
  noteActivity(): void;
  stop(): void;
} {
  let timer: NodeJS.Timeout | null = null;
  let writeFreshnessMessage: ((message: string) => void) | null = null;
  let lastActivityAt = Date.now();
  let iterations = 0;
  let stopped = false;
  let startedAt = Date.now();

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const maxDurationRemaining = () => {
    if (options.maxDurationMs === undefined) {
      return Number.POSITIVE_INFINITY;
    }
    return options.maxDurationMs - (Date.now() - startedAt);
  };

  const schedule = () => {
    clearTimer();
    if (stopped) {
      return;
    }
    const remainingDuration = maxDurationRemaining();
    if (remainingDuration <= 0) {
      stopped = true;
      return;
    }
    const elapsedIdle = Date.now() - lastActivityAt;
    const untilIdle = Math.max(options.intervalMs - elapsedIdle, 0);
    const delay = Math.min(untilIdle, remainingDuration);
    timer = setTimeout(onTimer, delay);
    timer.unref();
  };

  const onTimer = () => {
    timer = null;
    if (stopped) {
      return;
    }
    if (maxDurationRemaining() <= 0) {
      stopped = true;
      return;
    }
    if (Date.now() - lastActivityAt < options.intervalMs) {
      schedule();
      return;
    }
    writeFreshnessMessage?.(options.message);
    iterations += 1;
    lastActivityAt = Date.now();
    if (options.maxIterations !== undefined && iterations >= options.maxIterations) {
      stopped = true;
      return;
    }
    schedule();
  };

  return {
    start(writeMessage) {
      writeFreshnessMessage = writeMessage;
      startedAt = Date.now();
      lastActivityAt = Date.now();
      schedule();
    },
    noteActivity() {
      if (stopped) {
        return;
      }
      lastActivityAt = Date.now();
      schedule();
    },
    stop() {
      stopped = true;
      clearTimer();
    },
  };
}

function ptyExitCode(exit: PtyExit): number {
  if (typeof exit.exitCode === "number") {
    return exit.exitCode;
  }
  if (typeof exit.signal === "number") {
    return 128 + exit.signal;
  }
  if (typeof exit.signal === "string") {
    return signalExitCode(exit.signal as NodeJS.Signals);
  }
  return 1;
}

function terminalCols(): number {
  return process.stdout.columns ?? 120;
}

function terminalRows(): number {
  return process.stdout.rows ?? 40;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function signalExitCode(signal: NodeJS.Signals): number {
  const signalNumber = osConstants.signals[signal];
  return signalNumber === undefined ? 1 : 128 + signalNumber;
}
