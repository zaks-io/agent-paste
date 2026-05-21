#!/usr/bin/env node
import { spawn } from "node:child_process";

const script = new URL("./smoke-hosted.mjs", import.meta.url).pathname;
const child = spawn(process.execPath, [script, "preview"], { env: process.env, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
