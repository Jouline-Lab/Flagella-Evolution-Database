export type CoordRow = {
  geneName: string;
  geneId: string;
  contig: string;
  start: number;
  stop: number;
  strand: 1 | -1;
  assembly: string;
};

export type OperonPairOccurrence = {
  geneA: string;
  geneB: string;
  gap: number;
  upstream: string;
  downstream: string;
  assembly?: string;
};

export type UndirectedEdge = {
  source: string;
  target: string;
  count: number;
  averageGapBp?: number;
};

export type DirectedEdge = {
  source: string;
  target: string;
  count: number;
  averageGapBp?: number;
};

export type OperonAssociationSummary = {
  thresholdBp: number;
  assembliesScanned: number;
  assembliesWithCoords: number;
  pairOccurrences: number;
  undirected: UndirectedEdge[];
  directed: DirectedEdge[];
  geneNeighborCounts: Record<string, number>;
};

export type PhylumMeta = {
  id: string;
  label: string;
  assembliesWithCoords: number;
};

/** [phylumId, assembliesWithEdge, phylumAssemblyTotal] */
export type EdgePhylumCounts = Array<[string, number, number]>;

export type ThresholdEdgePhylumComposition = {
  undirected: Record<string, EdgePhylumCounts>;
  directed: Record<string, EdgePhylumCounts>;
};

export type OperonAssociationsBundle = {
  assembliesScanned: number;
  assembliesWithCoords: number;
  scannedAt: number;
  thresholds: number[];
  summaries: Record<string, OperonAssociationSummary>;
  phyla: PhylumMeta[];
  phylumSummaries: Record<string, Record<string, OperonAssociationSummary>>;
  edgePhylumByThreshold: Record<string, ThresholdEdgePhylumComposition>;
};

export const OPERON_THRESHOLD_STEPS = [500] as const;

export const OPERON_ASSOCIATIONS_URL = "/operon-summary/operon-associations-bundle.json";

/** Max gap stored while scanning; pairs beyond this never appear in results. */
export const MAX_SCAN_GAP_BP = 500;

export const DEFAULT_DISTANCE_THRESHOLD_BP = 500;

/** Minimum phylum assembly count for edge prevalence breakdown and phylum focus dropdown. */
export const DEFAULT_MIN_PHYLUM_SIZE = 50;

/** Default average prevalence (%) across eligible phyla required to show an edge. */
export const DEFAULT_AVERAGE_ASSOCIATION_PERCENT = 5;

export const EDGE_PHYLUM_BREAKDOWN_TOP_N = 10;

function getValue(parts: string[], idx: number): string {
  if (idx < 0 || idx >= parts.length) return "";
  return parts[idx]?.trim() ?? "";
}

export function parseCoordFile(tsv: string, assemblyFallback = ""): CoordRow[] {
  const lines = tsv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) return [];

  const headers = lines[0].split("\t").map((value) => value.trim().toLowerCase());
  const idxGeneName = headers.indexOf("gene_name");
  const idxGeneId = headers.indexOf("gene_id");
  const idxContig = headers.indexOf("genome_id");
  const idxStart = headers.indexOf("start");
  const idxStop = headers.indexOf("stop");
  const idxStrand = headers.indexOf("strand");
  const idxAssembly = headers.indexOf("assembly");

  if (
    idxGeneName === -1 ||
    idxGeneId === -1 ||
    idxContig === -1 ||
    idxStart === -1 ||
    idxStop === -1 ||
    idxStrand === -1
  ) {
    return [];
  }

  const rows: CoordRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split("\t");
    const geneName = getValue(parts, idxGeneName);
    const geneId = getValue(parts, idxGeneId);
    const contig = getValue(parts, idxContig);
    const start = Number(getValue(parts, idxStart));
    const stop = Number(getValue(parts, idxStop));
    const strandRaw = Number(getValue(parts, idxStrand));
    const assembly =
      idxAssembly === -1 ? assemblyFallback : getValue(parts, idxAssembly) || assemblyFallback;
    if (!geneName || !geneId || !contig || !assembly) continue;
    if (!Number.isFinite(start) || !Number.isFinite(stop)) continue;
    const strand: 1 | -1 = strandRaw === -1 ? -1 : 1;
    rows.push({
      geneName,
      geneId,
      contig,
      start: Math.min(start, stop),
      stop: Math.max(start, stop),
      strand,
      assembly
    });
  }

  return rows;
}

