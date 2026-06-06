import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  allOperatorClassifiedEventActions,
  OPERATOR_LIFECYCLE_EVENT_ACTIONS,
  OPERATOR_SECURITY_EVENT_ACTIONS,
  resolveOperatorEventActions,
} from "./operator-event-filters.js";

const repoRoot = resolve(import.meta.dirname, "../../../..");

const EMITTER_ROOTS = ["packages/db/src/repository", "packages/billing/src", "apps/jobs/src"] as const;

const IGNORED_PATH_PARTS = [".test.", ".integration.test.", "/test-helpers/", "/test/"];

const ACTION_LIKE = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

const TARGET_TYPES = "workspace|artifact|api_key|upload_session|cleanup|revision";

function shouldIgnore(relativePath: string): boolean {
  return IGNORED_PATH_PARTS.some((part) => relativePath.includes(part));
}

function extractActionsFromContent(content: string): Set<string> {
  const actions = new Set<string>();

  for (const match of content.matchAll(/action:\s*["']([a-z][a-z0-9_.]*)["']/g)) {
    actions.add(match[1]!);
  }

  for (const line of content.split("\n")) {
    if (!line.includes("action:")) {
      continue;
    }
    for (const match of line.matchAll(/"([a-z][a-z0-9_.]*)"/g)) {
      const action = match[1]!;
      if (ACTION_LIKE.test(action)) {
        actions.add(action);
      }
    }
  }

  if (content.includes("insert into operation_events")) {
    const sqlAction = new RegExp(`'([a-z][a-z0-9_.]*)',\\s*'(?:${TARGET_TYPES})`, "g");
    for (const match of content.matchAll(sqlAction)) {
      actions.add(match[1]!);
    }
  }

  return actions;
}

async function walkDirectory(absoluteDir: string, relativeDir: string, actions: Set<string>): Promise<void> {
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = join(relativeDir, entry.name);
    if (shouldIgnore(relativePath)) {
      continue;
    }
    const absolutePath = join(absoluteDir, entry.name);
    if (entry.isDirectory()) {
      await walkDirectory(absolutePath, relativePath, actions);
      continue;
    }
    if (!entry.name.endsWith(".ts")) {
      continue;
    }
    const content = await readFile(absolutePath, "utf8");
    for (const action of extractActionsFromContent(content)) {
      actions.add(action);
    }
  }
}

async function collectEmittedOperationEventActions(): Promise<Set<string>> {
  const actions = new Set<string>();
  for (const root of EMITTER_ROOTS) {
    await walkDirectory(join(repoRoot, root), root, actions);
  }
  return actions;
}

describe("resolveOperatorEventActions", () => {
  it("returns undefined for all focus", () => {
    expect(resolveOperatorEventActions({ focus: "all" })).toBeUndefined();
    expect(resolveOperatorEventActions({})).toBeUndefined();
  });

  it("returns security and lifecycle action lists for focus filters", () => {
    expect(resolveOperatorEventActions({ focus: "security" })).toEqual([...OPERATOR_SECURITY_EVENT_ACTIONS]);
    expect(resolveOperatorEventActions({ focus: "lifecycle" })).toEqual([...OPERATOR_LIFECYCLE_EVENT_ACTIONS]);
  });

  it("prefers an explicit action filter over focus", () => {
    expect(resolveOperatorEventActions({ focus: "security", action: "artifact.published" })).toEqual([
      "artifact.published",
    ]);
  });
});

describe("operator event action drift guard", () => {
  it("classifies every emitted audit action and excludes dead filter entries", async () => {
    const emitted = await collectEmittedOperationEventActions();
    const classified = new Set(allOperatorClassifiedEventActions());

    const unclassified = [...emitted].filter((action) => !classified.has(action)).sort();
    expect(unclassified, "emitted actions missing from operator focus filters").toEqual([]);

    const deadFilters = [...classified].filter((action) => !emitted.has(action)).sort();
    expect(deadFilters, "operator filter actions with no emitters in the codebase").toEqual([]);
  });

  it("keeps security and lifecycle focus groups disjoint", () => {
    const security = new Set(OPERATOR_SECURITY_EVENT_ACTIONS);
    const overlap = OPERATOR_LIFECYCLE_EVENT_ACTIONS.filter((action) => security.has(action));
    expect(overlap).toEqual([]);
  });
});
