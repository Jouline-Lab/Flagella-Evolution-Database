"use client";

import React, { useEffect, useState } from "react";
import { useGeneVisualization } from "@/hooks/useGeneVisualization";
import { DATASET_TREE_FILE } from "@/lib/visualization/config";
import { ControlPanel } from "./ControlPanel";
import { GeneSelectionSidebar } from "./GeneSelectionSidebar";
import { VisualizationCanvas } from "./VisualizationCanvas";
import { Loader2 } from "lucide-react";

function LoadingOverlay({
  isLoading,
  message
}: {
  isLoading: boolean;
  message: string;
}) {
  if (!isLoading) return null;

  return (
    <div className="absolute inset-0 backdrop-blur-sm bg-white loading-overlay flex items-center justify-center z-10 rounded-lg">
      <div className="bg-white/90 backdrop-blur-sm rounded-lg p-6 shadow-2xl flex flex-col items-center max-w-sm mx-4 border border-gray-300">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin-custom mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Processing...</h3>
        <p className="text-sm text-gray-600 text-center">{message}</p>
      </div>
    </div>
  );
}

export function GeneVisualization() {
  const [showSidebar, setShowSidebar] = useState(true);
  const [showTopTree, setShowTopTree] = useState(false);
  const [treeLayoutMode, setTreeLayoutMode] = useState<'phlogram' | 'cladogram'>('phlogram');
  const [tipExtensionMode, setTipExtensionMode] = useState<'none' | 'solid' | 'dashed'>('none');
  const [treeNewick, setTreeNewick] = useState<string | null>(null);
  const {
    state,
    loadTSVData,
    setSelectedLevels,
    setNormalizeLevel,
    filterByLineage,
    filterBySize,
    filterByRugMin,
    resetFilters,
    toggleGeneSelection,
    toggleAllGenes,
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
          loadTSVData(text);
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
  const selectedDatasetLabel = datasetLabels?.[dataset] ?? dataset.replace(/\.json$/, "");

  useEffect(() => {
    document.body.classList.add("viz-theme");
    return () => {
      document.body.classList.remove("viz-theme");
    };
  }, []);

  useEffect(() => {
    if (!canShowTopTree) {
      setShowTopTree(false);
      setTreeNewick(null);
      return;
    }
    let cancelled = false;
    fetch(`/${treeFile}`)
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
      <header className="bg-white border-b border-gray-200 shadow-sm px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between py-2">
          <div>
            <h1 className="text-lg font-semibold text-gray-900 leading-tight">
              Gene Presence Lineage Tool
            </h1>
            <p className="text-xs text-gray-700 leading-tight">
              Visualize gene presence & absence across GTDB taxonomic lineages
            </p>
          </div>
          <div className="hidden md:flex items-center space-x-6 text-sm text-gray-700">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-green-500 rounded-full" />
              <span>
                {selectedDatasetLabel}: {state.asmCount.toLocaleString()} assemblies
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full" />
              <span>{state.selectedLevels.length} levels</span>
            </div>
            {state.totalInput > 0 && (
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-purple-500 rounded-full" />
                <span>{state.activeGenes.length} genes active</span>
              </div>
            )}
          </div>
        </div>
      </header>

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
                activeGenes={state.activeGenes}
                onToggleGene={toggleGeneSelection}
                onToggleAll={toggleAllGenes}
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
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col relative w-full">
            <LoadingOverlay isLoading={state.isLoading} message={state.loadingMessage} />

            <div className={`p-3 flex flex-col w-full ${state.isLoading ? "opacity-0 pointer-events-none" : ""}`}>
              {state.totalInput > 0 && (
                <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-blue-900">
                        Mapped {state.countMap.size.toLocaleString()} of{" "}
                        {state.totalInput.toLocaleString()} input assemblies
                      </div>
                      <div className="text-xs text-blue-700 mt-1">
                        Coverage: {inputCoverage}% of input data • {gtdbCoverage}% of{" "}
                        {selectedDatasetLabel}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-semibold text-blue-900">{inputCoverage}%</div>
                      <div className="text-xs text-blue-700">matched</div>
                    </div>
                  </div>
                </div>
              )}

              <div className="w-full flex-1">
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
                    onLineageClick={filterByLineage}
                    onDomainClick={resetFilters}
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
