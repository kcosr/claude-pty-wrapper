# Usage

Run a fresh print-like turn:

```bash
claude-pty-wrapper -p "Explain the current repository"
```

Run with explicit Claude model and effort flags:

```bash
claude-pty-wrapper --model sonnet --effort high -p "Review the diff"
```

Emit durable session records instead of extracted text:

```bash
claude-pty-wrapper --session-jsonl "List changed files"
```

Emit a legacy-like stream JSONL translation:

```bash
claude-pty-wrapper --stream-json "List changed files"
```

Resume an existing Claude session:

```bash
claude-pty-wrapper --resume 18a18377-217d-4b29-9a68-c70a89b79330 "Continue"
```

Run opt-in live smoke tests against the installed Claude binary:

```bash
CLAUDE_PTY_WRAPPER_LIVE_SMOKE=1 npm run test:smoke:live
```
