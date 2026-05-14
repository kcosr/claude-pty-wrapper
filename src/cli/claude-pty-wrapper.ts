import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command, Option } from "commander";
import { ClaudePtyWrapperError } from "../core/errors.js";
import { runClaudePassthrough } from "../core/passthrough.js";
import { type OutputMode, runClaudePtyWrapper } from "../core/wrapper.js";

type CommandOptions = {
  print?: boolean;
  outputFormat: "text" | "json" | "stream-json";
  inputFormat: "text" | "stream-json";
  sessionJsonl?: boolean;
  resume?: string | boolean;
  sessionId?: string;
  cwd: string;
  claudeBin: string;
  timeout: number;
  model?: string;
  effort?: string;
  name?: string;
  dangerouslySkipPermissions?: boolean;
  rawPtyLog?: string;
  wrapperDebug?: boolean;
  continue?: boolean;
  includePartialMessages?: boolean;
  includeHookEvents?: boolean;
  permissionMode?: string;
  appendSystemPrompt?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  tools?: string[];
  mcpConfig?: string[];
  strictMcpConfig?: boolean;
  mcpDebug?: boolean;
  debug?: string | boolean;
  verbose?: boolean;
  agents?: string;
  agent?: string;
  settingSources?: string;
  settings?: string;
  pluginDir?: string[];
  pluginUrl?: string[];
  file?: string[];
  addDir?: string[];
  betas?: string[];
  fallbackModel?: string;
  jsonSchema?: string;
  maxBudgetUsd?: string;
  remoteControl?: string | boolean;
  remoteControlSessionNamePrefix?: string;
  worktree?: string | boolean;
  fromPr?: string | boolean;
  chrome?: boolean;
  ide?: boolean;
  bare?: boolean;
  brief?: boolean;
  disableSlashCommands?: boolean;
  forkSession?: boolean;
  tmux?: string | boolean;
  sessionPersistence?: boolean;
  replayUserMessages?: boolean;
};

export function configureProgram(): Command {
  const root = new Command();
  root
    .name("claude-pty-wrapper")
    .description("Run interactive Claude through a PTY and stream durable session output.")
    .version(packageVersion())
    .argument("[prompt]", "prompt to pass to Claude")
    .option("-p, --print", "run in print-compatible mode")
    .addOption(
      new Option("--output-format <format>", "output format")
        .choices(["text", "json", "stream-json"])
        .default("text"),
    )
    .addOption(
      new Option("--input-format <format>", "input format")
        .choices(["text", "stream-json"])
        .default("text"),
    )
    .option("--session-jsonl", "wrapper diagnostic: emit raw appended Claude session JSONL records")
    .option("-r, --resume [session-id]", "resume a Claude session")
    .option("-c, --continue", "continue the most recent conversation")
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
    .option("--permission-mode <mode>", "forward permission mode to Claude")
    .option("--append-system-prompt <prompt>", "forward appended system prompt to Claude")
    .option("--system-prompt <prompt>", "forward system prompt to Claude")
    .option("--allowedTools, --allowed-tools <tools...>", "forward allowed tools to Claude")
    .option(
      "--disallowedTools, --disallowed-tools <tools...>",
      "forward disallowed tools to Claude",
    )
    .option("--tools <tools...>", "forward enabled tools to Claude")
    .option("--mcp-config <configs...>", "forward MCP config paths to Claude")
    .option("--strict-mcp-config", "forward strict MCP config flag to Claude")
    .option("--mcp-debug", "forward MCP debug flag to Claude")
    .option("--debug [filter]", "forward Claude debug filter")
    .option("--verbose", "forward verbose mode to Claude")
    .option("--agents <json>", "forward agent definitions to Claude")
    .option("--agent <agent>", "forward agent selection to Claude")
    .option("--setting-sources <sources>", "forward setting sources to Claude")
    .option("--settings <file-or-json>", "forward settings to Claude")
    .option("--plugin-dir <path>", "forward plugin directory to Claude", collectString)
    .option("--plugin-url <url>", "forward plugin URL to Claude", collectString)
    .option("--file <specs...>", "forward file attachments to Claude")
    .option("--add-dir <directories...>", "forward additional directories to Claude")
    .option("--betas <betas...>", "forward beta headers to Claude")
    .option("--fallback-model <model>", "forward fallback model to Claude")
    .option("--json-schema <schema>", "forward JSON schema to Claude")
    .option("--max-budget-usd <amount>", "forward maximum budget to Claude")
    .option("--remote-control [name]", "forward remote-control mode to Claude")
    .option(
      "--remote-control-session-name-prefix <prefix>",
      "forward remote-control session prefix to Claude",
    )
    .option("--worktree [name]", "forward worktree mode to Claude")
    .option("--from-pr [value]", "forward pull request context to Claude")
    .option("--chrome", "forward Chrome integration flag to Claude")
    .option("--no-chrome", "forward Chrome disable flag to Claude")
    .option("--ide", "forward IDE integration flag to Claude")
    .option("--bare", "forward bare mode to Claude")
    .option("--brief", "forward brief mode to Claude")
    .option("--disable-slash-commands", "forward slash-command disable flag to Claude")
    .option("--fork-session", "forward fork-session flag to Claude")
    .option("--tmux [mode]", "forward tmux mode to Claude")
    .option("--no-session-persistence", "forward no-session-persistence flag to Claude")
    .option("--replay-user-messages", "forward replay-user-messages flag to Claude")
    .option(
      "--include-partial-messages",
      "accepted for Claude compatibility; partial events are not emitted",
    )
    .option(
      "--include-hook-events",
      "forward in passthrough mode; unsupported by wrapper stream translation",
    )
    .option("--raw-pty-log <file>", "write raw PTY output to a diagnostics file")
    .option("--wrapper-debug", "print wrapper diagnostics and raw PTY output to stderr")
    .action(async (prompt: string | undefined, options: CommandOptions) => {
      await run(async () => {
        validateCommandOptions(root, options);
        if (!wrapperModeRequested(root, options)) {
          const code = await runClaudePassthrough({
            claudeBin: options.claudeBin,
            cwd: options.cwd,
            args: buildPassthroughClaudeArgs(root, options, prompt),
          });
          process.exitCode = code;
          return;
        }
        const resolvedPrompt = await resolvePrompt(prompt, options.inputFormat);
        const outputMode = resolveOutputMode(root, options);
        const code = await runClaudePtyWrapper({
          prompt: resolvedPrompt,
          outputMode,
          cwd: options.cwd,
          claudeBin: options.claudeBin,
          timeoutMs: options.timeout * 1_000,
          resumeSessionId: typeof options.resume === "string" ? options.resume : undefined,
          sessionId: options.sessionId,
          model: options.model,
          effort: options.effort,
          name: options.name,
          dangerouslySkipPermissions: options.dangerouslySkipPermissions,
          claudeArgs: buildSharedClaudeArgs(root, options, { includeRuntimeOutputFlags: false }),
          rawPtyLog: options.rawPtyLog,
          wrapperDebug: options.wrapperDebug,
        });
        process.exitCode = code;
      });
    });
  return root;
}

