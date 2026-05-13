import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { ClaudePtyWrapperError } from "./errors.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function encodeClaudeProjectDir(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

export function claudeProjectDir(cwd: string): string {
  return join(homedir(), ".claude", "projects", encodeClaudeProjectDir(resolve(cwd)));
}

export function validateClaudeSessionId(sessionId: string): void {
  if (sessionId.includes("/") || sessionId.includes("\\") || sessionId.includes("..")) {
    throw new ClaudePtyWrapperError("claude session id must be a session id, not a path");
  }
  if (!uuidPattern.test(sessionId)) {
    throw new ClaudePtyWrapperError("claude session id must be a valid UUID");
  }
}

export function claudeSessionFilePath(cwd: string, sessionId: string): string {
  validateClaudeSessionId(sessionId);
  const projectDir = claudeProjectDir(cwd);
  const sessionPath = resolve(projectDir, `${sessionId}.jsonl`);
  const relativePath = relative(projectDir, sessionPath);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new ClaudePtyWrapperError(
      "claude session id must resolve inside the cwd-bound project directory",
    );
  }
  return sessionPath;
}

export function fileSizeIfExists(path: string): number {
  try {
    return statSync(path).size;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

export function assertExistingSessionFileUnderProjectDir(cwd: string, sessionPath: string): void {
  const projectDir = claudeProjectDir(cwd);
  if (!existsSync(sessionPath)) {
    throw new ClaudePtyWrapperError(`claude session file not found: ${sessionPath}`);
  }
  if (!realFileIsUnderRoot(projectDir, sessionPath)) {
    throw new ClaudePtyWrapperError("claude session file escaped the project directory");
  }
}

export function realFileIsUnderRoot(root: string, filePath: string): boolean {
  try {
    const realRoot = realpathSync(root);
    const realPath = realpathSync(filePath);
    const relativePath = relative(realRoot, realPath);
    return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
  } catch {
    return false;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
