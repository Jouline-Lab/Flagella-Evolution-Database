export const STANDARD_AMINO_ACIDS = "ACDEFGHIKLMNPQRSTVWY";

export type PositionLogoData = {
  alignmentColumn: number;
  residueCounts: Record<string, number>;
  totalSequences: number;
  informationContent: number;
  letterHeights: Record<string, number>;
};

/** Per-column summary of the full MSA (before gap filtering). */
export type AlignmentColumnStat = {
  /** 1-based index in the full alignment */
  alignmentColumn: number;
  /** Percentage of rows with gap (non–standard-AA) in this column */
  gapPercentage: number;
  residueCounts: Record<string, number>;
  gapCount: number;
  totalSequences: number;
};

export type GeneLogoPrecomputePayload = {
  version: number;
  geneName: string;
  geneSlug: string;
  sourceAlignmentFiles: string[];
  totalSequences: number;
  alignmentColumns: AlignmentColumnStat[];
  /** When this file was produced (ISO 8601). */
  generatedAt?: string;
};

export function buildAlignmentColumnStats(
  sequences: ReadonlyArray<{ readonly sequence: string }>
): AlignmentColumnStat[] {
  if (sequences.length === 0) {
    return [];
  }

  const n = sequences.length;
  const maxLength = Math.max(...sequences.map((s) => s.sequence.length));
  const stats: AlignmentColumnStat[] = [];

  for (let col = 0; col < maxLength; col += 1) {
    const residueCounts: Record<string, number> = {};
    let gapCount = 0;

    for (const seq of sequences) {
      const residue = seq.sequence[col]?.toUpperCase() ?? "-";
      if (STANDARD_AMINO_ACIDS.includes(residue)) {
        residueCounts[residue] = (residueCounts[residue] || 0) + 1;
      } else {
        gapCount += 1;
      }
    }

    stats.push({
      alignmentColumn: col + 1,
      gapPercentage: (gapCount / n) * 100,
      residueCounts,
      gapCount,
      totalSequences: n
    });
  }

  return stats;
}

/** 0-based original column indices that pass the same gap rule as the live chart. */
export function getKeptColumnIndices(stats: AlignmentColumnStat[], maxGapPercentage: number): number[] {
  const kept: number[] = [];
  for (let i = 0; i < stats.length; i += 1) {
    const s = stats[i];
    const residueCount = Object.values(s.residueCounts).reduce((a, b) => a + b, 0);
    if (residueCount > 0 && s.gapPercentage <= maxGapPercentage) {
      kept.push(i);
    }
  }
  return kept;
}

export function filterSequencesByColumnIndices<T extends { sequence: string }>(
  sequences: T[],
  keepPositions: number[]
): T[] {
  return sequences.map((sequence) => ({
    ...sequence,
    sequence: keepPositions.map((position) => sequence.sequence[position] ?? "-").join("")
  }));
}

export function filterAlignmentByGapThreshold<T extends { sequence: string }>(
  sequences: T[],
  maxGapPercentage: number
): { sequences: T[]; keptColumnIndices: number[] } {
  if (sequences.length === 0) {
    return { sequences: [], keptColumnIndices: [] };
  }
  const stats = buildAlignmentColumnStats(sequences);
  const kept = getKeptColumnIndices(stats, maxGapPercentage);
  return {
    sequences: filterSequencesByColumnIndices(sequences, kept),
    keptColumnIndices: kept
  };
}

export function calculateLogoDataFromColumnStats(
  stats: AlignmentColumnStat[],
  keptColumnIndices: number[]
): PositionLogoData[] {
  const logoData: PositionLogoData[] = [];

  for (const colIdx of keptColumnIndices) {
    const s = stats[colIdx];
    if (!s) {
      continue;
    }

    const { residueCounts, gapCount, totalSequences } = s;
    const residuesPresent = Object.keys(residueCounts);
    if (residuesPresent.length === 0) {
      continue;
    }

    const frequencies: Record<string, number> = {};
    residuesPresent.forEach((residue) => {
      frequencies[residue] = residueCounts[residue] / totalSequences;
    });
    if (gapCount > 0) {
      frequencies["-"] = gapCount / totalSequences;
    }

    let entropy = 0;
    Object.values(frequencies).forEach((frequency) => {
      if (frequency > 0) {
        entropy -= frequency * Math.log2(frequency);
      }
    });

    const informationContent = Math.max(0, Math.log2(21) - entropy);
    const letterHeights: Record<string, number> = {};
    residuesPresent.forEach((residue) => {
      letterHeights[residue] = frequencies[residue] * informationContent;
    });

    logoData.push({
      alignmentColumn: s.alignmentColumn,
      residueCounts: { ...residueCounts },
      totalSequences,
      informationContent,
      letterHeights
    });
  }

  return logoData;
}

/** Logo stacks from already column-filtered sequences (non-precomputed path). */
export function calculateLogoDataFromFilteredSequences<T extends { sequence: string }>(
  filteredSequences: T[],
  keptColumnIndices: number[]
): PositionLogoData[] {
  if (filteredSequences.length === 0 || keptColumnIndices.length === 0) {
    return [];
  }

  const logoData: PositionLogoData[] = [];

  for (let position = 0; position < keptColumnIndices.length; position += 1) {
    const residueCounts: Record<string, number> = {};
    let gapCount = 0;

    for (const sequence of filteredSequences) {
      const residue = sequence.sequence[position]?.toUpperCase() ?? "-";
      if (STANDARD_AMINO_ACIDS.includes(residue)) {
        residueCounts[residue] = (residueCounts[residue] || 0) + 1;
      } else {
        gapCount += 1;
      }
    }

    const residuesPresent = Object.keys(residueCounts);
    if (residuesPresent.length === 0) {
      continue;
    }

    const totalSequences = filteredSequences.length;
    const frequencies: Record<string, number> = {};
    residuesPresent.forEach((residue) => {
      frequencies[residue] = residueCounts[residue] / totalSequences;
    });
    if (gapCount > 0) {
      frequencies["-"] = gapCount / totalSequences;
    }

    let entropy = 0;
    Object.values(frequencies).forEach((frequency) => {
      if (frequency > 0) {
        entropy -= frequency * Math.log2(frequency);
      }
    });

    const informationContent = Math.max(0, Math.log2(21) - entropy);
    const letterHeights: Record<string, number> = {};
    residuesPresent.forEach((residue) => {
      letterHeights[residue] = frequencies[residue] * informationContent;
    });

    logoData.push({
      alignmentColumn: keptColumnIndices[position] + 1,
      residueCounts,
      totalSequences,
      informationContent,
      letterHeights
    });
  }

  return logoData;
}
