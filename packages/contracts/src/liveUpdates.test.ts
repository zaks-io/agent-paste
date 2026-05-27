import { describe, expect, it } from "vitest";
import {
  LiveUpdateAuthorizeRequest,
  LiveUpdateNotifyMessage,
  LiveUpdatePublishedRevisionEvent,
} from "./liveUpdates.js";

describe("live update contracts", () => {
  it("parses authorize requests for access links and dashboard sessions", () => {
    expect(
      LiveUpdateAuthorizeRequest.safeParse({
        kind: "access_link",
        public_id: "0123456789ABCDEF",
        blob: "signed",
      }).success,
    ).toBe(true);
    expect(
      LiveUpdateAuthorizeRequest.safeParse({
        kind: "dashboard",
        artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      }).success,
    ).toBe(true);
  });

  it("parses publish notify and SSE published revision events", () => {
    const pointer = {
      revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      iframe_src: "https://content.test/v/art.rev/index.html",
      render_mode: "html" as const,
      title: "Demo",
    };
    expect(
      LiveUpdateNotifyMessage.safeParse({
        op: "publish",
        artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        pointer,
      }).success,
    ).toBe(true);
    expect(
      LiveUpdatePublishedRevisionEvent.safeParse({
        type: "published_revision",
        artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        pointer,
      }).success,
    ).toBe(true);
  });
});
