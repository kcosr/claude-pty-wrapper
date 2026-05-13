import path from "node:path";

export function testClaudeSessionFilePath(home: string, cwd: string, sessionId: string): string {
  return path.join(
    home,
    ".claude",
    "projects",
    path.resolve(cwd).replace(/[/.]/g, "-"),
    `${sessionId}.jsonl`,
  );
}
