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
Claude. Other Claude flags keep their Claude names and are forwarded.

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

A bare prompt without wrapper output flags passes through to Claude's normal
interactive behavior.

Resume an existing Claude session:

```bash
claude-pty-wrapper --resume 18a18377-217d-4b29-9a68-c70a89b79330 -p "Continue"
```

Run opt-in live smoke tests against the installed Claude binary:

```bash
CLAUDE_PTY_WRAPPER_LIVE_SMOKE=1 npm run test:smoke:live
```
