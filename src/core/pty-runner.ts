import { type WriteStream, createWriteStream } from "node:fs";
import * as pty from "node-pty";

export interface PtyRunOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
  onData?: (data: string) => void;
}

export interface PtyExit {
  exitCode: number;
  signal: number;
}

export interface PtyHandle {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  waitForExit(): Promise<PtyExit>;
}

export function spawnPty(options: PtyRunOptions): PtyHandle {
  const proc = pty.spawn(options.command, options.args, {
    cwd: options.cwd,
    env: {
      ...options.env,
      TERM: options.env.TERM ?? "xterm-256color",
    },
    cols: options.cols ?? process.stdout.columns ?? 120,
    rows: options.rows ?? process.stdout.rows ?? 40,
  });

  proc.onData((data) => options.onData?.(data));

  const exitPromise = new Promise<PtyExit>((resolve) => {
    proc.onExit((event) => {
      resolve({ exitCode: event.exitCode, signal: event.signal ?? 0 });
    });
  });

  return {
    write(data) {
      proc.write(data);
    },
    resize(cols, rows) {
      proc.resize(cols, rows);
    },
    kill(signal) {
      killPtyProcessGroup(proc, signal);
    },
    waitForExit() {
      return exitPromise;
    },
  };
}

function killPtyProcessGroup(proc: pty.IPty, signal?: string): void {
  if (process.platform === "win32") {
    proc.kill(signal);
    return;
  }
  try {
    // forkpty children are session/process-group leaders on Unix. Claude's
    // stdio MCP servers inherit that process group, so group signaling is what
    // releases every process that may still hold the PTY slave open.
    process.kill(-proc.pid, signal ?? "SIGHUP");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ESRCH" || error.code === "EINVAL")
    ) {
      proc.kill(signal);
      return;
    }
    throw error;
  }
}

export function openRawPtyLog(path: string | undefined): WriteStream | null {
  if (!path) {
    return null;
  }
  return createWriteStream(path, { flags: "a" });
}
