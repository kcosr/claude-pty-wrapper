export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function claudeContentBlocks(content: unknown): Record<string, unknown>[] {
  if (!Array.isArray(content)) {
    return [];
  }
  return content.filter(isRecord);
}

export function extractClaudeText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  let combined = "";
  for (const item of claudeContentBlocks(content)) {
    if (typeof item.text === "string") {
      combined += streamBoundarySeparator(combined, item.text);
      combined += item.text;
    }
  }
  return combined;
}

export function isAllToolResultContent(content: unknown): boolean {
  const blocks = claudeContentBlocks(content);
  return blocks.length > 0 && blocks.every((block) => block.type === "tool_result");
}

export function realClaudeUserText(record: Record<string, unknown>): string | null {
  if (record.type !== "user" || record.isSidechain === true || !isRecord(record.message)) {
    return null;
  }
  const content = record.message.content;
  if (isAllToolResultContent(content)) {
    return null;
  }
  const text = extractClaudeText(content);
  const trimmed = text.trim();
  // Claude persists internal task-runner wakeups as user-looking records; they
  // should not start a wrapper output turn.
  if (trimmed.length === 0 || trimmed.startsWith("<task-notification>")) {
    return null;
  }
  return text;
}

export function claudeAssistantRecordText(record: Record<string, unknown>): string | null {
  if (record.type !== "assistant" || record.isSidechain === true || !isRecord(record.message)) {
    return null;
  }
  const text = extractClaudeText(record.message.content);
  return text.length > 0 ? text : null;
}

export function isClaudeTurnTerminalRecord(record: Record<string, unknown>): boolean {
  return (
    record.type === "system" && record.subtype === "turn_duration" && record.isSidechain !== true
  );
}

export function streamBoundarySeparator(prior: string, delta: string): string {
  if (prior.length === 0) {
    return "";
  }
  let trailing = 0;
  for (let i = prior.length - 1; i >= 0; i--) {
    if (prior[i] === "\n") {
      trailing++;
    } else {
      break;
    }
  }
  let leading = 0;
  for (let i = 0; i < delta.length; i++) {
    if (delta[i] === "\n") {
      leading++;
    } else {
      break;
    }
  }
  return "\n".repeat(Math.max(0, 2 - trailing - leading));
}
