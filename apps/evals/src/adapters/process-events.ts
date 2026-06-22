export function parseProcessJsonl(stdout: string): unknown[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return { type: "raw", text: line };
      }
    });
}

export function transcriptFromProcessEvents(events: unknown[], rawStdout: string): string {
  const parts = events.flatMap(textFromEvent).filter(Boolean);
  return parts.length > 0 ? `${parts.join("\n")}\n` : rawStdout;
}

export function finalAnswerFromProcessEvents(events: unknown[]): string {
  for (const event of [...events].reverse()) {
    const text = assistantText(event);
    if (text) {
      return text;
    }
  }
  return "";
}

function textFromEvent(event: unknown): string[] {
  if (!isRecord(event)) {
    return [];
  }
  const type = typeof event.type === "string" ? event.type : "event";
  if (type === "stderr") {
    return [`[stderr]\n${String(event.text ?? "")}`];
  }
  if (type === "raw") {
    return [String(event.text ?? "")];
  }
  const text = assistantText(event) ?? stringField(event, "text") ?? stringField(event, "message");
  if (text) {
    return [text];
  }
  if (isRecord(event.usage)) {
    return [`[usage] ${JSON.stringify(event.usage)}`];
  }
  return [`[event:${type}] ${truncate(JSON.stringify(event), 2000)}`];
}

function assistantText(event: unknown): string | undefined {
  if (!isRecord(event)) {
    return undefined;
  }
  if (event.type === "result") {
    return stringField(event, "result") ?? stringField(event, "text");
  }
  if (isRecord(event.item) && event.item.type === "agent_message") {
    return stringField(event.item, "text") ?? contentText(event.item.content);
  }
  if (event.type === "assistant" && isRecord(event.message)) {
    return contentText(event.message.content) ?? stringField(event.message, "text");
  }
  if (event.type === "stream_event" && isRecord(event.event)) {
    return stringField(event.event, "text") ?? deltaText(event.event.delta);
  }
  return undefined;
}

function deltaText(value: unknown): string | undefined {
  return isRecord(value) ? (stringField(value, "text") ?? stringField(value, "delta")) : undefined;
}

function contentText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const text = value
    .map((item) => (isRecord(item) ? stringField(item, "text") : undefined))
    .filter(Boolean)
    .join("");
  return text || undefined;
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === "string" ? value[key] : undefined;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n[truncated ${value.length - max} chars]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
