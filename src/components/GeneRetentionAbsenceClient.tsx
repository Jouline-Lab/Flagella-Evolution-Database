"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, Download, Loader2 } from "lucide-react";
import { withBasePath } from "@/lib/assetPaths";

const DATA_URL = "/flagellar_genes_phyletic_distribution.tsv";
const GENE_SUFFIX = "_count";
const TAXON_COLUMNS = ["phylum", "class", "order", "family", "genus", "species"];
const DIDERM_SPECIFIC_GENES = new Set(["FlgH", "FlgI", "FlgA", "FlgJ"]);

const CORE_FLAGELLAR_GENES = [
  "FlgP", "SwrB", "Putative", "FapA",
  "SwrD", "Transglycosylase", "MotE", "FliT", "PilZ", "FliW", "FlaG",
  "CsrA", "FlhG", "FlhF", "FlgA", "FlgH", "FlgM", "FlgI", "FlgN",
  "FliD", "FliA", "FliS", "FlgJ", "FlgF", "FlgL", "FlgG", "FliL",
  "FliK", "FliJ", "FliO", "FlgE", "FliH", "MotB", "FliF", "FlgD",
  "FliC", "FlgB", "FlgK", "FliI", "FliM", "FlgC", "FliE", "FliQ",
  "FlhB", "FliG", "FliR", "FliP", "MotA", "FliN", "FlhA"
];

type ParsedRetentionData = {
  genes: string[];
  taxa: string[];
  rows: {
    taxonomy: Record<string, string>;
    counts: number[];
  }[];
};

type PlotRecord = {
  label: string;
  value: number;
  n?: number;
  isSeparator?: boolean;
};

type TooltipState = {
  x: number;
  y: number;
  title: string;
  details: string[];
} | null;

type RetentionSelectOption = {
  label: string;
  value: string;
};

function numberOrZero(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatTaxon(value: string): string {
  const trimmed = value.trim();
  const stripped = trimmed.replace(/^[a-z]__/i, "");
  return stripped || trimmed || "Unclassified";
}

function normalizeLineage(row: Record<string, string>, lineageLevel: string): string {
  let lineage = String(row[lineageLevel] ?? "").trim();

  if (lineageLevel === "phylum") {
    const phylum = lineage.replace(/^p__/, "");
    const isPseudomonadota =
      /^p?__?pseudomonadota$/i.test(lineage) ||
      /^pseudomonadota$/i.test(phylum) ||
      /^pseudomonadata$/i.test(phylum);

    if (isPseudomonadota) {
      const className = String(row.class ?? "").trim().replace(/^c__/, "");
      lineage = className ? `${className}*` : `${phylum}*`;
    } else {
      lineage = phylum;
    }
  }

  return formatTaxon(lineage);
}

function parseDistributionTable(text: string): ParsedRetentionData {
  const lines = text.replace(/\r/g, "").split("\n").filter((line) => line.trim());
  if (lines.length < 2) {
    throw new Error("The distribution table did not include any data rows.");
  }

  const headers = lines[0].split("\t").map((header) => header.trim());
  const geneColumns = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => header.endsWith(GENE_SUFFIX))
    .map(({ header, index }) => ({
      gene: header.slice(0, -GENE_SUFFIX.length),
      index
    }));
  const taxa = TAXON_COLUMNS.filter((column) => headers.includes(column));
  const taxonIndexes = new Map(taxa.map((column) => [column, headers.indexOf(column)]));

  const rows: ParsedRetentionData["rows"] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split("\t");
    const taxonomy: Record<string, string> = {};
    for (const column of taxa) {
      taxonomy[column] = parts[taxonIndexes.get(column) ?? -1] ?? "";
    }

    rows.push({
      taxonomy,
      counts: geneColumns.map(({ index }) => numberOrZero(parts[index]))
    });
  }

  return {
    genes: geneColumns.map(({ gene }) => gene),
    taxa,
    rows
  };
}

function selectTopAndBottom(records: PlotRecord[], countPerSide = 8): PlotRecord[] {
  if (records.length <= countPerSide * 2) return records;
  return [
    ...records.slice(0, countPerSide),
    { label: "...", value: 0, isSeparator: true, n: records.length - countPerSide * 2 },
    ...records.slice(-countPerSide)
  ];
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const rough = value / 5;
  const power = 10 ** Math.floor(Math.log10(rough));
  const base = rough / power;
  const niceBase = base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10;
  return Math.ceil(value / (niceBase * power)) * niceBase * power;
}

