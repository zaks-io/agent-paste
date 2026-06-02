#!/usr/bin/env node
import { runSharedSecretSetter } from "./lib/shared-secret-setter.mjs";

// STREAM_INTERNAL_SECRET has no versioned-rotation profile, so its Worker set is
// declared here rather than derived from rotation-profiles.mjs.
await runSharedSecretSetter(
  {
    secretName: "STREAM_INTERNAL_SECRET",
    apps: ["api", "stream"],
    scriptName: "set-stream-internal-secret.mjs",
    byteLength: 32,
    consistencyNote:
      "Use the same value on api and stream so the stream Worker can authorize live-update calls to the API.",
  },
  process.argv.slice(2),
);
