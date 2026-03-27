import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const GENE_PROFILES_PATH = path.join(process.cwd(), "public", "gene-profiles.json");

export type GeneProfile = {
  name: string;
  slug: string;
  presentAssemblies: number;
  totalAssemblies: number;
  functionalCategory: string;
  knownFunctionSummary: string;
  componentLabel: "Ancestral component" | "Auxiliary/Acquired component";
  topNeighbors: Array<{
    name: string;
    count: number;
  }>;
};

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

let cachedGeneProfiles: GeneProfile[] | null = null;
let cachedGeneProfilesBySlug: Map<string, GeneProfile> | null = null;

function getGeneProfilesPath(): string {
  if (!existsSync(GENE_PROFILES_PATH)) {
    throw new Error(
      "gene-profiles.json not found. Run `node scripts/build-gene-profiles-index.mjs` once."
    );
  }
  return GENE_PROFILES_PATH;
}

async function loadGeneProfiles(): Promise<GeneProfile[]> {
  if (cachedGeneProfiles) {
    return cachedGeneProfiles;
  }

  const indexPath = getGeneProfilesPath();
  const raw = await readFile(indexPath, "utf8");
  const parsed = JSON.parse(raw) as GeneProfilesIndex;
  const profiles = Array.isArray(parsed.genes)
    ? parsed.genes.map((profile) => ({
        ...profile,
        topNeighbors: Array.isArray(profile.topNeighbors) ? profile.topNeighbors : []
      }))
    : [];

  cachedGeneProfiles = profiles;
  cachedGeneProfilesBySlug = new Map(profiles.map((profile) => [profile.slug, profile]));
  return cachedGeneProfiles;
}

export async function getGeneProfileBySlug(slug: string): Promise<GeneProfile | null> {
  const profiles = await loadGeneProfiles();
  const bySlug = cachedGeneProfilesBySlug ?? new Map(profiles.map((item) => [item.slug, item]));
  return bySlug.get(slug) ?? null;
}
