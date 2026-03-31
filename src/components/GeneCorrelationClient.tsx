"use client";

import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { withBasePath } from "@/lib/assetPaths";
import {
  GENE_COUNT_SUFFIX,
  buildWeights,
  computeJaccardMatrix,
  escapeHtml,
  fmt,
  hierarchicalClustering,
  jaccardToColor,
  leafOrderFromTree,
  parseDelimited,
  pickDefaultTaxonColumn,
  reorderMatrix,
  taxonColumnCandidates,
  toDistanceMatrix,
  type ClusterNode,
  type JaccardStats,
  type ParsedTable,
  type WeightingMode
} from "@/lib/geneCorrelation/jaccardHeatmapCore";
import { DownloadActionButton } from "@/components/DownloadActionButton";
import { CheckSquare, ChevronDown, Info, Square } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function normalizeGeneQuery(value: string): string {
  return value.toLowerCase().trim();
}

const DATA_URL = "/flagellar_genes_phyletic_distribution.tsv";
const FIXED_ALPHA = 1;
const FONT_SIZE = 14;
const EXTEND_TIPS = true;
const DEFAULT_LOW = "#7caec4";
const DEFAULT_HIGH = "#dd6030";

const HEATMAP_TITLE = "Clustered Gene Co-presence Heatmap";

type HeatmapSvgTheme = {
  canvasBg: string;
  dendroStroke: string;
  dendroGuide: string;
  labelText: string;
  hoverGuide: string;
  hoverOutline: string;
  cellNaN: string;
  heatmapBorder: string;
  colorbarBorder: string;
  tickStroke: string;
  tickText: string;
  colorbarTitle: string;
  gradientMid: string;
};

const HEATMAP_SVG_THEME_LIGHT: HeatmapSvgTheme = {
  canvasBg: "#ffffff",
  dendroStroke: "#333333",
  dendroGuide: "#8a8a8a",
  labelText: "#222222",
  hoverGuide: "#1f1f1f",
  hoverOutline: "#222222",
  cellNaN: "#f2f2f2",
  heatmapBorder: "#777777",
  colorbarBorder: "#888888",
  tickStroke: "#555555",
  tickText: "#333333",
  colorbarTitle: "#333333",
  gradientMid: "#ffffff"
};

const HEATMAP_SVG_THEME_DARK: HeatmapSvgTheme = {
  canvasBg: "#222228",
  dendroStroke: "#aeb8cc",
  dendroGuide: "#6b7588",
  labelText: "#e8ecf4",
  hoverGuide: "#c8d0e4",
  hoverOutline: "#e8ecf4",
  cellNaN: "#3a3f4d",
  heatmapBorder: "#5c6678",
  colorbarBorder: "#7a8599",
  tickStroke: "#8a93a8",
  tickText: "#dce4f4",
  colorbarTitle: "#e8ecf4",
  gradientMid: "#f0f4fc"
};

function makeSvgNode<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {}
): SVGElementTagNameMap[K] {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  return el;
}

const measureCanvas =
  typeof document !== "undefined" ? document.createElement("canvas") : null;
const measureCtx = measureCanvas?.getContext("2d");

function measureTextWidthPx(text: string, fontSize: number): number {
  if (!measureCtx) {
    return String(text).length * fontSize * 0.58;
  }
  measureCtx.font = `${fontSize}px Arial, sans-serif`;
  return measureCtx.measureText(String(text)).width;
}

