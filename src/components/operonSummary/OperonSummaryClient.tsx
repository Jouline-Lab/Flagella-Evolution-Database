"use client";

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import PageHeader from "@/components/layout/PageHeader";
import OperonAssociationNetworkGraph from "@/components/operonSummary/OperonAssociationNetworkGraph";
import { withBasePath } from "@/lib/assetPaths";
import {
  GENE_COUNT_SUFFIX,
  parseDelimited,
  type ParsedTable
} from "@/lib/geneCorrelation/jaccardHeatmapCore";
import {
  DEFAULT_AVERAGE_ASSOCIATION_PERCENT,
  DEFAULT_DISTANCE_THRESHOLD_BP,
  DEFAULT_MIN_PHYLUM_SIZE,
  OPERON_ASSOCIATIONS_URL,
  averageAssociationPercentForEdge,
  applyAverageAssociationSummary,
  filterPhylaByMinSize,
  getEdgePhylumBreakdown,
  pickPhylumSummary,
  reweightAssociationSummary,
  type AssociationNormalizationMode,
  type DirectedEdge,
  type OperonAssociationSummary,
  type OperonAssociationsBundle,
  type PhylumMeta,
  type UndirectedEdge
} from "@/lib/operonSummary/operonAssociationsCore";
import { cn } from "@/lib/utils";

const DATA_URL = "/flagellar_genes_phyletic_distribution.tsv";
const OPERON_PHYLETIC_DISTRIBUTION_URL = "/operon-summary/operon_phyletic_distribution_min500.tsv";
const OPERON_PHYLETIC_TRANSFER_PREFIX = "operon-phyletic-transfer:";

function sanitizeOperonFeatureName(value: string): string {
  return (
    value
      .trim()
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "Unknown"
  );
}

function operonPhyleticColumnName(source: string, target: string): string {
  return `${sanitizeOperonFeatureName(source)}_to_${sanitizeOperonFeatureName(target)}_count`;
}

function formatDirectionalityValue(value: number): string {
  if (value === 0) return "0";
  const absValue = Math.abs(value);
  const maximumFractionDigits =
    absValue < 1 ? Math.min(8, Math.max(3, Math.ceil(-Math.log10(absValue)) + 1)) : 1;
  return value.toLocaleString(undefined, { maximumFractionDigits });
}

function formatDirectionalityRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) {
    return "only observed one way";
  }
  return `${ratio.toLocaleString(undefined, { maximumFractionDigits: 1 })}x`;
}

function quantile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const index = (sortedValues.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function seededJitter(seed: string, spread: number): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const normalized = ((hash >>> 0) % 10000) / 10000;
  return (normalized - 0.5) * spread;
}

function normalizeGeneQuery(value: string): string {
  return value.toLowerCase().trim();
}

function filterSummaryByMaxAverageGap(
  summary: OperonAssociationSummary,
  maxAverageGapBp: number
): OperonAssociationSummary {
  const includesEdge = (edge: { averageGapBp?: number }) =>
    typeof edge.averageGapBp !== "number" ||
    !Number.isFinite(edge.averageGapBp) ||
    edge.averageGapBp <= maxAverageGapBp;
  const undirected = summary.undirected.filter(includesEdge);
  const directed = summary.directed.filter(includesEdge);
  const geneNeighborCounts: Record<string, number> = {};
  let pairOccurrences = 0;

  for (const edge of undirected) {
    pairOccurrences += edge.count;
    geneNeighborCounts[edge.source] = (geneNeighborCounts[edge.source] ?? 0) + edge.count;
    geneNeighborCounts[edge.target] = (geneNeighborCounts[edge.target] ?? 0) + edge.count;
  }

  return {
    ...summary,
    pairOccurrences,
    undirected,
    directed,
    geneNeighborCounts
  };
}

function filterSummaryByMinGenePresentAverage(
  bundle: OperonAssociationsBundle,
  summary: OperonAssociationSummary,
  options: {
    minPhylumSize: number;
    minAveragePercent: number;
    phylumId?: string | null;
  }
): OperonAssociationSummary {
  const minAveragePercent = Math.max(0, Math.min(100, options.minAveragePercent));
  if (minAveragePercent <= 0) {
    return summary;
  }

  const keepEdge = (edge: DirectedEdge | UndirectedEdge, directed: boolean) =>
    averageAssociationPercentForEdge(bundle, summary.thresholdBp, directed, edge.source, edge.target, {
      minPhylumSize: options.minPhylumSize,
      phylumId: options.phylumId,
      normalizationMode: "genePresent"
    }) >= minAveragePercent;

  const undirected = summary.undirected.filter((edge) => keepEdge(edge, false));
  const directed = summary.directed.filter((edge) => keepEdge(edge, true));
  const pairOccurrences = undirected.reduce((sum, edge) => sum + edge.count, 0);
  const geneNeighborCounts: Record<string, number> = {};
  for (const edge of undirected) {
    geneNeighborCounts[edge.source] = (geneNeighborCounts[edge.source] ?? 0) + edge.count;
    geneNeighborCounts[edge.target] = (geneNeighborCounts[edge.target] ?? 0) + edge.count;
  }

  return {
    ...summary,
    pairOccurrences,
    undirected,
    directed,
    geneNeighborCounts
  };
}

type BackboneEdge = Pick<DirectedEdge | UndirectedEdge, "source" | "target" | "count">;

type BackboneScanResult = {
  scannedAssemblies: number;
  speciesWithAllComponents: string[];
  components: BackboneComponentScanResult[];
};

type BackboneComponentScanResult = {
  index: number;
  path: string[];
  edgeColumnGroups: string[][];
  missingEdgeColumns: string[];
  matchedAssemblies: number;
  species: string[];
  exampleAssemblies: string[];
};

type DirectionalityMetric = {
  label: string;
  forward: number;
  reverse: number;
  predominantDirection: string;
  predominantValue: number;
  lesserValue: number;
  ratio: number;
};

type DirectionalityRow = {
  key: string;
  geneA: string;
  geneB: string;
  isBackbone: boolean;
  clade: DirectionalityMetric;
  genePresent: DirectionalityMetric;
  sortRatio: number;
};

type DirectionalityTooltip = {
  x: number;
  y: number;
  pair: string;
  label: string;
  edgeRole: string;
  direction: string;
  ratio: string;
  predominant: string;
  lesser: string;
} | null;

