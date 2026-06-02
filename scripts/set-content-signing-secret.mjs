#!/usr/bin/env node
import { appsForProfile, runSharedSecretSetter } from "./lib/shared-secret-setter.mjs";

await runSharedSecretSetter(
  {
    secretName: "CONTENT_SIGNING_SECRET",
    apps: appsForProfile("content-signing"),
    scriptName: "set-content-signing-secret.mjs",
    byteLength: 48,
    consistencyNote:
      "Use the same value on api, upload, content, and jobs so content/bundle tokens and agent-view URLs\n" +
      "mint and verify consistently. Use a DIFFERENT value per environment (preview vs production).",
  },
  process.argv.slice(2),
);
