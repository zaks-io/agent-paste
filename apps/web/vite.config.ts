import { cloudflare } from "@cloudflare/vite-plugin";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

export default defineConfig({
  // Bind dev to all interfaces so both http://localhost:5173 and
  // http://127.0.0.1:5173 resolve. Vite's default "localhost" binds IPv6-only
  // (::1) on some machines, which silently breaks whichever host you didn't use.
  server: {
    host: true,
    watch: { ignored: ["**/dist/**"] },
  },
  // lucide-react ships ~1500 icons as individual ESM files behind a barrel.
  // Under the Cloudflare (workerd) SSR environment, resolving that barrel
  // un-bundled makes SSR render hang for 10s+ (every icon = a separate module
  // fetch through miniflare). Pre-bundling it into one optimized dep fixes the
  // hang. Must be set for BOTH the client graph and the ssr environment.
  optimizeDeps: { include: ["lucide-react"] },
  environments: {
    ssr: { optimizeDeps: { include: ["lucide-react"] } },
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    // Sentry must be the last plugin. Uploads source maps (hidden, deleted after
    // upload) only when a token is present, so local/PR builds skip upload.
    ...(sentryAuthToken
      ? [sentryTanstackStart({ org: "zaksio", project: "agent-paste", authToken: sentryAuthToken })]
      : []),
  ],
});
