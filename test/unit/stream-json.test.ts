import { describe, expect, it } from "vitest";
import {
  createSyntheticStreamJsonState,
  syntheticStreamEventForRecord,
  syntheticStreamInitEvent,
  syntheticStreamResultEvent,
} from "../../src/core/stream-json.js";

describe("synthetic stream-json translation", () => {
  it("builds a legacy-like init event from available persisted metadata", () => {
    expect(
      syntheticStreamInitEvent({
        cwd: "/tmp/work",
        sessionId: "18a18377-217d-4b29-9a68-c70a89b79330",
        source: { type: "system", subtype: "init", cwd: "/tmp/source", model: "sonnet" },
      }),
    ).toEqual({
      type: "system",
      subtype: "init",
      cwd: "/tmp/source",
      session_id: "18a18377-217d-4b29-9a68-c70a89b79330",
      model: "sonnet",
    });
  });

  it("preserves assistant content blocks and tool results", () => {
    const state = createSyntheticStreamJsonState("18a18377-217d-4b29-9a68-c70a89b79330");

    expect(
      syntheticStreamEventForRecord(state, {
        type: "assistant",
        sessionId: state.sessionId,
        uuid: "assistant-uuid",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "reasoning" },
            { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "pwd" } },
          ],
        },
      }),
    ).toMatchObject({
      type: "assistant",
      session_id: state.sessionId,
      uuid: "assistant-uuid",
      message: {
        content: [
          { type: "thinking", thinking: "reasoning" },
          { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "pwd" } },
        ],
      },
    });

    expect(
      syntheticStreamEventForRecord(state, {
        type: "user",
        sessionId: state.sessionId,
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "/tmp/work" }],
        },
        toolUseResult: { stdout: "/tmp/work", stderr: "" },
      }),
    ).toMatchObject({
      type: "user",
      session_id: state.sessionId,
      message: {
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "/tmp/work" }],
      },
      tool_use_result: { stdout: "/tmp/work", stderr: "" },
    });
  });

  it("emits a final result record with combined assistant text from real durable shapes", () => {
    const state = createSyntheticStreamJsonState("18a18377-217d-4b29-9a68-c70a89b79330");
    syntheticStreamEventForRecord(state, {
      type: "assistant",
      sessionId: state.sessionId,
      cwd: "/home/kevin/worktrees/task-runner",
      entrypoint: "cli",
      gitBranch: "main",
      isSidechain: false,
      parentUuid: "parent-1",
      requestId: "req-1",
      timestamp: "2026-05-13T00:00:00.000Z",
      userType: "external",
      uuid: "assistant-1",
      version: "2.1.140",
      message: {
        id: "msg_1",
        model: "claude-sonnet-4-6",
        role: "assistant",
        stop_details: null,
        stop_reason: null,
        stop_sequence: null,
        type: "message",
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: "text", text: "one" }],
      },
    });
    syntheticStreamEventForRecord(state, {
      type: "assistant",
      sessionId: state.sessionId,
      isSidechain: false,
      message: {
        id: "msg_2",
        model: "claude-sonnet-4-6",
        role: "assistant",
        type: "message",
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [
          {
            type: "thinking",
            thinking: "",
            signature: "redacted-signature",
          },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "Bash",
            input: { command: "pwd" },
            caller: { type: "direct" },
          },
        ],
      },
    });
    syntheticStreamEventForRecord(state, {
      type: "assistant",
      sessionId: state.sessionId,
      message: {
        id: "msg_3",
        model: "claude-sonnet-4-6",
        role: "assistant",
        type: "message",
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: "text", text: "two" }],
      },
    });

    expect(
      syntheticStreamResultEvent(state, {
        type: "system",
        subtype: "turn_duration",
        sessionId: state.sessionId,
        durationMs: 42,
        messageCount: 3,
        isSidechain: false,
      }),
    ).toMatchObject({
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 42,
      num_turns: 3,
      result: "one\n\ntwo",
      stop_reason: "end_turn",
      session_id: state.sessionId,
      terminal_reason: "completed",
    });
  });

  it("ignores sidechain records and non-turn metadata observed in durable sessions", () => {
    const state = createSyntheticStreamJsonState("18a18377-217d-4b29-9a68-c70a89b79330");

    expect(
      syntheticStreamEventForRecord(state, {
        type: "assistant",
        isSidechain: true,
        message: { role: "assistant", content: [{ type: "text", text: "hidden" }] },
      }),
    ).toBeNull();
    expect(
      syntheticStreamEventForRecord(state, {
        type: "custom-title",
        customTitle: "title",
        sessionId: state.sessionId,
      }),
    ).toBeNull();
    expect(
      syntheticStreamEventForRecord(state, {
        type: "system",
        subtype: "stop_hook_summary",
        sessionId: state.sessionId,
      }),
    ).toBeNull();
    expect(state.resultText).toBe("");
  });
});
