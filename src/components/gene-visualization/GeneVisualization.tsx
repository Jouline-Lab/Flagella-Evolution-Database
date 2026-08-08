"use client";

import React, { useEffect, useState } from "react";
import { useGeneVisualization } from "@/hooks/useGeneVisualization";
import { withBasePath } from "@/lib/assetPaths";
import { DATASET_TREE_FILE } from "@/lib/visualization/config";
import { ControlPanel } from "./ControlPanel";
import { GeneSelectionSidebar } from "./GeneSelectionSidebar";
import { VisualizationCanvas } from "./VisualizationCanvas";
import { Loader2 } from "lucide-react";

/**
 * Minimum height (px) of the plot card only while `isLoading` is true, so the
 * spinner stays inside the visualization panel. After load this is unset and
 * the chart sets the height naturally—adjust this value if you want a taller
 * or shorter loading area.
 */
const VIZ_PANEL_MIN_HEIGHT_WHILE_LOADING_PX = 395;
const OPERON_PHYLETIC_TRANSFER_PREFIX = "operon-phyletic-transfer:";
const OPERON_PHYLETIC_TSV_URL = "/operon-summary/operon_phyletic_distribution_min500.tsv";
const OPERON_PHYLETIC_METADATA_COLUMNS = [
  "assembly",
  "domain",
  "phylum",
  "class",
  "order",
  "family",
  "genus",
  "species"
];

type OperonPhyleticTransferPayload = {
  version: 1;
  label: string;
  columns: string[];
  sourceUrl?: string;
  sourceFormat?: "tsv" | "sparse-association-v1";
  customDataKind?: "operon" | "insertion";
  displayNames?: Record<string, string>;
  backboneColumns?: string[];
  alternativeColumns?: string[];
  columnMetrics?: OperonColumnMetricPayload[];
};

function operonColumnDisplayName(column: string, displayNames?: Record<string, string>): string {
  return displayNames?.[column] ?? column.replace(/_to_/, "→");
}

type OperonColumnMetricPayload = {
  column: string;
  source: string;
  target: string;
  role: "backbone" | "alternative";
  mainTarget?: string;
  direction?: string;
  sourceType?: "kegg" | "pfam";
  count?: number;
  occurrencePercent?: number;
  meanDistanceBp?: number;
  cladeAveragePercent: number;
  genePresentAveragePercent: number;
};

export type OperonRugTooltipStats = {
  source: string;
  target: string;
  role: "backbone" | "alternative";
  mainTarget?: string;
  direction?: string;
  sourceType?: "kegg" | "pfam";
  count?: number;
  occurrencePercent?: number;
  meanDistanceBp?: number;
  cladeAveragePercent: number;
  genePresentAveragePercent: number;
  missingMainTargetAlternativeCount?: number;
  missingMainTargetGenomeCount?: number;
  missingMainTargetAlternativePercent?: number;
  alternativeCount?: number;
  alternativeWithMainTargetMissingCount?: number;
  alternativeWithMainTargetMissingPercent?: number;
};

type SparseInsertionPhyleticBundle = {
  schemaVersion: 1;
  assemblies: string[];
  associations: Record<string, Array<[number, number]>>;
};

function filterTsvColumns(
  tsvText: string,
  requestedColumns: string[],
  displayNames?: Record<string, string>
): { text: string; foundColumns: string[]; missingColumns: string[] } {
  const lines = tsvText.replace(/\r/g, "").split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new Error("Operon phyletic TSV is empty.");
  }

  const headers = lines[0].split("\t");
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const requestedUnique = Array.from(new Set(requestedColumns));
  const foundColumns = requestedUnique.filter((column) => headerIndex.has(column));
  const missingColumns = requestedUnique.filter((column) => !headerIndex.has(column));
  if (foundColumns.length === 0) {
    throw new Error("None of the visible directed operon edges were found in the operon phyletic TSV.");
  }

  const keepColumns = [
    ...OPERON_PHYLETIC_METADATA_COLUMNS.filter((column) => headerIndex.has(column)),
    ...foundColumns
  ];
  const keepIndexes = keepColumns.map((column) => headerIndex.get(column) ?? -1);
  const outputHeaders = [
    ...OPERON_PHYLETIC_METADATA_COLUMNS.filter((column) => headerIndex.has(column)),
    ...foundColumns.map((column) => operonColumnDisplayName(column, displayNames))
  ];
  const outputLines = [outputHeaders.join("\t")];

  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split("\t");
    outputLines.push(keepIndexes.map((index) => parts[index] ?? "").join("\t"));
  }

  return {
    text: outputLines.join("\n"),
    foundColumns,
    missingColumns
  };
}

