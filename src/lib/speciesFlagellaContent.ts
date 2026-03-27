import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { formatSpeciesName, normalizeSpeciesQuery } from "@/lib/speciesNaming";
import { classifyGene } from "@/lib/flagellaGeneClassification";

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

type GeneSummary = {
  name: string;
  count: number;
  gtdb: string[];
  ncbi: string[];
};

type GeneGroupSummary = {
  name: string;
  totalCount: number;
  genes: GeneSummary[];
};

export type SpeciesFlagellaContent = {
  matchedAssemblies: number;
  totalGeneCount: number;
  groups: GeneGroupSummary[];
};

const INDEX_PATH = path.join(process.cwd(), "public", "species-flagella-index.json");

const GROUP_ORDER = [
  "Basal body & hook",
  "Motor & switch",
  "Export apparatus",
  "Filament & junction",
  "Regulation",
  "Chaperones & assembly factors",
  "Flagellar structural proteins",
  "Other flagella-associated genes"
] as const;

let cachedIndex: SpeciesFlagellaIndex | null = null;

async function loadIndex(): Promise<SpeciesFlagellaIndex> {
  if (cachedIndex) return cachedIndex;

  if (!existsSync(INDEX_PATH)) {
    throw new Error(
      "species-flagella-index.json not found. Run `npm run build:species-flagella-index` once."
    );
  }

  const raw = await readFile(INDEX_PATH, "utf8");
  cachedIndex = JSON.parse(raw) as SpeciesFlagellaIndex;
  return cachedIndex;
}

export async function getSpeciesFlagellaContent(
  speciesName: string
): Promise<SpeciesFlagellaContent> {
  const index = await loadIndex();
  const key = normalizeSpeciesQuery(formatSpeciesName(speciesName));
  const speciesRecord = index.species[key];

  if (!speciesRecord) {
    return { matchedAssemblies: 0, totalGeneCount: 0, groups: [] };
  }

  const groupsMap = new Map<string, GeneGroupSummary>();
  let totalGeneCount = 0;

  for (const geneName of index.geneNames) {
    const geneData = speciesRecord.genes[geneName] ?? {
      count: 0,
      gtdb: [],
      ncbi: []
    };
    const geneCount = geneData.count ?? 0;

    totalGeneCount += geneCount;
    const groupName = classifyGene(geneName);
    const group = groupsMap.get(groupName) ?? { name: groupName, totalCount: 0, genes: [] };

    group.totalCount += geneCount;
    group.genes.push({
      name: geneName,
      count: geneCount,
      gtdb: geneData.gtdb ?? [],
      ncbi: (geneData.ncbi ?? []).filter((id): id is string => typeof id === "string" && id.length > 0)
    });
    groupsMap.set(groupName, group);
  }

  const groups = GROUP_ORDER.map((name) => {
    const group = groupsMap.get(name) ?? { name, totalCount: 0, genes: [] };
    return {
      ...group,
      genes: group.genes.sort((a, b) => a.name.localeCompare(b.name))
    };
  });

  return {
    matchedAssemblies: speciesRecord.matchedAssemblies,
    totalGeneCount,
    groups
  };
}
