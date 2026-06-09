// The single client enhancement that ships to the browser. Framework-free, DOM
// only, self-executing. It merges three behaviors that used to live as inline
// <script> blobs in the hono/jsx Shell + home page:
//   1. sticky-header data-stuck toggle on scroll
//   2. theme-toggle button (cycle system/dark/light, persist, paint icon + aria)
//   3. scroll-reveal + click-to-copy for the marketing home page
// Pages that lack the relevant elements simply no-op.
//
// The toggle's look + icons + cycle + cookie all come from @agent-paste/ui /brand
// (the SAME source the dashboard's React toggle uses), so the two headers cannot
// drift. Vite bundles these imports into the static client chunk; nothing ships
// to the marketing page beyond this one script.
import { buildThemeCookie, NEXT_THEME, readThemeCookie, THEME_ICON, type ThemeState } from "@agent-paste/ui";

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

// Click-to-copy on every [data-clipboard] element, with a textarea fallback for
// browsers without the async clipboard API, and a data-copied flash.
(() => {
  const FLASH_MS = 1100;
  const supportsClipboard = !!navigator.clipboard?.writeText;
  document.querySelectorAll("[data-clipboard]").forEach((el) => {
    el.addEventListener("click", async () => {
      const text = el.getAttribute("data-clipboard");
      if (!text) return;
      try {
        if (supportsClipboard) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.setAttribute("readonly", "");
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
        el.setAttribute("data-copied", "true");
        setTimeout(() => el.removeAttribute("data-copied"), FLASH_MS);
      } catch (err) {
        console.error("clipboard write failed", err);
      }
    });
  });
})();
