import { extractClaudeText, isRecord, streamBoundarySeparator } from "./claude-records.js";

export interface SyntheticStreamJsonState {
  sessionId: string;
  resultText: string;
  assistantTurns: number;
  emittedInit: boolean;
}

export function createSyntheticStreamJsonState(sessionId: string): SyntheticStreamJsonState {
  return {
    sessionId,
    resultText: "",
    assistantTurns: 0,
    emittedInit: false,
  };
}

export function syntheticStreamInitEvent(params: {
  cwd: string;
  sessionId: string;
  source: Record<string, unknown> | null;
}): Record<string, unknown> {
  const event = copyKnownSourceFields(params.source, [
    "cwd",
    "tools",
    "mcp_servers",
    "model",
    "permissionMode",
    "slash_commands",
    "apiKeySource",
    "claude_code_version",
    "output_style",
    "agents",
    "skills",
    "plugins",
    "analytics_disabled",
    "uuid",
    "memory_paths",
    "fast_mode_state",
  ]);
  return {
    type: "system",
    subtype: "init",
    cwd: typeof event.cwd === "string" ? event.cwd : params.cwd,
    session_id: params.sessionId,
    ...event,
  };
}

export function syntheticStreamEventForRecord(
  state: SyntheticStreamJsonState,
  record: Record<string, unknown>,
): Record<string, unknown> | null {
  if (record.isSidechain === true) {
    return null;
  }

  if (record.type === "assistant" && isRecord(record.message)) {
    const text = extractClaudeText(record.message.content);
    if (text.length > 0) {
      const separator = streamBoundarySeparator(state.resultText, text);
      state.resultText += separator;
      state.resultText += text;
    }
    state.assistantTurns++;
    return withCommonStreamFields(
      {
        type: "assistant",
        message: record.message,
        parent_tool_use_id: stringOrNull(record.parent_tool_use_id ?? record.parentToolUseId),
      },
      record,
      state.sessionId,
    );
  }

  if (
    record.type === "user" &&
    isRecord(record.message) &&
    isAllToolResultContent(record.message.content)
  ) {
    return withCommonStreamFields(
      {
        type: "user",
        message: record.message,
        parent_tool_use_id: stringOrNull(record.parent_tool_use_id ?? record.parentToolUseId),
        ...(record.tool_use_result !== undefined || record.toolUseResult !== undefined
          ? { tool_use_result: record.tool_use_result ?? record.toolUseResult }
          : {}),
      },
      record,
      state.sessionId,
    );
  }

  if (record.type === "rate_limit_event") {
    return withCommonStreamFields(
      { ...record, session_id: state.sessionId },
      record,
      state.sessionId,
    );
  }

  return null;
}

export function syntheticStreamResultEvent(
  state: SyntheticStreamJsonState,
  terminalRecord: Record<string, unknown>,
): Record<string, unknown> {
  const durationMs = numberValue(terminalRecord.duration_ms ?? terminalRecord.durationMs);
  const result: Record<string, unknown> = {
    type: "result",
    subtype: "success",
    is_error: false,
    api_error_status: null,
    num_turns: state.assistantTurns,
    result: state.resultText,
    stop_reason: "end_turn",
    session_id: state.sessionId,
    permission_denials: [],
    terminal_reason: "completed",
  };

  if (durationMs !== null) {
    result.duration_ms = durationMs;
  }
  if (typeof terminalRecord.uuid === "string") {
    result.uuid = terminalRecord.uuid;
  }
  if (terminalRecord.usage !== undefined) {
    result.usage = terminalRecord.usage;
  }
  if (terminalRecord.total_cost_usd !== undefined) {
    result.total_cost_usd = terminalRecord.total_cost_usd;
  }
  if (terminalRecord.fast_mode_state !== undefined) {
    result.fast_mode_state = terminalRecord.fast_mode_state;
  }
  return result;
}

function withCommonStreamFields(
  event: Record<string, unknown>,
  source: Record<string, unknown>,
  sessionId: string,
): Record<string, unknown> {
  return {
    ...event,
    session_id: stringValue(source.session_id ?? source.sessionId) ?? sessionId,
    ...(typeof source.uuid === "string" ? { uuid: source.uuid } : {}),
    ...(typeof source.timestamp === "string" ? { timestamp: source.timestamp } : {}),
  };
}

function copyKnownSourceFields(
  source: Record<string, unknown> | null,
  fields: string[],
): Record<string, unknown> {
  if (source === null) {
    return {};
  }
  const output: Record<string, unknown> = {};
  for (const field of fields) {
    if (source[field] !== undefined) {
      output[field] = source[field];
    }
  }
  return output;
}

function isAllToolResultContent(content: unknown): boolean {
  if (!Array.isArray(content) || content.length === 0) {
    return false;
  }
  return content.every((item) => isRecord(item) && item.type === "tool_result");
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
