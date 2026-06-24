import { VIEWER_FRAME_HEIGHT_MESSAGE_TYPE } from "@agent-paste/contracts";

const VIEWER_END_MARKER_ID = "__agp_viewer_end__";

/**
 * Inline bootstrap injected into viewer-framed interactive HTML only. Reports
 * document height to the trusted app shell via postMessage so the parent can
 * size the sandboxed iframe and scroll the host page.
 */
const VIEWER_RESIZE_REPORTER_SOURCE = `(function(){var T=${JSON.stringify(VIEWER_FRAME_HEIGHT_MESSAGE_TYPE)};var M=${JSON.stringify(VIEWER_END_MARKER_ID)};var last=0;function measure(){var end=document.getElementById(M);if(end){return Math.ceil(end.offsetTop+end.offsetHeight)}var b=document.body,d=document.documentElement;return Math.ceil(Math.max(b?b.scrollHeight:0,d.scrollHeight))}function post(){var h=measure();if(h<=0||h===last)return;last=h;if(window.parent!==window){window.parent.postMessage({type:T,height:h},"*")}}if(typeof ResizeObserver!=="undefined"){new ResizeObserver(post).observe(document.body||document.documentElement)}addEventListener("load",post);addEventListener("DOMContentLoaded",post);post();})();`;

const VIEWER_END_MARKER = `<div id="${VIEWER_END_MARKER_ID}" aria-hidden="true" style="display:block;width:0;height:0;margin:0;padding:0;border:0"></div>`;

function viewerResizeReporterTag(nonce?: string): string {
  if (nonce) {
    return `<script nonce="${nonce}">${VIEWER_RESIZE_REPORTER_SOURCE}</script>`;
  }
  return `<script>${VIEWER_RESIZE_REPORTER_SOURCE}</script>`;
}

export function injectViewerResizeReporter(html: string, nonce?: string): string {
  if (html.includes(VIEWER_FRAME_HEIGHT_MESSAGE_TYPE)) {
    return html;
  }
  const reporterTag = viewerResizeReporterTag(nonce);
  const bodyClose = /<\/body>/i.exec(html);
  if (bodyClose) {
    const index = bodyClose.index;
    return `${html.slice(0, index)}${VIEWER_END_MARKER}${reporterTag}${html.slice(index)}`;
  }
  return `${html}${VIEWER_END_MARKER}${reporterTag}`;
}
