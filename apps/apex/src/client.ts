// The single client enhancement that ships to the browser. Framework-free, DOM
// only, no imports, self-executing. It merges three behaviors that used to live
// as inline <script> blobs in the hono/jsx Shell + home page:
//   1. sticky-header data-stuck toggle on scroll
//   2. theme-toggle button (flip data-theme, persist, paint icon/label/aria)
//   3. scroll-reveal + click-to-copy for the marketing home page
// Pages that lack the relevant elements simply no-op.

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
  const label = toggle.querySelector(".tt-label");
  const sun =
    '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="3.2" stroke="currentColor" stroke-width="1.3"/><path d="M8 .8v1.8M8 13.4v1.8M.8 8h1.8M13.4 8h1.8M3 3l1.2 1.2M11.8 11.8 13 13M13 3l-1.2 1.2M4.2 11.8 3 13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
  const moon =
    '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13.5 9.3A5.5 5.5 0 0 1 6.7 2.5 5.5 5.5 0 1 0 13.5 9.3Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const current = () => root.getAttribute("data-theme") || (prefersDark ? "dark" : "light");
  const paint = () => {
    const dark = current() === "dark";
    if (icon) icon.innerHTML = dark ? moon : sun;
    if (label) label.textContent = dark ? "Dark" : "Light";
    toggle.setAttribute("aria-pressed", String(dark));
  };
  paint();
  toggle.addEventListener("click", () => {
    const next = current() === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    // Persist to the cookie shared with the dashboard (app.agent-paste.sh) so the
    // theme follows the visitor across surfaces. Domain = the registrable parent;
    // mirrors @agent-paste/brand themeCookieDomain()/buildThemeCookie().
    try {
      const host = location.hostname;
      const domain =
        host === "agent-paste.sh" || host.endsWith(".agent-paste.sh")
          ? host === "preview.agent-paste.sh" || host.includes(".preview.agent-paste.sh")
            ? ".preview.agent-paste.sh"
            : ".agent-paste.sh"
          : "";
      const secure = location.protocol === "https:" ? "; Secure" : "";
      // biome-ignore lint/suspicious/noDocumentCookie: framework-free script; the async Cookie Store API can't be read by the synchronous first-paint init, so both surfaces share document.cookie.
      document.cookie = `agp_theme=${next}; Path=/; Max-Age=31536000; SameSite=Lax${domain ? `; Domain=${domain}` : ""}${secure}`;
    } catch {}
    paint();
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
