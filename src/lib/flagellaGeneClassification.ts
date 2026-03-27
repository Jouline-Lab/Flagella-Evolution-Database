import { EXCLUDED_CORE_GENE_NAMES } from "@/lib/visualization/config";

const regulationGenes = new Set([
  "flia",
  "fliz",
  "flhc",
  "flhd",
  "fleq",
  "flra",
  "flrb",
  "flrc",
  "rflm"
]);
const chaperoneGenes = new Set(["flis", "flit", "flgn", "flga"]);
const motorGenes = new Set(["mota", "motb", "motx", "moty", "flig", "flim", "flin", "fliy"]);
const exportGenes = new Set(["flha", "flhb", "flip", "fliq", "flir", "flio", "flih", "flij"]);
const filamentGenes = new Set(["flic", "flid", "flik", "flif", "flbg", "flad", "flaf"]);

export function normalizeGeneName(value: string): string {
  return value.replace(/_count$/i, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function geneNameToSlug(value: string): string {
  return value
    .replace(/_count$/i, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function classifyGene(geneName: string): string {
  const gene = normalizeGeneName(geneName);
  if (regulationGenes.has(gene)) return "Regulation";
  if (chaperoneGenes.has(gene)) return "Chaperones & assembly factors";
  if (motorGenes.has(gene)) return "Motor & switch";
  if (exportGenes.has(gene)) return "Export apparatus";
  if (filamentGenes.has(gene)) return "Filament & junction";
  if (gene.startsWith("flg")) return "Basal body & hook";
  if (gene.startsWith("fli") || gene.startsWith("flh") || gene.startsWith("mot")) {
    return "Flagellar structural proteins";
  }
  return "Other flagella-associated genes";
}

export function getGeneKnownFunctionSummary(geneName: string): string {
  const category = classifyGene(geneName);

  switch (category) {
    case "Basal body & hook":
      return "This gene is grouped with basal body and hook-associated flagellar components in the current dataset.";
    case "Motor & switch":
      return "This gene is grouped with flagellar motor and switch-associated components in the current dataset.";
    case "Export apparatus":
      return "This gene is grouped with the flagellar export apparatus in the current dataset.";
    case "Filament & junction":
      return "This gene is grouped with filament and junction-associated flagellar components in the current dataset.";
    case "Regulation":
      return "This gene is grouped with flagellar regulatory components in the current dataset.";
    case "Chaperones & assembly factors":
      return "This gene is grouped with flagellar chaperones and assembly factors in the current dataset.";
    case "Flagellar structural proteins":
      return "This gene is grouped with flagellar structural proteins in the current dataset.";
    default:
      return "This gene is grouped as another flagella-associated component in the current dataset.";
  }
}

export function getGeneComponentLabel(
  geneName: string
): "Ancestral component" | "Auxiliary/Acquired component" {
  return EXCLUDED_CORE_GENE_NAMES.has(normalizeGeneName(geneName))
    ? "Auxiliary/Acquired component"
    : "Ancestral component";
}
