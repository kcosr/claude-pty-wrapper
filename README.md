# claude-pty-wrapper

> **Warning:** Experimental wrapper. Test against your workflow before relying
> on it for automation.

`claude-pty-wrapper` runs interactive Claude through a PTY while exposing a
print-like CLI that streams assistant text from Claude's durable session JSONL.

## Usage

```bash
claude-pty-wrapper "Summarize this repository"
```

Without wrapper output flags, `claude-pty-wrapper` passes through to Claude's
normal interactive mode using the current terminal.

```bash
claude-pty-wrapper -p "Summarize this repository"
```

Text mode is the default output mode. It prints assistant text blocks from the
session JSONL file and ignores tool calls, tool results, sidechains, and user
messages.

```bash
claude-pty-wrapper --session-jsonl "Summarize this repository"
```

`--session-jsonl` streams appended raw Claude JSONL records for the wrapper
turn. This is useful for diagnostics and downstream tooling.

```bash
claude-pty-wrapper -p --output-format stream-json "Summarize this repository"
```

`--output-format stream-json` emits a compatibility-oriented JSONL stream resembling
`claude -p --verbose --output-format stream-json`. It preserves persisted
assistant content blocks, including tool calls and reasoning-style blocks, but
cannot synthesize runtime-only metadata that Claude does not write to the
durable session file. See [docs/stream-json.md](docs/stream-json.md).

```bash
claude-pty-wrapper -p --output-format json "Summarize this repository"
```

`--output-format json` emits a single final result object, matching Claude's
print-mode JSON shape as closely as durable session files allow.

```bash
claude-pty-wrapper --resume 18a18377-217d-4b29-9a68-c70a89b79330 -p "Continue"
```

Resume mode tails from the existing session file size before spawning Claude,
so output is scoped to the resumed turn.

## Options

```text
-p, --print                     Run in print-compatible mode
--output-format <format>        text, json, or stream-json
--input-format <format>         text; stream-json is not supported yet
--session-jsonl                 Emit appended raw Claude session JSONL
--resume <session-id>           Resume an existing Claude session
--session-id <uuid>             Use an explicit session id for a fresh run
--cwd <dir>                     Working directory for Claude and path lookup
--claude-bin <path>             Claude binary; defaults to CLAUDE_BIN or claude
--timeout <seconds>             Overall turn timeout
--model <model>                 Forward to Claude
--effort <level>                Forward to Claude
--name <name>                   Forward to Claude
--dangerously-skip-permissions  Forward to Claude
--debug [filter]                Forward to Claude
--verbose                       Forward to Claude
--raw-pty-log <file>            Write raw PTY output for diagnostics
--wrapper-debug                 Print wrapper diagnostics to stderr
```

The wrapper interprets `-p/--print`, `--output-format`, `--input-format`, and
`--session-jsonl` itself because those modes are the purpose of the app; they
are never forwarded to Claude. Other Claude flags keep their Claude names and
are passed through before the prompt. Additional wrapper-only flags are `--cwd`,
`--claude-bin`, `--timeout`, `--raw-pty-log`, and `--wrapper-debug`.
`--include-partial-messages` is accepted as a no-op for compatibility with
tools that pass it with `--output-format stream-json`.

Use `-p/--print` for wrapper-managed text, JSON, and stream JSON output. A bare
prompt without wrapper output flags uses Claude's normal interactive behavior.

## Development

```bash
npm install
npm link
npm run check
```

Smoke tests build the CLI and run it against a fake Claude executable that is
spawned through `node-pty` and writes real session JSONL files under a temporary
`HOME`.

Live smoke tests are opt-in because they invoke the installed Claude binary and
may consume Claude/API quota:

```bash
CLAUDE_PTY_WRAPPER_LIVE_SMOKE=1 npm run test:smoke:live
```
