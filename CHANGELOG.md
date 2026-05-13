# Changelog

## [Unreleased]

### Breaking Changes

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

### Changed

### Fixed

### Removed