function validateCommandOptions(root: Command, options: CommandOptions): void {
  const outputFormatWasSet = root.getOptionValueSource("outputFormat") === "cli";
  const inputFormatWasSet = root.getOptionValueSource("inputFormat") === "cli";
  const wrapperMode = wrapperModeRequested(root, options);
  if (!wrapperMode) {
    rejectWrapperOnlyPassthroughOption(root, options);
  }
  if (options.continue && wrapperMode) {
    throw new ClaudePtyWrapperError(
      "--continue is not supported by the PTY wrapper; use --resume <session-id>",
    );
  }
  if (options.inputFormat !== "text" && wrapperMode) {
    throw new ClaudePtyWrapperError(
      "--input-format stream-json is not supported by the PTY wrapper yet",
    );
  }
  if (options.includeHookEvents && wrapperMode) {
    throw new ClaudePtyWrapperError(
      "--include-hook-events is only available from Claude runtime stream-json",
    );
  }
  if (options.sessionJsonl && options.print) {
    throw new ClaudePtyWrapperError("choose either --session-jsonl or --print");
  }
  if (options.sessionJsonl && outputFormatWasSet) {
    throw new ClaudePtyWrapperError("choose either --session-jsonl or --output-format");
  }
  if (!options.print && outputFormatWasSet) {
    throw new ClaudePtyWrapperError("--output-format requires -p/--print");
  }
  if (!options.print && inputFormatWasSet) {
    throw new ClaudePtyWrapperError("--input-format requires -p/--print");
  }
  if (wrapperMode && options.resume === true) {
    throw new ClaudePtyWrapperError("--resume requires a session id in wrapper mode");
  }
}

function rejectWrapperOnlyPassthroughOption(root: Command, options: CommandOptions): void {
  if (root.getOptionValueSource("timeout") === "cli") {
    throw new ClaudePtyWrapperError("--timeout requires -p/--print or --session-jsonl");
  }
  if (options.rawPtyLog) {
    throw new ClaudePtyWrapperError("--raw-pty-log requires -p/--print or --session-jsonl");
  }
  if (options.wrapperDebug) {
    throw new ClaudePtyWrapperError("--wrapper-debug requires -p/--print or --session-jsonl");
  }
}

function wrapperModeRequested(root: Command, options: CommandOptions): boolean {
  return (
    Boolean(options.print) ||
    Boolean(options.sessionJsonl) ||
    root.getOptionValueSource("outputFormat") === "cli" ||
    root.getOptionValueSource("inputFormat") === "cli"
  );
}

function resolveOutputMode(_root: Command, options: CommandOptions): OutputMode {
  if (options.sessionJsonl) {
    return "session-jsonl";
  }
  return options.outputFormat;
}

