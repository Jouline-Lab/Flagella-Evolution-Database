export type SpeciesRecord = {
  slug: string;
  name: string;
  summary: string;
  taxonomy: {
    phylum: string;
    className: string;
    order: string;
    family: string;
    genus: string;
  };
  traits: string[];
};

export const speciesCatalog: SpeciesRecord[] = [
  {
    slug: "escherichia-coli",
    name: "Escherichia coli",
    summary:
      "A model Gram-negative bacterium used in molecular biology and flagellar research.",
    taxonomy: {
      phylum: "Pseudomonadota",
      className: "Gammaproteobacteria",
      order: "Enterobacterales",
      family: "Enterobacteriaceae",
      genus: "Escherichia"
    },
    traits: [
      "Peritrichous flagella in many strains",
      "Well-studied chemotaxis network",
      "Extensive genomic resources"
    ]
  },
  {
    slug: "salmonella-enterica",
    name: "Salmonella enterica",
    summary:
      "An enteric pathogen with strong links between motility, host invasion, and immune response.",
    taxonomy: {
      phylum: "Pseudomonadota",
      className: "Gammaproteobacteria",
      order: "Enterobacterales",
      family: "Enterobacteriaceae",
      genus: "Salmonella"
    },
    traits: [
      "Phase-variable flagellin expression",
      "Motility supports colonization",
      "Close comparative model to E. coli"
    ]
  },
  {
    slug: "bacillus-subtilis",
    name: "Bacillus subtilis",
    summary:
      "A Gram-positive model organism with deep experimental literature on flagellar assembly.",
    taxonomy: {
      phylum: "Bacillota",
      className: "Bacilli",
      order: "Bacillales",
      family: "Bacillaceae",
      genus: "Bacillus"
    },
    traits: [
      "Peritrichous motility",
      "Biofilm and motility trade-offs",
      "Rich regulatory genetics"
    ]
  },
  {
    slug: "pseudomonas-aeruginosa",
    name: "Pseudomonas aeruginosa",
    summary:
      "An opportunistic pathogen often studied for polar motility and environmental adaptability.",
    taxonomy: {
      phylum: "Pseudomonadota",
      className: "Gammaproteobacteria",
      order: "Pseudomonadales",
      family: "Pseudomonadaceae",
      genus: "Pseudomonas"
    },
    traits: [
      "Polar flagellum",
      "Motility contributes to virulence",
      "High ecological versatility"
    ]
  }
];
