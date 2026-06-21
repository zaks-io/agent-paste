// The single client enhancement that ships to the browser. Framework-free,
// self-executing, with browser-side error monitoring plus the three DOM
// behaviors that used to live as inline <script> blobs in the hono/jsx Shell +
// home page:
//   1. sticky-header data-stuck toggle on scroll
//   2. theme-toggle button (cycle system/dark/light, persist, paint icon + aria)
//   3. scroll-reveal + click-to-copy for the marketing home page
// Pages that lack the relevant elements simply no-op.
//
// The toggle's look + icons + cycle + cookie all come from @agent-paste/ui /brand
// (the SAME source the dashboard's React toggle uses), so the two headers cannot
// drift. Vite bundles these imports into the static client chunk; nothing ships
// to the marketing page beyond this one script.
import {
  buildOptionalAnalyticsCookie,
  buildThemeCookie,
  NEXT_THEME,
  readOptionalAnalyticsCookie,
  readThemeCookie,
  THEME_ICON,
  type ThemeState,
} from "@agent-paste/ui";
import { initApexBrowserSentry } from "./sentry-browser";

const CLAIM_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

void initApexBrowserSentry();

function browserAnalyticsSignalActive() {
  return (
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true ||
    navigator.doNotTrack === "1"
  );
}

function optionalAnalyticsOff() {
  return browserAnalyticsSignalActive() || readOptionalAnalyticsCookie(document.cookie) === "off";
}

function claimCode() {
  return `clm_${encodeCrockford(Date.now(), 10)}${randomCrockford(16)}`;
}

function encodeCrockford(value: number, length: number) {
  let remaining = Math.max(0, Math.floor(value));
  let output = "";
  for (let index = 0; index < length; index += 1) {
    output = CLAIM_CODE_ALPHABET.charAt(remaining % 32) + output;
    remaining = Math.floor(remaining / 32);
  }
  return output;
}

function randomCrockford(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => CLAIM_CODE_ALPHABET.charAt(byte % 32)).join("");
}

function promptWithClaimCode(prompt: string, id: string) {
  return `${prompt}\n\nAgent Paste attribution: if you publish with --ephemeral, preserve this analytics flag: --claim-code ${id}. It is not auth or a secret.`;
}

function trackPromptCopied(id: string, promptVariant: string) {
  if (optionalAnalyticsOff()) {
    return;
  }
  void fetch("/__funnel/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event: "prompt_copied", claim_code: id, prompt_variant: promptVariant }),
    keepalive: true,
  }).catch(() => {});
}

