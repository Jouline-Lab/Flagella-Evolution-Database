import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { formatSpeciesName, normalizeSpeciesQuery } from "@/lib/speciesNaming";

type IndexedGene = {
  count?: number;
  gtdb?: string[];
  ncbi?: Array<string | null>;
};

type IndexedSpecies = {
  matchedAssemblies: number;
  genes: Record<string, IndexedGene>;
};

type SpeciesFlagellaIndex = {
  version: number;
  sourceTsv: string;
  geneNames: string[];
  species: Record<string, IndexedSpecies>;
};

const INDEX_PATH = path.join(process.cwd(), "public", "species-flagella-index.json");

let cachedIndex: SpeciesFlagellaIndex | null = null;

async function loadIndex(): Promise<SpeciesFlagellaIndex> {
  if (cachedIndex) {
    return cachedIndex;
  }

  if (!existsSync(INDEX_PATH)) {
    throw new Error(
      "species-flagella-index.json not found. Run `npm run build:species-flagella-index` once."
    );
  }

  const raw = await readFile(INDEX_PATH, "utf8");
  cachedIndex = JSON.parse(raw) as SpeciesFlagellaIndex;
  return cachedIndex;
}

export async function getSpeciesGeneIds(speciesName: string, geneName: string) {
  const index = await loadIndex();
  const normalizedSpeciesName = normalizeSpeciesQuery(formatSpeciesName(speciesName));
  const speciesRecord = index.species[normalizedSpeciesName];

  if (!speciesRecord) {
    return null;
  }

  const geneRecord = speciesRecord.genes[geneName] ?? {
    count: 0,
    gtdb: [],
    ncbi: []
  };

  return {
    speciesName: formatSpeciesName(speciesName),
    geneName,
    gtdb: geneRecord.gtdb ?? [],
    ncbi: geneRecord.ncbi ?? []
  };
}
