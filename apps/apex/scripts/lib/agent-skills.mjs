// Builds the Agent Skills discovery documents served under
// /.well-known/agent-skills/ per the Agent Skills Discovery RFC v0.2.0
// (https://github.com/cloudflare/agent-skills-discovery-rfc).
//
// The repo's top-level `skills/` directory is the only source. Each SKILL.md is
// republished byte-for-byte and its `digest` is derived from those same bytes at
// build time, so the index can never advertise a hash the artifact does not
// have (same "derive, never hand-pin" rule as THEME_INIT_SHA256 in the CSP).
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const AGENT_SKILLS_SCHEMA = "https://schemas.agentskills.io/discovery/0.2.0/schema.json";
export const AGENT_SKILLS_BASE = "/.well-known/agent-skills";
export const AGENT_SKILLS_INDEX_PATH = `${AGENT_SKILLS_BASE}/index.json`;

// Agent Skills specification name rules: 1-64 characters, lowercase alphanumeric
// and hyphens, no leading, trailing, or consecutive hyphens.
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

// A SKILL.md `name`/`description` is always a single-line scalar, so that is all
// this parser reads. The multi-line YAML spellings are rejected rather than
// half-parsed: `description: |` would otherwise yield the literal string "|" and
// a wrapped plain scalar would yield only its first line, both of which pass
// every length and pattern check below and ship a nonsense description.
const BLOCK_SCALAR_PATTERN = /^[|>][+-]?\d*$/;

function frontmatterField(frontmatter, field, origin) {
  const lines = frontmatter.split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith(`${field}:`));
  if (index === -1) {
    return "";
  }
  const raw = lines[index].slice(field.length + 1).trim();
  if (BLOCK_SCALAR_PATTERN.test(raw) || /^[ \t]/.test(lines[index + 1] ?? "")) {
    throw new Error(`${origin}: frontmatter "${field}" spans multiple lines; it must be a single-line value`);
  }
  const quote = raw[0];
  if (quote === '"' || quote === "'") {
    // A backslash means YAML escape semantics this parser does not implement.
    // It also makes the terminal quote ambiguous: in `"Does a thing.\"` that
    // quote is escaped, not closing, so the value is unterminated. Reject it.
    if (raw.length < 2 || !raw.endsWith(quote) || raw.includes("\\")) {
      throw new Error(`${origin}: frontmatter "${field}" is not a plain ${quote}-quoted single-line value`);
    }
    return raw.slice(1, -1);
  }
  return raw;
}

/** Extract the `name` and `description` a discovery entry needs from a SKILL.md. */
export function parseSkillFrontmatter(source, origin) {
  const match = source.match(FRONTMATTER_PATTERN);
  if (!match) {
    throw new Error(`${origin}: missing YAML frontmatter`);
  }
  const name = frontmatterField(match[1], "name", origin);
  const description = frontmatterField(match[1], "description", origin);
  if (!name || name.length > MAX_NAME_LENGTH || !SKILL_NAME_PATTERN.test(name)) {
    throw new Error(
      `${origin}: frontmatter "name" must be 1-64 lowercase alphanumeric/hyphen characters, got ${JSON.stringify(name)}`,
    );
  }
  if (!description || description.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(
      `${origin}: frontmatter "description" must be 1-${MAX_DESCRIPTION_LENGTH} characters, got ${description.length}`,
    );
  }
  return { name, description };
}

export function skillDigest(body) {
  return `sha256:${createHash("sha256").update(body, "utf8").digest("hex")}`;
}

/**
 * Turn parsed skills into the static files apex publishes: one SKILL.md per
 * skill plus the discovery index that points at them.
 */
export function agentSkillsAssets(skills) {
  if (skills.length === 0) {
    throw new Error("agent-skills: no skills found; the discovery index must not be empty");
  }
  const entries = skills.map((skill) => ({
    name: skill.name,
    type: "skill-md",
    description: skill.description,
    url: `${AGENT_SKILLS_BASE}/${skill.name}/SKILL.md`,
    digest: skillDigest(skill.body),
  }));
  const index = { $schema: AGENT_SKILLS_SCHEMA, skills: entries };
  return [
    { path: AGENT_SKILLS_INDEX_PATH, body: `${JSON.stringify(index, null, 2)}\n` },
    ...skills.map((skill, i) => ({ path: entries[i].url, body: skill.body })),
  ];
}

/** Read every `<skillsRoot>/<name>/SKILL.md`, keyed and sorted by frontmatter name. */
export async function readSkills(skillsRoot) {
  const dirs = (await readdir(skillsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const skills = await Promise.all(
    dirs.map(async (dir) => {
      const file = join(skillsRoot, dir, "SKILL.md");
      const body = await readFile(file, "utf8");
      const { name, description } = parseSkillFrontmatter(body, file);
      if (name !== dir) {
        throw new Error(`${file}: frontmatter name "${name}" does not match its directory "${dir}"`);
      }
      return { name, description, body };
    }),
  );
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}