// Sticky-state toggle for the shared topbar.
(() => {
  const bar = document.getElementById("topbar");
  if (bar) {
    const onScroll = () => bar.setAttribute("data-stuck", String(window.scrollY > 8));
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  const toggle = document.getElementById("theme-toggle");
  if (!toggle) return;
  const root = document.documentElement;
  const icon = toggle.querySelector(".tt-icon");

  // The persisted preference (system/dark/light). "system" => no data-theme
  // attribute, so prefers-color-scheme decides; the icon still reflects the choice.
  const state = (): ThemeState => readThemeCookie(document.cookie) ?? "system";
  const apply = (s: ThemeState) => {
    if (s === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", s);
  };
  const paint = (s: ThemeState) => {
    if (icon) icon.innerHTML = THEME_ICON[s];
    toggle.setAttribute("aria-label", `Theme: ${s}. Switch to ${NEXT_THEME[s]}.`);
  };
  paint(state());
  toggle.addEventListener("click", () => {
    const next = NEXT_THEME[state()];
    apply(next);
    // Persist to the cookie shared with the dashboard (app.agent-paste.sh) so the
    // theme follows the visitor across surfaces. Same builder both surfaces use.
    try {
      // biome-ignore lint/suspicious/noDocumentCookie: framework-free script; the async Cookie Store API can't be read by the synchronous first-paint init, so both surfaces share document.cookie.
      document.cookie = buildThemeCookie(next, location.hostname, location.protocol === "https:");
    } catch {}
    paint(next);
  });
})();

// Optional analytics preference. Browser-level GPC/DNT signals win; otherwise the
// shared first-party preference cookie controls whether the CF Web Analytics
// beacon is rendered on the next response.
(() => {
  const toggle = document.getElementById("analytics-toggle") as HTMLButtonElement | null;
  if (!toggle) return;

  const paint = () => {
    const off = optionalAnalyticsOff();
    const browserSignal = browserAnalyticsSignalActive();
    toggle.textContent = off ? "Analytics off" : "Analytics on";
    toggle.setAttribute("aria-pressed", String(off));
    toggle.disabled = browserSignal;
    toggle.title = browserSignal ? "Browser privacy signal active" : "Toggle optional analytics";
  };

  paint();
  toggle.addEventListener("click", () => {
    const next = optionalAnalyticsOff() ? "on" : "off";
    try {
      // biome-ignore lint/suspicious/noDocumentCookie: preference must be readable by the next SSR request on both public surfaces.
      document.cookie = buildOptionalAnalyticsCookie(next, location.hostname, location.protocol === "https:");
    } catch {}
    location.reload();
  });
})();

// Scroll-reveal: add `.in` to `.reveal` elements as they enter the viewport, and
// immediately reveal the sticky hero pane so it never starts hidden.
(() => {
  const els = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) {
    els.forEach((e) => {
      e.classList.add("in");
    });
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
  );
  els.forEach((e) => {
    io.observe(e);
  });
  requestAnimationFrame(() => {
    document.querySelectorAll(".pane-left .reveal").forEach((e) => {
      e.classList.add("in");
    });
  });
})();

// Public marketing pages avoid shipping the support address in prerendered HTML.
// Assemble it in-browser so humans get a normal mailto link while simple crawlers
// only see the generic support affordance.
(() => {
  document.querySelectorAll<HTMLAnchorElement>("[data-email-codes]").forEach((link) => {
    const codes = link.getAttribute("data-email-codes");
    if (!codes) return;
    const email = codes
      .split(",")
      .map((code) => String.fromCharCode(Number(code)))
      .join("");
    if (!email.includes("@")) return;
    link.href = `mailto:${email}`;
    link.textContent = email;
    link.setAttribute("aria-label", `Email ${email}`);
  });
})();

// Click-to-copy on every [data-clipboard] element, with a textarea fallback for
// browsers without the async clipboard API, and a data-copied flash.
(() => {
  const FLASH_MS = 1100;
  const supportsClipboard = !!navigator.clipboard?.writeText;
  document.querySelectorAll("[data-clipboard]").forEach((el) => {
    el.addEventListener("click", async () => {
      const text = el.getAttribute("data-clipboard");
      if (!text) return;
      const promptVariant = el.getAttribute("data-claim-prompt-variant");
      const id = promptVariant ? claimCode() : undefined;
      const clipboardText = id ? promptWithClaimCode(text, id) : text;
      try {
        if (supportsClipboard) {
          await navigator.clipboard.writeText(clipboardText);
        } else {
          const ta = document.createElement("textarea");
          ta.value = clipboardText;
          ta.setAttribute("readonly", "");
          ta.className = "clipboard-fallback";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
        if (id && promptVariant) {
          trackPromptCopied(id, promptVariant);
        }
        el.setAttribute("data-copied", "true");
        setTimeout(() => el.removeAttribute("data-copied"), FLASH_MS);
      } catch (err) {
        console.error("clipboard write failed", err);
      }
    });
  });
})();

// Pseudo-agent demo: reveal the transcript lines one at a time, like a real coding
// agent (Codex / Claude Code) working through a job. The inline Execute button
// sits right under the prompt; clicking it hides the button and streams the run
// in below with jittered, kind-aware pacing so it doesn't feel metronomic. When
// it finishes, a circular replay control appears in the head.
//
// JS only decides *which line shows now*; apex.css owns the fade and the caret.
// Progressive enhancement: every line is visible by default, so we arm the shell
// (hiding all but the prompt) ONLY when motion is allowed. Under reduced-motion we
// leave the static transcript untouched and just let the controls reveal it.
(() => {
  const shell = document.querySelector<HTMLElement>("[data-demo]");
  if (!shell) return;
  const runBtn = shell.querySelector<HTMLButtonElement>("[data-demo-run]");
  const replayBtn = shell.querySelector<HTMLButtonElement>("[data-demo-replay]");
  if (!runBtn) return;

  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  // Reduced-motion: do not arm at all. Arming sets data-demo="armed", which the
  // CSS uses to collapse (display:none) every line after the prompt until Execute
  // is clicked. The reduced-motion CSS block forces opacity/transform but does NOT
  // override that display:none, so arming under reduced-motion would hide the
  // transcript behind a click. Leaving the shell un-armed keeps the full static
  // transcript visible (the same baseline no-JS visitors and crawlers get), which
  // is the correct "don't animate" behavior, so we never wire the controls.
  if (reduceMotion) return;

  // The scrollable body is capped by its max-height (300px); as lines reveal past
  // it we keep the newest line in view by pinning the scroll to the bottom.
  const body = shell.querySelector<HTMLElement>(".t-body");
  const scrollToLatest = () => {
    if (body) body.scrollTop = body.scrollHeight;
  };

  // The prompt is the first .t-step and stays visible; the rest stream in.
  const playable = Array.from(shell.querySelectorAll<HTMLElement>(".t-step")).slice(1);

  // Pacing is data-driven: each line's `data-wait` is the real-world latency that
  // produces it (a thinking beat before reasoning, a network round-trip before a
  // fetch result, the upload/publish wait before the CLI output block; lines that
  // are part of one result carry tiny waits so they burst in together). We just
  // scale that down so the whole run is snappy — a few seconds, like a quick agent.
  const SPEED = 0.58; // <1 speeds the run up; the relative rhythm is preserved.
  const delayBefore = (el: HTMLElement) => {
    const raw = Number(el.getAttribute("data-wait"));
    const ms = Number.isFinite(raw) && raw > 0 ? raw : 320;
    return Math.max(120, Math.round(ms * SPEED));
  };

  let running = false;
  let timers: ReturnType<typeof setTimeout>[] = [];

  const clearTimers = () => {
    timers.forEach((id) => {
      clearTimeout(id);
    });
    timers = [];
  };

  const resetSteps = () => {
    playable.forEach((el) => {
      el.classList.remove("is-played", "is-active");
    });
  };

  const finish = () => {
    const last = playable[playable.length - 1];
    if (last) last.classList.remove("is-active");
    shell.setAttribute("data-demo", "done");
    running = false;
  };

  const run = () => {
    if (running) return;
    running = true;
    clearTimers();
    resetSteps();
    if (body) body.scrollTop = 0;
    shell.setAttribute("data-demo", "playing");

    let elapsed = 0;
    playable.forEach((el, i) => {
      elapsed += delayBefore(el);
      timers.push(
        setTimeout(() => {
          const previous = playable[i - 1];
          if (previous) previous.classList.remove("is-active");
          el.classList.add("is-played", "is-active");
          scrollToLatest();
          if (i === playable.length - 1) {
            // Let the caret blink on the final line briefly, then settle.
            timers.push(setTimeout(finish, 480));
          }
        }, elapsed),
      );
    });
  };

  runBtn.addEventListener("click", run);
  replayBtn?.addEventListener("click", run);

  // Arm: hide everything after the prompt and reveal the inline Execute button.
  shell.setAttribute("data-demo", "armed");
})();
