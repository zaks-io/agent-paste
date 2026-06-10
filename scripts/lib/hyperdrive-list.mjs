export async function listHyperdriveConfigs(run) {
  const result = await run("pnpm", ["exec", "wrangler", "hyperdrive", "list"], {
    allowFailure: true,
    quiet: true,
  });
  if (result.code !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || `wrangler hyperdrive list exited ${result.code}`);
  }
  return parseHyperdriveList(result.stdout);
}

export async function findHyperdriveByName(run, name) {
  return (await listHyperdriveConfigs(run)).find((config) => config.name === name) ?? null;
}

export function parseHyperdriveList(output) {
  const configs = [];
  for (const line of output.split(/\r?\n/)) {
    const id = line.match(/[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i)?.[0];
    if (!id) {
      continue;
    }
    const name = parseHyperdriveName(line, id);
    if (name) {
      configs.push({ id, name });
    }
  }
  return configs;
}

function parseHyperdriveName(line, id) {
  if (line.includes("│")) {
    const tableCells = line
      .split("│")
      .map((cell) => cell.trim())
      .filter(Boolean);
    const idCellIndex = tableCells.findIndex((cell) => cell.includes(id));
    if (idCellIndex !== -1) {
      return tableCells[idCellIndex + 1] ?? null;
    }
  }

  const afterId = line.slice(line.indexOf(id) + id.length).trim();
  return afterId.split(/\s+/)[0] || null;
}
