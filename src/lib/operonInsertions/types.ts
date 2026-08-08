export type InsertionNeighborDirection = "upstream" | "downstream";

export type InsertionNeighborAssociation = {
  insertedGene: string;
  neighborGene: string;
  direction: InsertionNeighborDirection;
  count: number;
  insertionCount: number;
  operonInsertionCount: number;
  occurrencePercent: number;
  sameStrandCount: number;
  sameStrandPercent: number;
  meanDistanceBp: number;
  standardDeviationBp: number;
  medianDistanceBp: number;
  lowerQuartileBp: number;
  upperQuartileBp: number;
  minimumDistanceBp: number;
  maximumDistanceBp: number;
};

export type InsertionNeighborBundle = {
  schemaVersion: number;
  generatedAt: string;
  options: {
    maxDistanceBp: number;
    sameStrandOnly: boolean;
    neighborMode: string;
    occurrenceDefinition?: string;
    directionDefinition?: string;
    distanceDefinition: string;
  };
  inputs: {
    referenceFile: string;
    insertionFile: string;
    referenceRows: number;
    insertionRows: number;
    referenceFiles: number;
    insertionFiles: number;
    invalidReferenceRows: number;
    invalidInsertionRows: number;
  };
  summary: {
    insertedGeneTypes: number;
    insertionsWithNeighbors: number;
    insertionsWithoutReferenceContig: number;
    insertionsWithoutNeighborInRange: number;
    associationOccurrences: number;
    associationRows: number;
  };
  associations: InsertionNeighborAssociation[];
};
