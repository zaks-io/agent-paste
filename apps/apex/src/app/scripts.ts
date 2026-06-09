// Runs in <head> before first paint: pin the stored theme so a returning visitor
// who chose a theme never flashes the OS default. Reads the cross-surface cookie
// (agp_theme, shared with the dashboard on .agent-paste.sh) so a theme chosen in
// the app carries here too; "system" or no cookie => no attribute => prefers-
// color-scheme decides (see styles TOKENS).
//
// Byte-stable: its sha256 is added to the CSP elsewhere. If you edit this, update
// the pinned hash + the byte-stability test (security-headers.test.ts).
export const THEME_INIT_JS = `(() => {
  try {
    var m = document.cookie.match(/(?:^|; )agp_theme=([^;]*)/);
    var t = m ? m[1] : "";
    if (t === "dark" || t === "light") document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();`;