/**
 * Within one assembly, find consecutive gene pairs on the same contig and strand whose
 * intergenic gap is at most `maxGapBp`.
 *
 * Coordinates use Prodigal-style leftmost/rightmost (start <= stop) with a strand flag.
 * Undirected pairs ignore order. Directed pairs follow transcription orientation:
 * + strand: lower coordinate upstream; − strand: higher coordinate upstream.
 */
export function extractNeighborhoodPairs(
  rows: CoordRow[],
  maxGapBp: number = MAX_SCAN_GAP_BP
): OperonPairOccurrence[] {
  const byContigStrand = new Map<string, CoordRow[]>();

  for (const row of rows) {
    const key = `${row.contig}\t${row.strand}`;
    const existing = byContigStrand.get(key) ?? [];
    existing.push(row);
    byContigStrand.set(key, existing);
  }

  const occurrences: OperonPairOccurrence[] = [];

  for (const contigRows of byContigStrand.values()) {
    const sorted = [...contigRows].sort(
      (a, b) => a.start - b.start || a.stop - b.stop || a.geneName.localeCompare(b.geneName)
    );

    for (let i = 0; i < sorted.length - 1; i += 1) {
      const current = sorted[i];
      const candidate = sorted[i + 1];
      const gapBp = Math.max(0, candidate.start - current.stop);

      if (gapBp > maxGapBp) {
        continue;
      }

      const upstream =
        current.strand === 1 ? current.geneName : candidate.geneName;
      const downstream =
        current.strand === 1 ? candidate.geneName : current.geneName;

      occurrences.push({
        geneA: current.geneName,
        geneB: candidate.geneName,
        gap: gapBp,
        upstream,
        downstream
      });
    }
  }

  return occurrences;
}

function undirectedKey(a: string, b: string): string {
  return a <= b ? `${a}\t${b}` : `${b}\t${a}`;
}

export function undirectedEdgeKey(source: string, target: string): string {
  return undirectedKey(source, target);
}

export function directedEdgeKey(source: string, target: string): string {
  return `${source}\t${target}`;
}

export function formatPhylumLabel(phylumId: string): string {
  return phylumId.replace(/^p__/, "").replace(/_/g, " ") || phylumId;
}

export type EdgePhylumBreakdownRow = {
  phylum: string;
  label: string;
  assembliesWithEdge: number;
  phylumTotal: number;
  percent: number;
  meetsConservationThreshold: boolean;
};

function readEdgePhylumRows(
  bundle: OperonAssociationsBundle,
  thresholdBp: number,
  directed: boolean,
  source: string,
  target: string,
  minPhylumSize: number
): EdgePhylumBreakdownRow[] {
  const step = pickThresholdStep(thresholdBp, bundle.thresholds);
  const composition = bundle.edgePhylumByThreshold[String(step)];
  if (!composition) {
    return [];
  }

  const key = directed ? directedEdgeKey(source, target) : undirectedEdgeKey(source, target);
  const counts = directed ? composition.directed[key] : composition.undirected[key];
  if (!counts || counts.length === 0) {
    return [];
  }

  const floor = Math.max(1, minPhylumSize);
  return counts
    .map((entry) => {
      const [phylum, assembliesWithEdge, phylumTotal] = entry;
      const percent = phylumTotal > 0 ? (100 * assembliesWithEdge) / phylumTotal : 0;
      return {
        phylum,
        label: formatPhylumLabel(phylum),
        assembliesWithEdge,
        phylumTotal,
        percent,
        meetsConservationThreshold: false
      };
    })
    .filter((row) => row.phylumTotal >= floor);
}

