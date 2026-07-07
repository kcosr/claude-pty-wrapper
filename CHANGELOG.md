# Changelog

## [Unreleased]

### Breaking Changes

### Added

### Changed

### Fixed

- Fixed headless `-p` teardown hangs and leaked stdio MCP server processes by
  signaling the Unix PTY process group during cleanup.

### Removed

## [0.2.0] - 2026-05-18

### Added

- Added passthrough freshness flags for interactive mode:
  `--freshness-interval`, `--freshness-message`,
  `--freshness-max-iterations`, and `--freshness-max-duration`. (#1)

### Changed

- Changed bare interactive passthrough to run Claude through a wrapper-owned PTY
  relay so the wrapper can observe terminal output and input activity. (#1)

## [0.1.1] - 2026-05-14

### Changed

- Clarified README and usage documentation for wrapper-owned flags versus
  Claude pass-through flags.
- Clarified local build, link, and development validation instructions.

## [0.1.0] - 2026-05-14

### Added

- Added the initial `claude-pty-wrapper` CLI, which spawns interactive Claude in a
  PTY, tails durable session JSONL, and emits extracted assistant text or raw
  appended session records.
- Added fresh-session and resume workflows with explicit Claude session path
  validation.
- Added smoke tests that exercise the built CLI against a fake Claude process
  through a real PTY and real session JSONL files.
- Added opt-in live smoke tests gated behind
  `CLAUDE_PTY_WRAPPER_LIVE_SMOKE=1`, with a dedicated
  `npm run test:smoke:live` script.
- Added `--output-format stream-json` for a compatibility-oriented translation
  from durable Claude session records to legacy print-mode stream JSONL,
  preserving tool calls, tool results, and persisted reasoning-style content
  blocks.
- Added `--output-format json` for a single Claude-shaped result object.
- Added transparent interactive passthrough for invocations without wrapper
  output flags.

### Changed

- Expanded Claude flag pass-through and renamed wrapper diagnostics to
  `--wrapper-debug`, keeping `--debug` available for Claude.
- Accepted `--include-partial-messages` as a no-op compatibility flag for
  stream-json callers.
- Required `-p/--print` for text, JSON, and stream JSON wrapper output so bare
  prompts can follow Claude's interactive default.

### Fixed

- Fixed PTY cleanup when session tailing fails before Claude exits.
- Improved stream-json parity by counting user turns, omitting null
  `parent_tool_use_id` fields, and carrying persisted stop reasons when
  available.
