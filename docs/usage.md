# Usage

From a checkout, build and link the command before running it from your shell:

```bash
npm install
npm run build
npm link
```

For development validation before linking, run:

```bash
npm install
npm run check
npm link
```

Run Claude's normal interactive mode:

```bash
claude-pty-wrapper "Explain the current repository"
```

Bare interactive mode runs Claude in a wrapper-owned PTY relay. Claude output is
written back to the terminal unchanged, and terminal input is forwarded to
Claude without screen emulation.

Enable idle freshness prompts in bare interactive mode:

```bash
claude-pty-wrapper --freshness-interval 60 "Explain the current repository"
```

When freshness is enabled, PTY output and user stdin both reset the idle timer.
The default injected message is `Please wait for further instructions.`.

Run a fresh print-like turn:

```bash
claude-pty-wrapper -p "Explain the current repository"
```

Run with explicit Claude model and effort flags:

```bash
claude-pty-wrapper --model sonnet --effort high -p "Review the diff"
```

The wrapper owns `-p/--print`, `--output-format`, `--input-format`, and
`--session-jsonl`; those flags select wrapper behavior and are not passed to
Claude. Wrapper diagnostics such as `--claude-bin`, `--cwd`, `--timeout`,
`--raw-pty-log`, and `--wrapper-debug` are also handled by the wrapper.
Passthrough freshness flags such as `--freshness-interval`,
`--freshness-message`, `--freshness-max-iterations`, and
`--freshness-max-duration` are handled by the wrapper and are rejected with
wrapper-managed output modes. Other supported Claude flags keep their Claude
names and are forwarded; run `claude-pty-wrapper --help` for the full accepted
flag list.

Emit durable session records instead of extracted text:

```bash
claude-pty-wrapper --session-jsonl "List changed files"
```

Emit a legacy-like stream JSONL translation:

```bash
claude-pty-wrapper -p --output-format stream-json "List changed files"
```

Emit a single Claude-shaped result object:

```bash
claude-pty-wrapper -p --output-format json "List changed files"
```

A bare prompt without wrapper output flags runs Claude interactively through the
wrapper-owned PTY relay.

Resume an existing Claude session:

```bash
claude-pty-wrapper --resume 18a18377-217d-4b29-9a68-c70a89b79330 -p "Continue"
```

Run opt-in live smoke tests against the installed Claude binary:

```bash
CLAUDE_PTY_WRAPPER_LIVE_SMOKE=1 npm run test:smoke:live
```