function downloadFigureSvg(container: HTMLDivElement | null) {
  const panels = Array.from(container?.querySelectorAll("svg") ?? []);
  if (panels.length === 0) return;

  const namespace = "http://www.w3.org/2000/svg";
  const width = 980;
  const gap = 18;
  const panelSizes = panels.map((panel) => {
    const viewBox = panel.getAttribute("viewBox")?.split(/\s+/).map(Number);
    return {
      width: Number.isFinite(viewBox?.[2]) ? viewBox![2] : width,
      height: Number.isFinite(viewBox?.[3]) ? viewBox![3] : 360
    };
  });
  const height =
    panelSizes.reduce((sum, size) => sum + size.height, 0) + Math.max(0, panels.length - 1) * gap;
  const combined = document.createElementNS(namespace, "svg");
  combined.setAttribute("xmlns", namespace);
  combined.setAttribute("viewBox", `0 0 ${width} ${height}`);
  combined.setAttribute("width", String(width));
  combined.setAttribute("height", String(height));

  const style = document.createElementNS(namespace, "style");
  style.textContent = `
    .retention-axis{stroke:#222;stroke-width:1}
    .retention-gridline{stroke:#d6dce8;stroke-width:1}
    .retention-bar{fill:#566383}
    .retention-axis-title{fill:#222;font:400 18px Arial,sans-serif}
    .retention-tick,.retention-x-label{fill:#222;font:16px Arial,sans-serif}
    .retention-separator{fill:#667085;font:700 28px Arial,sans-serif}
  `;
  combined.appendChild(style);
  const background = document.createElementNS(namespace, "rect");
  background.setAttribute("width", String(width));
  background.setAttribute("height", String(height));
  background.setAttribute("fill", "#ffffff");
  combined.appendChild(background);

  let yOffset = 0;
  panels.forEach((panel, index) => {
    const clone = panel.cloneNode(true) as SVGSVGElement;
    clone.querySelector("rect")?.setAttribute("fill", "#ffffff");
    clone.setAttribute("x", "0");
    clone.setAttribute("y", String(yOffset));
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(panelSizes[index].height));
    combined.appendChild(clone);
    yOffset += panelSizes[index].height + gap;
  });

  const source = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(combined)}`;
  const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "gene-retention-absence.svg";
  link.click();
  URL.revokeObjectURL(url);
}

function RetentionSelect({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: RetentionSelectOption[];
  onChange: (value: string) => void;
}) {
  const buttonId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <div
      className="retention-menu-field"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setIsOpen(false);
        }
      }}
    >
      <span>{label}</span>
      <div className="retention-menu-select">
        <button
          id={buttonId}
          type="button"
          className="retention-menu-trigger"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((current) => !current)}
        >
          {selected?.label ?? value}
        </button>
        {isOpen ? (
          <ul className="retention-menu-options" role="listbox" aria-labelledby={buttonId}>
            {options.map((option) => (
              <li key={option.value} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  className="retention-menu-option"
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                >
                  <span>{option.label}</span>
                  {option.value === value ? (
                    <Check className="retention-menu-option-check" size={16} aria-hidden="true" />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function CommitNumberInput({
  value,
  min,
  max,
  disabled,
  onCommit
}: {
  value: number;
  min: number;
  max?: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function commitDraft() {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }

    const boundedHigh = max == null ? parsed : Math.min(parsed, max);
    const nextValue = Math.max(min, boundedHigh);
    onCommit(nextValue);
    setDraft(String(nextValue));
  }

  return (
    <input
      type="number"
      min={min}
      max={max}
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commitDraft}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          setDraft(String(value));
          event.currentTarget.blur();
        }
      }}
    />
  );
}

type BarPanelProps = {
  xTitle: string;
  yTitle: string;
  records: PlotRecord[];
  onHover: (event: React.MouseEvent<SVGRectElement>, record: PlotRecord) => void;
  onLeave: () => void;
};

function BarPanel({ xTitle, yTitle, records, onHover, onLeave }: BarPanelProps) {
  const width = 980;
  const longestLabel = Math.max(...records.map((record) => record.label.length), 1);
  const bottomPad = Math.max(132, Math.min(250, longestLabel * 7 + 76));
  const height = 260 + bottomPad;
  const margin = { top: 30, right: 22, bottom: bottomPad, left: 92 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const yMax = niceMax(Math.max(...records.map((record) => record.value), 1));
  const slot = records.length > 0 ? plotWidth / records.length : plotWidth;
  const barWidth = Math.max(2, slot - 4);
  const ticks = Array.from({ length: 6 }, (_, idx) => (yMax / 5) * idx);

  return (
    <svg className="retention-plot-svg" viewBox={`0 0 ${width} ${height}`} role="img">
      <rect width={width} height={height} fill="var(--plot-bg, #fff)" />
      <line
        x1={margin.left}
        y1={height - margin.bottom}
        x2={width - margin.right}
        y2={height - margin.bottom}
        className="retention-axis"
      />
      <line
        x1={margin.left}
        y1={margin.top}
        x2={margin.left}
        y2={height - margin.bottom}
        className="retention-axis"
      />
      {ticks.map((tick) => {
        const y = height - margin.bottom - (tick / yMax) * plotHeight;
        return (
          <g key={tick}>
            <line x1={margin.left - 4} y1={y} x2={margin.left} y2={y} className="retention-axis" />
            <line
              x1={margin.left}
              y1={y}
              x2={width - margin.right}
              y2={y}
              className="retention-gridline"
            />
              <text x={margin.left - 10} y={y + 5} textAnchor="end" className="retention-tick">
              {Number.isInteger(tick) ? tick : tick.toFixed(1)}
            </text>
          </g>
        );
      })}
      {records.map((record, index) => {
        const x = margin.left + index * slot + (slot - barWidth) / 2;
        const barHeight = record.isSeparator ? 0 : (record.value / yMax) * plotHeight;
        const y = height - margin.bottom - barHeight;
        const labelX = x + barWidth / 2;
        const labelY = height - margin.bottom + 12;

        return (
          <g key={`${record.label}-${index}`}>
            {record.isSeparator ? (
              <text
                x={labelX}
                y={height - margin.bottom - plotHeight * 0.2}
                textAnchor="middle"
                className="retention-separator"
              >
                ...
              </text>
            ) : (
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={1.5}
                className="retention-bar"
                onMouseMove={(event) => onHover(event, record)}
                onMouseLeave={onLeave}
              />
            )}
            <text
              x={labelX}
              y={labelY}
              transform={`rotate(-65 ${labelX} ${labelY})`}
              textAnchor="end"
              className="retention-x-label"
            >
              {record.label}
            </text>
          </g>
        );
      })}
      <text x={(margin.left + width - margin.right) / 2} y={height - 20} textAnchor="middle" className="retention-axis-title">
        {xTitle}
      </text>
      <text
        x={26}
        y={(margin.top + height - margin.bottom) / 2}
        transform={`rotate(-90 26 ${(margin.top + height - margin.bottom) / 2})`}
        textAnchor="middle"
        className="retention-axis-title"
      >
        {yTitle}
      </text>
    </svg>
  );
}

export default function GeneRetentionAbsenceClient() {
  const svgWrapRef = useRef<HTMLDivElement | null>(null);
  const [data, setData] = useState<ParsedRetentionData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [geneMode, setGeneMode] = useState<"core" | "all" | "custom">("core");
  const [customGenes, setCustomGenes] = useState<string[]>([]);
  const [lineageLevel, setLineageLevel] = useState("phylum");
  const [minGenesPresent, setMinGenesPresent] = useState(25);
  const [minLineageSize, setMinLineageSize] = useState(5);
  const [showLineageExtremes, setShowLineageExtremes] = useState(true);
  const [lineageDisplayCount, setLineageDisplayCount] = useState(20);
  const [excludeDidermGenes, setExcludeDidermGenes] = useState(true);
  const [tooltip, setTooltip] = useState<TooltipState>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetch(withBasePath(DATA_URL))
      .then((response) => {
        if (!response.ok) throw new Error("Could not load the phyletic distribution table.");
        return response.text();
      })
      .then((text) => {
        if (cancelled) return;
        const parsed = parseDistributionTable(text);
        const availableGenes = new Set(parsed.genes);
        setData(parsed);
        setCustomGenes(CORE_FLAGELLAR_GENES.filter((gene) => availableGenes.has(gene)));
        setLineageLevel(parsed.taxa.includes("phylum") ? "phylum" : parsed.taxa[0] ?? "");
        setLoadError(null);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedGeneIndexes = useMemo(() => {
    if (!data) return [];
    const coreSet = new Set(CORE_FLAGELLAR_GENES);
    const customSet = new Set(customGenes);
    return data.genes
      .map((gene, index) => ({ gene, index }))
      .filter(({ gene }) => {
        if (geneMode === "all") return true;
        if (geneMode === "custom") return customSet.has(gene);
        return coreSet.has(gene);
      })
      .map(({ index }) => index);
  }, [customGenes, data, geneMode]);

  const analysis = useMemo(() => {
    if (!data || selectedGeneIndexes.length === 0) return null;

    const selectedGenes = selectedGeneIndexes.map((index) => data.genes[index]);
    const threshold = Math.max(0, Math.min(selectedGeneIndexes.length, minGenesPresent));
    const rows = data.rows.filter((row) => {
      let present = 0;
      for (const index of selectedGeneIndexes) {
        if (row.counts[index] > 0) present += 1;
      }
      return present >= threshold;
    });

    const histogram = new Map<number, number>();
    for (let count = threshold; count <= selectedGeneIndexes.length; count += 1) {
      histogram.set(count, 0);
    }
    for (const row of rows) {
      let present = 0;
      for (const index of selectedGeneIndexes) {
        if (row.counts[index] > 0) present += 1;
      }
      if (present >= threshold) {
        histogram.set(present, (histogram.get(present) ?? 0) + 1);
      }
    }

    const panelA = Array.from(histogram.entries()).map(([label, value]) => ({
      label: String(label),
      value
    }));

    const panelB = selectedGeneIndexes
      .map((geneIndex) => {
        let present = 0;
        for (const row of rows) {
          if (row.counts[geneIndex] > 0) present += 1;
        }
        return {
          label: data.genes[geneIndex],
          value: rows.length > 0 ? 100 * (1 - present / rows.length) : 0,
          n: rows.length - present
        };
      })
      .sort((a, b) => b.value - a.value);

    const panelCGenes = excludeDidermGenes
      ? selectedGeneIndexes.filter((index) => !DIDERM_SPECIFIC_GENES.has(data.genes[index]))
      : selectedGeneIndexes;
    const lineageGroups = new Map<string, typeof rows>();
    for (const row of rows) {
      const lineage = normalizeLineage(row.taxonomy, lineageLevel);
      if (!lineage) continue;
      const group = lineageGroups.get(lineage) ?? [];
      group.push(row);
      lineageGroups.set(lineage, group);
    }

    const panelC = Array.from(lineageGroups.entries())
      .filter(([, group]) => group.length >= minLineageSize)
      .map(([label, group]) => {
        let absent = 0;
        const total = group.length * panelCGenes.length;
        for (const row of group) {
          for (const index of panelCGenes) {
            if (row.counts[index] <= 0) absent += 1;
          }
        }
        return {
          label,
          value: total > 0 ? (100 * absent) / total : 0,
          n: group.length
        };
      })
      .sort((a, b) => b.value - a.value);

    return {
      rows,
      selectedGenes,
      panelA,
      panelB,
      panelC,
      lineageCount: panelC.length
    };
  }, [data, excludeDidermGenes, lineageLevel, minGenesPresent, minLineageSize, selectedGeneIndexes]);

  const maxGenes = selectedGeneIndexes.length;
  const customGeneSet = useMemo(() => new Set(customGenes), [customGenes]);
  const panelCRecords = useMemo(() => {
    if (!analysis) return [];
    if (!showLineageExtremes) return analysis.panelC;
    return selectTopAndBottom(analysis.panelC, lineageDisplayCount);
  }, [analysis, lineageDisplayCount, showLineageExtremes]);

  useEffect(() => {
    if (maxGenes === 0) return;
    setMinGenesPresent((current) => Math.min(current, maxGenes));
  }, [maxGenes]);

  function showTooltip(event: React.MouseEvent<SVGRectElement>, record: PlotRecord) {
    const details = [`Value: ${record.value.toFixed(2)}`];
    if (record.n != null) details.push(`n: ${record.n.toLocaleString()}`);
    setTooltip({
      x: Math.min(event.clientX + 12, window.innerWidth - 240),
      y: Math.min(event.clientY + 12, window.innerHeight - 90),
      title: record.label,
      details
    });
  }

  return (
    <section className="retention-tool">
      <div className="retention-controls">
        <RetentionSelect
          label="Gene set"
          value={geneMode}
          options={[
            { label: "Ancestral Genes", value: "core" },
            { label: "All detected genes", value: "all" },
            { label: "Custom", value: "custom" }
          ]}
          onChange={(nextValue) => setGeneMode(nextValue as "core" | "all" | "custom")}
        />
        <RetentionSelect
          label="Lineage level"
          value={lineageLevel}
          options={(data?.taxa ?? TAXON_COLUMNS).map((column) => ({
            label: column,
            value: column
          }))}
          onChange={setLineageLevel}
        />
        <label>
          <span>Minimum retained genes</span>
          <CommitNumberInput
            min={0}
            max={maxGenes}
            value={minGenesPresent}
            onCommit={setMinGenesPresent}
          />
        </label>
        <label>
          <span>Minimum lineage size</span>
          <CommitNumberInput
            min={1}
            value={minLineageSize}
            onCommit={setMinLineageSize}
          />
        </label>
        <button
          type="button"
          className="button button-secondary retention-download-button"
          onClick={() => downloadFigureSvg(svgWrapRef.current)}
          disabled={!analysis}
        >
          <Download size={16} aria-hidden="true" />
          Download SVG
        </button>
      </div>

      {geneMode === "custom" && data ? (
        <div className="retention-gene-popover">
          <div className="retention-gene-popover-header">
            <div>
              <strong>Custom gene set</strong>
              <span>
                Selected {customGenes.length.toLocaleString()} / {data.genes.length.toLocaleString()} genes
              </span>
            </div>
            <div className="retention-gene-popover-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setCustomGenes([...data.genes])}
              >
                Select all
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setCustomGenes([])}
              >
                Clear all
              </button>
            </div>
          </div>
          <div className="retention-gene-grid">
            {data.genes.map((gene) => {
              const checked = customGeneSet.has(gene);
              return (
                <label key={gene} className="retention-gene-option">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      setCustomGenes((current) => {
                        if (event.target.checked) {
                          return current.includes(gene) ? current : [...current, gene];
                        }
                        return current.filter((item) => item !== gene);
                      });
                    }}
                  />
                  <span>{gene}</span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <div className="retention-status">
          <Loader2 className="retention-spinner" size={18} aria-hidden="true" />
          Loading phyletic distribution table...
        </div>
      ) : null}

      {loadError ? <p className="error-note">{loadError}</p> : null}

      {analysis ? (
        <>
          <div className="retention-summary-grid">
            <div>
              <strong>{analysis.rows.length.toLocaleString()}</strong>
              <span>Genomes After Filtering</span>
            </div>
            <div>
              <strong>{analysis.selectedGenes.length.toLocaleString()}</strong>
              <span>Selected Genes</span>
            </div>
            <div>
              <strong>{analysis.lineageCount.toLocaleString()}</strong>
              <span>Number of Lineages</span>
            </div>
          </div>

          <div className="retention-figure-wrap" ref={svgWrapRef}>
            <BarPanel
              xTitle="Number of genes"
              yTitle="Number of genomes"
              records={analysis.panelA}
              onHover={showTooltip}
              onLeave={() => setTooltip(null)}
            />
            <BarPanel
              xTitle="Genes"
              yTitle="% Gene Absence"
              records={analysis.panelB}
              onHover={showTooltip}
              onLeave={() => setTooltip(null)}
            />
            <div className="retention-combined-panel">
              <div className="retention-panel-controls" aria-label="Lineage plot display controls">
                <label className="retention-checkbox-label">
                  <input
                    type="checkbox"
                    checked={showLineageExtremes}
                    onChange={(event) => setShowLineageExtremes(event.target.checked)}
                  />
                  <span>Show Extremes</span>
                </label>
                <label className="retention-checkbox-label">
                  <input
                    type="checkbox"
                    checked={excludeDidermGenes}
                    onChange={(event) => setExcludeDidermGenes(event.target.checked)}
                  />
                  <span>Exclude diderm-specific genes (FlgH, FlgI, FlgA, FlgJ)</span>
                </label>
                <label>
                  <span>Lineages per side</span>
                  <CommitNumberInput
                    min={1}
                    max={50}
                    value={lineageDisplayCount}
                    disabled={!showLineageExtremes}
                    onCommit={setLineageDisplayCount}
                  />
                </label>
                <p>
                  Showing{" "}
                  <strong>
                    {(showLineageExtremes ? panelCRecords.length : analysis.panelC.length).toLocaleString()}
                  </strong>{" "}
                  of <strong>{analysis.panelC.length.toLocaleString()}</strong> eligible {lineageLevel} groups.
                </p>
              </div>
              <BarPanel
                xTitle={lineageLevel}
                yTitle="Average Gene Absence %"
                records={panelCRecords}
                onHover={showTooltip}
                onLeave={() => setTooltip(null)}
              />
            </div>
          </div>
        </>
      ) : null}

      {tooltip ? (
        <div className="retention-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <strong>{tooltip.title}</strong>
          {tooltip.details.map((detail) => (
            <span key={detail}>{detail}</span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
