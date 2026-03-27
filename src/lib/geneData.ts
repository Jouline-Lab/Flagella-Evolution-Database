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
