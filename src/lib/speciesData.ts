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

export type SpeciesFlagellaGeneSummary = {
  name: string;
  count: number;
  gtdb: string[];
  ncbi: string[];
};

export type SpeciesFlagellaGroupSummary = {
  name: string;
  totalCount: number;
  genes: SpeciesFlagellaGeneSummary[];
};

export type SpeciesFlagellaContent = {
  matchedAssemblies: number;
  totalGeneCount: number;
  groups: SpeciesFlagellaGroupSummary[];
};

export type OperonGeneItem = {
  kind: "gene";
  id: string;
  geneName: string;
  geneId: string;
  assembly: string;
  contig: string;
  start: number;
  stop: number;
  strand: 1 | -1;
};

export type OperonGapItem = {
  kind: "gap";
  id: string;
  leftBp: number;
  rightBp: number;
};

export type OperonTrack = {
  id: string;
  assembly: string;
  contig: string;
  spanStart: number;
  spanEnd: number;
  lineSegments: Array<{
    id: string;
    start: number;
    stop: number;
  }>;
  items: Array<OperonGeneItem | OperonGapItem>;
};

export type SpeciesOperonContent = {
  matchedAssemblies: number;
  assemblyCount: number;
  contigCount: number;
  geneCount: number;
  missingAssemblies: string[];
  tracks: OperonTrack[];
};
