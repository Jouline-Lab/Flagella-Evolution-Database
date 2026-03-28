import { withBasePath } from "@/lib/assetPaths";
import { geneNameToSlug } from "@/lib/flagellaGeneClassification";
import { formatSpeciesName, normalizeSpeciesQuery } from "@/lib/speciesNaming";
import type { GeneProfile } from "@/lib/geneData";
export type { GeneProfile } from "@/lib/geneData";

type GeneProfilesIndex = {
  version: number;
  sourceTsv: string;
  genes: Array<
    Omit<GeneProfile, "topNeighbors"> & {
      topNeighbors?: Array<{
        name: string;
        count: number;
      }>;
    }
  >;
};

type AlignmentManifest = {
  version: number;
  alignments: Record<string, string>;
};

type SpeciesFlagellaIndex = {
  version: number;
  sourceTsv: string;
  geneNames: string[];
  species: Record<
    string,
    {
      matchedAssemblies: number;
      genes: Record<
        string,
        {
          count?: number;
          gtdb?: string[];
          ncbi?: Array<string | null>;
        }
      >;
    }
  >;
};

let geneProfilesPromise: Promise<GeneProfile[]> | null = null;
let geneProfilesBySlugPromise: Promise<Map<string, GeneProfile>> | null = null;
let alignmentManifestPromise: Promise<AlignmentManifest> | null = null;
let speciesFlagellaIndexPromise: Promise<SpeciesFlagellaIndex> | null = null;

async function loadGeneProfiles(): Promise<GeneProfile[]> {
  if (!geneProfilesPromise) {
    geneProfilesPromise = fetch(withBasePath("/gene-profiles.json")).then(async (response) => {
      if (!response.ok) {
        throw new Error("Failed to load gene profiles.");
      }

      const parsed = (await response.json()) as GeneProfilesIndex;
      return Array.isArray(parsed.genes)
        ? parsed.genes.map((profile) => ({
            ...profile,
            topNeighbors: Array.isArray(profile.topNeighbors) ? profile.topNeighbors : []
          }))
        : [];
    });
  }

  return geneProfilesPromise;
}

async function loadGeneProfilesBySlug(): Promise<Map<string, GeneProfile>> {
  if (!geneProfilesBySlugPromise) {
    geneProfilesBySlugPromise = loadGeneProfiles().then(
      (profiles) => new Map(profiles.map((profile) => [profile.slug, profile]))
    );
  }

  return geneProfilesBySlugPromise;
}

async function loadAlignmentManifest(): Promise<AlignmentManifest> {
  if (!alignmentManifestPromise) {
    alignmentManifestPromise = fetch(withBasePath("/alignments-manifest.json")).then(
      async (response) => {
        if (!response.ok) {
          return { version: 1, alignments: {} };
        }

        return (await response.json()) as AlignmentManifest;
      }
    );
  }

  return alignmentManifestPromise;
}

async function loadSpeciesFlagellaIndex(): Promise<SpeciesFlagellaIndex> {
  if (!speciesFlagellaIndexPromise) {
    speciesFlagellaIndexPromise = fetch(withBasePath("/species-flagella-index.json")).then(
      async (response) => {
        if (!response.ok) {
          throw new Error("Failed to load species flagella index.");
        }

        return (await response.json()) as SpeciesFlagellaIndex;
      }
    );
  }

  return speciesFlagellaIndexPromise;
}

export async function getGeneSuggestionsClient(
  query: string,
  limit = 20
): Promise<Array<{ name: string; slug: string }>> {
  const profiles = await loadGeneProfiles();
  const sorted = [...profiles].sort((a, b) => a.name.localeCompare(b.name));
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? sorted.filter((p) => {
        const nameLow = p.name.toLowerCase();
        const slugLow = p.slug.toLowerCase();
        return nameLow.includes(needle) || slugLow.includes(needle);
      })
    : sorted;
  return filtered.slice(0, limit).map((p) => ({ name: p.name, slug: p.slug }));
}

export async function getGeneProfileBySlugClient(slug: string): Promise<GeneProfile | null> {
  const bySlug = await loadGeneProfilesBySlug();
  const key = geneNameToSlug(slug);
  if (!key) {
    return null;
  }
  return bySlug.get(key) ?? null;
}

export async function getAlignmentPathForGeneClient(geneName: string): Promise<string | null> {
  const manifest = await loadAlignmentManifest();
  const key = geneName.toLowerCase().replace(/[^a-z0-9]/g, "");
  return manifest.alignments[key] ?? null;
}

export async function getSpeciesGeneIdsByGeneClient(geneName: string) {
  const index = await loadSpeciesFlagellaIndex();
  const result: Record<string, { gtdb: string[]; ncbi: Array<string | null> }> = {};

  for (const [speciesKey, speciesRecord] of Object.entries(index.species)) {
    const geneRecord = speciesRecord.genes[geneName];
    if (!geneRecord) {
      continue;
    }

    const gtdb = geneRecord.gtdb ?? [];
    const ncbi = geneRecord.ncbi ?? [];

    if (gtdb.length === 0 && ncbi.length === 0) {
      continue;
    }

    result[speciesKey] = { gtdb, ncbi };
  }

  return result;
}

export function getSpeciesKeyForName(speciesName: string): string {
  return normalizeSpeciesQuery(formatSpeciesName(speciesName));
}