function DirectionalityRatioBarPlot({
  rows,
  maxFiniteRatio,
  mode,
  minFlagellarGeneCount
}: {
  rows: DirectionalityRow[];
  maxFiniteRatio: number;
  mode: AssociationNormalizationMode;
  minFlagellarGeneCount: number;
}) {
  const [tooltip, setTooltip] = useState<DirectionalityTooltip>(null);
  const margin = { top: 38, right: 28, bottom: 112, left: 98 };
  const pairBand = 34;
  const innerWidth = Math.max(360, rows.length * pairBand);
  const innerHeight = 260;
  const width = margin.left + innerWidth + margin.right;
  const height = margin.top + innerHeight + margin.bottom;
  const selectedMetrics = rows.map((row) => (mode === "genePresent" ? row.genePresent : row.clade));
  const hasUnidirectionalValues = selectedMetrics.some(
    (metric) => metric.predominantValue > 0 && !Number.isFinite(metric.ratio)
  );
  const finitePlotMax = Math.max(1, Math.ceil(maxFiniteRatio));
  const plotMax = finitePlotMax;
  const plotRatioForMetric = (metric: DirectionalityMetric) => {
    if (metric.predominantValue <= 0) return 0;
    if (Number.isFinite(metric.ratio)) return metric.ratio;
    return finitePlotMax;
  };
  const logMax = Math.max(0, Math.log10(plotMax));
  const y = (value: number) => {
    if (value <= 1 || logMax === 0) {
      return margin.top + innerHeight;
    }
    const normalized = Math.log10(Math.min(value, plotMax)) / logMax;
    return margin.top + innerHeight - normalized * innerHeight;
  };
  const barWidth = 20;
  const powerTicks: number[] = [];
  for (let tick = 1; tick <= plotMax; tick *= 10) {
    powerTicks.push(tick);
  }
  const ticks = Array.from(
    new Set(
      [...powerTicks, plotMax]
        .filter((tick) => tick <= plotMax && (!hasUnidirectionalValues || tick < plotMax || tick === plotMax))
        .map((tick) => Number(tick.toFixed(1)))
    )
  );
  const seriesLabel = mode === "genePresent" ? "Both genes present" : `>=${minFlagellarGeneCount} genes`;
  const fill = "var(--header-bg-mid)";
  const distributionPoints = rows
    .map((row, index) => {
      const metric = mode === "genePresent" ? row.genePresent : row.clade;
      return {
        row,
        metric,
        value: metric.predominantValue > 0 ? plotRatioForMetric(metric) : 0,
        jitter: seededJitter(`${row.key}-${mode}-${index}`, 58)
      };
    })
    .filter((point) => point.value > 0);
  const sortedDistributionValues = distributionPoints.map((point) => point.value).sort((a, b) => a - b);
  const backboneDistributionValues = distributionPoints
    .filter((point) => point.row.isBackbone)
    .map((point) => point.value);
  const meanValues = backboneDistributionValues.length > 0 ? backboneDistributionValues : sortedDistributionValues;
  const boxStats =
    sortedDistributionValues.length > 0
      ? {
          min: sortedDistributionValues[0],
          q1: quantile(sortedDistributionValues, 0.25),
          median: quantile(sortedDistributionValues, 0.5),
          q3: quantile(sortedDistributionValues, 0.75),
          max: sortedDistributionValues[sortedDistributionValues.length - 1],
          mean: meanValues.reduce((sum, value) => sum + value, 0) / meanValues.length,
          meanLabel: backboneDistributionValues.length > 0 ? "backbone avg" : "avg"
        }
      : null;
  const boxWidth = 220;
  const boxHeight = 260;
  const boxMargin = { top: 28, right: 150, bottom: 30, left: 98 };
  const boxPlotX = boxMargin.left + 130;
  const boxPlotWidth = boxMargin.left + boxWidth + boxMargin.right;
  const boxPlotHeight = boxMargin.top + boxHeight + boxMargin.bottom;
  const boxY = (value: number) => {
    if (value <= 1 || logMax === 0) {
      return boxMargin.top + boxHeight;
    }
    const normalized = Math.log10(Math.min(value, plotMax)) / logMax;
    return boxMargin.top + boxHeight - normalized * boxHeight;
  };

  return (
    <div className="relative w-full max-w-full min-w-0 overflow-hidden rounded-md border border-[var(--input-border)] bg-[var(--surface)]">
      <div className="relative w-full max-w-full overflow-x-auto p-3">
        <svg className="block max-w-none shrink-0" width={width} height={height} role="img" aria-label="Directionality ratio bar plot">
        <defs>
          <pattern
            id={`directionality-alt-hatch-${mode}`}
            patternUnits="userSpaceOnUse"
            width="8"
            height="8"
            patternTransform="rotate(45)"
          >
            <rect width="8" height="8" fill={fill} />
            <line x1="0" x2="0" y1="0" y2="8" stroke="var(--surface)" strokeWidth="3" opacity="0.8" />
          </pattern>
        </defs>
        <line
          x1={margin.left}
          x2={margin.left}
          y1={margin.top}
          y2={margin.top + innerHeight}
          stroke="var(--text-soft)"
          strokeWidth={1}
        />
        <line
          x1={margin.left}
          x2={margin.left + innerWidth}
          y1={margin.top + innerHeight}
          y2={margin.top + innerHeight}
          stroke="var(--text-soft)"
          strokeWidth={1}
        />

        {ticks.map((tick) => {
          const tickY = y(tick);
          const isUnidirectionalTick = hasUnidirectionalValues && tick === Number(plotMax.toFixed(1));
          return (
            <g key={tick}>
              <line
                x1={margin.left}
                x2={margin.left + innerWidth}
                y1={tickY}
                y2={tickY}
                stroke="var(--input-border)"
                strokeWidth={1}
              />
              <text
                x={margin.left - 8}
                y={tickY + 4}
                textAnchor="end"
                className="fill-[var(--text-soft)] text-[11px] font-semibold"
              >
                {isUnidirectionalTick
                  ? "Unidirectional"
                  : `${tick.toLocaleString(undefined, { maximumFractionDigits: tick >= 10 ? 0 : 1 })}x`}
              </text>
            </g>
          );
        })}

        <text
          x={18}
          y={margin.top + innerHeight / 2}
          transform={`rotate(-90 18 ${margin.top + innerHeight / 2})`}
          textAnchor="middle"
          className="fill-[var(--text-soft)] text-[11px] font-semibold"
        >
          Direction Bias log (dominant/non-dominant)
        </text>
        <text
          x={margin.left + innerWidth / 2}
          y={height - 12}
          textAnchor="middle"
          className="fill-[var(--text-soft)] text-[12px] font-semibold"
        >
          Gene Pair
        </text>

        {rows.map((row, rowIndex) => {
          const centerX = margin.left + rowIndex * pairBand + pairBand / 2;
          const metric = mode === "genePresent" ? row.genePresent : row.clade;
          const hasObservation = metric.predominantValue > 0;
          const ratioForPlot = hasObservation ? plotRatioForMetric(metric) : 0;
          const barHeight = margin.top + innerHeight - y(ratioForPlot);
          const x = centerX - barWidth / 2;
          const barY = y(ratioForPlot);
          const edgeRole = row.isBackbone ? "Backbone edge" : "Alternative edge";
          const updateTooltip = (event: MouseEvent<SVGRectElement>) => {
            setTooltip({
              x: event.clientX + 10,
              y: event.clientY - 8,
              pair: `${row.geneA} / ${row.geneB}`,
              label: seriesLabel,
              edgeRole,
              direction: metric.predominantDirection,
              ratio: Number.isFinite(metric.ratio) ? formatDirectionalityRatio(metric.ratio) : "Unidirectional",
              predominant: formatDirectionalityValue(metric.predominantValue),
              lesser: formatDirectionalityValue(metric.lesserValue)
            });
          };
          return (
            <g key={row.key}>
              <rect
                x={x}
                y={barY}
                width={barWidth}
                height={barHeight}
                rx={2}
                fill={row.isBackbone ? fill : `url(#directionality-alt-hatch-${mode})`}
                className="cursor-default transition-opacity hover:opacity-85"
                onMouseEnter={updateTooltip}
                onMouseMove={updateTooltip}
                onMouseLeave={() => setTooltip(null)}
              />
              {hasObservation ? (
                <text
                  x={centerX}
                  y={Math.max(12, barY - 5)}
                  textAnchor="middle"
                  className="fill-[var(--text)] text-[9px] font-semibold"
                >
                  {formatDirectionalityValue(metric.predominantValue)}%
                </text>
              ) : null}
              <text
                x={centerX}
                y={margin.top + innerHeight + 14}
                textAnchor="end"
                transform={`rotate(-45 ${centerX} ${margin.top + innerHeight + 14})`}
                fill={row.isBackbone ? fill : "var(--text)"}
                className="text-[10px] font-semibold"
              >
                {row.geneA}/{row.geneB}
              </text>
            </g>
          );
        })}
        </svg>

        <div className="mt-2 flex flex-wrap items-center gap-6 text-lg text-[var(--text-soft)]">
          <span className="inline-flex items-center gap-2">
            <span className="h-3.5 w-8" style={{ background: fill }} />
            Backbone
          </span>
          <span className="inline-flex items-center gap-2">
            <svg width="32" height="14" aria-hidden="true">
              <defs>
                <pattern
                  id={`directionality-alt-hatch-legend-${mode}`}
                  patternUnits="userSpaceOnUse"
                  width="8"
                  height="8"
                  patternTransform="rotate(45)"
                >
                  <rect width="8" height="8" fill={fill} />
                  <line x1="0" x2="0" y1="0" y2="8" stroke="var(--surface)" strokeWidth="3" opacity="0.8" />
                </pattern>
              </defs>
              <rect x="1" y="1" width="30" height="12" fill={`url(#directionality-alt-hatch-legend-${mode})`} />
            </svg>
            Alternative
          </span>
        </div>
        {boxStats ? (
          <div className="mt-4 border-t border-[var(--input-border)] pt-3">
            <p className="m-0 text-sm font-semibold text-[var(--text)]">
              Direction bias distribution
            </p>
            <p className="m-0 mt-1 text-xs text-[var(--text-soft)]">
              Box plot and jittered points use the same log scale and selected directionality mode.
            </p>
            <svg
              className="mt-2 block"
              width={boxPlotWidth}
              height={boxPlotHeight}
              role="img"
              aria-label="Directionality ratio distribution box plot"
            >
              <defs>
                <pattern
                  id={`directionality-alt-dot-hatch-${mode}`}
                  patternUnits="userSpaceOnUse"
                  width="6"
                  height="6"
                  patternTransform="rotate(45)"
                >
                  <rect width="6" height="6" fill={fill} />
                  <line x1="0" x2="0" y1="0" y2="6" stroke="var(--surface)" strokeWidth="2" opacity="0.8" />
                </pattern>
              </defs>
              <line
                x1={boxMargin.left}
                x2={boxMargin.left}
                y1={boxMargin.top}
                y2={boxMargin.top + boxHeight}
                stroke="var(--text-soft)"
              />
              {ticks.map((tick) => {
                const tickY = boxY(tick);
                const isUnidirectionalTick = hasUnidirectionalValues && tick === Number(plotMax.toFixed(1));
                return (
                  <g key={`box-tick-${tick}`}>
                    <line
                      x1={boxMargin.left}
                      x2={boxMargin.left + boxWidth}
                      y1={tickY}
                      y2={tickY}
                      stroke="var(--input-border)"
                    />
                    <text
                      x={boxMargin.left - 8}
                      y={tickY + 4}
                      textAnchor="end"
                      className="fill-[var(--text-soft)] text-[11px] font-semibold"
                    >
                      {isUnidirectionalTick
                        ? "Unidirectional"
                        : `${tick.toLocaleString(undefined, { maximumFractionDigits: tick >= 10 ? 0 : 1 })}x`}
                    </text>
                  </g>
                );
              })}
              <line x1={boxPlotX} x2={boxPlotX} y1={boxY(boxStats.min)} y2={boxY(boxStats.max)} stroke={fill} strokeWidth={2} />
              <line x1={boxPlotX - 24} x2={boxPlotX + 24} y1={boxY(boxStats.min)} y2={boxY(boxStats.min)} stroke={fill} strokeWidth={2} />
              <line x1={boxPlotX - 24} x2={boxPlotX + 24} y1={boxY(boxStats.max)} y2={boxY(boxStats.max)} stroke={fill} strokeWidth={2} />
              <rect
                x={boxPlotX - 34}
                y={boxY(boxStats.q3)}
                width={68}
                height={Math.max(2, boxY(boxStats.q1) - boxY(boxStats.q3))}
                fill="color-mix(in srgb, var(--header-bg-mid) 22%, transparent)"
                stroke={fill}
                strokeWidth={2}
              />
              <line x1={boxPlotX - 34} x2={boxPlotX + 34} y1={boxY(boxStats.median)} y2={boxY(boxStats.median)} stroke={fill} strokeWidth={3} />
              <text
                x={boxPlotX + 42}
                y={boxY(boxStats.median) + 4}
                textAnchor="start"
                className="fill-[var(--text)] text-[11px] font-semibold"
              >
                median = {formatDirectionalityRatio(boxStats.median)}
              </text>
              {distributionPoints.map((point, index) => {
                const edgeRole = point.row.isBackbone ? "Backbone edge" : "Alternative edge";
                const updatePointTooltip = (event: MouseEvent<SVGCircleElement>) => {
                  setTooltip({
                    x: event.clientX + 10,
                    y: event.clientY - 8,
                    pair: `${point.row.geneA} / ${point.row.geneB}`,
                    label: seriesLabel,
                    edgeRole,
                    direction: point.metric.predominantDirection,
                    ratio: Number.isFinite(point.metric.ratio)
                      ? formatDirectionalityRatio(point.metric.ratio)
                      : "Unidirectional",
                    predominant: formatDirectionalityValue(point.metric.predominantValue),
                    lesser: formatDirectionalityValue(point.metric.lesserValue)
                  });
                };
                return (
                  <circle
                    key={`${point.row.key}-${index}`}
                    cx={boxPlotX + point.jitter}
                    cy={boxY(point.value)}
                    r={4}
                    fill={point.row.isBackbone ? fill : `url(#directionality-alt-dot-hatch-${mode})`}
                    stroke={fill}
                    strokeWidth={1}
                    opacity={0.9}
                    className="cursor-default transition-opacity hover:opacity-100"
                    onMouseEnter={updatePointTooltip}
                    onMouseMove={updatePointTooltip}
                    onMouseLeave={() => setTooltip(null)}
                  />
                );
              })}
            </svg>
          </div>
        ) : null}
        {tooltip ? (
          <div
            className="pointer-events-none fixed z-50 w-64 rounded-md border border-[var(--input-border)] bg-[var(--dialog-bg)] px-3 py-2 text-xs text-[var(--text)] shadow-lg"
            style={{ left: tooltip.x, top: tooltip.y, transform: "translateY(-100%)" }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="m-0 truncate font-semibold">{tooltip.pair}</p>
                <p className="m-0 mt-0.5 text-[var(--text-soft)]">
                  {tooltip.edgeRole} - {tooltip.label}
                </p>
              </div>
            </div>
            <div className="mt-2 space-y-1.5 border-t border-[var(--input-border)] pt-2 tabular-nums">
              <div className="flex justify-between gap-3">
                <span className="text-[var(--text-soft)]">Dominant</span>
                <strong className="text-right">{tooltip.direction}</strong>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[var(--text-soft)]">Ratio</span>
                <strong>{tooltip.ratio}</strong>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[var(--text-soft)]">Values</span>
                <strong>
                  {tooltip.predominant} / {tooltip.lesser}
                </strong>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function pairKey(a: string, b: string): string {
  return a <= b ? `${a}\t${b}` : `${b}\t${a}`;
}

function connectedComponentsFromEdges(edges: BackboneEdge[]): string[][] {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }

  const seen = new Set<string>();
  const components: string[][] = [];
  for (const node of adjacency.keys()) {
    if (seen.has(node)) continue;
    const stack = [node];
    const component: string[] = [];
    seen.add(node);
    while (stack.length > 0) {
      const current = stack.pop()!;
      component.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    components.push(component);
  }
  return components.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

function strongestEdgesByPair(edges: BackboneEdge[]): Map<string, BackboneEdge> {
  const best = new Map<string, BackboneEdge>();
  for (const edge of edges) {
    const key = pairKey(edge.source, edge.target);
    const existing = best.get(key);
    if (!existing || edge.count > existing.count) {
      best.set(key, edge);
    }
  }
  return best;
}

function maximumSpanningTreeForBackbone(nodes: string[], edges: BackboneEdge[]): BackboneEdge[] {
  const parent = new Map(nodes.map((node) => [node, node]));
  const find = (node: string): string => {
    const current = parent.get(node) ?? node;
    if (current === node) return node;
    const root = find(current);
    parent.set(node, root);
    return root;
  };
  const union = (a: string, b: string): boolean => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return false;
    parent.set(rootB, rootA);
    return true;
  };

  const tree: BackboneEdge[] = [];
  for (const edge of [...strongestEdgesByPair(edges).values()].sort((a, b) => b.count - a.count)) {
    if (union(edge.source, edge.target)) {
      tree.push(edge);
    }
  }
  return tree;
}

function pathBetweenBackboneNodes(start: string, end: string, adjacency: Map<string, BackboneEdge[]>): BackboneEdge[] {
  const stack: Array<{ node: string; path: BackboneEdge[] }> = [{ node: start, path: [] }];
  const seen = new Set<string>([start]);
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.node === end) return current.path;
    for (const edge of adjacency.get(current.node) ?? []) {
      const next = edge.source === current.node ? edge.target : edge.source;
      if (!seen.has(next)) {
        seen.add(next);
        stack.push({ node: next, path: [...current.path, edge] });
      }
    }
  }
  return [];
}

function nodesFromBackbonePath(start: string, path: BackboneEdge[]): string[] {
  const nodes = [start];
  let current = start;
  for (const edge of path) {
    current = edge.source === current ? edge.target : edge.source;
    nodes.push(current);
  }
  return nodes;
}

function chooseBackboneGenePaths(edges: BackboneEdge[]): string[][] {
  if (edges.length === 0) return [];
  const components = connectedComponentsFromEdges(edges);
  const paths: string[][] = [];
  for (const component of components) {
    if (component.length <= 1) {
      paths.push(component);
      continue;
    }
    const componentSet = new Set(component);
    const componentEdges = edges.filter((edge) => componentSet.has(edge.source) && componentSet.has(edge.target));
    const tree = maximumSpanningTreeForBackbone(component, componentEdges);
    const adjacency = new Map(component.map((node) => [node, [] as BackboneEdge[]]));
    for (const edge of tree) {
      adjacency.get(edge.source)?.push(edge);
      adjacency.get(edge.target)?.push(edge);
    }
    const terminals = component.filter((node) => (adjacency.get(node)?.length ?? 0) <= 1);
    const candidates = terminals.length >= 2 ? terminals : component;
    let bestStart = candidates[0];
    let bestPath: BackboneEdge[] = [];
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < candidates.length; i += 1) {
      for (let j = i + 1; j < candidates.length; j += 1) {
        const path = pathBetweenBackboneNodes(candidates[i], candidates[j], adjacency);
        const score = path.reduce((sum, edge) => sum + edge.count, 0);
        if (score > bestScore || (score === bestScore && path.length > bestPath.length)) {
          bestStart = candidates[i];
          bestPath = path;
          bestScore = score;
        }
      }
    }

    paths.push(promoteBackboneGenePath(nodesFromBackbonePath(bestStart, bestPath), component, componentEdges));
  }
  return paths;
}

function promoteBackboneGenePath(nodePath: string[], component: string[], edges: BackboneEdge[]): string[] {
  const bestByPair = strongestEdgesByPair(edges);
  const promoted = [...nodePath];
  const promotedNodes = new Set(promoted);
  for (let pass = 0; pass < component.length; pass += 1) {
    let bestCandidate: { node: string; insertAfter: number; improvement: number } | null = null;
    for (const node of component) {
      if (promotedNodes.has(node)) continue;
      for (let index = 0; index < promoted.length - 1; index += 1) {
        const direct = bestByPair.get(pairKey(promoted[index], promoted[index + 1]));
        const first = bestByPair.get(pairKey(promoted[index], node));
        const second = bestByPair.get(pairKey(node, promoted[index + 1]));
        if (!direct || !first || !second) continue;
        const strongestAlternate = Math.max(first.count, second.count);
        if (strongestAlternate <= direct.count) continue;
        const improvement = Math.max(strongestAlternate - direct.count, first.count + second.count - direct.count);
        if (!bestCandidate || improvement > bestCandidate.improvement) {
          bestCandidate = { node, insertAfter: index, improvement };
        }
      }
    }
    if (!bestCandidate) break;
    promoted.splice(bestCandidate.insertAfter + 1, 0, bestCandidate.node);
    promotedNodes.add(bestCandidate.node);
  }
  return promoted;
}

export default function OperonSummaryClient() {
  const [parsed, setParsed] = useState<ParsedTable | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedGenes, setSelectedGenes] = useState<string[]>([]);
  const [geneSearch, setGeneSearch] = useState("");
  const distanceThreshold = DEFAULT_DISTANCE_THRESHOLD_BP;
  const [averageAssociationPercent, setAverageAssociationPercent] = useState(
    DEFAULT_AVERAGE_ASSOCIATION_PERCENT
  );
  const [genePresentAssociationPercent, setGenePresentAssociationPercent] = useState(0);
  const [maxAverageGapBp, setMaxAverageGapBp] = useState(DEFAULT_DISTANCE_THRESHOLD_BP);
  const [normalizationMode, setNormalizationMode] =
    useState<AssociationNormalizationMode>("clade");
  const [directionalityMode, setDirectionalityMode] = useState<AssociationNormalizationMode>("clade");
  const [hideIsolated, setHideIsolated] = useState(false);
  const [filterToSelectedGenes, setFilterToSelectedGenes] = useState(false);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [selectedPhylum, setSelectedPhylum] = useState<string>("");
  const [minPhylumSize, setMinPhylumSize] = useState(DEFAULT_MIN_PHYLUM_SIZE);
  const [bundle, setBundle] = useState<OperonAssociationsBundle | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [layoutMode, setLayoutMode] = useState<"force" | "backbone" | "serpentine">("backbone");
  const [serpentineGenesPerRow, setSerpentineGenesPerRow] = useState<"auto" | number>("auto");
  const [backboneScanResult, setBackboneScanResult] = useState<BackboneScanResult | null>(null);
  const [backboneScanError, setBackboneScanError] = useState<string | null>(null);
  const [backboneScanProgress, setBackboneScanProgress] = useState({ scanned: 0, total: 0 });
  const [isBackboneScanning, setIsBackboneScanning] = useState(false);

  useEffect(() => {
    const updateTheme = () => {
      const nextIsDark = document.documentElement.getAttribute("data-theme") === "dark";
      setIsDarkMode((current) => (current === nextIsDark ? current : nextIsDark));
    };
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });
    return () => observer.disconnect();
  }, []);

  const geneNames = useMemo(() => {
    if (!parsed) {
      return [];
    }
    return parsed.headers
      .filter((header) => header.endsWith(GENE_COUNT_SUFFIX))
      .map((header) => header.slice(0, -GENE_COUNT_SUFFIX.length))
      .sort((a, b) => a.localeCompare(b));
  }, [parsed]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(withBasePath(DATA_URL));
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const text = await response.text();
        if (cancelled) {
          return;
        }
        const table = parseDelimited(text);
        setParsed(table);
        setLoadError(null);
        const genes = table.headers
          .filter((header) => header.endsWith(GENE_COUNT_SUFFIX))
          .map((header) => header.slice(0, -GENE_COUNT_SUFFIX.length));
        setSelectedGenes(genes);
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Failed to load gene list.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setFetchError(null);
      try {
        const response = await fetch(withBasePath(OPERON_ASSOCIATIONS_URL));
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = (await response.json()) as OperonAssociationsBundle;
        if (cancelled) {
          return;
        }
        setBundle({
          ...payload,
          phyla: payload.phyla ?? [],
          phylumSummaries: payload.phylumSummaries ?? {},
          edgePhylumByThreshold: payload.edgePhylumByThreshold ?? {},
          edgeOpportunityByThreshold: payload.edgeOpportunityByThreshold ?? {}
        });
      } catch (error) {
        if (!cancelled) {
          setBundle(null);
          setFetchError(
            error instanceof Error
              ? error.message
              : "Failed to load operon association bundle."
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const phylumOptions = useMemo((): PhylumMeta[] => {
    return filterPhylaByMinSize(bundle?.phyla ?? [], minPhylumSize);
  }, [bundle, minPhylumSize]);

  const effectiveSelectedPhylum = useMemo(() => {
    if (!selectedPhylum) {
      return "";
    }
    return phylumOptions.some((phylum) => phylum.id === selectedPhylum) ? selectedPhylum : "";
  }, [phylumOptions, selectedPhylum]);

  const maxPhylumSize = useMemo(() => {
    if (!bundle?.phyla.length) {
      return 1000;
    }
    return Math.max(...bundle.phyla.map((phylum) => phylum.assembliesWithCoords));
  }, [bundle]);

  const selectedPhylumMeta = useMemo(() => {
    if (!effectiveSelectedPhylum) {
      return null;
    }
    return phylumOptions.find((phylum) => phylum.id === effectiveSelectedPhylum) ?? null;
  }, [phylumOptions, effectiveSelectedPhylum]);

  const baseSummary = useMemo((): OperonAssociationSummary | null => {
    if (!bundle) {
      return null;
    }
    return pickPhylumSummary(bundle, distanceThreshold, effectiveSelectedPhylum || null);
  }, [bundle, distanceThreshold, effectiveSelectedPhylum]);

  const averageSummaryBase = useMemo((): OperonAssociationSummary | null => {
    if (!bundle || !baseSummary) {
      return null;
    }
    return applyAverageAssociationSummary(bundle, baseSummary, {
      minPhylumSize,
      minAveragePercent: averageAssociationPercent,
      phylumId: effectiveSelectedPhylum || null,
      genes:
        filterToSelectedGenes && selectedGenes.length > 0 ? new Set(selectedGenes) : null
    });
  }, [
    bundle,
    baseSummary,
    minPhylumSize,
    averageAssociationPercent,
    effectiveSelectedPhylum,
    filterToSelectedGenes,
    selectedGenes
  ]);

  const summary = useMemo((): OperonAssociationSummary | null => {
    if (!bundle || !averageSummaryBase) {
      return null;
    }
    const genePresentFiltered = filterSummaryByMinGenePresentAverage(bundle, averageSummaryBase, {
      minPhylumSize,
      minAveragePercent: genePresentAssociationPercent,
      phylumId: effectiveSelectedPhylum || null
    });
    return filterSummaryByMaxAverageGap(genePresentFiltered, maxAverageGapBp);
  }, [
    bundle,
    averageSummaryBase,
    minPhylumSize,
    genePresentAssociationPercent,
    effectiveSelectedPhylum,
    maxAverageGapBp
  ]);

  const visualSummary = useMemo((): OperonAssociationSummary | null => {
    if (!bundle || !summary || normalizationMode === "clade") {
      return summary;
    }
    return reweightAssociationSummary(bundle, summary, {
      minPhylumSize,
      phylumId: effectiveSelectedPhylum || null,
      normalizationMode
    });
  }, [bundle, summary, normalizationMode, minPhylumSize, effectiveSelectedPhylum]);

  const genePresentVisualSummary = useMemo((): OperonAssociationSummary | null => {
    if (!bundle || !summary) {
      return null;
    }
    return reweightAssociationSummary(bundle, summary, {
      minPhylumSize,
      phylumId: effectiveSelectedPhylum || null,
      normalizationMode: "genePresent"
    });
  }, [bundle, summary, minPhylumSize, effectiveSelectedPhylum]);

  const edgeMetrics = useMemo(() => {
    const makeKey = (directed: boolean, source: string, target: string) =>
      directed || source <= target ? `${source}\t${target}` : `${target}\t${source}`;
    const undirected = new Map<string, { cladeAveragePercent: number; genePresentAveragePercent?: number }>();
    const directed = new Map<string, { cladeAveragePercent: number; genePresentAveragePercent?: number }>();

    for (const edge of summary?.undirected ?? []) {
      undirected.set(makeKey(false, edge.source, edge.target), {
        cladeAveragePercent: edge.count
      });
    }
    for (const edge of summary?.directed ?? []) {
      directed.set(makeKey(true, edge.source, edge.target), {
        cladeAveragePercent: edge.count
      });
    }
    for (const edge of genePresentVisualSummary?.undirected ?? []) {
      const key = makeKey(false, edge.source, edge.target);
      const current = undirected.get(key);
      if (current) {
        current.genePresentAveragePercent = edge.count;
      }
    }
    for (const edge of genePresentVisualSummary?.directed ?? []) {
      const key = makeKey(true, edge.source, edge.target);
      const current = directed.get(key);
      if (current) {
        current.genePresentAveragePercent = edge.count;
      }
    }

    return { directed, undirected, makeKey };
  }, [summary, genePresentVisualSummary]);

  const filteredGeneOptions = useMemo(() => {
    const query = normalizeGeneQuery(geneSearch);
    if (!query) {
      return geneNames;
    }
    return geneNames.filter((gene) => normalizeGeneQuery(gene).includes(query));
  }, [geneNames, geneSearch]);

  const toggleGeneSelection = useCallback((gene: string, checked: boolean) => {
    setSelectedGenes((current) => {
      if (checked) {
        return current.includes(gene) ? current : [...current, gene].sort((a, b) => a.localeCompare(b));
      }
      return current.filter((item) => item !== gene);
    });
  }, []);

  const selectAllGenes = useCallback(() => {
    setSelectedGenes(geneNames);
  }, [geneNames]);

  const clearGeneSelection = useCallback(() => {
    setSelectedGenes([]);
  }, []);

  const lookupEdgePhylumBreakdown = useCallback(
    (directed: boolean, source: string, target: string) => {
      if (!bundle) {
        return [];
      }
      return getEdgePhylumBreakdown(bundle, distanceThreshold, directed, source, target, {
        minPhylumSize,
        conservationPercent: averageAssociationPercent,
        normalizationMode
      });
    },
    [bundle, distanceThreshold, minPhylumSize, averageAssociationPercent, normalizationMode]
  );

  const directedPhylumBreakdown = useCallback(
    (source: string, target: string) => lookupEdgePhylumBreakdown(true, source, target),
    [lookupEdgePhylumBreakdown]
  );

  const directedEdgeMetrics = useCallback(
    (source: string, target: string) =>
      edgeMetrics.directed.get(edgeMetrics.makeKey(true, source, target)),
    [edgeMetrics]
  );

  const networkResetKey = useMemo(() => {
    if (!summary) {
      return "empty";
    }
    return [
      effectiveSelectedPhylum,
      summary.thresholdBp,
      minPhylumSize,
      averageAssociationPercent,
      genePresentAssociationPercent,
      normalizationMode,
      maxAverageGapBp,
      summary.undirected.length,
      summary.directed.length
    ].join("|");
  }, [
    summary,
    effectiveSelectedPhylum,
    minPhylumSize,
    averageAssociationPercent,
    genePresentAssociationPercent,
    normalizationMode,
    maxAverageGapBp
  ]);

  const activeNetwork = {
    title: "Directed Operon Network",
    description:
      normalizationMode === "genePresent"
        ? "Directed edges follow transcription orientation on the shared strand. Edge weight is averaged across phyla using only assemblies where both endpoint genes are present."
        : "Directed edges follow transcription orientation on the shared strand. Edge weight is the average association prevalence across eligible phyla.",
    edges: visualSummary?.directed ?? [],
    directed: true,
    downloadFilename: "operon_network_directed.svg",
    getEdgeMetrics: directedEdgeMetrics,
    getEdgePhylumBreakdown: directedPhylumBreakdown
  };

  const visibleBackboneComponents = useMemo(
    () => chooseBackboneGenePaths(activeNetwork.edges).filter((path) => path.length >= 2),
    [activeNetwork.edges]
  );

  const directionalityRows = useMemo((): DirectionalityRow[] => {
    if (!bundle) {
      return [];
    }

    const backbonePairKeys = new Set<string>();
    for (const path of visibleBackboneComponents) {
      for (let index = 0; index < path.length - 1; index += 1) {
        backbonePairKeys.add(pairKey(path[index], path[index + 1]));
      }
    }

    const visiblePairs = new Map<string, { geneA: string; geneB: string }>();
    for (const edge of activeNetwork.edges) {
      if (edge.source === edge.target) continue;
      const [geneA, geneB] = edge.source <= edge.target ? [edge.source, edge.target] : [edge.target, edge.source];
      visiblePairs.set(pairKey(geneA, geneB), { geneA, geneB });
    }

    const buildMetric = (
      label: string,
      geneA: string,
      geneB: string,
      mode: AssociationNormalizationMode
    ): DirectionalityMetric => {
      const metricOptions = {
        minPhylumSize,
        phylumId: effectiveSelectedPhylum || null,
        normalizationMode: mode
      };
      const forward = averageAssociationPercentForEdge(
        bundle,
        summary?.thresholdBp ?? distanceThreshold,
        true,
        geneA,
        geneB,
        metricOptions
      );
      const reverse = averageAssociationPercentForEdge(
        bundle,
        summary?.thresholdBp ?? distanceThreshold,
        true,
        geneB,
        geneA,
        metricOptions
      );
      const forwardPredominates = forward >= reverse;
      const predominantValue = forwardPredominates ? forward : reverse;
      const lesserValue = forwardPredominates ? reverse : forward;
      return {
        label,
        forward,
        reverse,
        predominantDirection: forwardPredominates ? `${geneA} -> ${geneB}` : `${geneB} -> ${geneA}`,
        predominantValue,
        lesserValue,
        ratio: lesserValue > 0 ? predominantValue / lesserValue : predominantValue > 0 ? Number.POSITIVE_INFINITY : 0
      };
    };

    return [...visiblePairs.entries()].map(([key, pair]) => {
      const clade = buildMetric(`>=${bundle.minFlagellarGeneCount ?? 25} genes`, pair.geneA, pair.geneB, "clade");
      const genePresent = buildMetric("Both genes present", pair.geneA, pair.geneB, "genePresent");
      const sortValue = (ratio: number) => (Number.isFinite(ratio) ? ratio : Number.MAX_SAFE_INTEGER);
      return {
        key,
        geneA: pair.geneA,
        geneB: pair.geneB,
        isBackbone: backbonePairKeys.has(key),
        clade,
        genePresent,
        sortRatio: Math.max(sortValue(clade.ratio), sortValue(genePresent.ratio))
      };
    });
  }, [
    activeNetwork.edges,
    bundle,
    distanceThreshold,
    effectiveSelectedPhylum,
    minPhylumSize,
    summary?.thresholdBp,
    visibleBackboneComponents
  ]);

  const directionalityPlotRows = useMemo(() => {
    const sortValue = (ratio: number) => (Number.isFinite(ratio) ? ratio : Number.MAX_SAFE_INTEGER);
    const selectedMetric = (row: DirectionalityRow) =>
      directionalityMode === "genePresent" ? row.genePresent : row.clade;
    return [...directionalityRows].sort((a, b) => {
      const metricA = selectedMetric(a);
      const metricB = selectedMetric(b);
      return (
        sortValue(metricB.ratio) - sortValue(metricA.ratio) ||
        metricB.predominantValue - metricA.predominantValue ||
        a.key.localeCompare(b.key)
      );
    });
  }, [directionalityMode, directionalityRows]);

  const directionalityMaxFiniteRatio = useMemo(() => {
    const ratios = directionalityPlotRows.map((row) =>
      directionalityMode === "genePresent" ? row.genePresent.ratio : row.clade.ratio
    );
    return Math.max(1, ...ratios.filter((ratio) => Number.isFinite(ratio)));
  }, [directionalityMode, directionalityPlotRows]);

  const visibleDirectedEdges = summary?.directed ?? [];
  const openPhyleticDistributionForDirectedEdges = useCallback(() => {
    if (visibleDirectedEdges.length === 0) {
      return;
    }

    const columns = Array.from(
      new Set(visibleDirectedEdges.map((edge) => operonPhyleticColumnName(edge.source, edge.target)))
    );
    const transferId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const labelParts = [
      "Visible directed operons",
      `${columns.length} edges`,
      `min ${averageAssociationPercent}% clade`,
      `min ${genePresentAssociationPercent}% both genes present`,
      normalizationMode === "genePresent" ? "gene-present normalization" : "clade prevalence normalization",
      `max avg gap ${maxAverageGapBp} bp`
    ];
    if (selectedPhylumMeta) {
      labelParts.splice(1, 0, selectedPhylumMeta.label);
    }

    window.localStorage.setItem(
      `${OPERON_PHYLETIC_TRANSFER_PREFIX}${transferId}`,
      JSON.stringify({
        version: 1,
        label: labelParts.join(" · "),
        columns
      })
    );

    const targetUrl = withBasePath(`/phyletic-distribution-visualization?operonTransfer=${encodeURIComponent(transferId)}`);
    const link = document.createElement("a");
    link.href = targetUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [
    averageAssociationPercent,
    genePresentAssociationPercent,
    normalizationMode,
    maxAverageGapBp,
    selectedPhylumMeta,
    visibleDirectedEdges
  ]);

  const runBackboneConservationScan = useCallback(async () => {
    if (visibleBackboneComponents.length === 0) {
      setBackboneScanError("Need at least one visible backbone component with two or more genes.");
      return;
    }

    setIsBackboneScanning(true);
    setBackboneScanError(null);
    setBackboneScanResult(null);
    setBackboneScanProgress({ scanned: 0, total: 0 });

    try {
      const response = await fetch(withBasePath(OPERON_PHYLETIC_DISTRIBUTION_URL));
      if (!response.ok) {
        throw new Error(`Failed to load operon phyletic distribution: HTTP ${response.status}`);
      }
      const table = parseDelimited(await response.text());
      const headerIndex = new Map(table.headers.map((header, index) => [header, index]));
      const components = visibleBackboneComponents.map((path, index) => {
        const edgeColumnGroups: string[][] = [];
        const missingEdgeColumns: string[] = [];
        for (let i = 0; i < path.length - 1; i += 1) {
          const source = path[i];
          const target = path[i + 1];
          if (activeNetwork.directed) {
            const column = operonPhyleticColumnName(source, target);
            edgeColumnGroups.push(headerIndex.has(column) ? [column] : []);
            if (!headerIndex.has(column)) {
              missingEdgeColumns.push(column);
            }
          } else {
            const forward = operonPhyleticColumnName(source, target);
            const reverse = operonPhyleticColumnName(target, source);
            const presentColumns = [forward, reverse].filter((column) => headerIndex.has(column));
            edgeColumnGroups.push(presentColumns);
            if (presentColumns.length === 0) {
              missingEdgeColumns.push(`${forward} / ${reverse}`);
            }
          }
        }
        return { index: index + 1, path, edgeColumnGroups, missingEdgeColumns };
      });

      setBackboneScanProgress({ scanned: 0, total: table.rows.length });

      const componentAccumulators = components.map((component) => ({
        ...component,
        matchedAssemblies: 0,
        speciesSet: new Set<string>(),
        exampleAssemblies: [] as string[]
      }));

      table.rows.forEach((row, rowIndex) => {
        const assembly = row.assembly ?? "";
        for (const component of componentAccumulators) {
          if (component.missingEdgeColumns.length > 0) continue;
          const hasBackbone = component.edgeColumnGroups.every((columns) =>
            columns.some((column) => Number(row[column] ?? 0) > 0)
          );
          if (!hasBackbone) continue;

          component.matchedAssemblies += 1;
          if (component.exampleAssemblies.length < 8 && assembly) {
            component.exampleAssemblies.push(assembly);
          }
          const species = row.species ?? "";
          if (species) {
            component.speciesSet.add(species);
          }
        }
        if ((rowIndex + 1) % 1000 === 0 || rowIndex === table.rows.length - 1) {
          setBackboneScanProgress({ scanned: rowIndex + 1, total: table.rows.length });
        }
      });

      const componentResults = componentAccumulators.map((component) => ({
        index: component.index,
        path: component.path,
        edgeColumnGroups: component.edgeColumnGroups,
        missingEdgeColumns: component.missingEdgeColumns,
        matchedAssemblies: component.matchedAssemblies,
        species: [...component.speciesSet].sort((a, b) => a.localeCompare(b)),
        exampleAssemblies: component.exampleAssemblies
      }));
      const calculableSpeciesSets = componentAccumulators
        .filter((component) => component.missingEdgeColumns.length === 0)
        .map((component) => component.speciesSet);
      const speciesWithAllComponents =
        calculableSpeciesSets.length > 0
          ? [...calculableSpeciesSets[0]]
              .filter((species) => calculableSpeciesSets.every((speciesSet) => speciesSet.has(species)))
              .sort((a, b) => a.localeCompare(b))
          : [];

      setBackboneScanResult({
        scannedAssemblies: table.rows.length,
        speciesWithAllComponents,
        components: componentResults
      });
    } catch (error) {
      setBackboneScanError(error instanceof Error ? error.message : "Failed to scan backbone conservation.");
    } finally {
      setIsBackboneScanning(false);
    }
  }, [activeNetwork.directed, visibleBackboneComponents]);

  return (
    <>
      <PageHeader
        className="page-header-prominent"
        title="Operon Association Summary (WIP)"
        description={
          <span className="block max-w-5xl space-y-2 text-[var(--text)]">
            <span className="block">
              This network summarizes how often pairs of flagellar genes appear as neighboring operon
              genes. A pair is counted when consecutive gene ends are on the same contig and strand within{" "}
              <span className="tabular-nums">{distanceThreshold.toLocaleString()} bp</span>.
            </span>
            <span className="block">
              Percentages are calculated within each eligible phylum, then averaged across phyla. By
              default, eligible genomes must contain &gt;={bundle?.minFlagellarGeneCount ?? 25} flagellar
              genes, and phyla where the pair is absent contribute 0%. Edge width shows the selected
              percentage metric, while the filters below control which edges are displayed.
            </span>
          </span>
        }
      />

      <div className="min-w-0 rounded-lg border border-black/10 dark:border-white/10 bg-[var(--surface)] p-4 sm:p-5 space-y-5">
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-3">
            <label htmlFor="os-max-average-gap-bp" className="text-sm font-semibold text-[var(--text)]">
              Maximum avg distance (bp)
            </label>
            <div className="flex items-center gap-3">
              <input
                id="os-max-average-gap-bp"
                type="range"
                min={0}
                max={distanceThreshold}
                step={1}
                value={maxAverageGapBp}
                onChange={(event) => setMaxAverageGapBp(Number(event.target.value))}
                className="flex-1"
                style={{ accentColor: "var(--header-bg-mid)" }}
              />
              <input
                type="number"
                min={0}
                max={distanceThreshold}
                step={1}
                value={maxAverageGapBp}
                onChange={(event) => {
                  const next = Math.round(Number(event.target.value));
                  if (Number.isFinite(next)) {
                    setMaxAverageGapBp(Math.max(0, Math.min(distanceThreshold, next)));
                  }
                }}
                className="h-9 w-20 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] px-2 text-sm text-[var(--text)] tabular-nums outline-none focus-visible:border-[var(--primary)]"
                aria-label="Maximum average distance in bp"
              />
            </div>
            <p className="text-xs text-[var(--text-soft)] m-0">
              Only show edges whose stored average intergenic distance is at most{" "}
              <span className="tabular-nums">{maxAverageGapBp.toLocaleString()} bp</span>.
            </p>
          </div>

          <div className="space-y-3">
            <label htmlFor="os-average-association-percent" className="text-sm font-semibold text-[var(--text)]">
              Minimum average association (%)
            </label>
            <div className="flex items-center gap-3">
              <input
                id="os-average-association-percent"
                type="range"
                min={0}
                max={100}
                step={1}
                value={averageAssociationPercent}
                onChange={(event) => setAverageAssociationPercent(Number(event.target.value))}
                className="flex-1"
                style={{ accentColor: "var(--header-bg-mid)" }}
              />
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={averageAssociationPercent}
                onChange={(event) => {
                  const next = Math.round(Number(event.target.value));
                  if (Number.isFinite(next)) {
                    setAverageAssociationPercent(Math.max(0, Math.min(100, next)));
                  }
                }}
                className="h-9 w-20 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] px-2 text-sm text-[var(--text)] tabular-nums outline-none focus-visible:border-[var(--primary)]"
                aria-label="Minimum average association percent"
              />
            </div>
            <p className="text-xs text-[var(--text-soft)] m-0">
              Edges must meet this average association threshold using genomes with &gt;=
              {bundle?.minFlagellarGeneCount ?? 25} flagellar genes. Phyla without the association count as 0%.
            </p>
            <div className="space-y-3 border-t border-[var(--input-border)] pt-3">
              <label htmlFor="os-gene-present-association-percent" className="text-sm font-semibold text-[var(--text)]">
                Minimum both-genes-present association (%)
              </label>
              <div className="flex items-center gap-3">
                <input
                  id="os-gene-present-association-percent"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={genePresentAssociationPercent}
                  onChange={(event) => setGenePresentAssociationPercent(Number(event.target.value))}
                  className="flex-1"
                  style={{ accentColor: "var(--header-bg-mid)" }}
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={genePresentAssociationPercent}
                  onChange={(event) => {
                    const next = Math.round(Number(event.target.value));
                    if (Number.isFinite(next)) {
                      setGenePresentAssociationPercent(Math.max(0, Math.min(100, next)));
                    }
                  }}
                  className="h-9 w-20 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] px-2 text-sm text-[var(--text)] tabular-nums outline-none focus-visible:border-[var(--primary)]"
                  aria-label="Minimum both genes present association percent"
                />
              </div>
              <p className="text-xs text-[var(--text-soft)] m-0">
                Edges must also meet this threshold when only assemblies containing both endpoint genes are counted.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold text-[var(--text)] cursor-pointer">
              <input
                type="checkbox"
                checked={hideIsolated}
                onChange={(event) => setHideIsolated(event.target.checked)}
                className="accent-[var(--primary)]"
              />
              Hide disconnected nodes
            </label>
          </div>

          <div className="space-y-3">
            <label htmlFor="os-min-phylum-size" className="text-sm font-semibold text-[var(--text)]">
              Min phylum size
            </label>
            <input
              id="os-min-phylum-size"
              type="number"
              min={1}
              max={maxPhylumSize}
              step={1}
              value={minPhylumSize}
              onChange={(event) => {
                const next = Math.round(Number(event.target.value));
                if (Number.isFinite(next)) {
                  setMinPhylumSize(Math.max(1, Math.min(maxPhylumSize, next)));
                }
              }}
              className="h-9 w-full rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--text)] tabular-nums outline-none focus-visible:border-[var(--primary)]"
              aria-label="Minimum phylum assembly count"
            />
            <button
              type="button"
              onClick={() => setAdvancedFiltersOpen((current) => !current)}
              className="h-9 rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--text-soft)] transition-colors hover:border-[var(--primary)] hover:text-[var(--text)]"
              aria-expanded={advancedFiltersOpen}
            >
              {advancedFiltersOpen ? "Hide detailed filters" : "Show detailed filters"}
            </button>
          </div>
        </div>

        {advancedFiltersOpen ? (
        <div className="space-y-3">
          <label htmlFor="os-phylum-filter" className="text-sm font-semibold text-[var(--text)]">
            Phylum focus (optional)
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <select
              id="os-phylum-filter"
              value={effectiveSelectedPhylum}
              onChange={(event) => setSelectedPhylum(event.target.value)}
              className="h-9 min-w-[16rem] flex-1 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--text)] outline-none focus-visible:border-[var(--primary)]"
            >
              <option value="">All phyla (global)</option>
              {phylumOptions.map((phylum) => (
                <option key={phylum.id} value={phylum.id}>
                  {phylum.label} ({phylum.assembliesWithCoords.toLocaleString()} assemblies)
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-[var(--text-soft)] m-0 tabular-nums">
            {phylumOptions.length.toLocaleString()} phyla with at least {minPhylumSize.toLocaleString()}{" "}
            assemblies with operon coords.
          </p>
          <p className="text-xs text-[var(--text-soft)] m-0">
            {selectedPhylumMeta
              ? `Showing operon edges from ${selectedPhylumMeta.label} only. Click any edge to see which phyla most often show that relationship (% of each phylum's assemblies).`
              : "Global view across all phyla. Click any edge to see phylum prevalence (% of each phylum's assemblies with that edge)."}
            {" "}Only phyla meeting the minimum size are included in the dropdown and edge breakdown.
          </p>
        </div>
        ) : null}

        {advancedFiltersOpen ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold text-[var(--text)] m-0">Gene filter (optional)</p>
            <label className="flex items-center gap-2 text-xs font-semibold text-[var(--text)] cursor-pointer">
              <input
                type="checkbox"
                checked={filterToSelectedGenes}
                onChange={(event) => setFilterToSelectedGenes(event.target.checked)}
                className="accent-[var(--primary)]"
              />
              Limit networks to selected genes
            </label>
            <button
              type="button"
              className="h-8 rounded-md border border-transparent px-2 text-xs font-semibold text-[var(--primary)] transition-colors hover:border-[var(--input-border)] hover:bg-[var(--surface)]"
              onClick={selectAllGenes}
            >
              Select all
            </button>
            <button
              type="button"
              className="h-8 rounded-md border border-transparent px-2 text-xs font-semibold text-[var(--text-soft)] transition-colors hover:border-[var(--input-border)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
              onClick={clearGeneSelection}
            >
              Clear
            </button>
            <span className="text-xs text-[var(--text-soft)] tabular-nums">
              {selectedGenes.length} / {geneNames.length} selected
            </span>
          </div>
          <input
            type="search"
            value={geneSearch}
            onChange={(event) => setGeneSearch(event.target.value)}
            placeholder="Search genes…"
            className="h-9 w-full rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--text)] outline-none focus-visible:border-[var(--primary)]"
          />
          <div className="max-h-40 overflow-y-auto rounded-md border border-[var(--input-border)] p-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1">
            {filteredGeneOptions.map((gene) => (
              <label
                key={gene}
                className={cn(
                  "flex items-center gap-2 text-xs text-[var(--text)] cursor-pointer rounded px-1 py-0.5 hover:bg-black/5 dark:hover:bg-white/5"
                )}
              >
                <input
                  type="checkbox"
                  checked={selectedGenes.includes(gene)}
                  onChange={(event) => toggleGeneSelection(gene, event.target.checked)}
                  className="accent-[var(--primary)] shrink-0"
                />
                <span className="truncate">{gene}</span>
              </label>
            ))}
          </div>
        </div>
        ) : null}

        {loadError ? (
          <p className="text-sm text-red-600 dark:text-red-400 m-0" role="alert">
            Failed to load gene list: {loadError}
          </p>
        ) : null}
        {fetchError ? (
          <p className="text-sm text-red-600 dark:text-red-400 m-0" role="alert">
            {fetchError}. Build the data with{" "}
            <code className="text-xs">node scripts/operon-summary/build-operon-cache.mjs</code> then{" "}
            <code className="text-xs">node scripts/operon-summary/build-operon-associations.mjs</code>.
          </p>
        ) : null}

      </div>

      <div className="space-y-4 mt-6">
        <OperonAssociationNetworkGraph
          title={activeNetwork.title}
          description={activeNetwork.description}
          edges={activeNetwork.edges}
          geneNeighborCounts={visualSummary?.geneNeighborCounts ?? {}}
          directed={activeNetwork.directed}
          isDarkMode={isDarkMode}
          minCount={averageAssociationPercent}
          hideIsolated={hideIsolated}
          layoutMode={layoutMode}
          serpentineGenesPerRow={serpentineGenesPerRow}
          networkResetKey={`${layoutMode}|${serpentineGenesPerRow}|directed|${networkResetKey}`}
          downloadFilename={activeNetwork.downloadFilename}
          controls={
            <div className="flex shrink-0 items-end gap-3">
              <div className="flex flex-col items-center gap-2">
                <p className="m-0 w-full text-center text-xs font-semibold text-[var(--text-soft)]">
                  Network Style Options
                </p>
                <div className="flex items-center justify-center gap-2">
                  <div
                    className="inline-flex h-9 shrink-0 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] p-0.5"
                    role="group"
                    aria-label="Network layout"
                  >
                    {(["backbone", "serpentine", "force"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setLayoutMode(mode)}
                        className={cn(
                          "whitespace-nowrap rounded px-3 text-xs font-semibold transition-colors hover:bg-[var(--dropdown-hover)]",
                          layoutMode === mode
                            ? "bg-[var(--nav-hover-bg)] text-[var(--text)] shadow-xs"
                            : "text-[var(--text-soft)] hover:text-[var(--text)]"
                        )}
                        aria-pressed={layoutMode === mode}
                      >
                        {mode === "force" ? "Force" : mode === "serpentine" ? "Snake" : "Operon backbone"}
                      </button>
                    ))}
                  </div>
                  {layoutMode === "serpentine" ? (
                    <label className="flex h-9 shrink-0 items-center gap-2 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] px-2 text-xs font-semibold text-[var(--text-soft)]">
                      <span>Wrap</span>
                      <select
                        value={String(serpentineGenesPerRow)}
                        onChange={(event) => {
                          const value = event.target.value;
                          setSerpentineGenesPerRow(value === "auto" ? "auto" : Number(value));
                        }}
                        className="h-7 rounded border border-[var(--input-border)] bg-[var(--surface)] px-1 text-xs text-[var(--text)] outline-none focus-visible:border-[var(--primary)]"
                        aria-label="Snake genes per row"
                      >
                        <option value="auto">Auto</option>
                        {[4, 5, 6, 8, 10, 12].map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-col items-center gap-2">
                <span className="w-full text-center text-xs font-semibold text-[var(--text-soft)]">
                  Edge Width
                </span>
                <div
                  className="inline-flex h-9 shrink-0 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] p-0.5"
                  role="group"
                  aria-label="Graph edge width normalization"
                >
                  {([
                    ["clade", `Genomes with >=${bundle?.minFlagellarGeneCount ?? 25} genes`],
                    ["genePresent", "Both genes present"]
                  ] as const).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setNormalizationMode(mode)}
                      className={cn(
                        "whitespace-nowrap rounded px-3 text-xs font-semibold transition-colors hover:bg-[var(--dropdown-hover)]",
                        normalizationMode === mode
                          ? "bg-[var(--nav-hover-bg)] text-[var(--text)] shadow-xs"
                          : "text-[var(--text-soft)] hover:text-[var(--text)]"
                      )}
                      aria-pressed={normalizationMode === mode}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          }
          onOpenPhyleticDistribution={openPhyleticDistributionForDirectedEdges}
          canOpenPhyleticDistribution={visibleDirectedEdges.length > 0}
          normalizationMode={normalizationMode}
          cladeNormalizationLabel={`Genomes with >=${bundle?.minFlagellarGeneCount ?? 25} genes`}
          getEdgeMetrics={activeNetwork.getEdgeMetrics}
          getEdgePhylumBreakdown={activeNetwork.getEdgePhylumBreakdown}
        />

        <section className="min-w-0 rounded-lg border border-black/10 dark:border-white/10 bg-[var(--dialog-bg)] p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="m-0 text-lg font-semibold text-[var(--text)]">Exact Backbone Conservation</h2>
              <p className="m-0 mt-1 max-w-4xl text-xs text-[var(--text-soft)]">
                Checks the operon phyletic distribution table for each disconnected visible backbone component.
                A component match means every adjacent backbone edge column has count &gt; 0 in that assembly.
                Uses the filtered <code>operon_phyletic_distribution_min500.tsv</code> file.
              </p>
            </div>
            <button
              type="button"
              onClick={runBackboneConservationScan}
              disabled={isBackboneScanning || visibleBackboneComponents.length === 0}
              className="h-9 shrink-0 rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--text-soft)] transition-colors hover:border-[var(--primary)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isBackboneScanning ? "Scanning..." : "Check phyletic table"}
            </button>
          </div>

          <div className="rounded-md border border-[var(--input-border)] bg-[var(--surface)] p-3">
            <p className="m-0 text-xs font-semibold text-[var(--text-soft)]">Backbone being tested</p>
            <div className="mt-1 space-y-1">
              {visibleBackboneComponents.length > 0 ? (
                visibleBackboneComponents.map((path, index) => (
                  <p key={`${index}-${path.join("-")}`} className="m-0 break-words text-sm font-semibold text-[var(--text)]">
                    Component {index + 1}: {path.join(" -> ")}
                  </p>
                ))
              ) : (
                <p className="m-0 text-sm font-semibold text-[var(--text)]">No visible backbone available</p>
              )}
            </div>
          </div>

          {isBackboneScanning ? (
            <div className="space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                <div
                  className="h-full rounded-full bg-[var(--primary)] transition-[width]"
                  style={{
                    width:
                      backboneScanProgress.total > 0
                        ? `${Math.round((100 * backboneScanProgress.scanned) / backboneScanProgress.total)}%`
                        : "0%"
                  }}
                />
              </div>
              <p className="m-0 text-xs text-[var(--text-soft)] tabular-nums">
                Scanned {backboneScanProgress.scanned.toLocaleString()} /{" "}
                {backboneScanProgress.total.toLocaleString()} assemblies.
              </p>
            </div>
          ) : null}

          {backboneScanError ? (
            <p className="m-0 text-sm text-red-600 dark:text-red-400" role="alert">
              {backboneScanError}
            </p>
          ) : null}

          {backboneScanResult ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                {[
                  ["Backbone components", backboneScanResult.components.length],
                  ["Assemblies scanned", backboneScanResult.scannedAssemblies],
                  ["Best component matches", Math.max(0, ...backboneScanResult.components.map((component) => component.matchedAssemblies))],
                  [
                    "Best species matches",
                    Math.max(0, ...backboneScanResult.components.map((component) => component.species.length))
                  ],
                  [
                    "Species with all components",
                    backboneScanResult.speciesWithAllComponents.length
                  ]
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border border-[var(--input-border)] bg-[var(--surface)] p-3">
                    <p className="m-0 text-xs font-semibold text-[var(--text-soft)]">{label}</p>
                    <p className="m-0 mt-1 text-2xl font-semibold text-[var(--text)] tabular-nums">
                      {Number(value).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>

              <article className="rounded-md border border-[var(--input-border)] bg-[var(--surface)] p-3">
                <p className="m-0 text-sm font-semibold text-[var(--text)]">
                  Species with all visible backbone components
                </p>
                <p className="m-0 mt-1 text-xs text-[var(--text-soft)]">
                  Species must match every disconnected backbone component shown above.
                </p>
                <div className="mt-3 max-h-56 overflow-auto rounded-md border border-[var(--input-border)] bg-[var(--dialog-bg)] p-2 text-xs text-[var(--text)]">
                  {backboneScanResult.speciesWithAllComponents.length > 0 ? (
                    <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                      {backboneScanResult.speciesWithAllComponents.map((species) => (
                        <span key={`all-components-${species}`} className="min-w-0 truncate" title={species}>
                          {species}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="m-0 text-[var(--text-soft)]">No species match all visible components.</p>
                  )}
                </div>
              </article>

              <div className="space-y-3">
                {backboneScanResult.components.map((component) => (
                  <article key={component.index} className="rounded-md border border-[var(--input-border)] bg-[var(--surface)] p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="m-0 text-sm font-semibold text-[var(--text)]">
                          Component {component.index}: {component.path.join(" -> ")}
                        </p>
                        <p className="m-0 mt-1 text-xs text-[var(--text-soft)]">
                          Required edge columns:{" "}
                          {component.edgeColumnGroups
                            .map((columns) => (columns.length > 0 ? columns.join(" / ") : "missing from filtered file"))
                            .join(", ")}
                        </p>
                        {component.missingEdgeColumns.length > 0 ? (
                          <p className="m-0 mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
                            Cannot verify exact matches from the filtered table; missing{" "}
                            {component.missingEdgeColumns.join(", ")}.
                          </p>
                        ) : null}
                      </div>
                      <strong className="text-lg text-[var(--text)] tabular-nums">
                        {component.matchedAssemblies.toLocaleString()} assemblies
                      </strong>
                    </div>

                    <div className="mt-3">
                      <p className="m-0 text-xs font-semibold text-[var(--text-soft)]">
                        Matching species ({component.species.length.toLocaleString()})
                      </p>
                      <div className="mt-2 max-h-48 overflow-auto rounded-md border border-[var(--input-border)] bg-[var(--dialog-bg)] p-2 text-xs text-[var(--text)]">
                        {component.species.length > 0 ? (
                          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                            {component.species.map((species) => (
                              <span key={`${component.index}-${species}`} className="min-w-0 truncate" title={species}>
                                {species}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="m-0 text-[var(--text-soft)]">No matching species found.</p>
                        )}
                      </div>
                    </div>

                    {component.exampleAssemblies.length > 0 ? (
                      <p className="m-0 mt-3 text-xs text-[var(--text-soft)]">
                        Example assemblies: {component.exampleAssemblies.join(", ")}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="min-w-0 rounded-lg border border-black/10 dark:border-white/10 bg-[var(--dialog-bg)] p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="m-0 text-lg font-semibold text-[var(--text)]">Association Directionality</h2>
              <p className="m-0 mt-1 max-w-4xl text-xs text-[var(--text-soft)]">
                X-axis shows currently visualized gene pairs. Y-axis shows the ratio of the dominant direction
                divided by the less observed reverse direction, ordered from highest ratio to lowest.
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <div
                className="inline-flex h-9 shrink-0 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] p-0.5"
                role="group"
                aria-label="Directionality ratio normalization"
              >
                {([
                  ["clade", `Genomes with >=${bundle?.minFlagellarGeneCount ?? 25} genes`],
                  ["genePresent", "Both genes present"]
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setDirectionalityMode(mode)}
                    className={cn(
                      "whitespace-nowrap rounded px-3 text-xs font-semibold transition-colors hover:bg-[var(--dropdown-hover)]",
                      directionalityMode === mode
                        ? "bg-[var(--nav-hover-bg)] text-[var(--text)] shadow-xs"
                        : "text-[var(--text-soft)] hover:text-[var(--text)]"
                    )}
                    aria-pressed={directionalityMode === mode}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {directionalityPlotRows.length > 0 ? (
            <DirectionalityRatioBarPlot
              rows={directionalityPlotRows}
              maxFiniteRatio={directionalityMaxFiniteRatio}
              mode={directionalityMode}
              minFlagellarGeneCount={bundle?.minFlagellarGeneCount ?? 25}
            />
          ) : (
            <p className="m-0 rounded-md border border-[var(--input-border)] bg-[var(--surface)] p-3 text-sm text-[var(--text-soft)]">
              No visible associations are available for directionality analysis.
            </p>
          )}
        </section>
      </div>
    </>
  );
}

