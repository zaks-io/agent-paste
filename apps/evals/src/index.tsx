#!/usr/bin/env node
import { render } from "ink";
import { parseArgs } from "./args";
import { App } from "./ui/App";

render(<App args={parseArgs(process.argv.slice(2))} />, { interactive: process.stdin.isTTY });
