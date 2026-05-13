import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { ClaudePtyWrapperError } from "./errors.js";

export interface TailJsonlOptions {
  path: string;
  startOffset: number;
  signal: AbortSignal;
  pollMs?: number;
}

export interface TailJsonlRecord {
  line: string;
  record: Record<string, unknown>;
  offsetEnd: number;
}

export async function* tailJsonl(options: TailJsonlOptions): AsyncGenerator<TailJsonlRecord> {
  let offset = options.startOffset;
  let buffer = "";
  const pollMs = options.pollMs ?? 50;

  while (!options.signal.aborted) {
    const size = await currentSize(options.path);
    if (size === null || size <= offset) {
      await delay(pollMs, options.signal);
      continue;
    }

    const chunk = await readRange(options.path, offset, size);
    offset = size;
    buffer += chunk;

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.trim().length === 0) {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new ClaudePtyWrapperError(
          `failed to parse Claude session history ${basename(options.path)}: invalid JSON`,
        );
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new ClaudePtyWrapperError(
          `failed to parse Claude session history ${basename(options.path)}: record is not an object`,
        );
      }
      yield { line, record: parsed as Record<string, unknown>, offsetEnd: offset - buffer.length };
    }
  }
}

async function currentSize(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readRange(path: string, start: number, endExclusive: number): Promise<string> {
  const chunks: string[] = [];
  const stream = createReadStream(path, {
    encoding: "utf8",
    start,
    end: endExclusive - 1,
  });
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks.join("");
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