export function countConservedPhylaForEdge(
  bundle: OperonAssociationsBundle,
  thresholdBp: number,
  directed: boolean,
  source: string,
  target: string,
  options: { minPhylumSize: number; conservationPercent: number }
): number {
  const threshold = Math.max(0, Math.min(100, options.conservationPercent));
  return readEdgePhylumRows(bundle, thresholdBp, directed, source, target, options.minPhylumSize).filter(
    (row) => row.percent >= threshold
  ).length;
}

export function averageAssociationPercentForEdge(
  bundle: OperonAssociationsBundle,
  thresholdBp: number,
  directed: boolean,
  source: string,
  target: string,
  options: { minPhylumSize: number; phylumId?: string | null }
): number {
  const eligiblePhyla = options.phylumId
    ? bundle.phyla.filter((phylum) => phylum.id === options.phylumId)
    : filterPhylaByMinSize(bundle.phyla, options.minPhylumSize);

  const phyla = eligiblePhyla.filter(
    (phylum) => options.phylumId || phylum.assembliesWithCoords >= Math.max(1, options.minPhylumSize)
  );

  if (phyla.length === 0) {
    return 0;
  }

  const rowsByPhylum = new Map(
    readEdgePhylumRows(bundle, thresholdBp, directed, source, target, 1).map((row) => [
      row.phylum,
      row.percent
    ])
  );
  const total = phyla.reduce((sum, phylum) => sum + (rowsByPhylum.get(phylum.id) ?? 0), 0);
  return total / phyla.length;
}

export function getEdgePhylumBreakdown(
  bundle: OperonAssociationsBundle,
  thresholdBp: number,
  directed: boolean,
  source: string,
  target: string,
  options?: {
    minPhylumSize?: number;
    conservationPercent?: number;
    limit?: number;
  }
): EdgePhylumBreakdownRow[] {
  const minPhylumSize = Math.max(1, options?.minPhylumSize ?? 1);
  const conservationPercent = Math.max(0, Math.min(100, options?.conservationPercent ?? 0));
  const limit = Math.max(1, options?.limit ?? EDGE_PHYLUM_BREAKDOWN_TOP_N);

  return readEdgePhylumRows(bundle, thresholdBp, directed, source, target, minPhylumSize)
    .map((row) => ({
      ...row,
      meetsConservationThreshold: row.percent >= conservationPercent
    }))
    .sort(
      (a, b) =>
        b.percent - a.percent ||
        b.assembliesWithEdge - a.assembliesWithEdge ||
        a.label.localeCompare(b.label)
    )
    .slice(0, limit);
}

export function filterPhylaByMinSize(
  phyla: PhylumMeta[],
  minPhylumSize: number
): PhylumMeta[] {
  const floor = Math.max(1, minPhylumSize);
  return phyla.filter((phylum) => phylum.assembliesWithCoords >= floor);
}

export function pickPhylumSummary(
  bundle: OperonAssociationsBundle,
  thresholdBp: number,
  phylumId: string | null
): OperonAssociationSummary | null {
  if (!phylumId) {
    return pickThresholdSummary(bundle, thresholdBp);
  }
  const step = pickThresholdStep(thresholdBp, bundle.thresholds);
  return bundle.phylumSummaries[String(step)]?.[phylumId] ?? null;
}

