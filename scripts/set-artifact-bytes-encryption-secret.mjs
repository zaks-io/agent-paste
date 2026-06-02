#!/usr/bin/env node
import { appsForProfile, runSharedSecretSetter } from "./lib/shared-secret-setter.mjs";

await runSharedSecretSetter(
  {
    secretName: "ARTIFACT_BYTES_ENCRYPTION_KEY",
    apps: appsForProfile("artifact-bytes-encryption"),
    scriptName: "set-artifact-bytes-encryption-secret.mjs",
    byteLength: 48,
    consistencyNote:
      "Use the same value on upload, content, and jobs so encrypt/decrypt and bundle generation stay consistent.",
  },
  process.argv.slice(2),
);
