import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflow = parse(readFileSync(new URL("../.github/workflows/pr-preview.yml", import.meta.url), "utf8"));
const deploy = workflow.jobs.deploy;
const soak = deploy.steps.find((step) => step.id === "large-transfer");
const artifact = deploy.steps.find((step) => step.with?.name?.startsWith("hosted-transfer-evidence"));
const expression = (value) => `$${`{{ ${value} }}`}`;

function evaluate(expression, sameRepo, labels) {
  const source = expression.slice(3, -2).replaceAll("labels.*.name", "labels.map(label => label.name)");
  const github = {
    repository: "zaks-io/agent-paste",
    event: {
      pull_request: {
        head: { repo: { full_name: sameRepo ? "zaks-io/agent-paste" : "other/fork" } },
        labels: labels.map((name) => ({ name })),
      },
    },
  };
  return new Function("github", "contains", `return (${source})`)(github, (items, name) => items.includes(name));
}

describe("hosted acceptance opt-in workflow", () => {
  it.each([
    [true, [], false],
    [true, ["large-transfer-preview"], false],
    [true, ["full-pr-preview"], false],
    [false, ["full-pr-preview", "large-transfer-preview"], false],
    [true, ["full-pr-preview", "large-transfer-preview"], true],
  ])("requires both labels and a same-repository head", (same, labels, expected) => {
    expect(evaluate(soak.if, same, labels)).toBe(expected);
    expect(evaluate(deploy.if, same, labels)).toBe(same && labels.includes("full-pr-preview"));
  });

  it("keeps the default deadline and bounds the opt-in run", () => {
    expect(evaluate(deploy["timeout-minutes"], true, ["full-pr-preview"])).toBe(25);
    expect(evaluate(deploy["timeout-minutes"], true, ["full-pr-preview", "large-transfer-preview"])).toBe(135);
    expect(soak["timeout-minutes"]).toBe(110);
  });

  it("keeps the scoped secret inside the deploy job and uploads exactly the sanitized file", () => {
    expect(soak.env.AGENT_PASTE_PR_SMOKE_HARNESS_SECRET).toBe(expression("steps.deploy.outputs.smoke_harness_secret"));
    expect(soak.env.AGENT_PASTE_PR_CONTENT_URL).toBe(expression("steps.deploy.outputs.content_url"));
    expect(JSON.stringify(deploy.outputs)).not.toContain("secret");
    expect(artifact.with.path).toBe(`${expression("runner.temp")}/hosted-large-transfer/hosted-transfer-evidence.json`);
    expect(artifact.if).toContain("always()");
    expect(artifact.if).toContain("steps.large-transfer.outcome != 'skipped'");
    expect(artifact.if).toContain("'large-transfer-preview'");
    expect(artifact.if).toContain("'full-pr-preview'");
    expect(workflow.on.pull_request.types).toContain("labeled");
  });
});
