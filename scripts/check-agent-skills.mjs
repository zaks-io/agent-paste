import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const claudeSkillsDir = path.join(root, ".claude", "skills");
const agentSkillsDir = path.join(root, ".agents", "skills");
const skillsLockPath = path.join(root, "skills-lock.json");
const skillPrefix = "agent-paste-";

const errors = [];

const relative = (target) => path.relative(root, target) || ".";
const fail = (message) => errors.push(message);

const listDirNames = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true }).map((entry) => entry.name);
  } catch (error) {
    fail(`Cannot read ${relative(dir)}: ${error.message}`);
    return [];
  }
};

const readText = (file) => {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    fail(`Cannot read ${relative(file)}: ${error.message}`);
    return null;
  }
};

const readRealPath = (target) => {
  try {
    return realpathSync(target);
  } catch (error) {
    fail(`Cannot resolve ${relative(target)}: ${error.message}`);
    return null;
  }
};

const extractFrontmatterName = (skillFile) => {
  const text = readText(skillFile);
  if (!text) return null;

  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    fail(`${relative(skillFile)} is missing YAML frontmatter`);
    return null;
  }

  const nameMatch = match[1].match(/^name:\s*(.+)\s*$/m);
  if (!nameMatch) {
    fail(`${relative(skillFile)} is missing frontmatter name`);
    return null;
  }

  return nameMatch[1].trim().replace(/^["']|["']$/g, "");
};

const extractDefaultPrompt = (openaiFile) => {
  const text = readText(openaiFile);
  if (!text) return null;

  const match = text.match(/^\s*default_prompt:\s*(.+)\s*$/m);
  if (!match) {
    fail(`${relative(openaiFile)} is missing interface.default_prompt`);
    return null;
  }

  return match[1].trim().replace(/^["']|["']$/g, "");
};

const sha256 = (file) => {
  const text = readText(file);
  if (text === null) return null;
  return createHash("sha256").update(text).digest("hex");
};

const claudeSkillNames = listDirNames(claudeSkillsDir)
  .filter((name) => {
    const fullPath = path.join(claudeSkillsDir, name);
    try {
      return lstatSync(fullPath).isDirectory();
    } catch {
      return false;
    }
  })
  .sort();

for (const name of claudeSkillNames) {
  if (!name.startsWith(skillPrefix)) {
    fail(`${relative(path.join(claudeSkillsDir, name))} must start with ${skillPrefix}`);
    continue;
  }

  const skillFile = path.join(claudeSkillsDir, name, "SKILL.md");
  const frontmatterName = extractFrontmatterName(skillFile);
  if (frontmatterName && frontmatterName !== name) {
    fail(`${relative(skillFile)} name is ${frontmatterName}, expected ${name}`);
  }

  const openaiFile = path.join(claudeSkillsDir, name, "agents", "openai.yaml");
  const defaultPrompt = extractDefaultPrompt(openaiFile);
  if (defaultPrompt && !defaultPrompt.includes(`$${name}`)) {
    fail(`${relative(openaiFile)} default_prompt must reference $${name}`);
  }
}

const agentEntries = listDirNames(agentSkillsDir).sort();
const claudeSkillSet = new Set(claudeSkillNames);
const agentEntrySet = new Set(agentEntries);

for (const name of agentEntries) {
  const agentPath = path.join(agentSkillsDir, name);
  let stats;
  try {
    stats = lstatSync(agentPath);
  } catch (error) {
    fail(`Cannot inspect ${relative(agentPath)}: ${error.message}`);
    continue;
  }

  if (!name.startsWith(skillPrefix)) {
    fail(`${relative(agentPath)} must start with ${skillPrefix}`);
  }

  if (!stats.isSymbolicLink()) {
    fail(`${relative(agentPath)} must be a symlink to .claude/skills/${name}`);
    continue;
  }

  const expectedTarget = path.join("..", "..", ".claude", "skills", name);
  const actualTarget = readlinkSync(agentPath);
  if (actualTarget !== expectedTarget) {
    fail(`${relative(agentPath)} points to ${actualTarget}, expected ${expectedTarget}`);
  }

  const expectedRealPath = readRealPath(path.join(claudeSkillsDir, name));
  const actualRealPath = readRealPath(agentPath);
  if (actualRealPath && expectedRealPath && actualRealPath !== expectedRealPath) {
    fail(`${relative(agentPath)} resolves to ${relative(actualRealPath)}, expected ${relative(expectedRealPath)}`);
  }
}

for (const name of claudeSkillNames) {
  if (!agentEntrySet.has(name)) {
    fail(`${relative(agentSkillsDir)} is missing symlink ${name}`);
  }
}

for (const name of agentEntries) {
  if (!claudeSkillSet.has(name)) {
    fail(`${relative(agentSkillsDir)}/${name} has no matching .claude skill`);
  }
}

const lockText = readText(skillsLockPath);
if (lockText) {
  try {
    const lock = JSON.parse(lockText);
    for (const [name, entry] of Object.entries(lock.skills ?? {})) {
      if (!name.startsWith(skillPrefix)) {
        fail(`${relative(skillsLockPath)} contains unprefixed skill key ${name}`);
      }

      if (!entry.skillPath?.startsWith(`.claude/skills/${skillPrefix}`)) {
        fail(`${relative(skillsLockPath)} entry ${name} must point at canonical .claude/skills`);
        continue;
      }

      const lockedSkillFile = path.join(root, entry.skillPath);
      const lockedSkillName = path.basename(path.dirname(lockedSkillFile));
      if (lockedSkillName !== name) {
        fail(`${relative(skillsLockPath)} entry ${name} points at ${entry.skillPath}`);
      }

      if (entry.computedHash) {
        const actualHash = sha256(lockedSkillFile);
        if (actualHash && actualHash !== entry.computedHash) {
          fail(`${relative(skillsLockPath)} entry ${name} hash is ${entry.computedHash}, expected ${actualHash}`);
        }
      }
    }
  } catch (error) {
    fail(`${relative(skillsLockPath)} is not valid JSON: ${error.message}`);
  }
}

if (errors.length > 0) {
  console.error("Agent skill guard failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Agent skill guard passed (${claudeSkillNames.length} skills).`);