function drawDendrogramLines(
  group: SVGGElement,
  root: ClusterNode,
  orderIndexMap: Map<number, number>,
  dendroX: number,
  dendroW: number,
  heatY: number,
  cellSize: number,
  maxH: number,
  extendTips: boolean,
  rowLabelAnchorX: number,
  orderedLabels: string[],
  fontSize: number,
  dendroStroke: string,
  dendroGuide: string
): void {
  function xFromHeight(h: number): number {
    const t = maxH <= 0 ? 0 : h / maxH;
    return dendroX + dendroW - t * dendroW;
  }
  function yFromIndex(i: number): number {
    return heatY + (i + 0.5) * cellSize;
  }
  function recurse(node: ClusterNode): number {
    if (!node.left && !node.right) {
      return orderIndexMap.get(node.members[0])!;
    }

    const yL = recurse(node.left!);
    const yR = recurse(node.right!);
    const yMin = Math.min(yL, yR);
    const yMax = Math.max(yL, yR);

    const xNode = xFromHeight(node.height);
    const xLeft = xFromHeight(node.left!.left || node.left!.right ? node.left!.height : 0);
    const xRight = xFromHeight(node.right!.left || node.right!.right ? node.right!.height : 0);

    group.appendChild(
      makeSvgNode("line", {
        x1: xNode,
        y1: yFromIndex(yMin),
        x2: xNode,
        y2: yFromIndex(yMax),
        stroke: dendroStroke,
        "stroke-width": 1
      })
    );
    group.appendChild(
      makeSvgNode("line", {
        x1: xLeft,
        y1: yFromIndex(yL),
        x2: xNode,
        y2: yFromIndex(yL),
        stroke: dendroStroke,
        "stroke-width": 1
      })
    );
    group.appendChild(
      makeSvgNode("line", {
        x1: xRight,
        y1: yFromIndex(yR),
        x2: xNode,
        y2: yFromIndex(yR),
        stroke: dendroStroke,
        "stroke-width": 1
      })
    );
    return (yL + yR) / 2;
  }
  recurse(root);

  if (extendTips) {
    const tipStartX = xFromHeight(0);
    for (let i = 0; i < orderIndexMap.size; i++) {
      const label = String(orderedLabels[i] ?? "");
      const textWidth = measureTextWidthPx(label, fontSize);
      const labelLeftX = rowLabelAnchorX - textWidth;
      const guideEndX = labelLeftX - 4;
      const x1 = Math.min(tipStartX + 1, guideEndX);
      const x2 = Math.max(tipStartX + 1, guideEndX);
      const y = yFromIndex(i);
      group.appendChild(
        makeSvgNode("line", {
          x1,
          y1: y,
          x2,
          y2: y,
          stroke: dendroGuide,
          "stroke-width": 0.9,
          "stroke-dasharray": "2,3"
        })
      );
    }
  }
}

type TooltipState = { x: number; y: number; html: string } | null;

type DrawArgs = {
  svg: SVGSVGElement;
  labels: string[];
  sim: number[][];
  stats: JaccardStats;
  blueHex: string;
  redHex: string;
  fontSize: number;
  extendTips: boolean;
  gradientId: string;
  svgTheme: HeatmapSvgTheme;
  onCellHover: (state: TooltipState) => void;
};

