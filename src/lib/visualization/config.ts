import type { TaxonomicLevel } from "@/types/gene-visualization";

/**
 * Taxonomic ranks the "Flagella Phylogeny" dataset is offered at. Each
 * resolution has its own rooted tree, dropped into `public/` as
 * `flagella_phylogeny_<resolution>_rooted_for_visualization.tree`, and a
 * paired dataset JSON built from it by `scripts/build-flagella-phylogeny-json.py`.
 */
export const PHYLOGENY_RESOLUTIONS = ["family", "order", "class", "phylum"] as const;
export type PhylogenyResolution = (typeof PHYLOGENY_RESOLUTIONS)[number];

export const DATASETS = [
  "GTDB214_lineage_ordered.json",
  "flagella_phylogeny_family_rooted_for_visualization.json",
  "flagella_phylogeny_order_rooted_for_visualization.json",
  "flagella_phylogeny_class_rooted_for_visualization.json",
  "flagella_phylogeny_phylum_rooted_for_visualization.json"
] as const;

export const DEFAULT_DATASET = DATASETS[0];
export const DEFAULT_TSV_FILENAME = "flagellar_genes_phyletic_distribution.tsv";

export const DATASET_LABELS: Record<(typeof DATASETS)[number], string> = {
  "GTDB214_lineage_ordered.json": "GTDB r214",
  "flagella_phylogeny_family_rooted_for_visualization.json": "Flagella Phylogeny (Family)",
  "flagella_phylogeny_order_rooted_for_visualization.json": "Flagella Phylogeny (Order)",
  "flagella_phylogeny_class_rooted_for_visualization.json": "Flagella Phylogeny (Class)",
  "flagella_phylogeny_phylum_rooted_for_visualization.json": "Flagella Phylogeny (Phylum)"
};

export const DATASET_TREE_FILE: Partial<Record<(typeof DATASETS)[number], string>> = {
  "GTDB214_lineage_ordered.json": "bac120_r214.tree",
  "flagella_phylogeny_family_rooted_for_visualization.json":
    "flagella_phylogeny_family_rooted_for_visualization.tree",
  "flagella_phylogeny_order_rooted_for_visualization.json":
    "flagella_phylogeny_order_rooted_for_visualization.tree",
  "flagella_phylogeny_class_rooted_for_visualization.json":
    "flagella_phylogeny_class_rooted_for_visualization.tree",
  "flagella_phylogeny_phylum_rooted_for_visualization.json":
    "flagella_phylogeny_phylum_rooted_for_visualization.tree"
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

/**
 * Branch color tiers for TBE (Transfer Bootstrap Expectation) support values:
 * true neutral grey (weak, < 80) -> muted orange (moderate, 80-90) -> bright
 * red (strong, >= 90). Weak support is the common case in a large tree, so it
 * fades toward the chart surface instead of visually dominating the panel;
 * strong support pops. Ordered highest threshold first; `colorForSupport`
 * picks the first tier a value clears. Validated with the dataviz skill's
 * ordinal-ramp checks (lightness monotone, adjacent steps separated, the
 * palest step still >= 2:1 contrast on the chart surface). The grey->orange
 * jump deliberately fails that validator's single-hue check -- an actual
 * neutral (zero chroma) has no defined hue to measure, so the "spread" it
 * reports there is an artifact of that check, not a real defect; going from
 * a genuinely colorless "no confidence" to a colored "some confidence" is
 * the intended read, not a same-hue ramp.
 */
export type SupportColorTier = {
  readonly minSupport: number;
  readonly color: string;
  readonly label: string;
};

export const SUPPORT_COLOR_TIERS: readonly SupportColorTier[] = [
  { minSupport: 90, color: "#dc2626", label: ">= 90" },
  { minSupport: 80, color: "#cf8a4c", label: "80-90" },
  { minSupport: 0, color: "#b0b0b0", label: "< 80" }
];

export function colorForSupport(support: number): string {
  const tier = SUPPORT_COLOR_TIERS.find((t) => support >= t.minSupport);
  return tier?.color ?? SUPPORT_COLOR_TIERS[SUPPORT_COLOR_TIERS.length - 1].color;
}

export const EXCLUDED_CORE_GENE_NAMES = new Set([
  "flhe",
  "flhc",
  "flhd",
  "flgq",
  "flaf",
  "flbt",
  "flgo",
  "flgp"
]);

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
  "YviE",
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
