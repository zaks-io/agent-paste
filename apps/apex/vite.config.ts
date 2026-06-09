import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Plain Vite + React for the apex marketing site. There is no dev server / SPA
// entry: the site is prerendered to static HTML by scripts/prerender.mjs (which
// drives the client + SSR builds programmatically). Workspace packages are
// bundled into the SSR output so the prerender step imports plain JS, never TS.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  ssr: {
    noExternal: [/^@agent-paste\//],
  },
});
