#!/usr/bin/env node
import { appsForProfile, runSharedSecretSetter } from "./lib/shared-secret-setter.mjs";

await runSharedSecretSetter(
  {
    secretName: "UPLOAD_SIGNING_SECRET",
    apps: appsForProfile("upload-signing"),
    scriptName: "set-upload-signing-secret.mjs",
    byteLength: 48,
    consistencyNote:
      "UPLOAD_SIGNING_SECRET binds only to upload, which both mints and verifies signed upload URLs.\n" +
      "Use a DIFFERENT value per environment (preview vs production).",
  },
  process.argv.slice(2),
);
