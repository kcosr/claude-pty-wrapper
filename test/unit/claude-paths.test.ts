import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  claudeProjectDir,
  claudeSessionFilePath,
  encodeClaudeProjectDir,
} from "../../src/core/claude-paths.js";

describe("Claude session paths", () => {
  it("encodes cwd using Claude's project directory convention", () => {
    expect(encodeClaudeProjectDir("/home/kevin/.claude/foo.bar")).toBe(
      "-home-kevin--claude-foo-bar",
    );
  });

  it("resolves session files under the cwd-bound Claude project directory", () => {
    const cwd = path.join(os.tmpdir(), "claude-pty-wrapper-path-test");
    const sessionId = "18a18377-217d-4b29-9a68-c70a89b79330";

    expect(claudeSessionFilePath(cwd, sessionId)).toBe(
      path.join(claudeProjectDir(cwd), `${sessionId}.jsonl`),
    );
  });

  it("rejects path-like and non-UUID session ids", () => {
    expect(() => claudeSessionFilePath("/tmp/work", "../escape")).toThrow(
      "claude session id must be a session id",
    );
    expect(() => claudeSessionFilePath("/tmp/work", "not-a-session")).toThrow(
      "claude session id must be a valid UUID",
    );
  });
});
