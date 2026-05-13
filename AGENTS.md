# Agent Onboarding (claude-pty-wrapper)

This repository contains `claude-pty-wrapper`, a TypeScript Node CLI that runs
interactive Claude through a PTY while exposing a print-like command interface.

## Start Here

- Read `README.md` for the supported CLI surface and behavior.
- Source code lives in `src/cli/` and `src/core/`.
- Current CLI bin entrypoint is `src/cli/main.ts`.
- `--stream-json` is a compatibility translation of durable Claude session
  records; keep the mapping behavior documented in `docs/stream-json.md`.
- Tests live in `test/unit/`, `test/integration/`, and `test/smoke/`.
- CLI smoke tests run with `npm run test:smoke`.

## Conventions

- TypeScript Node CLI.
- Keep command parsing in `src/cli/`.
- Keep Claude path handling, session JSONL parsing, tailing, PTY execution, and wrapper orchestration in `src/core/`.
- Prefer explicit contracts over fallback parsing or heuristic shape detection.
- Do not add print-mode `--output-format stream-json` usage to the PTY path.

## Testing

- Run `npm install` to install dependencies.
- Run `npm link` after building when you need the `claude-pty-wrapper` command
  available on your local `PATH`.
- Run `npm run lint` for Biome checks.
- Run `npm run typecheck` for TypeScript checks.
- Run `npm test` for unit and integration tests.
- Run `npm run test:smoke` after CLI or process orchestration changes.
- Run `npm run check` before handing off broader changes.

## Changelog

- Add user-facing changes to `CHANGELOG.md` under `## [Unreleased]`.
- Use these subsections when applicable: Breaking Changes, Added, Changed, Fixed, Removed.
- Add the needed subsection under `## [Unreleased]` if it is missing; do not create duplicate subsection headings.