function drawClusteredHeatmap({
  svg,
  labels,
  sim,
  stats,
  blueHex,
  redHex,
  fontSize,
  extendTips,
  gradientId,
  svgTheme,
  onCellHover
}: DrawArgs): void {
  const n = labels.length;
  if (n === 0) {
    throw new Error("No genes to draw.");
  }
  const dist = toDistanceMatrix(sim);
  const tree = hierarchicalClustering(dist);
  const order = leafOrderFromTree(tree);
  const orderPos = new Map(order.map((leaf, idx) => [leaf, idx]));
  const orderedLabels = order.map((i) => labels[i]);
  const orderedSim = reorderMatrix(sim, order);
  const orderedBoth = reorderMatrix(stats.bothCountMatrix, order);
  const maxHeight = Math.max(tree.height, 0.05);

  const cellSize = Math.max(fontSize + 4, Math.min(26, Math.floor(780 / n)));
  const heatSize = n * cellSize;
  const dendroW = Math.max(160, Math.min(320, Math.floor(heatSize * 0.35)));
  const colorbarW = 18;
  const titleH = 0;
  const maxLabelChars = labels.reduce((m, s) => Math.max(m, String(s).length), 0);
  const rowLabelW = Math.max(90, Math.min(150, Math.ceil(maxLabelChars * fontSize * 0.5) + 12));
  const xLabelH = Math.max(36, Math.min(210, Math.ceil(maxLabelChars * fontSize * 0.62) + 8));
  const bottomPad = 24;
  const topPad = 8;
  const labelGap = 6;
  const xLabelShift = 3;

  const colorbarH = Math.max(110, Math.min(220, Math.floor(heatSize * 0.32)));
  const colorbarTickFont = Math.max(11, Math.min(13, fontSize));
  const colorbarTitleFont = Math.max(12, Math.min(14, fontSize + 1));
  const dendroToLabelGap = 10;
  const labelBaseColor = svgTheme.labelText;
  const width = 20 + dendroW + dendroToLabelGap + rowLabelW + heatSize + 24 + colorbarW + 84;
  const height = topPad + titleH + xLabelH + heatSize + bottomPad;

  const dendroX = 20;
  const heatX = dendroX + dendroW + dendroToLabelGap + rowLabelW;
  const heatY = topPad + titleH + xLabelH;
  const colorbarX = heatX + heatSize + 24;
  const colorbarY = heatY + 8;
  const rowLabelAnchorX = heatX - labelGap;

  while (svg.firstChild) {
    svg.removeChild(svg.firstChild);
  }
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));

  svg.appendChild(
    makeSvgNode("rect", { x: 0, y: 0, width, height, fill: svgTheme.canvasBg })
  );

  const dendroGroup = makeSvgNode("g") as SVGGElement;
  drawDendrogramLines(
    dendroGroup,
    tree,
    orderPos,
    dendroX,
    dendroW,
    heatY,
    cellSize,
    maxHeight,
    extendTips,
    rowLabelAnchorX,
    orderedLabels,
    fontSize,
    svgTheme.dendroStroke,
    svgTheme.dendroGuide
  );
  svg.appendChild(dendroGroup);

  const cellRects: Array<Array<SVGRectElement | null>> = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => null)
  );
  const rowLabelNodes: SVGTextElement[] = [];
  const colLabelNodes: SVGTextElement[] = [];
  const hoverGuideRow = makeSvgNode("line", {
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 0,
    stroke: svgTheme.hoverGuide,
    "stroke-width": 1.2,
    "stroke-dasharray": "3,3",
    "stroke-linecap": "round",
    "pointer-events": "none",
    opacity: 0
  });
  const hoverGuideCol = makeSvgNode("line", {
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 0,
    stroke: svgTheme.hoverGuide,
    "stroke-width": 1.2,
    "stroke-dasharray": "3,3",
    "stroke-linecap": "round",
    "pointer-events": "none",
    opacity: 0
  });
  const hoverCellOutline = makeSvgNode("rect", {
    x: 0,
    y: 0,
    width: cellSize,
    height: cellSize,
    fill: "none",
    stroke: svgTheme.hoverOutline,
    "stroke-width": 1.2,
    "pointer-events": "none",
    opacity: 0
  });

  function clearHoverFocus(): void {
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const cell = cellRects[r][c];
        if (!cell) {
          continue;
        }
        cell.setAttribute("opacity", "1");
      }
    }
    for (const t of rowLabelNodes) {
      t.setAttribute("opacity", "1");
      t.setAttribute("font-weight", "500");
      t.setAttribute("fill", labelBaseColor);
    }
    for (const t of colLabelNodes) {
      t.setAttribute("opacity", "1");
      t.setAttribute("font-weight", "500");
      t.setAttribute("fill", labelBaseColor);
    }
    hoverGuideRow.setAttribute("opacity", "0");
    hoverGuideCol.setAttribute("opacity", "0");
    hoverCellOutline.setAttribute("opacity", "0");
  }

  function applyHoverFocus(i: number, j: number): void {
    const cellCx = heatX + (j + 0.5) * cellSize;
    const cellCy = heatY + (i + 0.5) * cellSize;
    const cellX = heatX + j * cellSize;
    const cellY = heatY + i * cellSize;

    for (let r = 0; r < n; r++) {
      rowLabelNodes[r].setAttribute("opacity", "1");
      rowLabelNodes[r].setAttribute("font-weight", r === i ? "700" : "500");
      rowLabelNodes[r].setAttribute("fill", labelBaseColor);
    }
    for (let c = 0; c < n; c++) {
      colLabelNodes[c].setAttribute("opacity", "1");
      colLabelNodes[c].setAttribute("font-weight", c === j ? "700" : "500");
      colLabelNodes[c].setAttribute("fill", labelBaseColor);
    }

    hoverGuideRow.setAttribute("x1", String(rowLabelAnchorX + 2));
    hoverGuideRow.setAttribute("y1", String(cellCy));
    hoverGuideRow.setAttribute("x2", String(cellX - 1));
    hoverGuideRow.setAttribute("y2", String(cellCy));
    hoverGuideRow.setAttribute("opacity", "1");

    hoverGuideCol.setAttribute("x1", String(cellCx));
    hoverGuideCol.setAttribute("y1", String(heatY - labelGap - 2));
    hoverGuideCol.setAttribute("x2", String(cellCx));
    hoverGuideCol.setAttribute("y2", String(cellY - 1));
    hoverGuideCol.setAttribute("opacity", "1");

    hoverCellOutline.setAttribute("x", String(cellX));
    hoverCellOutline.setAttribute("y", String(cellY));
    hoverCellOutline.setAttribute("width", String(cellSize));
    hoverCellOutline.setAttribute("height", String(cellSize));
    hoverCellOutline.setAttribute("opacity", "1");
  }

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = orderedSim[i][j];
      const color = Number.isFinite(v)
        ? jaccardToColor(v, blueHex, redHex)
        : svgTheme.cellNaN;
      const rect = makeSvgNode("rect", {
        x: heatX + j * cellSize,
        y: heatY + i * cellSize,
        width: cellSize,
        height: cellSize,
        fill: color,
        stroke: "none"
      }) as SVGRectElement;
      cellRects[i][j] = rect;
      rect.addEventListener("mouseenter", () => applyHoverFocus(i, j));
      rect.addEventListener("mousemove", (evt) => {
        const geneRow = orderedLabels[i];
        const geneCol = orderedLabels[j];
        const html =
          `<b>Row gene:</b> ${escapeHtml(geneRow)}<br>` +
          `<b>Column gene:</b> ${escapeHtml(geneCol)}<br>` +
          `<b>Jaccard:</b> ${fmt(v, 4)}<br>` +
          `<b>Co-present genomes:</b> ${orderedBoth[i][j].toLocaleString()}`;
        onCellHover({ x: evt.clientX, y: evt.clientY, html });
      });
      rect.addEventListener("mouseleave", () => {
        onCellHover(null);
        clearHoverFocus();
      });
      svg.appendChild(rect);
    }
  }

  svg.appendChild(
    makeSvgNode("rect", {
      x: heatX,
      y: heatY,
      width: heatSize,
      height: heatSize,
      fill: "none",
      stroke: svgTheme.heatmapBorder,
      "stroke-width": 0.7
    })
  );

  for (let i = 0; i < n; i++) {
    const txt = makeSvgNode("text", {
      x: rowLabelAnchorX,
      y: heatY + (i + 0.5) * cellSize,
      "text-anchor": "end",
      "dominant-baseline": "middle",
      "font-size": fontSize,
      fill: svgTheme.labelText
    }) as SVGTextElement;
    txt.textContent = orderedLabels[i];
    rowLabelNodes.push(txt);
    svg.appendChild(txt);
  }

  for (let j = 0; j < n; j++) {
    const x = heatX + (j + 0.5) * cellSize + xLabelShift;
    const y = heatY - labelGap;
    const txt = makeSvgNode("text", {
      x,
      y,
      "font-size": fontSize,
      fill: svgTheme.labelText,
      transform: `rotate(-90 ${x} ${y})`,
      "text-anchor": "start"
    }) as SVGTextElement;
    txt.textContent = orderedLabels[j];
    colLabelNodes.push(txt);
    svg.appendChild(txt);
  }

  const defs = makeSvgNode("defs");
  const lg = makeSvgNode("linearGradient", {
    id: gradientId,
    x1: "0%",
    y1: "100%",
    x2: "0%",
    y2: "0%"
  });
  lg.appendChild(makeSvgNode("stop", { offset: "0%", "stop-color": blueHex }));
  lg.appendChild(makeSvgNode("stop", { offset: "50%", "stop-color": svgTheme.gradientMid }));
  lg.appendChild(makeSvgNode("stop", { offset: "100%", "stop-color": redHex }));
  defs.appendChild(lg);
  svg.appendChild(defs);

  svg.appendChild(
    makeSvgNode("rect", {
      x: colorbarX,
      y: colorbarY,
      width: colorbarW,
      height: colorbarH,
      fill: `url(#${gradientId})`,
      stroke: svgTheme.colorbarBorder,
      "stroke-width": 0.6,
      rx: 2,
      ry: 2
    })
  );

  const ticks = [0, 0.5, 1];
  for (const t of ticks) {
    const yy = colorbarY + colorbarH - t * colorbarH;
    svg.appendChild(
      makeSvgNode("line", {
        x1: colorbarX + colorbarW,
        y1: yy,
        x2: colorbarX + colorbarW + 5,
        y2: yy,
        stroke: svgTheme.tickStroke,
        "stroke-width": 1
      })
    );
    const tickText = makeSvgNode("text", {
      x: colorbarX + colorbarW + 8,
      y: yy,
      "dominant-baseline": "middle",
      "font-size": colorbarTickFont,
      fill: svgTheme.tickText
    }) as SVGTextElement;
    tickText.textContent = t.toFixed(1);
    svg.appendChild(tickText);
  }
  const cbarTitle = makeSvgNode("text", {
    x: colorbarX + colorbarW / 2,
    y: colorbarY - 10,
    "text-anchor": "middle",
    "font-size": colorbarTitleFont,
    "font-weight": 600,
    fill: svgTheme.colorbarTitle
  }) as SVGTextElement;
  cbarTitle.textContent = "Similarity";
  svg.appendChild(cbarTitle);

  svg.appendChild(hoverGuideRow);
  svg.appendChild(hoverGuideCol);
  svg.appendChild(hoverCellOutline);
}

