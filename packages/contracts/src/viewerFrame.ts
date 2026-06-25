import { z } from "./zod.js";

/** postMessage `type` from viewer-framed HTML to the hosting app origin. */
export const VIEWER_FRAME_HEIGHT_MESSAGE_TYPE = "agent-paste:viewer-height" as const;

/** Maximum reported document height accepted by the viewer shell (50 MB of px). */
export const VIEWER_FRAME_MAX_HEIGHT_PX = 50_000_000;

export const ViewerFrameHeightMessage = z.object({
  type: z.literal(VIEWER_FRAME_HEIGHT_MESSAGE_TYPE),
  height: z.number().finite().positive().max(VIEWER_FRAME_MAX_HEIGHT_PX),
});
export type ViewerFrameHeightMessage = z.infer<typeof ViewerFrameHeightMessage>;

export function isViewerFrameHeightMessage(value: unknown): value is ViewerFrameHeightMessage {
  return ViewerFrameHeightMessage.safeParse(value).success;
}
