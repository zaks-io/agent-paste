import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AGENT_SKILLS_INDEX_PATH,
  AGENT_SKILLS_SCHEMA,
  agentSkillsAssets,
  parseSkillFrontmatter,
  readSkills,
  skillDigest,
} from "./agent-skills.mjs";

const SKILLS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../skills");

function skill(overrides = {}) {
  return { name: "demo", description: "Do a demo thing.", body: "---\nname: demo\n---\nbody\n", ...overrides };
}

describe("parseSkillFrontmatter", () => {
  it("reads name and description out of the frontmatter block", () => {
    const parsed = parseSkillFrontmatter("---\nname: demo\ndescription: Does a thing.\n---\n\n# Demo\n", "demo");
    expect(parsed).toEqual({ name: "demo", description: "Does a thing." });
  });

  it("strips surrounding quotes from scalar values", () => {
    const parsed = parseSkillFrontmatter('---\nname: "demo"\ndescription: "Does a thing."\n---\nbody\n', "demo");
    expect(parsed).toEqual({ name: "demo", description: "Does a thing." });
  });

  it("throws when the frontmatter block is absent", () => {
    expect(() => parseSkillFrontmatter("# Demo\n", "demo")).toThrow(/missing YAML frontmatter/);
  });

  for (const name of ["-demo", "demo-", "de--mo", "Demo", "de_mo", "d".repeat(65), ""]) {
    it(`rejects the invalid skill name ${JSON.stringify(name)}`, () => {
      const source = `---\nname: ${name}\ndescription: Does a thing.\n---\nbody\n`;
      expect(() => parseSkillFrontmatter(source, "demo")).toThrow(/name/);
    });
  }

  it("rejects a missing description", () => {
    expect(() => parseSkillFrontmatter("---\nname: demo\n---\nbody\n", "demo")).toThrow(/description/);
  });

  it("rejects a description over the 1024 character spec limit", () => {
    const source = `---\nname: demo\ndescription: ${"x".repeat(1025)}\n---\nbody\n`;
    expect(() => parseSkillFrontmatter(source, "demo")).toThrow(/description/);
  });

  // Both spellings used to parse to a value that passed every check below:
  // the block scalar to the literal "|", the wrapped scalar to its first line.
  for (const [label, value] of [
    ["a block scalar", "|\n  Does a thing.\n  Over two lines."],
    ["a folded scalar", ">-\n  Does a thing."],
    ["a wrapped plain scalar", "Does a thing\n  over two lines."],
  ]) {
    it(`rejects ${label} description`, () => {
      const source = `---\nname: demo\ndescription: ${value}\n---\nbody\n`;
      expect(() => parseSkillFrontmatter(source, "demo")).toThrow(/spans multiple lines/);
    });
  }

  // An escaped terminal quote is not a closing quote, so both of these are
  // unterminated YAML that used to strip to a plausible-looking description.
  for (const [label, value] of [
    ["unterminated", '"Does a thing.'],
    ["closed only by an escaped quote", '"Does a thing.\\"'],
  ]) {
    it(`rejects a description ${label}`, () => {
      const source = `---\nname: demo\ndescription: ${value}\n---\nbody\n`;
      expect(() => parseSkillFrontmatter(source, "demo")).toThrow(/"description"/);
    });
  }
});

describe("skillDigest", () => {
  it("formats the SHA-256 of the artifact bytes as sha256:{hex}", () => {
    expect(skillDigest("hello")).toBe(`sha256:${createHash("sha256").update("hello", "utf8").digest("hex")}`);
    expect(skillDigest("hello")).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("agentSkillsAssets", () => {
  it("emits an index plus one artifact per skill", () => {
    const assets = agentSkillsAssets([skill({ name: "alpha" }), skill({ name: "beta" })]);
    expect(assets.map((asset) => asset.path)).toEqual([
      AGENT_SKILLS_INDEX_PATH,
      "/.well-known/agent-skills/alpha/SKILL.md",
      "/.well-known/agent-skills/beta/SKILL.md",
    ]);
  });

  it("advertises the v0.2.0 schema and required entry fields", () => {
    const [index] = agentSkillsAssets([skill()]);
    const parsed = JSON.parse(index.body);
    expect(parsed.$schema).toBe(AGENT_SKILLS_SCHEMA);
    expect(parsed.skills).toHaveLength(1);
    expect(Object.keys(parsed.skills[0]).sort()).toEqual(["description", "digest", "name", "type", "url"]);
    expect(parsed.skills[0].type).toBe("skill-md");
  });

  it("publishes each SKILL.md verbatim under the url it advertises", () => {
    const entry = skill({ body: "---\nname: demo\n---\nverbatim body\n" });
    const [index, artifact] = agentSkillsAssets([entry]);
    const published = JSON.parse(index.body).skills[0];
    expect(artifact.path).toBe(published.url);
    expect(artifact.body).toBe(entry.body);
    expect(published.digest).toBe(skillDigest(artifact.body));
  });

  it("refuses to publish an empty index", () => {
    expect(() => agentSkillsAssets([])).toThrow(/must not be empty/);
  });
});

describe("readSkills", () => {
  it("reads the repository skills directory", async () => {
    const skills = await readSkills(SKILLS_ROOT);
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.map((entry) => entry.name)).toContain("agent-paste");
  });

  it("digests the bytes actually on disk", async () => {
    const [index] = agentSkillsAssets(await readSkills(SKILLS_ROOT));
    for (const entry of JSON.parse(index.body).skills) {
      const source = await readFile(resolve(SKILLS_ROOT, entry.name, "SKILL.md"), "utf8");
      expect(entry.digest).toBe(skillDigest(source));
    }
  });

  it("throws when a skill directory name and frontmatter name disagree", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-skills-"));
    try {
      await mkdir(join(root, "foo"));
      await writeFile(join(root, "foo", "SKILL.md"), "---\nname: bar\ndescription: Does a thing.\n---\nbody\n");
      await expect(readSkills(root)).rejects.toThrow(/does not match its directory "foo"/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