const controlSelectClass =
  "w-full min-h-[38px] rounded-md border px-2 py-2 text-sm outline-none border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--text)] focus-visible:border-[var(--primary)]";

const controlLabelClass = "text-xs font-semibold text-[var(--text)]";

const geneSearchInputClass = `${controlSelectClass} h-full min-h-[38px] text-left placeholder:text-[var(--text-soft)]`;

function ControlOptionHint({
  id,
  label,
  children
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <span className="relative inline-flex align-middle shrink-0 group">
      <button
        type="button"
        className="rounded-full p-0.5 text-[var(--text-soft)] hover:text-[var(--text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-1"
        aria-label={label}
        aria-describedby={id}
      >
        <Info className="w-4 h-4" strokeWidth={2} aria-hidden />
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute left-1/2 bottom-[calc(100%+8px)] z-[100] w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-[var(--surface-border)] bg-[var(--dropdown-bg)] px-3 py-2.5 text-left text-sm font-normal leading-relaxed text-[var(--text)] shadow-lg opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}

function OptionLabelRow({
  htmlFor,
  hintId,
  hintLabel,
  hint,
  children
}: {
  htmlFor: string;
  hintId: string;
  hintLabel: string;
  hint: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1 min-w-0">
      <label htmlFor={htmlFor} className={cn(controlLabelClass, "m-0 min-w-0 cursor-pointer")}>
        {children}
      </label>
      <ControlOptionHint id={hintId} label={hintLabel}>
        {hint}
      </ControlOptionHint>
    </div>
  );
}

type ThemedListboxOption<V extends string = string> = { value: V; label: string };

function ThemedListboxSelect<V extends string>({
  id,
  value,
  onChange,
  options,
  disabled
}: {
  id: string;
  value: V;
  onChange: (v: V) => void;
  options: readonly ThemedListboxOption<V>[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) {
        return;
      }
      if (shellRef.current?.contains(t)) {
        return;
      }
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const isDisabled = Boolean(disabled) || options.length === 0;
  const selectedLabel =
    options.find((o) => o.value === value)?.label ??
    (options.length === 0 ? "(no taxonomy columns)" : String(value));

  return (
    <div ref={shellRef} className="autocomplete-shell w-full">
      <button
        type="button"
        id={id}
        disabled={isDisabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? `${id}-listbox` : undefined}
        className={cn(
          controlSelectClass,
          "flex w-full cursor-pointer items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50"
        )}
        onClick={() => {
          if (!isDisabled) {
            setOpen((o) => !o);
          }
        }}
      >
        <span className="min-w-0 truncate">{selectedLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
      </button>
      {open && !isDisabled ? (
        <div id={`${id}-listbox`} role="listbox" className="autocomplete-dropdown">
          {options.map((opt) => (
            <button
              key={String(opt.value)}
              type="button"
              role="option"
              aria-selected={value === opt.value}
              className={cn(
                "autocomplete-item",
                value === opt.value ? "autocomplete-item-active" : ""
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const WEIGHTING_LISTBOX_OPTIONS: ThemedListboxOption<WeightingMode>[] = [
  { value: "none", label: "none" },
  { value: "inverse", label: "inverse" },
  { value: "inverse_sqrt", label: "inverse_sqrt" }
];

export default function GeneCorrelationClient() {
  const rawId = useId();
  const gradientId = `cbar-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [parsed, setParsed] = useState<ParsedTable | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [taxonCol, setTaxonCol] = useState("");
  const [weighting, setWeighting] = useState<WeightingMode>("inverse");
  const [lowColor, setLowColor] = useState(DEFAULT_LOW);
  const [highColor, setHighColor] = useState(DEFAULT_HIGH);
  const [selectedGenes, setSelectedGenes] = useState<string[]>([]);
  const [geneSearch, setGeneSearch] = useState("");
  const [geneDropdownOpen, setGeneDropdownOpen] = useState(false);
  const [geneActiveIndex, setGeneActiveIndex] = useState(-1);
  const [drawError, setDrawError] = useState<string | null>(null);
  const [heatmapDrawn, setHeatmapDrawn] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    const updateTheme = () => {
      setIsDarkMode(document.documentElement.getAttribute("data-theme") === "dark");
    };
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });
    return () => observer.disconnect();
  }, []);

  const taxonCandidates = useMemo(() => {
    if (!parsed) {
      return [];
    }
    return taxonColumnCandidates(parsed.headers, GENE_COUNT_SUFFIX);
  }, [parsed]);

  const geneNames = useMemo(() => {
    if (!parsed) {
      return [];
    }
    return parsed.headers
      .filter((h) => h.endsWith(GENE_COUNT_SUFFIX))
      .map((h) => h.slice(0, -GENE_COUNT_SUFFIX.length));
  }, [parsed]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(withBasePath(DATA_URL));
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const text = await res.text();
        if (cancelled) {
          return;
        }
        const table = parseDelimited(text);
        setParsed(table);
        setLoadError(null);
        const candidates = taxonColumnCandidates(table.headers, GENE_COUNT_SUFFIX);
        const defaultTaxon = pickDefaultTaxonColumn(candidates, null);
        setTaxonCol(defaultTaxon);
        const genes = table.headers
          .filter((h) => h.endsWith(GENE_COUNT_SUFFIX))
          .map((h) => h.slice(0, -GENE_COUNT_SUFFIX.length));
        setSelectedGenes(genes);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "Failed to load data.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (parsed && taxonCandidates.length > 0 && !taxonCandidates.includes(taxonCol)) {
      setTaxonCol(pickDefaultTaxonColumn(taxonCandidates, taxonCol));
    }
  }, [parsed, taxonCandidates, taxonCol]);

  const geneSuggestions = useMemo(() => {
    const query = normalizeGeneQuery(geneSearch);
    const base = query
      ? geneNames.filter((gene) => normalizeGeneQuery(gene).includes(query))
      : geneNames;
    return base.slice(0, 80);
  }, [geneNames, geneSearch]);

  useEffect(() => {
    if (geneSuggestions.length === 0) {
      setGeneActiveIndex(-1);
      return;
    }
    setGeneActiveIndex((current) => {
      if (current < 0) {
        return 0;
      }
      if (current >= geneSuggestions.length) {
        return geneSuggestions.length - 1;
      }
      return current;
    });
  }, [geneSuggestions]);

  const recomputeAndDraw = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || !parsed || !taxonCol) {
      setHeatmapDrawn(false);
      return;
    }
    if (selectedGenes.length === 0) {
      setDrawError("Select at least one gene.");
      setHeatmapDrawn(false);
      while (svg.firstChild) {
        svg.removeChild(svg.firstChild);
      }
      return;
    }
    try {
      const weights = buildWeights(parsed.rows, taxonCol, weighting, FIXED_ALPHA);
      const result = computeJaccardMatrix(
        parsed.rows,
        GENE_COUNT_SUFFIX,
        weights,
        new Set(selectedGenes)
      );
      drawClusteredHeatmap({
        svg,
        labels: result.labels,
        sim: result.sim,
        stats: result.stats,
        blueHex: lowColor,
        redHex: highColor,
        fontSize: FONT_SIZE,
        extendTips: EXTEND_TIPS,
        gradientId,
        svgTheme: isDarkMode ? HEATMAP_SVG_THEME_DARK : HEATMAP_SVG_THEME_LIGHT,
        onCellHover: setTooltip
      });
      setDrawError(null);
      setHeatmapDrawn(true);
    } catch (e) {
      setDrawError(e instanceof Error ? e.message : String(e));
      setHeatmapDrawn(false);
      while (svg.firstChild) {
        svg.removeChild(svg.firstChild);
      }
    }
  }, [
    parsed,
    taxonCol,
    weighting,
    lowColor,
    highColor,
    selectedGenes,
    gradientId,
    isDarkMode
  ]);

  const downloadHeatmapSvg = useCallback(() => {
    const svg = svgRef.current;
    if (!svg?.firstChild) {
      return;
    }
    const serializer = new XMLSerializer();
    let serialized = serializer.serializeToString(svg);
    if (!serialized.includes('xmlns="http://www.w3.org/2000/svg"')) {
      serialized = serialized.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`], {
      type: "image/svg+xml;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "clustered_gene_co_presence_heatmap.svg";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);

  useEffect(() => {
    recomputeAndDraw();
  }, [recomputeAndDraw]);

  const toggleGeneSelection = (gene: string, checked: boolean) => {
    setSelectedGenes((current) => {
      if (checked) {
        if (current.includes(gene)) {
          return current;
        }
        return [...current, gene];
      }
      return current.filter((item) => item !== gene);
    });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-[var(--surface)] p-5 sm:p-6 space-y-6">
        <h2 className="text-lg font-semibold text-[var(--text)] m-0">Controls and options</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-4 items-start">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
              <OptionLabelRow
                htmlFor="gc-gene-search"
                hintId="gc-hint-genes"
                hintLabel="About genes in the heatmap"
                hint={
                  <span className="block m-0">
                    Only selected genes are used in the heatmap and clustering. Search the list or
                    use Select All / Deselect All.
                  </span>
                }
              >
                Genes in heatmap
              </OptionLabelRow>
              <span className="text-xs font-semibold text-[var(--text)] tabular-nums shrink-0">
                {geneNames.length === 0
                  ? "—"
                  : `${selectedGenes.length} / ${geneNames.length}`}
              </span>
            </div>
            <div className="flex flex-wrap gap-2 items-stretch">
              <button
                type="button"
                className="button button-secondary table-action-button self-center shrink-0"
                onClick={() =>
                  setSelectedGenes(selectedGenes.length > 0 ? [] : [...geneNames])
                }
              >
                {selectedGenes.length > 0 ? (
                  <>
                    <Square className="table-action-icon" />
                    Deselect All
                  </>
                ) : (
                  <>
                    <CheckSquare className="table-action-icon" />
                    Select All
                  </>
                )}
              </button>
              <div className="autocomplete-shell flex-1 min-w-0 min-h-[38px]">
                <input
                  id="gc-gene-search"
                  type="text"
                  className={geneSearchInputClass}
                  placeholder="Search gene name and add…"
                  value={geneSearch}
                onFocus={() => setGeneDropdownOpen(true)}
                onBlur={() => {
                  setTimeout(() => setGeneDropdownOpen(false), 120);
                }}
                onChange={(event) => {
                  setGeneSearch(event.target.value);
                  setGeneDropdownOpen(true);
                  setGeneActiveIndex(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setGeneDropdownOpen(true);
                    setGeneActiveIndex((current) =>
                      Math.min(geneSuggestions.length - 1, Math.max(0, current + 1))
                    );
                    return;
                  }

                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setGeneDropdownOpen(true);
                    setGeneActiveIndex((current) => Math.max(0, current - 1));
                    return;
                  }

                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (
                      geneDropdownOpen &&
                      geneActiveIndex >= 0 &&
                      geneActiveIndex < geneSuggestions.length
                    ) {
                      const gene = geneSuggestions[geneActiveIndex];
                      const isChecked = selectedGenes.includes(gene);
                      toggleGeneSelection(gene, !isChecked);
                    }
                    return;
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    setGeneDropdownOpen(false);
                  }
                }}
              />

              {geneDropdownOpen && geneSuggestions.length > 0 ? (
                <div
                  className="autocomplete-dropdown"
                  onMouseDown={(event) => event.preventDefault()}
                >
                  {geneSuggestions.map((gene, idx) => (
                    <label
                      className={`autocomplete-item autocomplete-item-checkbox ${
                        idx === geneActiveIndex ? "autocomplete-item-active" : ""
                      }`}
                      key={gene}
                      onMouseEnter={() => setGeneActiveIndex(idx)}
                      onMouseDown={(event) => event.preventDefault()}
                    >
                      <input
                        type="checkbox"
                        checked={selectedGenes.includes(gene)}
                        onChange={(event) =>
                          toggleGeneSelection(gene, event.target.checked)
                        }
                      />
                      <span>{gene}</span>
                    </label>
                  ))}
                </div>
              ) : null}
              </div>
            </div>

            {selectedGenes.length === 0 ? (
              <p className="text-xs text-[var(--text-soft)] m-0 leading-snug">
                No genes selected. Search or use Select All for the co-presence heatmap.
              </p>
            ) : null}
          </div>

          <div className="min-w-0 space-y-1.5">
            <OptionLabelRow
              htmlFor="gc-taxon"
              hintId="gc-hint-taxon"
              hintLabel="About taxon normalization"
              hint={
                <span className="block m-0">
                  Which taxonomy column groups genomes (e.g. species vs. order). Finer ranks make
                  more, smaller groups; coarser ranks pool lineages for correcting sampling bias.
                  Pairs with Normalization factor, which adjusts weights within each group.
                </span>
              }
            >
              Taxon normalization
            </OptionLabelRow>
            <ThemedListboxSelect
              id="gc-taxon"
              value={taxonCol}
              onChange={setTaxonCol}
              options={taxonCandidates.map((c) => ({ value: c, label: c }))}
              disabled={taxonCandidates.length === 0}
            />
          </div>

          <div className="min-w-0 space-y-1.5">
            <OptionLabelRow
              htmlFor="gc-weight"
              hintId="gc-hint-weight"
              hintLabel="About normalization factor"
              hint={
                <span className="block m-0 space-y-1.5">
                  <span className="block">
                    <span className="font-medium">none</span> — every genome counts the same.
                  </span>
                  <span className="block">
                    <span className="font-medium">inverse</span> — big taxon groups contribute less
                    per genome (weight ∝ 1 ÷ group size).
                  </span>
                  <span className="block">
                    <span className="font-medium">inverse_sqrt</span> — for correcting sampling bias
                    with a weaker factor (weight ∝ 1 ÷ √(group size)).
                  </span>
                </span>
              }
            >
              Normalization factor
            </OptionLabelRow>
            <ThemedListboxSelect
              id="gc-weight"
              value={weighting}
              onChange={setWeighting}
              options={WEIGHTING_LISTBOX_OPTIONS}
            />
          </div>
        </div>

        <div className="border-t border-black/10 dark:border-white/10 pt-6 space-y-5">
        <div>
          <div className="flex items-center gap-1 mb-2">
            <p className={cn(controlLabelClass, "m-0")}>Similarity scale (colors)</p>
            <ControlOptionHint
              id="gc-hint-colors"
              label="About the color scale"
            >
              <span className="block m-0">
                Similarity runs from your low color through white at 0.5 to your high color. Tweak
                for contrast or to match other figures.
              </span>
            </ControlOptionHint>
          </div>
          <div className="flex flex-wrap gap-6 items-center">
            <div className="flex items-center gap-2">
              <label
                className="relative block w-5 h-5 rounded border border-[var(--surface-border)] overflow-hidden cursor-pointer shrink-0"
                title="Low similarity color"
              >
                <span
                  className="absolute inset-0"
                  style={{ backgroundColor: lowColor }}
                  aria-hidden
                />
                <input
                  type="color"
                  value={lowColor}
                  onChange={(e) => setLowColor(e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  aria-label="Low similarity color"
                />
              </label>
              <span className="text-sm font-medium text-[var(--text)]">Low similarity</span>
            </div>
            <div className="flex items-center gap-2">
              <label
                className="relative block w-5 h-5 rounded border border-[var(--surface-border)] overflow-hidden cursor-pointer shrink-0"
                title="High similarity color"
              >
                <span
                  className="absolute inset-0"
                  style={{ backgroundColor: highColor }}
                  aria-hidden
                />
                <input
                  type="color"
                  value={highColor}
                  onChange={(e) => setHighColor(e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  aria-label="High similarity color"
                />
              </label>
              <span className="text-sm font-medium text-[var(--text)]">High similarity</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setLowColor(DEFAULT_LOW);
                setHighColor(DEFAULT_HIGH);
              }}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Reset colors
            </button>
          </div>
        </div>

        {loadError ? (
          <p className="text-sm text-red-600 dark:text-red-400 m-0" role="alert">
            Could not load <code className="text-xs">{DATA_URL}</code>: {loadError}
          </p>
        ) : null}
        {drawError ? (
          <p className="text-sm text-red-600 dark:text-red-400 m-0" role="alert">
            {drawError}
          </p>
        ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-[var(--dialog-bg)] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 dark:border-white/10 px-4 py-4 sm:px-5">
          <h2 className="text-lg font-semibold text-[var(--text)] m-0">{HEATMAP_TITLE}</h2>
          <DownloadActionButton onClick={downloadHeatmapSvg} disabled={!heatmapDrawn}>
            Download SVG
          </DownloadActionButton>
        </div>
        <div className="overflow-auto min-h-[400px]">
          <svg
            ref={svgRef}
            className="block w-full h-auto"
            aria-label={HEATMAP_TITLE}
          />
        </div>
      </div>

      {tooltip && typeof window !== "undefined"
        ? createPortal(
            <div
              className="fixed z-50 pointer-events-none bg-white text-black dark:bg-black dark:text-white text-xs sm:text-sm rounded border border-gray-300 dark:border-gray-600 px-2 py-1 max-w-sm break-words shadow-lg"
              style={{
                left: Math.min(tooltip.x + 14, window.innerWidth - 220),
                top: Math.min(tooltip.y + 14, window.innerHeight - 120)
              }}
            >
              <div dangerouslySetInnerHTML={{ __html: tooltip.html }} />
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
