import type { PublishInput, PublishOutcome, PublishTransport } from "@agent-paste/api-client/publish";
import type { AgentView, ArtifactFileContent } from "@agent-paste/contracts";
import { describe, expect, it } from "vitest";
import {
  type ReviseDeps,
  ReviseError,
  type RevisionReader,
  reviseOnePath,
  reviseWholeBody,
} from "./revise-one-path.js";

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
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

describe("reviseOnePath", () => {
  it("publishes a partial-manifest revision under the base, preserving title + entrypoint", async () => {
    const base = await fileContent("hello world");
    const reader: RevisionReader = {
      readArtifact: async () => agentView(),
      readFile: async () => base,
    };
    let captured: PublishInput | undefined;
    const publish = async (_t: PublishTransport, input: PublishInput) => {
      captured = input;
      return outcome();
    };
    const result = await reviseOnePath(deps(reader, publish), {
      artifactId: "art_1",
      path: "index.html",
      edits: [{ oldString: "world", newString: "there" }],
      idempotencyKey: "k1" as PublishInput["idempotencyKey"],
    });

    expect(result).toEqual({ ok: true, noop: false, outcome: outcome() });
    expect(captured?.artifactId).toBe("art_1");
    expect(captured?.baseRevisionId).toBe("rev_1");
    expect(captured?.title).toBe("My Doc");
    expect(captured?.entrypoint).toBe("index.html");
    expect(captured?.files).toHaveLength(1);
    expect(captured?.files[0]?.path).toBe("index.html");
  });

  it("sends a patch entry when a verified diff is smaller", async () => {
    const baseBody = `line one\n${"context\n".repeat(20)}line target\n`;
    const base = await fileContent(baseBody);
    const reader: RevisionReader = { readArtifact: async () => agentView(), readFile: async () => base };
    let captured: PublishInput | undefined;
    const publish = async (_t: PublishTransport, input: PublishInput) => {
      captured = input;
      return outcome();
    };
    await reviseOnePath(deps(reader, publish), {
      artifactId: "art_1",
      path: "index.html",
      edits: [{ oldString: "line target", newString: "line edited" }],
      idempotencyKey: "k1" as PublishInput["idempotencyKey"],
    });
    expect(captured?.files[0]?.patch).toBeDefined();
    expect(captured?.files[0]?.patch?.baseSha256).toBe(base.sha256);
  });

  it("falls back to a whole-file entry (still under base) when no smaller diff exists", async () => {
    const base = await fileContent("a");
    const reader: RevisionReader = { readArtifact: async () => agentView(), readFile: async () => base };
    let captured: PublishInput | undefined;
    const publish = async (_t: PublishTransport, input: PublishInput) => {
      captured = input;
      return outcome();
    };
    await reviseOnePath(deps(reader, publish), {
      artifactId: "art_1",
      path: "index.html",
      edits: [{ oldString: "a", newString: "bb" }],
      idempotencyKey: "k1" as PublishInput["idempotencyKey"],
    });
    // Diff of a 1-byte file is never smaller, so the whole file is sent under base.
    expect(captured?.files[0]?.patch).toBeUndefined();
    expect(captured?.baseRevisionId).toBe("rev_1");
  });

  it("is a no-op (no revision) when the edit result equals the stored bytes", async () => {
    const base = await fileContent("hello world");
    const reader: RevisionReader = { readArtifact: async () => agentView(), readFile: async () => base };
    let published = false;
    const publish = async () => {
      published = true;
      return outcome();
    };
    const result = await reviseOnePath(deps(reader, publish), {
      artifactId: "art_1",
      path: "index.html",
      edits: [{ oldString: "world", newString: "world" }],
      idempotencyKey: "k1" as PublishInput["idempotencyKey"],
    });
    expect(result).toMatchObject({ ok: true, noop: true });
    expect(result).toMatchObject({ base: { artifact_id: "art_1", title: "My Doc" } });
    expect(published).toBe(false);
  });

  it("throws a typed ReviseError when an edit does not match (never falls back)", async () => {
    const base = await fileContent("hello");
    const reader: RevisionReader = { readArtifact: async () => agentView(), readFile: async () => base };
    const publish = async () => outcome();
    await expect(
      reviseOnePath(deps(reader, publish), {
        artifactId: "art_1",
        path: "index.html",
        edits: [{ oldString: "absent", newString: "x" }],
        idempotencyKey: "k1" as PublishInput["idempotencyKey"],
      }),
    ).rejects.toMatchObject({ name: "ReviseError", reason: "not_found", editIndex: 0 });
  });

  it("throws base_not_text for a binary base", async () => {
    const base = await fileContent("", { is_binary: true, body: undefined });
    const reader: RevisionReader = { readArtifact: async () => agentView(), readFile: async () => base };
    const publish = async () => outcome();
    await expect(
      reviseOnePath(deps(reader, publish), {
        artifactId: "art_1",
        path: "index.html",
        edits: [{ oldString: "a", newString: "b" }],
        idempotencyKey: "k1" as PublishInput["idempotencyKey"],
      }),
    ).rejects.toBeInstanceOf(ReviseError);
  });

  it("throws path_not_in_base when the target path is absent from the base tree", async () => {
    const reader: RevisionReader = {
      readArtifact: async () =>
        agentView({
          files: [{ path: "other.html", size_bytes: 1, content_type: "text/html", url: "u" }] as AgentView["files"],
        }),
      readFile: async () => fileContent("x"),
    };
    const publish = async () => outcome();
    await expect(
      reviseOnePath(deps(reader, publish), {
        artifactId: "art_1",
        path: "index.html",
        edits: [{ oldString: "x", newString: "y" }],
        idempotencyKey: "k1" as PublishInput["idempotencyKey"],
      }),
    ).rejects.toMatchObject({ reason: "path_not_in_base" });
  });

  it("retries once against the fresh base on a patch_conflict (TOCTOU)", async () => {
    const base = await fileContent("hello world");
    let publishCalls = 0;
    const reader: RevisionReader = { readArtifact: async () => agentView(), readFile: async () => base };
    const publish = async (_t: PublishTransport, _input: PublishInput) => {
      publishCalls += 1;
      if (publishCalls === 1) {
        throw { code: "patch_conflict", message: "patch_conflict: index.html: base moved" };
      }
      return outcome();
    };
    const result = await reviseOnePath(deps(reader, publish), {
      artifactId: "art_1",
      path: "index.html",
      edits: [{ oldString: "world", newString: "there" }],
      idempotencyKey: "k1" as PublishInput["idempotencyKey"],
    });
    expect(result).toMatchObject({ ok: true, noop: false });
    expect(publishCalls).toBe(2);
  });

  it("surfaces a stale edit as not_found after a TOCTOU re-read", async () => {
    let readCount = 0;
    const fresh = await fileContent("completely different");
    const original = await fileContent("hello world");
    const reader: RevisionReader = {
      readArtifact: async () => agentView(),
      readFile: async () => {
        readCount += 1;
        return readCount === 1 ? original : fresh;
      },
    };
    const publish = async () => {
      throw { code: "patch_conflict", message: "patch_conflict" };
    };
    await expect(
      reviseOnePath(deps(reader, publish), {
        artifactId: "art_1",
        path: "index.html",
        edits: [{ oldString: "world", newString: "there" }],
        idempotencyKey: "k1" as PublishInput["idempotencyKey"],
      }),
    ).rejects.toMatchObject({ reason: "not_found" });
  });

  it("does not retry on a non-conflict error", async () => {
    const base = await fileContent("hello world");
    let publishCalls = 0;
    const reader: RevisionReader = { readArtifact: async () => agentView(), readFile: async () => base };
    const publish = async () => {
      publishCalls += 1;
      throw { code: "internal_error", message: "boom" };
    };
    await expect(
      reviseOnePath(deps(reader, publish), {
        artifactId: "art_1",
        path: "index.html",
        edits: [{ oldString: "world", newString: "there" }],
        idempotencyKey: "k1" as PublishInput["idempotencyKey"],
      }),
    ).rejects.toMatchObject({ code: "internal_error" });
    expect(publishCalls).toBe(1);
  });
});