function buildPassthroughClaudeArgs(
  root: Command,
  options: CommandOptions,
  prompt: string | undefined,
): string[] {
  const args: string[] = [];
  addOptionalString(args, "--resume", options.resume);
  addBoolean(args, "-c", options.continue);
  addString(args, "--session-id", options.sessionId);
  addString(args, "--model", options.model);
  addString(args, "--effort", options.effort);
  addString(args, "--name", options.name);
  addBoolean(args, "--dangerously-skip-permissions", options.dangerouslySkipPermissions);
  args.push(...buildSharedClaudeArgs(root, options, { includeRuntimeOutputFlags: true }));
  if (prompt !== undefined) {
    args.push("--");
    args.push(prompt);
  }
  return args;
}

function buildSharedClaudeArgs(
  root: Command,
  options: CommandOptions,
  settings: { includeRuntimeOutputFlags: boolean },
): string[] {
  const args: string[] = [];
  addString(args, "--permission-mode", options.permissionMode);
  addString(args, "--append-system-prompt", options.appendSystemPrompt);
  addString(args, "--system-prompt", options.systemPrompt);
  addVariadic(args, "--allowed-tools", options.allowedTools);
  addVariadic(args, "--disallowed-tools", options.disallowedTools);
  addVariadic(args, "--tools", options.tools);
  addVariadic(args, "--mcp-config", options.mcpConfig);
  addBoolean(args, "--strict-mcp-config", options.strictMcpConfig);
  addBoolean(args, "--mcp-debug", options.mcpDebug);
  addOptionalString(args, "--debug", options.debug);
  addBoolean(args, "--verbose", options.verbose);
  addString(args, "--agents", options.agents);
  addString(args, "--agent", options.agent);
  addString(args, "--setting-sources", options.settingSources);
  addString(args, "--settings", options.settings);
  addRepeated(args, "--plugin-dir", options.pluginDir);
  addRepeated(args, "--plugin-url", options.pluginUrl);
  addVariadic(args, "--file", options.file);
  addVariadic(args, "--add-dir", options.addDir);
  addVariadic(args, "--betas", options.betas);
  addString(args, "--fallback-model", options.fallbackModel);
  addString(args, "--json-schema", options.jsonSchema);
  addString(args, "--max-budget-usd", options.maxBudgetUsd);
  addOptionalString(args, "--remote-control", options.remoteControl);
  addString(args, "--remote-control-session-name-prefix", options.remoteControlSessionNamePrefix);
  addOptionalString(args, "--worktree", options.worktree);
  addOptionalString(args, "--from-pr", options.fromPr);
  addBoolean(args, "--chrome", optionWasSet(root, "chrome") && options.chrome === true);
  addBoolean(args, "--no-chrome", optionWasSet(root, "chrome") && options.chrome === false);
  addBoolean(args, "--ide", options.ide);
  addBoolean(args, "--bare", options.bare);
  addBoolean(args, "--brief", options.brief);
  addBoolean(args, "--disable-slash-commands", options.disableSlashCommands);
  addBoolean(args, "--fork-session", options.forkSession);
  addOptionalString(args, "--tmux", options.tmux);
  addBoolean(
    args,
    "--no-session-persistence",
    optionWasSet(root, "sessionPersistence") && options.sessionPersistence === false,
  );
  addBoolean(args, "--replay-user-messages", options.replayUserMessages);
  if (settings.includeRuntimeOutputFlags) {
    addBoolean(args, "--include-partial-messages", options.includePartialMessages);
    addBoolean(args, "--include-hook-events", options.includeHookEvents);
  }
  return args;
}

function optionWasSet(root: Command, name: string): boolean {
  return root.getOptionValueSource(name) === "cli";
}

function addString(args: string[], flag: string, value: unknown): void {
  if (typeof value === "string" && value.length > 0) {
    args.push(flag, value);
  }
}

function addOptionalString(args: string[], flag: string, value: unknown): void {
  if (value === true) {
    args.push(flag);
  } else {
    addString(args, flag, value);
  }
}

function addBoolean(args: string[], flag: string, value: unknown): void {
  if (value === true) {
    args.push(flag);
  }
}

function addRepeated(args: string[], flag: string, value: unknown): void {
  if (!Array.isArray(value)) {
    return;
  }
  for (const item of value) {
    addString(args, flag, item);
  }
}

function addVariadic(args: string[], flag: string, value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) {
    return;
  }
  args.push(flag, ...value.map(String));
}

function collectString(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

async function resolvePrompt(
  prompt: string | undefined,
  inputFormat: CommandOptions["inputFormat"],
): Promise<string> {
  if (inputFormat !== "text") {
    throw new ClaudePtyWrapperError(
      "--input-format stream-json is not supported by the PTY wrapper yet",
    );
  }
  if (prompt !== undefined) {
    return prompt;
  }
  if (process.stdin.isTTY) {
    return "";
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
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