export function aggregateOperonAssociations(
  occurrences: OperonPairOccurrence[],
  thresholdBp: number,
  geneFilter?: Set<string> | null
): OperonAssociationSummary {
  const undirectedCounts = new Map<string, number>();
  const directedCounts = new Map<string, number>();
  const undirectedGapSums = new Map<string, number>();
  const directedGapSums = new Map<string, number>();
  const geneNeighborCounts = new Map<string, number>();

  let filteredOccurrences = 0;

  for (const occ of occurrences) {
    if (occ.gap > thresholdBp) {
      continue;
    }

    if (geneFilter && geneFilter.size > 0) {
      if (!geneFilter.has(occ.geneA) && !geneFilter.has(occ.geneB)) {
        continue;
      }
      if (!geneFilter.has(occ.geneA) || !geneFilter.has(occ.geneB)) {
        continue;
      }
    }

    filteredOccurrences += 1;

    const uKey = undirectedKey(occ.geneA, occ.geneB);
    undirectedCounts.set(uKey, (undirectedCounts.get(uKey) ?? 0) + 1);
    undirectedGapSums.set(uKey, (undirectedGapSums.get(uKey) ?? 0) + occ.gap);

    const dKey = `${occ.upstream}\t${occ.downstream}`;
    directedCounts.set(dKey, (directedCounts.get(dKey) ?? 0) + 1);
    directedGapSums.set(dKey, (directedGapSums.get(dKey) ?? 0) + occ.gap);

    geneNeighborCounts.set(occ.geneA, (geneNeighborCounts.get(occ.geneA) ?? 0) + 1);
    geneNeighborCounts.set(occ.geneB, (geneNeighborCounts.get(occ.geneB) ?? 0) + 1);
  }

  const undirected: UndirectedEdge[] = [];
  for (const [key, count] of undirectedCounts.entries()) {
    const [source, target] = key.split("\t");
    const averageGapBp = count > 0 ? (undirectedGapSums.get(key) ?? 0) / count : 0;
    undirected.push({ source, target, count, averageGapBp });
  }
  undirected.sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));

  const directed: DirectedEdge[] = [];
  for (const [key, count] of directedCounts.entries()) {
    const [source, target] = key.split("\t");
    const averageGapBp = count > 0 ? (directedGapSums.get(key) ?? 0) / count : 0;
    directed.push({ source, target, count, averageGapBp });
  }
  directed.sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));

  const geneCountsRecord: Record<string, number> = {};
  for (const [gene, count] of geneNeighborCounts.entries()) {
    geneCountsRecord[gene] = count;
  }

  return {
    thresholdBp,
    assembliesScanned: 0,
    assembliesWithCoords: 0,
    pairOccurrences: filteredOccurrences,
    undirected,
    directed,
    geneNeighborCounts: geneCountsRecord
  };
}

export function pickThresholdStep(requestedBp: number, steps: readonly number[] = OPERON_THRESHOLD_STEPS): number {
  let chosen = steps[0] ?? 0;
  for (const step of steps) {
    if (step <= requestedBp) {
      chosen = step;
    } else {
      break;
    }
  }
  return chosen;
}

export function pickThresholdSummary(
  bundle: OperonAssociationsBundle,
  requestedBp: number
): OperonAssociationSummary | null {
  const step = pickThresholdStep(requestedBp, bundle.thresholds);
  return bundle.summaries[String(step)] ?? null;
}

export function filterSummaryByGenes(
  summary: OperonAssociationSummary,
  genes: Set<string>
): OperonAssociationSummary {
  if (genes.size === 0) {
    return summary;
  }

  const undirected = summary.undirected.filter(
    (edge) => genes.has(edge.source) && genes.has(edge.target)
  );
  const directed = summary.directed.filter(
    (edge) => genes.has(edge.source) && genes.has(edge.target)
  );

  return rebuildSummaryFromEdges(summary, undirected, directed);
}

export function filterSummaryByMinCount(
  summary: OperonAssociationSummary,
  minCount: number
): OperonAssociationSummary {
  if (!Number.isFinite(minCount) || minCount <= 1) {
    return summary;
  }

  const undirected = summary.undirected.filter((edge) => edge.count >= minCount);
  const directed = summary.directed.filter((edge) => edge.count >= minCount);

  return rebuildSummaryFromEdges(summary, undirected, directed);
}