function materializeSparseInsertionTsv(
  bundle: SparseInsertionPhyleticBundle,
  requestedColumns: string[],
  displayNames?: Record<string, string>
): { text: string; foundColumns: string[]; missingColumns: string[] } {
  const requestedUnique = Array.from(new Set(requestedColumns));
  const foundColumns = requestedUnique.filter((column) => Array.isArray(bundle.associations[column]));
  const missingColumns = requestedUnique.filter((column) => !Array.isArray(bundle.associations[column]));
  if (foundColumns.length === 0) {
    throw new Error("None of the visible directed insertion associations were found in the insertion phyletic bundle.");
  }

  const countRows = Array.from({ length: bundle.assemblies.length }, () =>
    new Array(foundColumns.length).fill(0)
  );
  foundColumns.forEach((column, columnIndex) => {
    for (const [assemblyIndex, count] of bundle.associations[column] ?? []) {
      if (assemblyIndex >= 0 && assemblyIndex < countRows.length) {
        countRows[assemblyIndex][columnIndex] = count;
      }
    }
  });

  const outputLines = [
    ["assembly", ...foundColumns.map((column) => operonColumnDisplayName(column, displayNames))].join("\t")
  ];
  for (let index = 0; index < bundle.assemblies.length; index += 1) {
    outputLines.push([bundle.assemblies[index], ...countRows[index]].join("\t"));
  }

  return {
    text: outputLines.join("\n"),
    foundColumns,
    missingColumns
  };
}

function parseTsvRows(tsvText: string): { headers: string[]; rows: string[][] } {
  const lines = tsvText.replace(/\r/g, "").split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }
  return {
    headers: lines[0].split("\t"),
    rows: lines.slice(1).map((line) => line.split("\t"))
  };
}

function buildOperonRugTooltipStats(
  tsvText: string,
  metrics: OperonColumnMetricPayload[],
  defaultCountMap: Map<string, Record<string, number>>,
  displayNames?: Record<string, string>
): Record<string, OperonRugTooltipStats> {
  const { headers, rows } = parseTsvRows(tsvText);
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const assemblyIndex = headerIndex.get("assembly") ?? 0;
  const tooltipStats: Record<string, OperonRugTooltipStats> = {};

  for (const metric of metrics) {
    const displayColumn = operonColumnDisplayName(metric.column, displayNames);
    const stats: OperonRugTooltipStats = {
      source: metric.source,
      target: metric.target,
      role: metric.role,
      mainTarget: metric.mainTarget,
      direction: metric.direction,
      sourceType: metric.sourceType,
      count: metric.count,
      occurrencePercent: metric.occurrencePercent,
      meanDistanceBp: metric.meanDistanceBp,
      cladeAveragePercent: metric.cladeAveragePercent,
      genePresentAveragePercent: metric.genePresentAveragePercent
    };

    const edgeIndex = headerIndex.get(metric.column);
    if (
      metric.role === "alternative" &&
      metric.mainTarget &&
      metric.source !== metric.target &&
      edgeIndex != null
    ) {
      const mainTargetColumn = `${metric.mainTarget}_count`;
      let missingMainTargetGenomeCount = 0;
      let missingMainTargetAlternativeCount = 0;
      let alternativeCount = 0;
      let alternativeWithMainTargetMissingCount = 0;

      for (const row of rows) {
        const assembly = row[assemblyIndex] ?? "";
        const defaultCounts = defaultCountMap.get(assembly);
        if (!defaultCounts) continue;
        const hasAlternative = (Number(row[edgeIndex] ?? 0) || 0) > 0;
        const mainTargetMissing = (defaultCounts[mainTargetColumn] ?? 0) <= 0;

        if (hasAlternative) {
          alternativeCount += 1;
          if (mainTargetMissing) {
            alternativeWithMainTargetMissingCount += 1;
          }
        }
        if (mainTargetMissing) {
          missingMainTargetGenomeCount += 1;
          if (hasAlternative) {
            missingMainTargetAlternativeCount += 1;
          }
        }
      }

      stats.missingMainTargetGenomeCount = missingMainTargetGenomeCount;
      stats.missingMainTargetAlternativeCount = missingMainTargetAlternativeCount;
      stats.missingMainTargetAlternativePercent =
        missingMainTargetGenomeCount > 0
          ? (100 * missingMainTargetAlternativeCount) / missingMainTargetGenomeCount
          : 0;
      stats.alternativeCount = alternativeCount;
      stats.alternativeWithMainTargetMissingCount = alternativeWithMainTargetMissingCount;
      stats.alternativeWithMainTargetMissingPercent =
        alternativeCount > 0 ? (100 * alternativeWithMainTargetMissingCount) / alternativeCount : 0;
    }

    tooltipStats[displayColumn] = stats;
  }

  return tooltipStats;
}

