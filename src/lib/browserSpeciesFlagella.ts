import { withBasePath } from "@/lib/assetPaths";
import { classifyGene } from "@/lib/flagellaGeneClassification";
import { formatSpeciesName, normalizeSpeciesQuery } from "@/lib/speciesNaming";
import type { SpeciesFlagellaContent } from "@/lib/speciesData";

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

let indexPromise: Promise<SpeciesFlagellaIndex> | null = null;

async function loadIndex(): Promise<SpeciesFlagellaIndex> {
  if (!indexPromise) {
    indexPromise = fetch(withBasePath("/species-flagella-index.json")).then(async (response) => {
      if (!response.ok) {
        throw new Error("Failed to load species flagella index.");
      }

      return (await response.json()) as SpeciesFlagellaIndex;
    });
  }

  return indexPromise;
}

export async function getSpeciesFlagellaContentClient(
  speciesName: string
): Promise<SpeciesFlagellaContent> {
  const index = await loadIndex();
  const key = normalizeSpeciesQuery(formatSpeciesName(speciesName));
  const speciesRecord = index.species[key];

  if (!speciesRecord) {
    return { matchedAssemblies: 0, totalGeneCount: 0, groups: [] };
  }

  const groupsMap = new Map<string, SpeciesFlagellaContent["groups"][number]>();
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