export function applyPhylumConservationSummary(
  bundle: OperonAssociationsBundle,
  summary: OperonAssociationSummary,
  options: {
    minPhylumSize: number;
    conservationPercent: number;
    minPhylaCount?: number;
    genes?: Set<string> | null;
  }
): OperonAssociationSummary {
  const conservationOptions = {
    minPhylumSize: options.minPhylumSize,
    conservationPercent: options.conservationPercent
  };
  const minPhylaCount = Math.max(1, options.minPhylaCount ?? 1);

  let undirected = summary.undirected;
  let directed = summary.directed;

  if (options.genes && options.genes.size > 0) {
    undirected = undirected.filter(
      (edge) => options.genes!.has(edge.source) && options.genes!.has(edge.target)
    );
    directed = directed.filter(
      (edge) => options.genes!.has(edge.source) && options.genes!.has(edge.target)
    );
  }

  undirected = undirected
    .map((edge) => ({
      ...edge,
      count: countConservedPhylaForEdge(
        bundle,
        summary.thresholdBp,
        false,
        edge.source,
        edge.target,
        conservationOptions
      )
    }))
    .filter((edge) => edge.count >= minPhylaCount)
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));

  directed = directed
    .map((edge) => ({
      ...edge,
      count: countConservedPhylaForEdge(
        bundle,
        summary.thresholdBp,
        true,
        edge.source,
        edge.target,
        conservationOptions
      )
    }))
    .filter((edge) => edge.count >= minPhylaCount)
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));

  return rebuildSummaryFromEdges(summary, undirected, directed);
}

export function applyAverageAssociationSummary(
  bundle: OperonAssociationsBundle,
  summary: OperonAssociationSummary,
  options: {
    minPhylumSize: number;
    minAveragePercent: number;
    phylumId?: string | null;
    genes?: Set<string> | null;
  }
): OperonAssociationSummary {
  const minAveragePercent = Math.max(0, Math.min(100, options.minAveragePercent));

  let undirected = summary.undirected;
  let directed = summary.directed;

  if (options.genes && options.genes.size > 0) {
    undirected = undirected.filter(
      (edge) => options.genes!.has(edge.source) && options.genes!.has(edge.target)
    );
    directed = directed.filter(
      (edge) => options.genes!.has(edge.source) && options.genes!.has(edge.target)
    );
  }

  undirected = undirected
    .map((edge) => {
      const averagePercent = averageAssociationPercentForEdge(
        bundle,
        summary.thresholdBp,
        false,
        edge.source,
        edge.target,
        {
          minPhylumSize: options.minPhylumSize,
          phylumId: options.phylumId
        }
      );
      return {
        ...edge,
        averagePercent,
        count: Number(averagePercent.toFixed(1))
      };
    })
    .filter((edge) => edge.averagePercent >= minAveragePercent)
    .map(({ averagePercent, ...edge }) => edge)
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));

  directed = directed
    .map((edge) => {
      const averagePercent = averageAssociationPercentForEdge(
        bundle,
        summary.thresholdBp,
        true,
        edge.source,
        edge.target,
        {
          minPhylumSize: options.minPhylumSize,
          phylumId: options.phylumId
        }
      );
      return {
        ...edge,
        averagePercent,
        count: Number(averagePercent.toFixed(1))
      };
    })
    .filter((edge) => edge.averagePercent >= minAveragePercent)
    .map(({ averagePercent, ...edge }) => edge)
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));

  return rebuildSummaryFromEdges(summary, undirected, directed);
}

export function applySummaryFilters(
  summary: OperonAssociationSummary,
  options: {
    genes?: Set<string> | null;
    minCount?: number;
  }
): OperonAssociationSummary {
  let next = summary;
  if (options.genes && options.genes.size > 0) {
    next = filterSummaryByGenes(next, options.genes);
  }
  if (options.minCount != null && options.minCount > 1) {
    next = filterSummaryByMinCount(next, options.minCount);
  }
  return next;
}

function rebuildSummaryFromEdges(
  summary: OperonAssociationSummary,
  undirected: UndirectedEdge[],
  directed: DirectedEdge[]
): OperonAssociationSummary {
  const geneNeighborCounts: Record<string, number> = {};
  for (const edge of undirected) {
    geneNeighborCounts[edge.source] = (geneNeighborCounts[edge.source] ?? 0) + edge.count;
    geneNeighborCounts[edge.target] = (geneNeighborCounts[edge.target] ?? 0) + edge.count;
  }

  let pairOccurrences = 0;
  for (const edge of undirected) {
    pairOccurrences += edge.count;
  }

  return {
    ...summary,
    pairOccurrences,
    undirected,
    directed,
    geneNeighborCounts
  };
}