function LoadingOverlay({
  isLoading,
  message
}: {
  isLoading: boolean;
  message: string;
}) {
  if (!isLoading) return null;

  return (
    <div className="absolute inset-0 overflow-hidden rounded-lg backdrop-blur-sm bg-white/80 loading-overlay flex items-center justify-center z-10">
      <div className="bg-white/90 backdrop-blur-sm rounded-lg p-6 shadow-2xl flex flex-col items-center max-w-sm mx-4 border border-gray-300">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin-custom mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Processing...</h3>
        <p className="text-sm text-gray-600 text-center">{message}</p>
      </div>
    </div>
  );
}

export function GeneVisualization() {
  const [customDataKind, setCustomDataKind] = useState<"user" | "operon" | "insertion">("user");
  const [showSidebar, setShowSidebar] = useState(true);
  const [showTopTree, setShowTopTree] = useState(false);
  const [treeLayoutMode, setTreeLayoutMode] = useState<'phlogram' | 'cladogram'>('phlogram');
  const [tipExtensionMode, setTipExtensionMode] = useState<'none' | 'solid' | 'dashed'>('none');
  const [treeNewick, setTreeNewick] = useState<string | null>(null);
  const [operonTransferHandled, setOperonTransferHandled] = useState(false);
  const [operonBackboneGenes, setOperonBackboneGenes] = useState<string[]>([]);
  const [operonAlternativeGenes, setOperonAlternativeGenes] = useState<string[]>([]);
  const [operonRugTooltipStats, setOperonRugTooltipStats] = useState<Record<string, OperonRugTooltipStats>>({});
  const {
    state,
    loadTSVData,
    loadCustomTSVData,
    setSelectedLevels,
    setNormalizeLevel,
    filterByLineage,
    filterBySize,
    filterByRugMin,
    resetFilters,
    toggleGeneSelection,
    toggleGeneGroupSelection,
    togglePresence,
    addDifferenceVisualization,
    filterAllZeroAssemblies,
    SearchLineageInput,
    onWidthChange,
    getColorScale,
    dataset,
    datasets,
    setDataset,
    taxonomy,
    datasetLabels,
    rugMode,
    setRugMode
  } = useGeneVisualization();
  const treeFile = DATASET_TREE_FILE[dataset] ?? null;
  const canShowTopTree = Boolean(treeFile);

  const handleFileUpload = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".tsv";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const text = event.target?.result as string;
          setCustomDataKind("user");
          setOperonBackboneGenes([]);
          setOperonAlternativeGenes([]);
          setOperonRugTooltipStats({});
          loadCustomTSVData(text, file.name || "Custom TSV File");
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  const handleDownloadFilteredData = () => {
    if (state.raw.length === 0 || state.geneNames.length === 0) {
      alert("No data available to download. Please load a TSV file first.");
      return;
    }

    const header = ["assembly", ...state.geneNames].join("\t");
    const rows = state.raw.map((record) => {
      const assembly = record.assembly;
      const counts = state.countMap.get(assembly);
      const geneValues = state.geneNames.map((geneName) => counts?.[geneName] ?? 0);
      return [assembly, ...geneValues].join("\t");
    });

    const tsvContent = [header, ...rows].join("\n");
    const blob = new Blob([tsvContent], {
      type: "text/tab-separated-values;charset=utf-8;"
    });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().split("T")[0];
    const filename = `filtered_gene_counts_${timestamp}.tsv`;

    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const inputCoverage =
    state.totalInput > 0
      ? ((state.countMap.size / state.totalInput) * 100).toFixed(1)
      : "0.0";
  const gtdbCoverage =
    state.asmCount > 0 ? ((state.countMap.size / state.asmCount) * 100).toFixed(1) : "0.0";
  const referenceAssembliesLabel =
    dataset === "GTDB214_lineage_ordered.json"
      ? "GTDB r214 assemblies"
      : `${datasetLabels?.[dataset] ?? dataset.replace(/\.json$/, "")} assemblies`;

  useEffect(() => {
    document.body.classList.add("viz-theme");
    return () => {
      document.body.classList.remove("viz-theme");
    };
  }, []);

  useEffect(() => {
    if (operonTransferHandled || state.defaultGeneNames.length === 0) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const transferId = params.get("operonTransfer");
    if (!transferId) {
      setOperonTransferHandled(true);
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const storageKey = `${OPERON_PHYLETIC_TRANSFER_PREFIX}${transferId}`;
        const rawPayload = window.localStorage.getItem(storageKey);
        if (!rawPayload) {
          throw new Error("Could not find the operon transfer payload.");
        }
        const payload = JSON.parse(rawPayload) as OperonPhyleticTransferPayload;
        if (payload.version !== 1 || !Array.isArray(payload.columns) || payload.columns.length === 0) {
          throw new Error("The operon transfer payload is invalid.");
        }

        const sourceUrl = payload.sourceUrl ?? OPERON_PHYLETIC_TSV_URL;
        const sourceFormat = payload.sourceFormat ?? "tsv";
        const response = await fetch(withBasePath(sourceUrl));
        if (!response.ok) {
          throw new Error(`Failed to load phyletic transfer data: HTTP ${response.status}`);
        }
        const sourceText =
          sourceFormat === "sparse-association-v1" ? "" : await response.text();
        const filtered =
          sourceFormat === "sparse-association-v1"
            ? materializeSparseInsertionTsv(
                (await response.json()) as SparseInsertionPhyleticBundle,
                payload.columns,
                payload.displayNames
              )
            : filterTsvColumns(sourceText, payload.columns, payload.displayNames);
        if (cancelled) return;

        const foundColumnSet = new Set(filtered.foundColumns);
        setCustomDataKind(payload.customDataKind ?? "operon");
        setOperonBackboneGenes(
          (payload.backboneColumns ?? [])
            .filter((column) => foundColumnSet.has(column))
            .map((column) => operonColumnDisplayName(column, payload.displayNames))
        );
        setOperonAlternativeGenes(
          (payload.alternativeColumns ?? [])
            .filter((column) => foundColumnSet.has(column))
            .map((column) => operonColumnDisplayName(column, payload.displayNames))
        );
        setOperonRugTooltipStats(
          buildOperonRugTooltipStats(
            sourceFormat === "sparse-association-v1" ? filtered.text : sourceText,
            (payload.columnMetrics ?? []).filter((metric) => foundColumnSet.has(metric.column)),
            state.countMap,
            payload.displayNames
          )
        );

        await loadCustomTSVData(filtered.text, payload.label || "Visible Directed Operons", {
          activateCustomGenes: false
        });
        window.localStorage.removeItem(storageKey);
        if (filtered.missingColumns.length > 0) {
          console.warn(
            `${filtered.missingColumns.length} transferred phyletic columns were not found in ${sourceUrl}.`
          );
        }
      } catch (error) {
        if (!cancelled) {
          alert(error instanceof Error ? error.message : "Failed to import operon data.");
        }
      } finally {
        if (!cancelled) {
          setOperonTransferHandled(true);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [loadCustomTSVData, operonTransferHandled, state.countMap, state.defaultGeneNames.length]);

  useEffect(() => {
    if (!canShowTopTree) {
      setShowTopTree(false);
      setTreeNewick(null);
      return;
    }
    let cancelled = false;
    fetch(withBasePath(`/${treeFile}`))
      .then((resp) => (resp.ok ? resp.text() : Promise.reject(new Error(`Failed to load ${treeFile}`))))
      .then((text) => {
        if (!cancelled) setTreeNewick(text);
      })
      .catch(() => {
        if (!cancelled) setTreeNewick(null);
      });
    return () => {
      cancelled = true;
    };
  }, [canShowTopTree, treeFile]);

  return (
    <div className="min-h-screen viz-theme bg-gray-50 text-gray-900">
      <div className="bg-white border-b border-gray-200 shadow-sm px-3 sm:px-5 lg:px-6 py-2.5">
        <ControlPanel
          onLoadTSV={handleFileUpload}
          selectedLevels={state.selectedLevels}
          onSelectedLevelsChange={setSelectedLevels}
          onResetFilter={resetFilters}
          geneNames={state.geneNames}
          onAddDifference={(gene1, gene2, useCounts) =>
            addDifferenceVisualization({ gene1, gene2, useCounts })
          }
          normalizeLevel={state.normalizeLevel}
          onNormalizeLevel={setNormalizeLevel}
          onFilterAssemblies={filterAllZeroAssemblies}
          onFilterBySize={filterBySize}
          onFilterByRugMin={filterByRugMin}
          datasetOptions={datasets}
          selectedDataset={dataset}
          onDatasetChange={(d) => setDataset(d as unknown as (typeof datasets)[number])}
          datasetLabels={datasetLabels}
          SearchLineageInput={SearchLineageInput}
          mode="all"
          rugMode={rugMode}
          onRugModeChange={setRugMode}
          showTopTree={showTopTree}
          onShowTopTreeChange={setShowTopTree}
          canShowTopTree={canShowTopTree}
          treeLayoutMode={treeLayoutMode}
          onTreeLayoutModeChange={setTreeLayoutMode}
          tipExtensionMode={tipExtensionMode}
          onTipExtensionModeChange={setTipExtensionMode}
        />
      </div>

      <div className="px-3 sm:px-5 lg:px-6 py-3 flex flex-col lg:flex-row gap-4">
        {showSidebar ? (
          <div className="w-full lg:w-56 xl:w-64 flex-shrink-0 relative">
            <button
              onClick={() => setShowSidebar(false)}
              className="absolute top-2 right-2 h-7 w-7 rounded border bg-white hover:bg-gray-50 flex items-center justify-center"
              aria-label="Collapse gene selection"
              title="Hide"
            >
              <span aria-hidden="true" className="text-lg font-bold leading-none">&lsaquo;</span>
            </button>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 h-full">
              <GeneSelectionSidebar
                geneNames={state.geneNames}
                defaultGeneNames={state.defaultGeneNames}
                customGeneNames={state.customGeneNames}
                customDataKind={customDataKind}
                activeGenes={state.activeGenes}
                onToggleGene={toggleGeneSelection}
                onToggleGeneGroup={toggleGeneGroupSelection}
                onTogglePresence={togglePresence}
                showPresence={state.showPresence}
              />
            </div>
          </div>
        ) : (
          <div className="flex-shrink-0">
            <button
              onClick={() => setShowSidebar(true)}
              className="h-7 w-7 rounded border bg-white hover:bg-gray-50 flex items-center justify-center"
              aria-label="Expand gene selection"
              title="Expand"
            >
              <span aria-hidden="true" className="text-lg font-bold leading-none">&rsaquo;</span>
            </button>
          </div>
        )}

        <div className="flex-1 min-w-0 flex flex-col w-full">
          <div
            className="bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col relative w-full overflow-hidden"
            style={
              state.isLoading ? { minHeight: VIZ_PANEL_MIN_HEIGHT_WHILE_LOADING_PX } : undefined
            }
          >
            <LoadingOverlay isLoading={state.isLoading} message={state.loadingMessage} />

            <div
              className={`p-3 flex flex-col w-full ${state.isLoading ? "opacity-0 pointer-events-none select-none" : ""}`}
            >
              {state.totalInput > 0 && (
                <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="text-sm font-medium text-blue-900">
                    Mapped {state.countMap.size.toLocaleString()} of{" "}
                    {state.totalInput.toLocaleString()} input assemblies
                  </div>
                  <div className="text-xs text-blue-700 mt-1">
                    Coverage: {inputCoverage}% of input assemblies • {gtdbCoverage}% of{" "}
                    {referenceAssembliesLabel}
                  </div>
                </div>
              )}

              <div className="w-full flex flex-col">
                {!state.isLoading && (
                  <VisualizationCanvas
                    data={state.raw}
                    selectedLevels={state.selectedLevels}
                    activeGenes={state.activeGenes}
                    matrix={state.matrix}
                    coordMap={state.coordMap}
                    widthMap={state.widthMap}
                    asmIndex={state.asmIndex}
                    geneIndex={state.geneIndex}
                    countMap={state.countMap}
                    customRugGenes={customDataKind === "operon" || customDataKind === "insertion" ? state.customGeneNames : []}
                    backboneRugGenes={customDataKind === "operon" || customDataKind === "insertion" ? operonBackboneGenes : []}
                    alternativeRugGenes={customDataKind === "operon" || customDataKind === "insertion" ? operonAlternativeGenes : []}
                    rugTooltipStats={customDataKind === "operon" || customDataKind === "insertion" ? operonRugTooltipStats : {}}
                    onLineageClick={filterByLineage}
                    onDomainClick={resetFilters}
                    onRemoveGene={toggleGeneSelection}
                    onWidthChange={onWidthChange}
                    getColorScale={getColorScale}
                    rugMode={rugMode}
                    onDownloadTSV={handleDownloadFilteredData}
                    showTopTree={showTopTree && canShowTopTree}
                    treeNewick={treeNewick}
                    treeLayoutMode={treeLayoutMode}
                    tipExtensionMode={tipExtensionMode}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
