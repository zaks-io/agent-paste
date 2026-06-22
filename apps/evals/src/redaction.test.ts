import { describe, expect, it } from "vitest";
import { redactSensitiveText } from "./redaction";

describe("redactSensitiveText", () => {
  it("redacts provider API keys in shell and JSON-shaped output", () => {
    const redacted = redactSensitiveText(
      [
        "OPENROUTER_API_KEY=sk-or-v1-abc123",
        'OPENAI_API_KEY="sk-quoted-value"',
        "ANTHROPIC_API_KEY='sk-single-quoted-value'",
        '{"text":"OPENAI_API_KEY=sk-secret-value"}',
        '{"ANTHROPIC_API_KEY":"sk-ant-secret"}',
      ].join("\n"),
      { OPENROUTER_API_KEY: "sk-or-v1-abc123" },
    );

    expect(redacted).toContain("OPENROUTER_API_KEY=[redacted]");
    expect(redacted).toContain("OPENAI_API_KEY=[redacted]");
    expect(redacted).toContain("OPENAI_API_KEY=[redacted]");
    expect(redacted).toContain("ANTHROPIC_API_KEY=[redacted]");
    expect(redacted).toContain('"ANTHROPIC_API_KEY":"[redacted]"');
    expect(redacted).not.toContain("sk-or-v1-abc123");
    expect(redacted).not.toContain("sk-quoted-value");
    expect(redacted).not.toContain("sk-single-quoted-value");
    expect(redacted).not.toContain("sk-secret-value");
    expect(redacted).not.toContain("sk-ant-secret");
  });
});
