import { cloudflare } from "@cloudflare/vite-plugin";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

export default defineConfig({
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
