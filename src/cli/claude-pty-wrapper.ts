import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command, Option } from "commander";
import { ClaudePtyWrapperError } from "../core/errors.js";
import { type OutputMode, runClaudePtyWrapper } from "../core/wrapper.js";

export function configureProgram(): Command {
  const root = new Command();
  root
    .name("claude-pty-wrapper")
    .description("Run interactive Claude through a PTY and stream durable session output.")
    .version(packageVersion())
    .argument("[prompt]", "prompt to pass to Claude")
    .option("-p, --print", "extract assistant text from Claude session JSONL")
    .option("--session-jsonl", "emit raw appended Claude session JSONL records")
    .option("--stream-json", "reserved for future synthetic stream-json output")
    .option("--resume <session-id>", "resume a Claude session")
    .option("--session-id <uuid>", "use a specific session ID for a fresh run")
    .option("--cwd <dir>", "working directory for Claude", process.cwd())
    .option("--claude-bin <path>", "Claude binary", process.env.CLAUDE_BIN ?? "claude")
    .addOption(
      new Option("--timeout <seconds>", "turn timeout in seconds")
        .argParser(parsePositiveSeconds)
        .default(300),
    )
    .option("--model <model>", "forward model to Claude")
    .option("--effort <level>", "forward effort level to Claude")
    .option("--name <name>", "forward display name to Claude")
    .option("--dangerously-skip-permissions", "forward permission bypass flag to Claude")
    .option("--raw-pty-log <file>", "write raw PTY output to a diagnostics file")
    .option("--debug", "print wrapper diagnostics and raw PTY output to stderr")
    .action(async (prompt: string | undefined, options) => {
      await run(async () => {
        if (options.streamJson) {
          throw new ClaudePtyWrapperError("--stream-json is reserved for future implementation");
        }
        const outputMode = resolveOutputMode(Boolean(options.print), Boolean(options.sessionJsonl));
        const code = await runClaudePtyWrapper({
          prompt: prompt ?? "",
          outputMode,
          cwd: options.cwd,
          claudeBin: options.claudeBin,
          timeoutMs: options.timeout * 1_000,
          resumeSessionId: options.resume,
          sessionId: options.sessionId,
          model: options.model,
          effort: options.effort,
          name: options.name,
          dangerouslySkipPermissions: options.dangerouslySkipPermissions,
          rawPtyLog: options.rawPtyLog,
          debug: options.debug,
        });
        process.exitCode = code;
      });
    });
  return root;
}

function resolveOutputMode(print: boolean, sessionJsonl: boolean): OutputMode {
  if (print && sessionJsonl) {
    throw new ClaudePtyWrapperError("choose only one output mode");
  }
  return sessionJsonl ? "session-jsonl" : "text";
}

function parsePositiveSeconds(value: string): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error("timeout must be a positive number of seconds");
  }
  return seconds;
}

async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ClaudePtyWrapperError) {
      console.error(`claude-pty-wrapper: ${error.message}`);
      process.exitCode = error.exitCode;
      return;
    }
    throw error;
  }
}

function packageVersion(): string {
  const packagePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../package.json",
  );
  const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: string };
  return pkg.version ?? "0.0.0";
}
