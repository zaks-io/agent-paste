import { VIEWER_FRAME_HEIGHT_MESSAGE_TYPE } from "@agent-paste/contracts";

export const VIEWER_END_MARKER_ID = "__agp_viewer_end__";
const VIEWER_RESIZE_REPORTER_SOURCE =
  '(function(){var T="agent-paste:viewer-height";var M="__agp_viewer_end__";var last=0;function measure(){var end=document.getElementById(M);if(end){return Math.ceil(end.offsetTop+end.offsetHeight)}var b=document.body,d=document.documentElement;return Math.ceil(Math.max(b?b.scrollHeight:0,d.scrollHeight))}function post(){var h=measure();if(h<=0||h===last)return;last=h;if(window.parent!==window){window.parent.postMessage({type:T,height:h},"*")}}if(typeof ResizeObserver!=="undefined"){new ResizeObserver(post).observe(document.body||document.documentElement)}addEventListener("load",post);addEventListener("DOMContentLoaded",post);post();})();';

if (VIEWER_FRAME_HEIGHT_MESSAGE_TYPE !== "agent-paste:viewer-height" || VIEWER_END_MARKER_ID !== "__agp_viewer_end__") {
  throw new Error("viewer resize reporter constants drifted from contracts");
}

const VIEWER_END_MARKER =
  '<div id="__agp_viewer_end__" aria-hidden="true" style="display:block;width:0;height:0;margin:0;padding:0;border:0"></div>';
const VIEWER_RESIZE_REPORTER_TAG = "<script>" + VIEWER_RESIZE_REPORTER_SOURCE + "</script>";
export const VIEWER_RESIZE_REPORTER_TRANSFORM_ID = "GB8p4FjZ10tL";
export const VIEWER_RESIZE_INJECTION_BLOCK = VIEWER_END_MARKER + VIEWER_RESIZE_REPORTER_TAG;

let reporterScriptSha256Promise: Promise<string> | undefined;

export async function viewerResizeReporterScriptSha256(): Promise<string> {
  reporterScriptSha256Promise ??= crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(VIEWER_RESIZE_REPORTER_SOURCE))
    .then((digest) => {
      const bytes = new Uint8Array(digest);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    });
  return reporterScriptSha256Promise;
}

export function injectViewerResizeReporter(html: string): string {
  if (html.includes(VIEWER_RESIZE_INJECTION_BLOCK)) return html;
  const matches = [...html.matchAll(/<\/body>/gi)];
  const bodyCloseIndex = matches.at(-1)?.index ?? -1;
  return bodyCloseIndex === -1
    ? html + VIEWER_RESIZE_INJECTION_BLOCK
    : html.slice(0, bodyCloseIndex) + VIEWER_RESIZE_INJECTION_BLOCK + html.slice(bodyCloseIndex);
}
