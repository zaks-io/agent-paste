import type { PublishInput, PublishOutcome, PublishTransport } from "@agent-paste/api-client/publish";
import type { AgentView, ArtifactFileContent } from "@agent-paste/contracts";
import { describe, expect, it } from "vitest";
import { type ReviseDeps, type RevisionReader, reviseOnePath, reviseWholeBody } from "./revise-one-path.js";

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function agentView(over: Partial<AgentView> = {}): AgentView {
  return {
    artifact_id: "art_1",
    revision_id: "rev_1",
    title: "My Doc",
    entrypoint: "index.html",
    created_at: "2026-01-01T00:00:00.000Z",
    expires_at: "2026-02-01T00:00:00.000Z",
    revision_content_url: "https://example.test/c",
    files: [{ path: "index.html", size_bytes: 1, content_type: "text/html", url: "https://example.test/f" }],
    safety_warnings: [],
    bundle: { available: false },
    ...over,
  } as AgentView;
}

async function fileContent(body: string, over: Partial<ArtifactFileContent> = {}): Promise<ArtifactFileContent> {
  return {
    path: "index.html",
    sha256: await sha256Hex(body),
    size_bytes: new TextEncoder().encode(body).byteLength,
    content_type: "text/html",
    is_binary: false,
    body,
    ...over,
  } as ArtifactFileContent;
}

function outcome(): PublishOutcome {
  return {
    privateUrl: "https://example.test/v/art_1",
    title: "My Doc",
    expiresAt: "2026-02-01T00:00:00.000Z",
    uploadStats: { totalFiles: 1, totalBytes: 1, uploadedFiles: 1, uploadedBytes: 1, reusedFiles: 0, reusedBytes: 0 },
    result: {} as PublishOutcome["result"],
  };
}

const transport = {} as PublishTransport;

function deps(reader: RevisionReader, publish: ReviseDeps["publish"]): ReviseDeps {
  return { reader, transport, publish };
}

describe("reviseOnePath edge contracts", () => {
  it("accepts a target path in a mixed base tree and forwards render mode", async () => {
    const base = await fileContent("hello world");
    const reader: RevisionReader = {
      readArtifact: async () =>
        agentView({
          files: [
            { path: "index.html", size_bytes: 1, content_type: "text/html", url: "u" },
            { path: "other.html", size_bytes: 1, content_type: "text/html", url: "u" },
          ] as AgentView["files"],
        }),
      readFile: async () => base,
    };
    let captured: PublishInput | undefined;
    const publish = async (_transport: PublishTransport, input: PublishInput) => {
      captured = input;
      return outcome();
    };

    await reviseOnePath(deps(reader, publish), {
      artifactId: "art_1",
      path: "index.html",
      edits: [{ oldString: "world", newString: "there" }],
      idempotencyKey: "k1" as PublishInput["idempotencyKey"],
      renderMode: "markdown",
    });

    expect(captured?.renderMode).toBe("markdown");
    expect(captured?.idempotencyKey).toBe("k1");
  });

  it("includes edit failure details in the thrown ReviseError", async () => {
    const base = await fileContent("hello");
    const reader: RevisionReader = { readArtifact: async () => agentView(), readFile: async () => base };

    await expect(
      reviseOnePath(
        deps(reader, async () => outcome()),
        {
          artifactId: "art_1",
          path: "index.html",
          edits: [{ oldString: "absent", newString: "x" }],
          idempotencyKey: "k1" as PublishInput["idempotencyKey"],
        },
      ),
    ).rejects.toMatchObject({ reason: "not_found", editIndex: 0, message: "edit 0 not_found" });
  });

  it("reports exact missing-path and non-text base errors", async () => {
    const publish = async () => outcome();
    await expect(
      reviseWholeBody(
        deps(
          {
            readArtifact: async () =>
              agentView({
                files: [
                  { path: "other.html", size_bytes: 1, content_type: "text/html", url: "u" },
                ] as AgentView["files"],
              }),
            readFile: async () => fileContent("x"),
          },
          publish,
        ),
        {
          artifactId: "art_1",
          path: "index.html",
          nextText: "y",
          idempotencyKey: "k1" as PublishInput["idempotencyKey"],
        },
      ),
    ).rejects.toMatchObject({ reason: "path_not_in_base", message: "index.html: not in the base revision" });

    await expect(
      reviseWholeBody(
        deps(
          {
            readArtifact: async () => agentView(),
            readFile: async () => fileContent("", { body: undefined }),
          },
          publish,
        ),
        {
          artifactId: "art_1",
          path: "index.html",
          nextText: "y",
          idempotencyKey: "k1" as PublishInput["idempotencyKey"],
        },
      ),
    ).rejects.toMatchObject({ reason: "base_not_text", message: "index.html: base is binary or too large to edit" });
  });

  it("retries when patch conflict is signaled by code only", async () => {
    const base = await fileContent("hello world");
    const reader: RevisionReader = { readArtifact: async () => agentView(), readFile: async () => base };
    let publishCalls = 0;
    const publish = async () => {
      publishCalls += 1;
      if (publishCalls === 1) {
        throw { code: "patch_conflict" };
      }
      return outcome();
    };

    await expect(
      reviseWholeBody(deps(reader, publish), {
        artifactId: "art_1",
        path: "index.html",
        nextText: "hello there",
        idempotencyKey: "k1" as PublishInput["idempotencyKey"],
      }),
    ).resolves.toMatchObject({ ok: true, noop: false });
    expect(publishCalls).toBe(2);
  });

  it("retries when patch conflict is signaled by message only", async () => {
    const base = await fileContent("hello world");
    const reader: RevisionReader = { readArtifact: async () => agentView(), readFile: async () => base };
    let publishCalls = 0;
    const publish = async () => {
      publishCalls += 1;
      if (publishCalls === 1) {
        throw new Error("patch_conflict: base moved");
      }
      return outcome();
    };

    await expect(
      reviseWholeBody(deps(reader, publish), {
        artifactId: "art_1",
        path: "index.html",
        nextText: "hello there",
        idempotencyKey: "k1" as PublishInput["idempotencyKey"],
      }),
    ).resolves.toMatchObject({ ok: true, noop: false });
    expect(publishCalls).toBe(2);
  });

  it("rethrows non-object publish failures without treating them as patch conflicts", async () => {
    const base = await fileContent("hello world");
    const reader: RevisionReader = { readArtifact: async () => agentView(), readFile: async () => base };

    await expect(
      reviseWholeBody(
        deps(reader, async () => {
          throw null;
        }),
        {
          artifactId: "art_1",
          path: "index.html",
          nextText: "hello there",
          idempotencyKey: "k1" as PublishInput["idempotencyKey"],
        },
      ),
    ).rejects.toBeNull();
  });
});
