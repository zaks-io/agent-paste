import { describe, expect, it } from "vitest";
import { inferRenderModeFromEntrypoint } from "./renderMode.js";
import { RenderMode } from "./revisions.js";
import { CreateUploadSessionRequest } from "./uploadSessions.js";

describe("shared render-mode inference map", () => {
  it.each([
    ["index.html", "html"],
    ["page.htm", "html"],
    ["README.md", "markdown"],
    ["notes.markdown", "markdown"],
    ["plain.txt", "text"],
    ["plain.text", "text"],
    ["photo.png", "image"],
    ["photo.jpg", "image"],
    ["photo.jpeg", "image"],
    ["anim.gif", "image"],
    ["photo.webp", "image"],
    ["chart.svg", "image"],
    ["song.mp3", "audio"],
    ["song.wav", "audio"],
    ["voice.m4a", "audio"],
    ["sound.ogg", "audio"],
    ["clip.mp4", "video"],
    ["clip.webm", "video"],
    ["clip.mov", "video"],
  ] as const)("maps %s -> %s", (entrypoint, mode) => {
    expect(inferRenderModeFromEntrypoint(entrypoint)).toBe(mode);
  });

  it("is case-insensitive on the extension", () => {
    expect(inferRenderModeFromEntrypoint("CLIP.MOV")).toBe("video");
  });

  it("returns undefined for unknown or missing extensions", () => {
    expect(inferRenderModeFromEntrypoint("data.json")).toBeUndefined();
    expect(inferRenderModeFromEntrypoint("Makefile")).toBeUndefined();
  });

  it("only maps to valid RenderMode values", () => {
    expect(RenderMode.options).toEqual(["html", "markdown", "text", "image", "audio", "video"]);
  });
});

describe("CreateUploadSessionRequest render_mode", () => {
  const base = {
    title: "demo",
    entrypoint: "index.html",
    files: [{ path: "index.html", size_bytes: 12 }],
  };

  it("accepts every RenderMode enum value", () => {
    for (const mode of RenderMode.options) {
      const parsed = CreateUploadSessionRequest.safeParse({ ...base, render_mode: mode });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.render_mode).toBe(mode);
    }
  });

  it("accepts an absent render_mode (server-side inference)", () => {
    const parsed = CreateUploadSessionRequest.safeParse(base);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.render_mode).toBeUndefined();
  });

  it("accepts an absent title (revision publish preserves the artifact title)", () => {
    const parsed = CreateUploadSessionRequest.safeParse({
      artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      entrypoint: "index.html",
      files: [{ path: "index.html", size_bytes: 12 }],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.title).toBeUndefined();
  });

  it("rejects values outside the enum", () => {
    expect(CreateUploadSessionRequest.safeParse({ ...base, render_mode: "quicktime" }).success).toBe(false);
    expect(CreateUploadSessionRequest.safeParse({ ...base, render_mode: 7 }).success).toBe(false);
  });
});
