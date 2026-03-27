import React, { useState, useCallback, useEffect, useRef } from "react";
import * as d3 from "d3";
import LineageAutocomplete from "@/components/LineageAutocomplete";
import { withBasePath } from "@/lib/assetPaths";
import {
  ALL_LEVELS,
  sortGenesByCustomRowOrder,
  DATASETS,
  DATASET_LABELS,
  DEFAULT_DATASET,
  DEFAULT_TSV_FILENAME,
  GOLDEN,
  TAXONOMY_VERSIONS
} from "@/lib/visualization/config";
import type {
  GTDBRecord,
  GeneCountData,
  VisualizationState,
  TaxonomicLevel,
  DifferenceOptions
} from "@/types/gene-visualization";

export function useGeneVisualization() {
  const [state, setState] = useState<VisualizationState>({
    originalRaw: [],
    raw: [],
    assemblies: [],
    selectedLevels: ["phylum"],
    totalInput: 0,
    geneNames: [],
    matrix: null,
    asmCount: 0,
    countMap: new Map(),
    asmIndex: new Map(),
    geneIndex: new Map(),
    coordMap: new Map(),
    widthMap: new Map(),
    normalizeLevel: null,
    showPresence: true,
    activeGenes: [],
    isLoading: true,
    loadingMessage: "Loading default data..."
  });

  const [containerWidth, setContainerWidth] = useState(1200);
  const [lineageOptions, setLineageOptions] = useState<string[]>([]);
  const lastTSVTextRef = useRef<string | null>(null);
  const isFirstDatasetLoadRef = useRef<boolean>(true);

  const [rugMode, setRugMode] = useState<"normalized" | "binary" | "heatmap">(
    "binary"
  );
  const lastRugMinRef = useRef<number>(0);
  const sizeFilterStateRef = useRef<{
    level: TaxonomicLevel | null;
    threshold: number;
    baseline: GTDBRecord[] | null;
  }>({
    level: null,
    threshold: 0,
    baseline: null
  });

  const [dataset, setDataset] = useState<(typeof DATASETS)[number]>(DEFAULT_DATASET);
  const colorCacheRef = useRef<{ [key: string]: any }>({});
  const globalColorMapRef = useRef<{ [key: string]: string }>({});

  const generatePastelColor = useCallback((index: number): string => {
    const hue = (index * GOLDEN * 360) % 360;
    const saturation = 60 + (index % 4) * 8;
    const lightness = 40 + (index % 3) * 8;
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }, []);

  const getLineageColor = useCallback(
    (lineageName: string): string => {
      if (!globalColorMapRef.current[lineageName]) {
        const existingColors = Object.keys(globalColorMapRef.current).length;
        globalColorMapRef.current[lineageName] = generatePastelColor(existingColors);
      }
      return globalColorMapRef.current[lineageName];
    },
    [generatePastelColor]
  );

  const onWidthChange = useCallback((width: number) => {
    setContainerWidth(width);
  }, []);

  const loadGTDBData = useCallback(async (fileName: string) => {
    try {
      const response = await fetch(withBasePath(fileName.startsWith("/") ? fileName : `/${fileName}`));
      const jsonData: GTDBRecord[] = await response.json();

      sizeFilterStateRef.current = { level: null, threshold: 0, baseline: null };
      setState((prev) => ({
        ...prev,
        originalRaw: jsonData,
        raw: jsonData.slice(),
        assemblies: jsonData.map((d) => d.assembly),
        asmCount: jsonData.length,
        asmIndex: new Map(jsonData.map((d, i) => [d.assembly, i]))
      }));

      const options = Array.from(
        new Set(jsonData.flatMap((d) => ALL_LEVELS.map((l) => d[l])))
      ).sort();
      setLineageOptions(options);
    } catch (error) {
      console.error("Error loading GTDB data:", error);
      alert("Error loading GTDB data: " + error);
    }
  }, []);

  const loadTSVData = useCallback(async (tsvText: string) => {
    lastTSVTextRef.current = tsvText;
    setState((prev) => ({
      ...prev,
      isLoading: true,
      loadingMessage: "Processing TSV data..."
    }));
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        setState((prev) => {
          const lines = tsvText.trim().split(/\r?\n/);
          const header = lines.shift()?.split("\t") || [];
          const rows = lines.filter(Boolean);

          const totalInput = rows.length;
          const assemblyColIdx = Math.max(0, header.indexOf("assembly"));
          const countCols = header
            .map((name, idx) => ({ name, idx }))
            .filter(({ name, idx }) => idx !== assemblyColIdx && name.endsWith("_count"));

          const geneNames = countCols.map((c) => c.name);
          const geneColIdxs = countCols.map((c) => c.idx);
          const geneIndex = new Map(geneNames.map((g, i) => [g, i]));
          let matrix = new Uint8Array(geneNames.length * prev.asmCount);
          const newCountMap = new Map<string, GeneCountData>();

          for (let r = 0; r < rows.length; r++) {
            const cols = rows[r].split("\t");
            const asm = cols[assemblyColIdx] ?? cols[0];
            const asmIdx = prev.asmIndex.get(asm);
            if (asmIdx === undefined) continue;

            const cm: GeneCountData = {};
            for (let g = 0; g < geneNames.length; g++) {
              const colIdx = geneColIdxs[g];
              const raw = colIdx < cols.length ? cols[colIdx] : undefined;
              const val = Number(raw) || 0;
              cm[geneNames[g]] = val;
              if (val > 0) {
                matrix[g * prev.asmCount + asmIdx] = 1;
              }
            }
            newCountMap.set(asm, cm);
          }

          return {
            ...prev,
            totalInput,
            geneNames,
            geneIndex,
            matrix,
            countMap: newCountMap,
            isLoading: false,
            loadingMessage: ""
          };
        });
        resolve();
      }, 10);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        if (!isFirstDatasetLoadRef.current) {
          setState((prev) => ({
            ...prev,
            isLoading: true,
            loadingMessage: "Switching taxonomy..."
          }));
          await new Promise((r) => setTimeout(r, 10));
        }
        await loadGTDBData(dataset);
        if (isFirstDatasetLoadRef.current && !lastTSVTextRef.current) {
          try {
            const resp = await fetch(
              withBasePath(
                DEFAULT_TSV_FILENAME.startsWith("/") ? DEFAULT_TSV_FILENAME : `/${DEFAULT_TSV_FILENAME}`
              )
            );
            if (resp.ok) {
              const text = await resp.text();
              await loadTSVData(text);
            }
          } catch (e) {
            console.warn("Default TSV auto-load failed:", e);
          }
        }
        if (lastTSVTextRef.current) {
          await loadTSVData(lastTSVTextRef.current);
        }
      } finally {
        if (!cancelled) {
          setState((prev) => ({ ...prev, isLoading: false, loadingMessage: "" }));
        }
      }
      isFirstDatasetLoadRef.current = false;
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [dataset, loadGTDBData, loadTSVData]);

  const taxonomy = React.useMemo(() => {
    const m = dataset.match(/^GTDB(\d+)/);
    return m ? m[1] : TAXONOMY_VERSIONS[0] || "214";
  }, [dataset]);

  const getColorScale = useCallback((level: TaxonomicLevel, categories: string[]) => {
    const WEBSITE_CATEGORY_COLORS = [
      "#FCB315",
      "#7CAEC4",
      "#DD6030",
      "#231F20",
      "#7D2985",
      "#B4B4B4"
    ];
    const cacheKey = `${level}_${categories.slice().sort().join("_")}`;
    if (!colorCacheRef.current[cacheKey]) {
      const colors = categories.map((_, idx) => WEBSITE_CATEGORY_COLORS[idx % WEBSITE_CATEGORY_COLORS.length]);
      colorCacheRef.current[cacheKey] = d3.scaleOrdinal(categories, colors);
    }
    return colorCacheRef.current[cacheKey];
  }, []);

  useEffect(() => {
    if (state.assemblies.length > 0 && containerWidth > 0) {
      setState((prev) => {
        if (prev.assemblies.length === 0) return prev;
        const coordMap = new Map<string, number>();
        const widthMap = new Map<string, number>();
        const MARGINS = { left: 100, right: 16 };
        const totalW = containerWidth - MARGINS.left - MARGINS.right;

        if (!prev.normalizeLevel) {
          const xBand = d3.scaleBand().domain(prev.assemblies).range([0, totalW]).paddingInner(0);
          prev.assemblies.forEach((a) => {
            coordMap.set(a, xBand(a)!);
            widthMap.set(a, xBand.bandwidth());
          });
        } else if (prev.normalizeLevel === "__ALL__") {
          const w = totalW / prev.assemblies.length;
          prev.assemblies.forEach((a, i) => {
            coordMap.set(a, i * w);
            widthMap.set(a, w);
          });
        } else {
          const runs: Array<{ cat: string; start: number; end: number }> = [];
          const level = prev.normalizeLevel;
          let start = 0;
          let cat = prev.raw[0]?.[level] || "";
          for (let k = 1; k < prev.assemblies.length; k++) {
            if (prev.raw[k]?.[level] !== cat) {
              runs.push({ cat, start, end: k - 1 });
              cat = prev.raw[k]?.[level] || "";
              start = k;
            }
          }
          runs.push({ cat, start, end: prev.assemblies.length - 1 });
          const segW = totalW / runs.length;
          runs.forEach((run, ri) => {
            const arr = prev.assemblies.slice(run.start, run.end + 1);
            const w = segW / arr.length;
            arr.forEach((a, idx) => {
              coordMap.set(a, ri * segW + idx * w);
              widthMap.set(a, w);
            });
          });
        }

        return { ...prev, coordMap, widthMap };
      });
    }
  }, [containerWidth, state.assemblies.length, state.normalizeLevel]);

  const setSelectedLevels = useCallback((levels: TaxonomicLevel[]) => {
    setState((prev) => ({
      ...prev,
      selectedLevels: levels.length > 0 ? levels : ["phylum"]
    }));
  }, []);

  const setNormalizeLevel = useCallback((level: TaxonomicLevel | "__ALL__" | null) => {
    setState((prev) => ({ ...prev, normalizeLevel: level }));
  }, []);

  const filterByLineage = useCallback((level: TaxonomicLevel, category: string) => {
    setState((prev) => ({ ...prev, isLoading: true, loadingMessage: `Filtering by ${level}: ${category}...` }));
    setTimeout(() => {
      sizeFilterStateRef.current = { level: null, threshold: 0, baseline: null };
      setState((prev) => {
        const filtered = prev.originalRaw.filter((d) => d[level] === category);
        return {
          ...prev,
          raw: filtered,
          assemblies: filtered.map((d) => d.assembly),
          isLoading: false,
          loadingMessage: ""
        };
      });
    }, 10);
  }, []);

  const filterBySize = useCallback((level: TaxonomicLevel, threshold: number) => {
    setState((prev) => ({
      ...prev,
      isLoading: true,
      loadingMessage: `Filtering by ${level} size (min: ${threshold})...`
    }));
    setTimeout(() => {
      setState((prev) => {
        const tracker = sizeFilterStateRef.current;
        const sameLevel = tracker.level === level;
        const baselineDefined = !!tracker.baseline;
        const isLoosening = sameLevel && threshold < tracker.threshold;
        if (!sameLevel || !baselineDefined) {
          tracker.baseline = prev.raw;
        }
        const baseline = isLoosening && tracker.baseline ? tracker.baseline : prev.raw;
        const counts = d3.rollup(
          baseline,
          (v: GTDBRecord[]) => v.length,
          (d: GTDBRecord) => d[level]
        );
        const filtered = baseline.filter((d) => (counts.get(d[level]) || 0) >= threshold);
        if (threshold <= 0) {
          sizeFilterStateRef.current = { level: null, threshold: 0, baseline: null };
        } else {
          sizeFilterStateRef.current = {
            level,
            threshold,
            baseline: !sameLevel || !baselineDefined ? baseline : tracker.baseline
          };
        }
        return {
          ...prev,
          raw: filtered,
          assemblies: filtered.map((d) => d.assembly),
          isLoading: false,
          loadingMessage: ""
        };
      });
    }, 10);
  }, []);

  const filterByRugMin = useCallback((min: number, rugKey: string | "ANY" = "ANY") => {
    setState((prev) => ({
      ...prev,
      isLoading: true,
      loadingMessage: `Filtering assemblies by ${rugKey === "ANY" ? "any rug" : rugKey} >= ${min}...`
    }));
    setTimeout(() => {
      sizeFilterStateRef.current = { level: null, threshold: 0, baseline: null };
      setState((prev) => {
        const baseline = min < lastRugMinRef.current ? prev.originalRaw : prev.raw;
        const keys = rugKey === "ANY" ? (prev.activeGenes.length > 0 ? prev.activeGenes : prev.geneNames) : [rugKey];
        const filtered = baseline.filter((d) => {
          const cm = prev.countMap.get(d.assembly);
          if (!cm) return false;
          for (const k of keys) {
            if ((cm[k] || 0) >= min) return true;
          }
          return false;
        });
        lastRugMinRef.current = min;
        return {
          ...prev,
          raw: filtered,
          assemblies: filtered.map((d) => d.assembly),
          isLoading: false,
          loadingMessage: ""
        };
      });
    }, 10);
  }, []);

  const resetFilters = useCallback(() => {
    setState((prev) => ({ ...prev, isLoading: true, loadingMessage: "Resetting filters..." }));
    setTimeout(() => {
      sizeFilterStateRef.current = { level: null, threshold: 0, baseline: null };
      setState((prev) => ({
        ...prev,
        raw: prev.originalRaw.slice(),
        assemblies: prev.originalRaw.map((d) => d.assembly),
        isLoading: false,
        loadingMessage: ""
      }));
    }, 10);
  }, []);

  const toggleGeneSelection = useCallback((gene: string) => {
    setState((prev) => ({ ...prev, isLoading: true, loadingMessage: "Processing gene selection..." }));
    setTimeout(() => {
      setState((prev) => {
        const isActive = prev.activeGenes.includes(gene);
        const activeGenes = isActive ? prev.activeGenes.filter((g) => g !== gene) : [...prev.activeGenes, gene];
        return { ...prev, activeGenes, isLoading: false, loadingMessage: "" };
      });
    }, 10);
  }, []);

  const toggleAllGenes = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isLoading: true,
      loadingMessage: `Processing ${prev.activeGenes.length > 0 ? "deselection" : "selection"} of all genes...`
    }));
    setTimeout(() => {
      setState((prev) => ({
        ...prev,
        activeGenes: prev.activeGenes.length > 0 ? [] : sortGenesByCustomRowOrder(prev.geneNames),
        isLoading: false,
        loadingMessage: ""
      }));
    }, 10);
  }, []);

  const togglePresence = useCallback(() => {
    setState((prev) => {
      if (!prev.matrix) return prev;
      const newMatrix = new Uint8Array(prev.matrix.length);
      for (let i = 0; i < prev.matrix.length; i++) {
        newMatrix[i] = prev.matrix[i] ? 0 : 1;
      }
      return { ...prev, matrix: newMatrix, showPresence: !prev.showPresence };
    });
  }, []);

  const addDifferenceVisualization = useCallback((options: DifferenceOptions) => {
    setState((prev) => ({ ...prev, isLoading: true, loadingMessage: "Creating gene comparison visualization..." }));
    setTimeout(() => {
      setState((prev) => {
        const { gene1, gene2, useCounts } = options;
        if (!gene1 || !gene2 || gene1 === gene2) {
          return { ...prev, isLoading: false, loadingMessage: "" };
        }
        const oldN = prev.geneNames.length;
        const label = (a: string, b: string) =>
          `${a.replace(/_count$/, "")}${useCounts ? ">" : "-"}${b.replace(/_count$/, "")}`;
        const name1 = label(gene1, gene2);
        const name2 = label(gene2, gene1);
        const newGeneNames = [...prev.geneNames, name1, name2];
        const newGeneIndex = new Map(prev.geneIndex);
        newGeneIndex.set(name1, oldN);
        newGeneIndex.set(name2, oldN + 1);
        const newMatrix = new Uint8Array(newGeneNames.length * prev.asmCount);
        newMatrix.set(prev.matrix || new Uint8Array(0));
        const newCountMap = new Map(prev.countMap);
        prev.assemblies.forEach((a) => {
          const ai = prev.asmIndex.get(a);
          if (ai === undefined) return;
          const cm = newCountMap.get(a) || {};
          const c1 = cm[gene1] || 0;
          const c2 = cm[gene2] || 0;
          const p1 = useCounts ? c1 > c2 : c1 > 0 && c2 === 0;
          const p2 = useCounts ? c2 > c1 : c2 > 0 && c1 === 0;
          newMatrix[oldN * prev.asmCount + ai] = p1 ? 1 : 0;
          newMatrix[(oldN + 1) * prev.asmCount + ai] = p2 ? 1 : 0;
          cm[name1] = p1 ? 1 : 0;
          cm[name2] = p2 ? 1 : 0;
          newCountMap.set(a, cm);
        });
        return {
          ...prev,
          geneNames: newGeneNames,
          geneIndex: newGeneIndex,
          matrix: newMatrix,
          countMap: newCountMap,
          activeGenes: [...prev.activeGenes, name1, name2],
          isLoading: false,
          loadingMessage: ""
        };
      });
    }, 10);
  }, []);

  const filterAllZeroAssemblies = useCallback(() => {
    setState((prev) => ({ ...prev, isLoading: true, loadingMessage: "Filtering zero assemblies..." }));
    setTimeout(() => {
      sizeFilterStateRef.current = { level: null, threshold: 0, baseline: null };
      setState((prev) => {
        const filtered = prev.raw.filter((d) => {
          const cm = prev.countMap.get(d.assembly);
          return cm && Object.values(cm).some((c) => c > 0);
        });
        return {
          ...prev,
          raw: filtered,
          assemblies: filtered.map((d) => d.assembly),
          isLoading: false,
          loadingMessage: ""
        };
      });
    }, 10);
  }, []);

  const searchLineage = useCallback((searchTerm: string) => {
    if (!searchTerm.trim()) return;
    setState((prev) => ({
      ...prev,
      isLoading: true,
      loadingMessage: `Searching for lineage: ${searchTerm}...`
    }));
    setTimeout(() => {
      sizeFilterStateRef.current = { level: null, threshold: 0, baseline: null };
      setState((prev) => {
        const level = ALL_LEVELS.find((l) => prev.originalRaw.some((d) => d[l] === searchTerm));
        if (!level) {
          alert("No lineage: " + searchTerm);
          return { ...prev, isLoading: false, loadingMessage: "" };
        }
        const filtered = prev.originalRaw.filter((d) => d[level] === searchTerm);
        return {
          ...prev,
          raw: filtered,
          assemblies: filtered.map((d) => d.assembly),
          isLoading: false,
          loadingMessage: ""
        };
      });
    }, 10);
  }, []);

  return {
    state,
    lineageOptions,
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
    searchLineage,
    SearchLineageInput: (props: React.InputHTMLAttributes<HTMLInputElement>) =>
      React.createElement(LineageAutocomplete, {
        suggestions: lineageOptions,
        onSelect: (value: string) => searchLineage(value),
        placeholder: props.placeholder
      }),
    onWidthChange,
    getColorScale,
    dataset,
    datasets: [...DATASETS] as Array<(typeof DATASETS)[number]>,
    datasetLabels: DATASET_LABELS,
    setDataset,
    taxonomy,
    rugMode,
    setRugMode
  };
}
