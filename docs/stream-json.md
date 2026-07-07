# Stream JSON

Claude's legacy print-mode stream:

```bash
claude -p --verbose --output-format stream-json "..."
```

emits runtime JSONL events. In local samples from Claude Code 2.1.140, a simple
turn produced:

- `system` / `init`, with runtime metadata such as `cwd`, tools, model, plugins,
  and Claude Code version.
- `rate_limit_event`, when available.
- `assistant`, containing a full Claude message object.
- `result`, containing the final text, session id, turn count, timing, usage,
  cost, and terminal status.

A tool-use turn produced the same shape plus:

- `assistant` records with `message.content` blocks such as `tool_use`.
- `user` records with `message.content` blocks such as `tool_result` and
  optional `tool_use_result` metadata.
- A final `assistant` text message followed by `result`.

`claude-pty-wrapper --session-jsonl` is different: it emits the raw durable
session records from Claude's `~/.claude/projects/.../<session-id>.jsonl` file.
Those records use Claude's persisted history shape, often including camel-case
fields such as `sessionId` and terminal records such as
`{"type":"system","subtype":"turn_duration"}`.

`claude-pty-wrapper -p --output-format stream-json` translates the durable
session records into a legacy-like stream:

- It emits a synthetic `system/init` event. If Claude persisted init metadata,
  the wrapper forwards known metadata fields; otherwise it supplies `cwd` and
  `session_id`.
- It suppresses the initial prompt `user` record, matching legacy print-mode
  stream output.
- It forwards `assistant` message records with their full `message.content`
  blocks intact, including text, tool calls, reasoning-style blocks, and other
  content types Claude persists.
- It forwards `user` tool-result records so consumers can observe tool outputs.
- It emits a synthetic `result` record after the durable `turn_duration`
  completion marker.
- It accepts `--include-partial-messages` for CLI compatibility but silently
  ignores it because durable session files do not contain runtime partial
  message deltas.

Some Claude versions flush durable session records only after the interactive
PTY session exits. In those cases, wrapper mode observes Claude's PTY
turn-completion marker, closes Claude cleanly, then translates the flushed
session records. If Claude writes no durable session records for the completed
turn, stream-json mode falls back to the final assistant block in the
screen-reader PTY stream and emits a minimal `system`, `assistant`, and `result`
sequence. Durable records remain the preferred source because they preserve tool
calls, tool results, reasoning blocks, and richer metadata.

The translation is compatibility-oriented, not byte-for-byte identical. The
wrapper cannot synthesize data that is not present in the durable session file,
such as rate-limit metadata, exact API timings, full cost accounting, or every
runtime-only init field.

## Local Durable Session Findings

A local review of recent `~/.claude/projects/**/*.jsonl` files and
`~/.local/state/task-runner` run state found these durable-session patterns:

- Task-runner stores Claude `backendSessionId` values and resolved
  `~/.claude/projects/.../<session-id>.jsonl` paths in `run.json` and
  `run-events.jsonl`, so those files are representative wrapper inputs.
- Durable session records use `sessionId`; legacy print-mode stream JSON uses
  `session_id`. The translator normalizes to `session_id`.
- Durable sessions commonly include non-conversation metadata records such as
  `last-prompt`, `custom-title`, `agent-name`, `attachment`, `ai-title`,
  `permission-mode`, `queue-operation`, and `file-history-snapshot`. The
  translator ignores these.
- Durable `system` records observed include `turn_duration`,
  `stop_hook_summary`, `away_summary`, and `local_command`. Only
  `turn_duration` terminates the translated stream and creates `result`.
- Durable sessions often do not persist `system/init`; the translator emits a
  minimal synthetic init event when no persisted init is observed before the
  turn begins.
- Assistant content block shapes observed include `text`, `thinking`, and
  `tool_use`. Tool-use blocks include `caller`, `id`, `input`, `name`, and
  `type`.
- User tool-result blocks include `content`, `tool_use_id`, `type`, and
  sometimes `is_error`.
- Durable user records commonly store tool result metadata as `toolUseResult`;
  legacy stream JSON uses `tool_use_result`. The translator emits
  `tool_use_result`.
