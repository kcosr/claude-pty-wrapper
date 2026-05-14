import { spawn } from "node:child_process";
import { constants as osConstants } from "node:os";
import { resolve } from "node:path";
import { ClaudePtyWrapperError } from "./errors.js";

export interface ClaudePassthroughOptions {
  claudeBin: string;
  cwd: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}

export async function runClaudePassthrough(options: ClaudePassthroughOptions): Promise<number> {
  const child = spawn(options.claudeBin, options.args, {
    cwd: resolve(options.cwd),
    env: options.env ?? process.env,
    stdio: "inherit",
  });

  return await new Promise<number>((resolveExit, reject) => {
    child.on("error", (error) => {
      reject(new ClaudePtyWrapperError(`failed to spawn Claude: ${error.message}`));
    });
    child.on("exit", (code, signal) => {
      if (typeof code === "number") {
        resolveExit(code);
        return;
      }
      resolveExit(signalExitCode(signal));
    });
  });
}

function signalExitCode(signal: NodeJS.Signals | null): number {
  if (signal === null) {
    return 1;
  }
  const signalNumber = osConstants.signals[signal];
  // POSIX shells conventionally report signal exits as 128 + signal number.
  return signalNumber === undefined ? 1 : 128 + signalNumber;
}
