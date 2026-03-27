import { withBasePath } from "@/lib/assetPaths";

export type PhyleticRow = Record<string, string>;

export type PhyleticMatrixResult = {
  headers: string[];
  rows: PhyleticRow[];
  totalRows: number;
  matchedRows: number;
};

export type CountFilterMode = "any" | "eq" | "gte" | "lte" | "between";
export type CountFilterState = {
  mode: CountFilterMode;
  value: string;
  valueTo: string;
};

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

let phyleticTextPromise: Promise<string> | null = null;
let phyleticHeadersPromise: Promise<string[]> | null = null;
let taxonomyIndexPromise: Promise<TaxonomyIndex> | null = null;

async function loadPhyleticText(): Promise<string> {
  if (!phyleticTextPromise) {
    phyleticTextPromise = fetch(withBasePath("/flagellar_genes_phyletic_distribution.tsv")).then(
      async (response) => {
        if (!response.ok) {
          throw new Error("Failed to load phyletic matrix TSV.");
        }

        return response.text();
      }
    );
  }

  return phyleticTextPromise;
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

export async function getPhyleticHeadersClient(): Promise<string[]> {
  if (!phyleticHeadersPromise) {
    phyleticHeadersPromise = loadPhyleticText().then((text) => {
      const firstLine = text.split(/\r?\n/).find((line) => line.trim()) ?? "";
      return firstLine ? firstLine.split("\t") : [];
    });
  }

  return phyleticHeadersPromise;
}

export async function getTaxonomySuggestionsClient(params: {
  rank: string;
  query: string;
  limit?: number;
  selectedTaxonomy?: Record<string, string[]>;
}): Promise<string[]> {
  const taxonomyIndex = await loadTaxonomyIndex();
  const rankIndex = taxonomyIndex.ranks.indexOf(params.rank as TaxonomyRank);
  if (rankIndex === -1) {
    return [];
  }

  const query = params.query.toLowerCase().trim();
  const limit = params.limit ?? 20;
  const values = new Set<string>();
  const selectedTaxonomy = params.selectedTaxonomy ?? {};

  for (const tuple of taxonomyIndex.rows) {
    if (!Array.isArray(tuple) || tuple.length !== taxonomyIndex.ranks.length) {
      continue;
    }

    let passesHigherRankSelections = true;
    for (let idx = 0; idx < rankIndex; idx += 1) {
      const higherRank = taxonomyIndex.ranks[idx];
      const selectedValues = selectedTaxonomy[higherRank] ?? [];
      if (selectedValues.length === 0) {
        continue;
      }

      const rowValue = (tuple[idx] ?? "").trim();
      if (!selectedValues.includes(rowValue)) {
        passesHigherRankSelections = false;
        break;
      }
    }

    if (!passesHigherRankSelections) {
      continue;
    }

    const rawValue = (tuple[rankIndex] ?? "").trim();
    if (!rawValue || rawValue === "-") {
      continue;
    }

    if (query && !rawValue.toLowerCase().includes(query)) {
      continue;
    }

    values.add(rawValue);
    if (values.size >= limit) {
      break;
    }
  }

  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

function passesCountFilter(
  value: string,
  filter: CountFilterState | undefined
): boolean {
  if (!filter || filter.mode === "any") {
    return true;
  }

  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) {
    return false;
  }

  const base = Number(filter.value);
  const bound = Number(filter.valueTo);

  if (filter.mode === "eq") {
    return Number.isNaN(base) ? true : numericValue === base;
  }
  if (filter.mode === "gte") {
    return Number.isNaN(base) ? true : numericValue >= base;
  }
  if (filter.mode === "lte") {
    return Number.isNaN(base) ? true : numericValue <= base;
  }

  if (Number.isNaN(base) || Number.isNaN(bound)) {
    return true;
  }

  const min = Math.min(base, bound);
  const max = Math.max(base, bound);
  return numericValue >= min && numericValue <= max;
}

export async function queryPhyleticMatrixClient(params: {
  visibleColumns: string[];
  taxonomyFilters: Record<string, string[]>;
  countFilters: Record<string, CountFilterState>;
  requiredCountColumns?: string[];
}): Promise<PhyleticMatrixResult> {
  const text = await loadPhyleticText();
  const lines = text.split(/\r?\n/).filter((line) => line.trim());

  if (lines.length === 0) {
    return { headers: [], rows: [], totalRows: 0, matchedRows: 0 };
  }

  const headers = lines[0].split("\t");
  const headerIndexByName = Object.fromEntries(headers.map((header, idx) => [header, idx]));
  let totalRows = 0;
  let matchedRows = 0;
  const rows: PhyleticRow[] = [];

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const values = lines[lineIndex].split("\t");
    totalRows += 1;
    let passes = true;

    if (params.requiredCountColumns && params.requiredCountColumns.length > 0) {
      const hasAnySelectedGeneCount = params.requiredCountColumns.some((column) => {
        const idx = headerIndexByName[column];
        if (idx === undefined) {
          return false;
        }

        const numericValue = Number(values[idx] ?? "");
        return !Number.isNaN(numericValue) && numericValue > 0;
      });

      if (!hasAnySelectedGeneCount) {
        continue;
      }
    }

    for (const [column, selectedValues] of Object.entries(params.taxonomyFilters)) {
      if (!selectedValues || selectedValues.length === 0) {
        continue;
      }

      const idx = headerIndexByName[column];
      if (idx === undefined) {
        continue;
      }

      const cell = (values[idx] ?? "").trim();
      if (!selectedValues.includes(cell)) {
        passes = false;
        break;
      }
    }

    if (!passes) {
      continue;
    }

    for (const [column, filter] of Object.entries(params.countFilters)) {
      const idx = headerIndexByName[column];
      if (idx === undefined) {
        continue;
      }

      if (!passesCountFilter(values[idx] ?? "", filter)) {
        passes = false;
        break;
      }
    }

    if (!passes) {
      continue;
    }

    matchedRows += 1;
    const row: PhyleticRow = {};
    for (const column of params.visibleColumns) {
      const idx = headerIndexByName[column];
      row[column] = idx === undefined ? "" : values[idx] ?? "";
    }
    rows.push(row);
  }

  return { headers, rows, totalRows, matchedRows };
}
