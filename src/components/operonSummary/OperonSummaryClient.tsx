"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  applyAverageAssociationSummary,
  filterPhylaByMinSize,
  getEdgePhylumBreakdown,
  pickPhylumSummary,
  type OperonAssociationSummary,
  type OperonAssociationsBundle,
  type PhylumMeta
} from "@/lib/operonSummary/operonAssociationsCore";
import { cn } from "@/lib/utils";

const DATA_URL = "/flagellar_genes_phyletic_distribution.tsv";
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

function normalizeGeneQuery(value: string): string {
  return value.toLowerCase().trim();
}

function formatAverageGapBp(averageGapBp: number | undefined): string | null {
  if (typeof averageGapBp !== "number" || !Number.isFinite(averageGapBp)) {
    return null;
  }
  return `${Math.round(averageGapBp).toLocaleString()} bp`;
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

export default function OperonSummaryClient() {
  const [parsed, setParsed] = useState<ParsedTable | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedGenes, setSelectedGenes] = useState<string[]>([]);
  const [geneSearch, setGeneSearch] = useState("");
  const distanceThreshold = DEFAULT_DISTANCE_THRESHOLD_BP;
  const [averageAssociationPercent, setAverageAssociationPercent] = useState(
    DEFAULT_AVERAGE_ASSOCIATION_PERCENT
  );
  const [maxAverageGapBp, setMaxAverageGapBp] = useState(DEFAULT_DISTANCE_THRESHOLD_BP);
  const [hideIsolated, setHideIsolated] = useState(false);
  const [filterToSelectedGenes, setFilterToSelectedGenes] = useState(false);
  const [selectedPhylum, setSelectedPhylum] = useState<string>("");
  const [minPhylumSize, setMinPhylumSize] = useState(DEFAULT_MIN_PHYLUM_SIZE);
  const [bundle, setBundle] = useState<OperonAssociationsBundle | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [networkMode, setNetworkMode] = useState<"directed" | "undirected">("directed");
  const [layoutMode, setLayoutMode] = useState<"force" | "backbone">("backbone");

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
          edgePhylumByThreshold: payload.edgePhylumByThreshold ?? {}
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
      } finally {
        if (!cancelled) {
          setLoading(false);
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

  const eligiblePhylaCount = useMemo(() => {
    return filterPhylaByMinSize(bundle?.phyla ?? [], minPhylumSize).length;
  }, [bundle, minPhylumSize]);

  const summary = useMemo((): OperonAssociationSummary | null => {
    if (!averageSummaryBase) {
      return null;
    }
    return filterSummaryByMaxAverageGap(averageSummaryBase, maxAverageGapBp);
  }, [averageSummaryBase, maxAverageGapBp]);

  const edgeFilterPreview = useMemo(() => {
    if (!baseSummary || !summary) {
      return null;
    }
    return {
      undirectedShown: summary.undirected.length,
      undirectedTotal: baseSummary.undirected.length,
      directedShown: summary.directed.length,
      directedTotal: baseSummary.directed.length
    };
  }, [baseSummary, summary]);

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
        conservationPercent: averageAssociationPercent
      });
    },
    [bundle, distanceThreshold, minPhylumSize, averageAssociationPercent]
  );

  const undirectedPhylumBreakdown = useCallback(
    (source: string, target: string) => lookupEdgePhylumBreakdown(false, source, target),
    [lookupEdgePhylumBreakdown]
  );

  const directedPhylumBreakdown = useCallback(
    (source: string, target: string) => lookupEdgePhylumBreakdown(true, source, target),
    [lookupEdgePhylumBreakdown]
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
      maxAverageGapBp,
      summary.undirected.length,
      summary.directed.length
    ].join("|");
  }, [summary, effectiveSelectedPhylum, minPhylumSize, averageAssociationPercent, maxAverageGapBp]);

  const topUndirected = summary?.undirected.slice(0, 12) ?? [];
  const topDirected = summary?.directed.slice(0, 12) ?? [];
  const activeNetwork =
    networkMode === "directed"
      ? {
          title: "Directed Operon Network",
          description:
            "Directed edges follow transcription orientation on the shared strand. Edge weight is average association prevalence across eligible phyla.",
          edges: summary?.directed ?? [],
          directed: true,
          downloadFilename: "operon_network_directed.svg",
          getEdgePhylumBreakdown: directedPhylumBreakdown
        }
      : {
          title: "Undirected Operon Network",
          description:
            "Consecutive genes are linked when they appear on the same contig and strand within the distance threshold, regardless of order. Edge weight is average association prevalence across eligible phyla.",
          edges: summary?.undirected ?? [],
          directed: false,
          downloadFilename: "operon_network_undirected.svg",
          getEdgePhylumBreakdown: undirectedPhylumBreakdown
        };

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
      `min ${averageAssociationPercent}%`,
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
    maxAverageGapBp,
    selectedPhylumMeta,
    visibleDirectedEdges
  ]);

  return (
    <>
      <PageHeader
        className="page-header-prominent"
        title="Operon Association Summary (WIP)"
        description={
          <span className="text-[var(--text)]">
            Summarize flagellar gene neighborhood relationships across all assemblies in{" "}
            <code className="text-sm">public/operon_coords</code>. Consecutive genes on the same contig
            and strand within the distance threshold are treated as operon neighbors. Data is loaded from
            a static JSON bundle built locally — this page is not linked from the site navigation.
          </span>
        }
      />

      <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-[var(--surface)] p-5 sm:p-6 space-y-6">
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-3">
            <p className="text-sm font-semibold text-[var(--text)] m-0">
              Intergenic distance threshold (bp)
            </p>
            <p className="text-sm font-semibold text-[var(--text)] tabular-nums m-0">
              {distanceThreshold.toLocaleString()} bp
            </p>
            <p className="text-xs text-[var(--text-soft)] m-0">
              Maximum gap between consecutive gene ends on the same contig and strand (default 500 bp).
              The generated bundle is built only for this threshold.
            </p>
          </div>

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
                className="w-20 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-sm text-[var(--text)] tabular-nums outline-none focus-visible:border-[var(--primary)]"
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
                className="w-20 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-sm text-[var(--text)] tabular-nums outline-none focus-visible:border-[var(--primary)]"
                aria-label="Minimum average association percent"
              />
            </div>
            <p className="text-xs text-[var(--text-soft)] m-0">
              Edge weight is the average percentage of assemblies showing the association across eligible
              phyla. Phyla without the association count as 0% in the average.
            </p>
            {edgeFilterPreview ? (
              <p className="text-xs text-[var(--text-soft)] m-0 tabular-nums">
                {edgeFilterPreview.undirectedShown.toLocaleString()} /{" "}
                {edgeFilterPreview.undirectedTotal.toLocaleString()} undirected edges ·{" "}
                {edgeFilterPreview.directedShown.toLocaleString()} /{" "}
                {edgeFilterPreview.directedTotal.toLocaleString()} directed edges
              </p>
            ) : null}
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
        </div>

        <div className="space-y-3">
          <label htmlFor="os-phylum-filter" className="text-sm font-semibold text-[var(--text)]">
            Phylum focus (optional)
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <select
              id="os-phylum-filter"
              value={effectiveSelectedPhylum}
              onChange={(event) => setSelectedPhylum(event.target.value)}
              className="min-w-[16rem] flex-1 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text)] outline-none focus-visible:border-[var(--primary)]"
            >
              <option value="">All phyla (global)</option>
              {phylumOptions.map((phylum) => (
                <option key={phylum.id} value={phylum.id}>
                  {phylum.label} ({phylum.assembliesWithCoords.toLocaleString()} assemblies)
                </option>
              ))}
            </select>
            <label htmlFor="os-min-phylum-size" className="text-xs font-semibold text-[var(--text-soft)]">
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
              className="w-20 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-sm text-[var(--text)] tabular-nums outline-none focus-visible:border-[var(--primary)]"
              aria-label="Minimum phylum assembly count"
            />
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
              className="text-xs font-semibold text-[var(--primary)] hover:underline"
              onClick={selectAllGenes}
            >
              Select all
            </button>
            <button
              type="button"
              className="text-xs font-semibold text-[var(--text-soft)] hover:underline"
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
            className="w-full rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text)] outline-none focus-visible:border-[var(--primary)]"
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

        <div className="rounded-xl border border-black/10 dark:border-white/10 bg-[var(--dialog-bg)] px-4 py-3 text-xs text-[var(--text-soft)] space-y-1">
          {!bundle && !loading && !fetchError ? (
            <p className="m-0 text-[var(--text)]">
              No association bundle found. Run{" "}
              <code className="text-xs">node scripts/operon-summary/build-operon-cache.mjs</code> then{" "}
              <code className="text-xs">node scripts/operon-summary/build-operon-associations.mjs</code>.
            </p>
          ) : null}
          <p className="m-0">
            {loading
              ? "Loading operon association bundle…"
              : summary
                ? `${selectedPhylumMeta ? `${selectedPhylumMeta.label}: ` : ""}${summary.assembliesWithCoords.toLocaleString()} assemblies with operon coords. ${summary.pairOccurrences.toLocaleString()} neighbor instances within ${summary.thresholdBp.toLocaleString()} bp.`
                : "Waiting for operon association data…"}
          </p>
          {bundle?.scannedAt ? (
            <p className="m-0 tabular-nums">
              Bundle built {new Date(bundle.scannedAt).toLocaleString()}. Threshold:{" "}
              {distanceThreshold.toLocaleString()} bp.
            </p>
          ) : null}
        </div>

        {summary && topUndirected.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="text-sm font-semibold text-[var(--text)] mb-2">Top undirected pairs</p>
              <ul className="text-xs text-[var(--text-soft)] space-y-1 m-0 p-0 list-none">
                {topUndirected.map((edge) => (
                  <li key={`${edge.source}-${edge.target}`} className="tabular-nums">
                    {edge.source} ↔ {edge.target}: {edge.count.toFixed(1)}% average
                    {formatAverageGapBp(edge.averageGapBp)
                      ? ` · avg distance ${formatAverageGapBp(edge.averageGapBp)}`
                      : ""}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--text)] mb-2">Top directed pairs</p>
              <ul className="text-xs text-[var(--text-soft)] space-y-1 m-0 p-0 list-none">
                {topDirected.map((edge) => (
                  <li key={`${edge.source}-${edge.target}`} className="tabular-nums">
                    {edge.source} → {edge.target}: {edge.count.toFixed(1)}% average
                    {formatAverageGapBp(edge.averageGapBp)
                      ? ` · avg distance ${formatAverageGapBp(edge.averageGapBp)}`
                      : ""}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </div>

      <div className="space-y-4 mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/10 dark:border-white/10 bg-[var(--dialog-bg)] px-4 py-3 sm:px-5">
          <p className="text-sm font-semibold text-[var(--text)] m-0">Network view</p>
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="inline-flex rounded-lg border border-black/10 dark:border-white/10 bg-[var(--surface)] p-1"
              role="group"
              aria-label="Network layout"
            >
              {(["force", "backbone"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setLayoutMode(mode)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                    layoutMode === mode
                      ? "bg-[var(--primary)] text-white shadow-sm"
                      : "text-[var(--text-soft)] hover:text-[var(--text)]"
                  )}
                  aria-pressed={layoutMode === mode}
                >
                  {mode === "force" ? "Force" : "Operon backbone"}
                </button>
              ))}
            </div>
            <div
              className="inline-flex rounded-lg border border-black/10 dark:border-white/10 bg-[var(--surface)] p-1"
              role="group"
              aria-label="Network direction"
            >
              {(["directed", "undirected"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setNetworkMode(mode)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                    networkMode === mode
                      ? "bg-[var(--primary)] text-white shadow-sm"
                      : "text-[var(--text-soft)] hover:text-[var(--text)]"
                  )}
                  aria-pressed={networkMode === mode}
                >
                  {mode === "directed" ? "Directed" : "Undirected"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <OperonAssociationNetworkGraph
          title={activeNetwork.title}
          description={activeNetwork.description}
          edges={activeNetwork.edges}
          geneNeighborCounts={summary?.geneNeighborCounts ?? {}}
          directed={activeNetwork.directed}
          isDarkMode={isDarkMode}
          minCount={averageAssociationPercent}
          hideIsolated={hideIsolated}
          layoutMode={layoutMode}
          networkResetKey={`${layoutMode}|${networkMode}|${networkResetKey}`}
          downloadFilename={activeNetwork.downloadFilename}
          onOpenPhyleticDistribution={openPhyleticDistributionForDirectedEdges}
          canOpenPhyleticDistribution={visibleDirectedEdges.length > 0}
          getEdgePhylumBreakdown={activeNetwork.getEdgePhylumBreakdown}
        />
      </div>
    </>
  );
}
