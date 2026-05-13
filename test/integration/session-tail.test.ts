import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tailJsonl } from "../../src/core/claude-session-tail.js";

describe("tailJsonl", () => {
  it("waits for file creation, parses complete appended lines, and buffers partial lines", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "claude-pty-tail-"));
    const sessionPath = path.join(workspace, "session.jsonl");
    const controller = new AbortController();
    const records: Record<string, unknown>[] = [];

    const consume = (async () => {
      for await (const item of tailJsonl({
        path: sessionPath,
        startOffset: 0,
        pollMs: 10,
        signal: controller.signal,
      })) {
        records.push(item.record);
        if (records.length === 2) {
          controller.abort();
        }
      }
    })();

    await mkdir(workspace, { recursive: true });
    await writeFile(sessionPath, '{"type":"user"}\n{"type":"assistant"', "utf8");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(records).toEqual([{ type: "user" }]);

    await writeFile(sessionPath, '{"type":"user"}\n{"type":"assistant"}\n', "utf8");
    await consume;
    expect(records).toEqual([{ type: "user" }, { type: "assistant" }]);
  });
});
