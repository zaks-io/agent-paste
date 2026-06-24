import { describe, expect, it } from "vitest";
import {
  VIEWER_FRAME_HEIGHT_MESSAGE_TYPE,
  ViewerFrameHeightMessage,
  isViewerFrameHeightMessage,
} from "./viewerFrame.js";

describe("viewerFrame", () => {
  it("accepts a positive finite height", () => {
    const message = { type: VIEWER_FRAME_HEIGHT_MESSAGE_TYPE, height: 2400 };
    expect(ViewerFrameHeightMessage.parse(message)).toEqual(message);
    expect(isViewerFrameHeightMessage(message)).toBe(true);
  });

  it("rejects unknown types and non-positive heights", () => {
    expect(isViewerFrameHeightMessage({ type: "other", height: 100 })).toBe(false);
    expect(isViewerFrameHeightMessage({ type: VIEWER_FRAME_HEIGHT_MESSAGE_TYPE, height: 0 })).toBe(false);
    expect(isViewerFrameHeightMessage({ type: VIEWER_FRAME_HEIGHT_MESSAGE_TYPE, height: -1 })).toBe(false);
  });
});
