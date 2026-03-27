import { createReadStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const TSV_FILENAME = "flagellar_genes_phyletic_distribution.tsv";
const TSV_PATH = path.join(process.cwd(), "public", TSV_FILENAME);
const OUTPUT_PATH = path.join(process.cwd(), "public", "species-flagella-index.json");

function formatSpeciesName(value) {
  return value.replace(/^[a-z]__/i, "").trim();
}

function normalizeSpeciesName(value) {
  return formatSpeciesName(value).toLowerCase().trim();
}

function parseIds(rawValue) {
  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value && value !== "-");
}

function buildIdPairs(gtdbIds, ncbiIds) {
  return gtdbIds.map((gtdbId, index) => ({
    gtdbId,
    ncbiId: ncbiIds[index] ?? null
  }));
}

function buildGeneDefs(headers) {
  const map = new Map();

  headers.forEach((header, idx) => {
    if (header.endsWith("_count")) {
      const geneName = header.replace(/_count$/i, "");
      const def = map.get(geneName) ?? { geneName, countIdx: -1, gtdbIdx: [], ncbiIdx: [] };
      def.countIdx = idx;
      map.set(geneName, def);
      return;
    }

    if (header.includes("_GTDB_")) {
      const geneName = header.split("_GTDB_")[0];
      const def = map.get(geneName) ?? { geneName, countIdx: -1, gtdbIdx: [], ncbiIdx: [] };
      def.gtdbIdx.push(idx);
      map.set(geneName, def);
      return;
    }

    if (header.includes("_NCBI_")) {
      const geneName = header.split("_NCBI_")[0];
      const def = map.get(geneName) ?? { geneName, countIdx: -1, gtdbIdx: [], ncbiIdx: [] };
      def.ncbiIdx.push(idx);
      map.set(geneName, def);
    }
  });

  return Array.from(map.values())
    .filter((def) => def.countIdx >= 0)
    .sort((a, b) => a.geneName.localeCompare(b.geneName));
}

function createEmptyGeneMap(geneDefs) {
  const genes = {};
  for (const def of geneDefs) {
    genes[def.geneName] = { count: 0, gtdbIds: [], ncbiIds: [], idPairs: [] };
  }
  return genes;
}

async function buildSpeciesFlagellaIndex() {
  if (!existsSync(TSV_PATH)) {
    throw new Error(`TSV file not found: ${TSV_PATH}`);
  }

  const stream = createReadStream(TSV_PATH, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let headers = [];
  let speciesIdx = -1;
  let geneDefs = [];
  const speciesMap = new Map();

  for await (const line of rl) {
    if (!line.trim()) continue;

    if (headers.length === 0) {
      headers = line.split("\t");
      speciesIdx = headers.indexOf("species");
      if (speciesIdx === -1) {
        throw new Error("Column 'species' not found in TSV header.");
      }
      geneDefs = buildGeneDefs(headers);
      continue;
    }

    const cells = line.split("\t");
    const displayName = formatSpeciesName(cells[speciesIdx] ?? "");
    const normalizedName = normalizeSpeciesName(displayName);
    if (!normalizedName) continue;

    const current =
      speciesMap.get(normalizedName) ?? {
        name: displayName,
        matchedAssemblies: 0,
        genes: createEmptyGeneMap(geneDefs)
      };

    current.matchedAssemblies += 1;

    for (const def of geneDefs) {
      const geneEntry = current.genes[def.geneName];
      const count = Number(cells[def.countIdx] ?? "");
      if (!Number.isNaN(count) && count > 0) {
        geneEntry.count += count;
      }

      const rowGtdbIds = def.gtdbIdx.flatMap((idx) => parseIds(cells[idx] ?? ""));
      const rowNcbiIds = def.ncbiIdx.flatMap((idx) => parseIds(cells[idx] ?? ""));

      for (const id of rowGtdbIds) {
        if (!geneEntry.gtdbIds.includes(id)) {
          geneEntry.gtdbIds.push(id);
        }
      }

      for (const id of rowNcbiIds) {
        if (!geneEntry.ncbiIds.includes(id)) {
          geneEntry.ncbiIds.push(id);
        }
      }

      for (const pair of buildIdPairs(rowGtdbIds, rowNcbiIds)) {
        if (!geneEntry.idPairs.some((existing) => existing.gtdbId === pair.gtdbId)) {
          geneEntry.idPairs.push(pair);
        }
      }
    }

    speciesMap.set(normalizedName, current);
  }

  const species = Object.fromEntries(
    Array.from(speciesMap.entries(), ([key, value]) => [
      key,
      {
        ...value,
        genes: Object.fromEntries(
          Object.entries(value.genes).map(([gene, info]) => [
            gene,
            {
              count: info.count,
              gtdbIds: [...info.gtdbIds].sort((a, b) => a.localeCompare(b)),
              ncbiIds: [...info.ncbiIds].sort((a, b) => a.localeCompare(b)),
              idPairs: [...info.idPairs].sort((a, b) => a.gtdbId.localeCompare(b.gtdbId))
            }
          ])
        )
      }
    ])
  );

  const payload = {
    version: 1,
    sourceTsv: TSV_FILENAME,
    geneNames: geneDefs.map((def) => def.geneName),
    species
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(payload), "utf8");

  // eslint-disable-next-line no-console
  console.log(`Species flagella index written: ${OUTPUT_PATH}`);
  // eslint-disable-next-line no-console
  console.log(`Species indexed: ${Object.keys(species).length}`);
  // eslint-disable-next-line no-console
  console.log(`Gene columns indexed: ${payload.geneNames.length}`);
}

buildSpeciesFlagellaIndex().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
