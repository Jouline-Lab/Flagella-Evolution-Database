import { speciesCatalog } from "@/data/species";
import { formatSpeciesName, normalizeSpeciesQuery, speciesNameToSlug, stripTaxonomyPrefix } from "@/lib/speciesNaming";
import { withBasePath } from "@/lib/assetPaths";

const TAXONOMY_RANKS = [
  "phylum",
  "class",
  "order",
  "family",
  "genus",
  "species"
] as const;

type TaxonomyRank = (typeof TAXONOMY_RANKS)[number];

type TaxonomyIndex = {
  version: number;
  ranks: TaxonomyRank[];
  rows: string[][];
};

export type SpeciesSuggestion = {
  name: string;
  slug: string;
};

export type SpeciesProfile = SpeciesSuggestion & {
  taxonomy: {
    phylum: string;
    className: string;
    order: string;
    family: string;
    genus: string;
  };
  summary: string;
  traits: string[];
};

let taxonomyIndexPromise: Promise<TaxonomyIndex> | null = null;
let speciesProfilesPromise: Promise<SpeciesProfile[]> | null = null;

function cleanTaxonomyValue(value: string): string {
  return stripTaxonomyPrefix(value) || "-";
}

async function loadTaxonomyIndex(): Promise<TaxonomyIndex> {
  if (!taxonomyIndexPromise) {
    taxonomyIndexPromise = fetch(withBasePath("/taxonomy-index.json")).then(async (response) => {
      if (!response.ok) {
        throw new Error("Failed to load taxonomy index.");
      }

      return (await response.json()) as TaxonomyIndex;
    });
  }

  return taxonomyIndexPromise;
}

async function loadSpeciesProfiles(): Promise<SpeciesProfile[]> {
  if (!speciesProfilesPromise) {
    speciesProfilesPromise = loadTaxonomyIndex().then((taxonomyIndex) => {
      const speciesRankIndex = taxonomyIndex.ranks.indexOf("species");
      const phylumRankIndex = taxonomyIndex.ranks.indexOf("phylum");
      const classRankIndex = taxonomyIndex.ranks.indexOf("class");
      const orderRankIndex = taxonomyIndex.ranks.indexOf("order");
      const familyRankIndex = taxonomyIndex.ranks.indexOf("family");
      const genusRankIndex = taxonomyIndex.ranks.indexOf("genus");

      if (
        speciesRankIndex < 0 ||
        phylumRankIndex < 0 ||
        classRankIndex < 0 ||
        orderRankIndex < 0 ||
        familyRankIndex < 0 ||
        genusRankIndex < 0
      ) {
        return [];
      }

      const rowsBySlug = new Map<string, SpeciesProfile>();

      for (const row of taxonomyIndex.rows) {
        if (!Array.isArray(row) || row.length !== taxonomyIndex.ranks.length) {
          continue;
        }

        const rawSpecies = (row[speciesRankIndex] ?? "").trim();
        if (!rawSpecies || rawSpecies === "-") {
          continue;
        }

        const name = formatSpeciesName(rawSpecies);
        if (!name) {
          continue;
        }

        const slug = speciesNameToSlug(name);
        if (rowsBySlug.has(slug)) {
          continue;
        }

        const curatedMatch = speciesCatalog.find(
          (item) =>
            normalizeSpeciesQuery(item.name) === normalizeSpeciesQuery(name) || item.slug === slug
        );

        rowsBySlug.set(slug, {
          name,
          slug,
          taxonomy: {
            phylum: cleanTaxonomyValue(row[phylumRankIndex] ?? ""),
            className: cleanTaxonomyValue(row[classRankIndex] ?? ""),
            order: cleanTaxonomyValue(row[orderRankIndex] ?? ""),
            family: cleanTaxonomyValue(row[familyRankIndex] ?? ""),
            genus: cleanTaxonomyValue(row[genusRankIndex] ?? "")
          },
          summary:
            curatedMatch?.summary ??
            "Taxonomy-derived species profile generated from the phyletic matrix dataset.",
          traits:
            curatedMatch?.traits ?? [
              "Comprehensive gene-level details are being added.",
              "Taxonomic data is available from the current dataset."
            ]
        });
      }

      return Array.from(rowsBySlug.values()).sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  return speciesProfilesPromise;
}

export async function getSpeciesSuggestionsClient(
  query: string,
  limit = 20
): Promise<SpeciesSuggestion[]> {
  const rows = await loadSpeciesProfiles();
  const normalizedQuery = normalizeSpeciesQuery(query);
  const filtered = normalizedQuery
    ? rows.filter((item) => normalizeSpeciesQuery(item.name).includes(normalizedQuery))
    : rows;

  return filtered.slice(0, limit).map((item) => ({
    name: item.name,
    slug: item.slug
  }));
}

export async function getAllSpeciesProfilesClient(): Promise<SpeciesProfile[]> {
  return loadSpeciesProfiles();
}
