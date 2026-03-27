import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

export type PhyleticRow = Record<string, string>;

export type PhyleticMatrixResult = {
  headers: string[];
  rows: PhyleticRow[];
  totalRows: number;
  matchedRows: number;
};

const TSV_FILENAME = "flagellar_genes_phyletic_distribution.tsv";
const TSV_PATH = path.join(process.cwd(), "public", TSV_FILENAME);
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
let cachedTaxonomyIndex: TaxonomyIndex | null = null;

export type CountFilterMode = "any" | "eq" | "gte" | "lte" | "between";
export type CountFilterState = {
  mode: CountFilterMode;
  value: string;
  valueTo: string;
};

function getTsvPath(): string {
  if (!existsSync(TSV_PATH)) {
    throw new Error(`TSV file not found at ${TSV_PATH}`);
  }
  return TSV_PATH;
}

export async function getPhyleticHeaders(): Promise<string[]> {
  const tsvPath = getTsvPath();
  const stream = createReadStream(tsvPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }
    rl.close();
    stream.close();
    return line.split("\t");
  }

  return [];
}

export async function getTaxonomySuggestions(params: {
  rank: string;
  query: string;
  limit?: number;
  selectedTaxonomy?: Record<string, string[]>;
}): Promise<string[]> {
  if (!existsSync(TAXONOMY_INDEX_PATH)) {
    throw new Error(
      "taxonomy-index.json not found. Run `npm run build:taxonomy-index` once."
    );
  }

  if (!cachedTaxonomyIndex) {
    const raw = await readFile(TAXONOMY_INDEX_PATH, "utf8");
    cachedTaxonomyIndex = JSON.parse(raw) as TaxonomyIndex;
  }
  const taxonomyIndex = cachedTaxonomyIndex;

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

export async function queryPhyleticMatrix(params: {
  visibleColumns: string[];
  taxonomyFilters: Record<string, string[]>;
  countFilters: Record<string, CountFilterState>;
  requiredCountColumns?: string[];
}): Promise<PhyleticMatrixResult> {
  const tsvPath = getTsvPath();
  const stream = createReadStream(tsvPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let headers: string[] = [];
  let headerIndexByName: Record<string, number> = {};
  let totalRows = 0;
  let matchedRows = 0;
  const rows: PhyleticRow[] = [];

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    if (headers.length === 0) {
      headers = line.split("\t");
      headerIndexByName = Object.fromEntries(
        headers.map((header, idx) => [header, idx])
      );
      continue;
    }

    totalRows += 1;
    const values = line.split("\t");
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