describe("reviseWholeBody", () => {
  it("publishes the whole new body as a revise under the base", async () => {
    const base = await fileContent("old body");
    const reader: RevisionReader = { readArtifact: async () => agentView(), readFile: async () => base };
    let captured: PublishInput | undefined;
    const publish = async (_t: PublishTransport, input: PublishInput) => {
      captured = input;
      return outcome();
    };
    const result = await reviseWholeBody(deps(reader, publish), {
      artifactId: "art_1",
      path: "index.html",
      nextText: "new body",
      idempotencyKey: "k1" as PublishInput["idempotencyKey"],
    });
    expect(result).toMatchObject({ ok: true, noop: false });
    expect(captured?.baseRevisionId).toBe("rev_1");
  });

  it("is a no-op when the new body equals the stored bytes", async () => {
    const base = await fileContent("same");
    const reader: RevisionReader = { readArtifact: async () => agentView(), readFile: async () => base };
    let published = false;
    const publish = async () => {
      published = true;
      return outcome();
    };
    const result = await reviseWholeBody(deps(reader, publish), {
      artifactId: "art_1",
      path: "index.html",
      nextText: "same",
      idempotencyKey: "k1" as PublishInput["idempotencyKey"],
    });
    expect(result).toMatchObject({ ok: true, noop: true, base: { revision_id: "rev_1" } });
    expect(published).toBe(false);
  });
});
