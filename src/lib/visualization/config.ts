import type { TaxonomicLevel } from "@/types/gene-visualization";

export const DATASETS = [
  "GTDB214_lineage_ordered.json",
  "flagella_phylogeny.json"
] as const;

export const DEFAULT_DATASET = DATASETS[0];
export const DEFAULT_TSV_FILENAME = "flagellar_genes_phyletic_distribution.tsv";

export const DATASET_LABELS: Record<(typeof DATASETS)[number], string> = {
  "flagella_phylogeny.json": "Flagella Phylogeny",
  "GTDB214_lineage_ordered.json": "GTDB r214"
};

export const DATASET_TREE_FILE: Partial<Record<(typeof DATASETS)[number], string>> = {
  "flagella_phylogeny.json": "flagella_phylogeny.tree",
  "GTDB214_lineage_ordered.json": "bac120_r214.tree"
};

export const TAXONOMY_VERSIONS = Array.from(
  new Set(
    DATASETS.map((f) => {
      const match = f.match(/^GTDB(\d+)/);
      return match ? match[1] : null;
    }).filter(Boolean) as string[]
  )
).sort((a, b) => Number(b) - Number(a));

export const ALL_LEVELS: TaxonomicLevel[] = [
  "phylum",
  "class",
  "order",
  "family",
  "genus",
  "species"
];

export const GOLDEN = 0.618033988749895;


export const CUSTOM_GENE_ROW_ORDER = [
  "CsrA",
  "FliW",
  "Transglycosylase",
  "FlaG",
  "PilZ",
  "FliT",
  "FlbB",
  "FlgA",
  "FlgH",
  "FlgI",
  "FlgJ",
  "FlgB",
  "FlgC",
  "FliE",
  "FliG",
  "FliM",
  "FlgK",
  "FliC",
  "FlgD",
  "FlgE",
  "MotA",
  "MotB",
  "FliL",
  "FliK",
  "FlgF",
  "FlgG",
  "FlhA",
  "FlhB",
  "FliP",
  "FliQ",
  "FliR",
  "FliN",
  "FliF",
  "FliI",
  "FliH",
  "FliJ",
  "FliO",
  "FlgN",
  "FlgL",
  "FliD",
  "FliS",
  "FlgM",
  "FliA",
  "FlhF",
  "FlhG",
  "DUF327",
  "YvyF",
  "Putative",
  "FapA",
  "SwrD",
  "DUF6470",
  "SwrB",
  "FliB",
  "SwrA",
  "FlaY",
  "FlgQ",
  "PflA",
  "PflB",
  "DUF1217",
  "FlaF",
  "FlbT",
  "LdtR",
  "MotK",
  "MotC",
  "DUF3383",
  "FlhC",
  "FlhD",
  "FlhE",
  "YdiV",
  "FljA",
  "FlcA",
  "FlcB",
  "FlcC",
  "FlcD",
  "FlgO",
  "FlgP",
  "FlgT",
  "MotX",
  "FlrA",
  "MotY",
  "FlrC",
  "Transglutaminase"
] as const;

function normalizeGeneOrderKey(gene: string) {
  return gene.replace(/_count$/i, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const CUSTOM_GENE_ROW_ORDER_INDEX = new Map(
  CUSTOM_GENE_ROW_ORDER.map((gene, index) => [normalizeGeneOrderKey(gene), index])
);

export function sortGenesByCustomRowOrder(geneNames: string[]): string[] {
  const regularGenes = geneNames.filter((gene) => !gene.includes(">") && !gene.includes("-"));
  const comparisonGenes = geneNames.filter((gene) => gene.includes(">") || gene.includes("-"));

  const sortedRegularGenes = [...regularGenes].sort((a, b) => {
    const orderA = CUSTOM_GENE_ROW_ORDER_INDEX.get(normalizeGeneOrderKey(a)) ?? Number.POSITIVE_INFINITY;
    const orderB = CUSTOM_GENE_ROW_ORDER_INDEX.get(normalizeGeneOrderKey(b)) ?? Number.POSITIVE_INFINITY;
    if (orderA !== orderB) return orderA - orderB;
    return normalizeGeneOrderKey(a).localeCompare(normalizeGeneOrderKey(b));
  });

  return [...sortedRegularGenes, ...comparisonGenes];
}
