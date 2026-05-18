import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cliPath = path.join(repoRoot, "dist/cli/main.js");

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface TimedInput {
  delayMs: number;
  data: string;
}

interface RunCliOptions {
  cwd: string;
  env?: Record<string, string | undefined>;
  reject?: boolean;
  input?: string;
  timedInput?: TimedInput[];
}

export async function runCli(args: string[], options: RunCliOptions): Promise<CliResult> {
  if (options.input !== undefined || options.timedInput !== undefined) {
    return runCliWithSpawn(args, options);
  }
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    if (options.reject === false && typeof error === "object" && error !== null) {
      return {
        stdout: String((error as { stdout?: string }).stdout ?? ""),
        stderr: String((error as { stderr?: string }).stderr ?? ""),
        exitCode: Number((error as { code?: number }).code ?? 1),
      };
    }
    throw error;
  }
}

async function runCliWithSpawn(args: string[], options: RunCliOptions): Promise<CliResult> {
  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk) => {
    stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  });
  child.stderr.on("data", (chunk) => {
    stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  });

  if (options.input !== undefined) {
    child.stdin.write(options.input);
    child.stdin.end();
  } else {
    for (const item of options.timedInput ?? []) {
      setTimeout(() => {
        child.stdin.write(item.data);
      }, item.delayMs).unref();
    }
  }

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });

  const result = {
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
    exitCode,
  };
  if (exitCode !== 0 && options.reject !== false) {
    throw new Error(
      `CLI exited with ${exitCode}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result;
}
