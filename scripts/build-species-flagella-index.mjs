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

function createGeneEntry() {
  return {
    count: 0,
    gtdbToNcbi: new Map()
  };
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
        matchedAssemblies: 0,
        genes: {}
      };

    current.matchedAssemblies += 1;

    for (const def of geneDefs) {
      const count = Number(cells[def.countIdx] ?? "");
      const rowGtdbIds = def.gtdbIdx.flatMap((idx) => parseIds(cells[idx] ?? ""));
      const rowNcbiIds = def.ncbiIdx.flatMap((idx) => parseIds(cells[idx] ?? ""));
      const hasPositiveCount = !Number.isNaN(count) && count > 0;
      const hasIds = rowGtdbIds.length > 0 || rowNcbiIds.length > 0;

      if (!hasPositiveCount && !hasIds) {
        continue;
      }

      const geneEntry = current.genes[def.geneName] ?? createGeneEntry();

      if (hasPositiveCount) {
        geneEntry.count += count;
      }

      for (const [index, gtdbId] of rowGtdbIds.entries()) {
        const ncbiId = rowNcbiIds[index] ?? null;
        const existingNcbiId = geneEntry.gtdbToNcbi.get(gtdbId);

        if (existingNcbiId === undefined || (existingNcbiId === null && ncbiId !== null)) {
          geneEntry.gtdbToNcbi.set(gtdbId, ncbiId);
        }
      }

      current.genes[def.geneName] = geneEntry;
    }

    speciesMap.set(normalizedName, current);
  }

  const species = Object.fromEntries(
    Array.from(speciesMap.entries(), ([key, value]) => [
      key,
      {
        genes: Object.fromEntries(
          Object.entries(value.genes).map(([gene, info]) => [
            gene,
            (() => {
              const serialized = {};
              const gtdb = [...info.gtdbToNcbi.keys()].sort((a, b) => a.localeCompare(b));
              const ncbi = gtdb.map((gtdbId) => info.gtdbToNcbi.get(gtdbId) ?? null);
              const lastNonNullNcbiIndex = ncbi.reduce(
                (lastIndex, value, index) => (value !== null ? index : lastIndex),
                -1
              );
              const compactNcbi = lastNonNullNcbiIndex >= 0 ? ncbi.slice(0, lastNonNullNcbiIndex + 1) : [];

              if (info.count > 0) {
                serialized.count = info.count;
              }

              if (gtdb.length > 0) {
                serialized.gtdb = gtdb;
              }

              if (compactNcbi.length > 0) {
                serialized.ncbi = compactNcbi;
              }

              return serialized;
            })()
          ])
        )
        ,
        matchedAssemblies: value.matchedAssemblies
      }
    ])
  );

  const payload = {
    version: 3,
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
