import { describe, expect, it } from "vitest";
import {
  claudeAssistantRecordText,
  isClaudeTurnTerminalRecord,
  realClaudeUserText,
  streamBoundarySeparator,
} from "../../src/core/claude-records.js";

describe("Claude session records", () => {
  it("extracts real user text and ignores tool results, sidechains, and task notifications", () => {
    expect(
      realClaudeUserText({
        type: "user",
        message: { content: [{ type: "text", text: "Hello" }] },
      }),
    ).toBe("Hello");
    expect(
      realClaudeUserText({
        type: "user",
        message: { content: [{ type: "tool_result", content: "ok" }] },
      }),
    ).toBeNull();
    expect(
      realClaudeUserText({
        type: "user",
        isSidechain: true,
        message: { content: [{ type: "text", text: "hidden" }] },
      }),
    ).toBeNull();
    expect(
      realClaudeUserText({
        type: "user",
        message: { content: "<task-notification>done</task-notification>" },
      }),
    ).toBeNull();
  });

  it("extracts assistant text blocks and detects turn completion records", () => {
    expect(
      claudeAssistantRecordText({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "A" },
            { type: "tool_use", name: "Bash" },
            { type: "text", text: "B" },
          ],
        },
      }),
    ).toBe("A\n\nB");
    expect(claudeAssistantRecordText({ type: "assistant", isSidechain: true })).toBeNull();
    expect(
      isClaudeTurnTerminalRecord({
        type: "system",
        subtype: "turn_duration",
        isSidechain: false,
      }),
    ).toBe(true);
  });

  it("keeps adjacent assistant records separated by paragraph boundaries", () => {
    expect(streamBoundarySeparator("", "next")).toBe("");
    expect(streamBoundarySeparator("prior", "next")).toBe("\n\n");
    expect(streamBoundarySeparator("prior\n", "\nnext")).toBe("");
  });
});
