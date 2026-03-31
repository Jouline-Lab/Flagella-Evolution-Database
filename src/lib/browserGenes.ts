import { withBasePath } from "@/lib/assetPaths";
import { geneNameToSlug } from "@/lib/flagellaGeneClassification";
import { formatSpeciesName, normalizeSpeciesQuery } from "@/lib/speciesNaming";
import type { GeneLogoPrecomputePayload } from "@/lib/sequenceLogoMath";
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

type AlignmentFilesIndex = {
  version: number;
  files: string[];
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
let alignmentFilenamesPromise: Promise<string[]> | null = null;
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

async function loadAlignmentFilenames(): Promise<string[]> {
  if (!alignmentFilenamesPromise) {
    alignmentFilenamesPromise = fetch(withBasePath("/alignments-index.json")).then(async (response) => {
      if (!response.ok) {
        return [];
      }

      const parsed = (await response.json()) as AlignmentFilesIndex;
      const files = Array.isArray(parsed.files) ? parsed.files : [];
      return [...files].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    });
  }

  return alignmentFilenamesPromise;
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

const PART_SUFFIX_RE = /\.part(\d+)\.fasta$/i;

function alignmentPartNumber(filename: string): number {
  const m = filename.match(PART_SUFFIX_RE);
  return m ? Number.parseInt(m[1], 10) : 0;
}

function stemKeyForPartFile(filename: string): string {
  return filename.replace(PART_SUFFIX_RE, ".fasta");
}

/**
 * Resolves one or more `/alignments/…` URLs for a gene: filenames must start with `{GeneName}_`.
 * Chunked alignments use `basename.part001.fasta`, `basename.part002.fasta`, … (same stem); all parts are loaded in order.
 */
export async function getAlignmentPathsForGeneClient(geneName: string): Promise<string[]> {
  const files = await loadAlignmentFilenames();
  if (files.length === 0) {
    return [];
  }

  const prefix = `${geneName.toLowerCase()}_`;
  const matches = files.filter((filename) => filename.toLowerCase().startsWith(prefix));
  if (matches.length === 0) {
    return [];
  }

  const partFiles = matches.filter((f) => PART_SUFFIX_RE.test(f));
  if (partFiles.length > 0) {
    const byStem = new Map<string, string[]>();
    for (const f of partFiles) {
      const stem = stemKeyForPartFile(f);
      const list = byStem.get(stem) ?? [];
      list.push(f);
      byStem.set(stem, list);
    }
    const stems = [...byStem.keys()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    const chosen = stems[0];
    const group = byStem.get(chosen) ?? [];
    group.sort((a, b) => alignmentPartNumber(a) - alignmentPartNumber(b));
    return group.map((f) => `/alignments/${f}`);
  }

  matches.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return [`/alignments/${matches[0]}`];
}

/** First alignment URL only (legacy). */
export async function getAlignmentPathForGeneClient(geneName: string): Promise<string | null> {
  const paths = await getAlignmentPathsForGeneClient(geneName);
  return paths[0] ?? null;
}

let geneLogoPrecomputeCache: Map<string, Promise<GeneLogoPrecomputePayload | null>> | null = null;

function getGeneLogoPrecomputeCache() {
  if (!geneLogoPrecomputeCache) {
    geneLogoPrecomputeCache = new Map();
  }
  return geneLogoPrecomputeCache;
}

/** Optional `/precomputed-logos/{slug}.json` for server-build logo column stats. */
export async function getGeneLogoPrecomputeClient(slug: string): Promise<GeneLogoPrecomputePayload | null> {
  const key = slug.trim();
  if (!key) {
    return null;
  }
  const cache = getGeneLogoPrecomputeCache();
  if (!cache.has(key)) {
    cache.set(
      key,
      fetch(withBasePath(`/precomputed-logos/${encodeURIComponent(key)}.json`))
        .then(async (response) => {
          if (!response.ok) {
            return null;
          }
          try {
            return (await response.json()) as GeneLogoPrecomputePayload;
          } catch {
            return null;
          }
        })
        .catch(() => null)
    );
  }
  return cache.get(key)!;
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
