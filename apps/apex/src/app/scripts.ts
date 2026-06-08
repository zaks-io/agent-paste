// Runs in <head> before first paint: pin the stored theme so a returning visitor
// who chose a theme never flashes the OS default. No storage => no attribute =>
// prefers-color-scheme decides (see styles TOKENS).
//
// Byte-stable: its sha256 is added to the CSP elsewhere. Do not alter its logic.
export const THEME_INIT_JS = `(() => {
  try {
    const t = localStorage.getItem("ap-theme");
    if (t === "dark" || t === "light") document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();`;
