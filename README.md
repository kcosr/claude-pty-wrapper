# claude-pty-wrapper

> **Warning:** Experimental wrapper. Test against your workflow before relying
> on it for automation.

`claude-pty-wrapper` runs interactive Claude through a PTY while exposing a
print-like CLI that streams assistant text from Claude's durable session JSONL.

## Usage

```bash
claude-pty-wrapper "Summarize this repository"
```

Without wrapper output flags, `claude-pty-wrapper` runs Claude in a
wrapper-owned PTY and relays bytes between Claude and the current terminal.
The terminal still renders ANSI/control sequences; the wrapper does not emulate
or parse the screen.

```bash
claude-pty-wrapper --freshness-interval 60 "Summarize this repository"
```

In passthrough mode, `--freshness-interval` enables optional idle prompts. If
neither Claude output nor user input is observed for the interval, the wrapper
sends the freshness message into Claude's PTY followed by Enter.

```bash
claude-pty-wrapper -p "Summarize this repository"
```

Text mode is the default output mode. It prints assistant text blocks from the
session JSONL file and ignores tool calls, tool results, sidechains, and user
messages.

Wrapper-managed output prefers Claude's durable session JSONL. For Claude
versions that flush that file only after the interactive turn exits, the wrapper
asks Claude for screen-reader-friendly PTY output, observes Claude's
turn-completion terminal marker, exits the PTY cleanly, then reads the flushed
session records. If no session records are written, text, JSON, and stream JSON
output fall back to the final assistant block in the screen-reader PTY stream.

```bash
claude-pty-wrapper --session-jsonl "Summarize this repository"
```

`--session-jsonl` streams appended raw Claude JSONL records for the wrapper
turn. On Claude versions that flush session JSONL only when the interactive PTY
exits, those raw records are emitted after the wrapper observes PTY turn
completion and closes Claude cleanly. Unlike text, JSON, and stream JSON modes,
raw session JSONL cannot fall back to PTY text when Claude writes no session
records. This is useful for diagnostics and downstream tooling.

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

## Option Handling

Wrapper-owned flags:

```text
-p, --print                 Use wrapper-managed print-compatible output
--output-format <format>    Wrapper output: text, json, or stream-json
--input-format <format>     Wrapper input: text; stream-json is not supported yet
--session-jsonl             Emit appended raw Claude session JSONL
--cwd <dir>                 Working directory for Claude and session path lookup
--claude-bin <path>         Claude binary; defaults to CLAUDE_BIN or claude
--timeout <seconds>         Wrapper turn timeout
--raw-pty-log <file>        Write raw PTY output for diagnostics
--wrapper-debug             Print wrapper diagnostics to stderr
--freshness-interval <sec>  Passthrough idle interval; enables freshness prompts
--freshness-message <text>  Passthrough idle message; defaults to "Please wait for further instructions."
--freshness-max-iterations <count>
                            Stop after this many freshness prompts
--freshness-max-duration <sec>
                            Stop freshness behavior after this session duration
```

All other supported Claude flags keep their Claude names and are passed through
before the prompt. Examples include `--model`, `--effort`, `--name`,
`--session-id`, `--resume`, `--dangerously-skip-permissions`, `--debug`, and
`--verbose`. Run `claude-pty-wrapper --help` for the full accepted flag list.

`--include-partial-messages` is accepted as a no-op in wrapper stream-json mode
for compatibility with tools that pass it. In passthrough mode, runtime stream
flags such as `--include-partial-messages` and `--include-hook-events` are
forwarded to Claude.

Use `-p/--print` for wrapper-managed text, JSON, and stream JSON output. A bare
prompt without wrapper output flags uses interactive passthrough through a
wrapper-owned PTY relay.

Freshness flags are passthrough-only. `--freshness-message`,
`--freshness-max-iterations`, and `--freshness-max-duration` require
`--freshness-interval`; max iterations and max duration are mutually exclusive.
Freshness is inactive unless `--freshness-interval` is set.

## Running Locally

Install dependencies, build the CLI, and link the command into your local
`PATH`:

```bash
npm install
npm run build
npm link
```

Then run it as:

```bash
claude-pty-wrapper "Summarize this repository"
claude-pty-wrapper -p "Summarize this repository"
```

After code changes, rerun `npm run build`; the linked command points at this
repo's `dist/` output.

## Development

Run the full local validation suite:

```bash
npm install
npm run check
```

`npm run check` runs linting, typechecking, unit/integration tests, and smoke
tests. The smoke tests build the CLI first, then run it against a fake Claude
executable that is spawned through `node-pty` and writes real session JSONL
files under a temporary `HOME`.

To validate before linking, use:

```bash
npm install
npm run check
npm link
```

Live smoke tests are opt-in because they invoke the installed Claude binary and
may consume Claude/API quota:

```bash
CLAUDE_PTY_WRAPPER_LIVE_SMOKE=1 npm run test:smoke:live
```
