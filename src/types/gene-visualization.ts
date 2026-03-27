// Types for the Gene Visualization Tool
export interface GTDBRecord {
  assembly: string;
  phylum: string;
  class: string;
  order: string;
  family: string;
  genus: string;
  species: string;
}

export interface GeneCountData {
  [geneId: string]: number;
}

export interface AssemblyData {
  assembly: string;
  counts: GeneCountData;
}

export interface VisualizationState {
  originalRaw: GTDBRecord[];
  raw: GTDBRecord[];
  assemblies: string[];
  selectedLevels: TaxonomicLevel[];
  totalInput: number;
  geneNames: string[];
  matrix: Uint8Array | null;
  asmCount: number;
  countMap: Map<string, GeneCountData>;
  asmIndex: Map<string, number>;
  geneIndex: Map<string, number>;
  coordMap: Map<string, number>;
  widthMap: Map<string, number>;
  normalizeLevel: TaxonomicLevel | "__ALL__" | null;
  showPresence: boolean;
  activeGenes: string[];
  isLoading: boolean;
  loadingMessage: string;
}

export type TaxonomicLevel =
  | "phylum"
  | "class"
  | "order"
  | "family"
  | "genus"
  | "species";

export interface ColorScale {
  (value: string): string;
}

export interface VisualizationConstants {
  FIXED_WIDTH: number;
  MARGINS: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  LEVEL_HEIGHT: number;
  INNER_PAD: number;
  RUG_HEIGHT: number;
  RUG_PAD: number;
  BASE_GAP: number;
  GOLDEN: number;
}

export interface FilterOptions {
  sizeFilterLevel: TaxonomicLevel | "";
  sizeFilterThreshold: number;
  searchTerm: string;
  lineageFilter: {
    level: TaxonomicLevel;
    category: string;
  } | null;
}

export interface DifferenceOptions {
  gene1: string;
  gene2: string;
  useCounts: boolean;
}

export interface RugPlotData {
  gene: string;
  index: number;
  baseY: number;
  active: boolean;
}

export interface LineageRun {
  cat: string;
  start: number;
  end: number;
}

export interface TooltipData {
  level: TaxonomicLevel;
  category: string;
  count: number;
  x: number;
  y: number;
}

// ---------------------------------------------
// Legacy / utility types used by DataProcessor
// ---------------------------------------------
export type Assembly = GTDBRecord;

export interface GeneData {
  [geneName: string]: number;
}

export interface ProcessedData {
  assemblies: Assembly[];
  geneNames: string[];
  matrix: number[][];
  countMap: Map<string, GeneData>;
  asmIndex: Map<string, number>;
  geneIndex: Map<string, number>;
}

export interface CoordinateMap {
  coordMap: Map<string, number>;
  widthMap: Map<string, number>;
}

export type LineageLevel = TaxonomicLevel;
