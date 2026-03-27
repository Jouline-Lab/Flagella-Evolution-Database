import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { speciesCatalog } from "@/data/species";
import {
  formatSpeciesName,
  normalizeSpeciesQuery,
  speciesNameToSlug,
  stripTaxonomyPrefix
} from "@/lib/speciesNaming";

const TAXONOMY_INDEX_PATH = path.join(process.cwd(), "public", "taxonomy-index.json");
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

type SpeciesRow = {
  name: string;
  slug: string;
  taxonomy: {
    phylum: string;
    className: string;
    order: string;
    family: string;
    genus: string;
  };
};

export type SpeciesSuggestion = {
  name: string;
  slug: string;
};

export type SpeciesProfile = SpeciesRow & {
  summary: string;
  traits: string[];
};

let cachedSpeciesRows: SpeciesRow[] | null = null;
let cachedSpeciesBySlug: Map<string, SpeciesRow> | null = null;

function cleanTaxonomyValue(value: string): string {
  return stripTaxonomyPrefix(value) || "-";
}

async function loadTaxonomyIndex(): Promise<TaxonomyIndex> {
  if (!existsSync(TAXONOMY_INDEX_PATH)) {
    throw new Error(
      "taxonomy-index.json not found. Run `npm run build:taxonomy-index` once."
    );
  }
  const raw = await readFile(TAXONOMY_INDEX_PATH, "utf8");
  return JSON.parse(raw) as TaxonomyIndex;
}

async function loadSpeciesRows(): Promise<SpeciesRow[]> {
  if (cachedSpeciesRows) {
    return cachedSpeciesRows;
  }

  const taxonomyIndex = await loadTaxonomyIndex();
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
    cachedSpeciesRows = [];
    cachedSpeciesBySlug = new Map<string, SpeciesRow>();
    return cachedSpeciesRows;
  }

  const rowsBySlug = new Map<string, SpeciesRow>();

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

    rowsBySlug.set(slug, {
      name,
      slug,
      taxonomy: {
        phylum: cleanTaxonomyValue(row[phylumRankIndex] ?? ""),
        className: cleanTaxonomyValue(row[classRankIndex] ?? ""),
        order: cleanTaxonomyValue(row[orderRankIndex] ?? ""),
        family: cleanTaxonomyValue(row[familyRankIndex] ?? ""),
        genus: cleanTaxonomyValue(row[genusRankIndex] ?? "")
      }
    });
  }

  cachedSpeciesBySlug = rowsBySlug;
  cachedSpeciesRows = Array.from(rowsBySlug.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  return cachedSpeciesRows;
}

export async function getSpeciesSuggestions(
  query: string,
  limit = 20
): Promise<SpeciesSuggestion[]> {
  const rows = await loadSpeciesRows();
  const normalizedQuery = normalizeSpeciesQuery(query);
  const filtered = normalizedQuery
    ? rows.filter((item) =>
        normalizeSpeciesQuery(item.name).includes(normalizedQuery)
      )
    : rows;

  return filtered.slice(0, limit).map((item) => ({
    name: item.name,
    slug: item.slug
  }));
}

export async function getSpeciesProfileBySlug(
  slug: string
): Promise<SpeciesProfile | null> {
  const rows = await loadSpeciesRows();
  const bySlug = cachedSpeciesBySlug ?? new Map(rows.map((item) => [item.slug, item]));
  const row = bySlug.get(slug) ?? null;
  if (!row) {
    return null;
  }

  const curatedMatch = speciesCatalog.find(
    (item) =>
      normalizeSpeciesQuery(item.name) === normalizeSpeciesQuery(row.name) ||
      item.slug === slug
  );

  return {
    ...row,
    summary:
      curatedMatch?.summary ??
      "Taxonomy-derived species profile generated from the phyletic matrix dataset.",
    traits:
      curatedMatch?.traits ?? [
        "Comprehensive gene-level details are being added.",
        "Taxonomic data is available from the current dataset."
      ]
  };
}

export async function getAllSpeciesProfiles(): Promise<SpeciesProfile[]> {
  const rows = await loadSpeciesRows();

  return Promise.all(
    rows.map(async (row) => {
      const curatedMatch = speciesCatalog.find(
        (item) =>
          normalizeSpeciesQuery(item.name) === normalizeSpeciesQuery(row.name) ||
          item.slug === row.slug
      );

      return {
        ...row,
        summary:
          curatedMatch?.summary ??
          "Taxonomy-derived species profile generated from the phyletic matrix dataset.",
        traits:
          curatedMatch?.traits ?? [
            "Comprehensive gene-level details are being added.",
            "Taxonomic data is available from the current dataset."
          ]
      };
    })
  );
}
