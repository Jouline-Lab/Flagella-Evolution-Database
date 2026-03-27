'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import * as d3 from 'd3';
import { Upload, Database, MousePointer, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { GTDBRecord, TaxonomicLevel } from '@/types/gene-visualization';

interface VisualizationCanvasProps {
  data: GTDBRecord[];
  selectedLevels: TaxonomicLevel[];
  activeGenes: string[];
  matrix: Uint8Array | null;
  coordMap: Map<string, number>;
  widthMap: Map<string, number>;
  asmIndex: Map<string, number>;
  geneIndex: Map<string, number>;
  countMap: Map<string, Record<string, number>>;
  onLineageClick: (level: TaxonomicLevel, category: string, range?: { start: number; end: number }) => void;
  onDomainClick: () => void;
  onWidthChange?: (width: number) => void;
  getColorScale: (level: TaxonomicLevel, categories: string[]) => (value: string) => string;
  rugMode?: 'binary' | 'normalized' | 'heatmap';
  onDownloadTSV?: () => void;
  showTopTree?: boolean;
  treeNewick?: string | null;
  treeLayoutMode?: 'phlogram' | 'cladogram';
  tipExtensionMode?: 'none' | 'solid' | 'dashed';
}

export type VisualizationCanvasHandle = {
  downloadSVG: () => void;
};

// Heatmap color anchors (wheat -> red -> black)
// Ranges: 1-5 (wheat->red), 5-20 (red->black), >20 saturates at black
const HEAT_MID_WHEAT = '#F5DEB3';
const HEAT_HIGH_RED = '#DC2626';
const HEAT_BLACK = '#000000';

type RugMode = 'binary' | 'normalized' | 'heatmap';
type TreeLayoutMode = 'phlogram' | 'cladogram';
const TREE_MATCH_LEVELS: TaxonomicLevel[] = ['order', 'species', 'genus', 'family', 'class', 'phylum'];

type CanvasRenderMeta = {
  activeGenes: string[];
  dataRef: GTDBRecord[];
  matrixRef: Uint8Array | null;
  selectedLevelsRef: TaxonomicLevel[];
  coordMapRef: Map<string, number>;
  widthMapRef: Map<string, number>;
  countMapRef: Map<string, Record<string, number>>;
  rugMode: RugMode;
  containerWidth: number;
  topTreeOffset: number;
  svgHeight: number;
};

type LineageRun = {
  cat: string;
  start: number;
  end: number;
};

function getRugColor(gene: string, count: number, maxCount: number, rugMode: RugMode): string {
  if (rugMode === 'binary') {
    return count > 0 ? 'rgb(0,0,0)' : 'rgb(255,255,255)';
  }
  if (rugMode === 'heatmap') {
    if (count <= 0) return 'rgb(255,255,255)';
    if (count <= 5) {
      const t = (count - 1) / 4;
      const c1 = d3.rgb(HEAT_MID_WHEAT);
      const c2 = d3.rgb(HEAT_HIGH_RED);
      const r = Math.round(c1.r + (c2.r - c1.r) * t);
      const g = Math.round(c1.g + (c2.g - c1.g) * t);
      const b = Math.round(c1.b + (c2.b - c1.b) * t);
      return `rgb(${r}, ${g}, ${b})`;
    }
    const t = (Math.min(count, 20) - 5) / 15;
    const c1 = d3.rgb(HEAT_HIGH_RED);
    const c2 = d3.rgb(HEAT_BLACK);
    const r = Math.round(c1.r + (c2.r - c1.r) * t);
    const g = Math.round(c1.g + (c2.g - c1.g) * t);
    const b = Math.round(c1.b + (c2.b - c1.b) * t);
    return `rgb(${r}, ${g}, ${b})`;
  }

  const norm = maxCount > 0 ? (count / maxCount) : 0;
  const intensity = Math.round(255 * (1 - norm));
  return `rgb(${intensity}, ${intensity}, ${intensity})`;
}

interface TooltipProps {
  isVisible: boolean;
  x: number;
  y: number;
  category: string;
  count: number;
  containerWidth: number;
  containerHeight: number;
  label?: string;
}

function Tooltip({ isVisible, x, y, category, count, label }: TooltipProps) {
  if (!isVisible) return null;
  return (
    <div
      className="viz-tooltip absolute pointer-events-none text-xs rounded px-2 py-1 shadow-lg z-50 whitespace-nowrap"
      style={{
        left: `${x - 12}px`,
        top: `${y + 12}px`,
        transform: 'translate(-100%, 0)'
      }}
    >
      <div className="font-semibold">{category}</div>
      <div>Count: {count.toLocaleString()}</div>
      {label ? (<div>{label}</div>) : null}
    </div>
  );
}

export const VisualizationCanvas = forwardRef<VisualizationCanvasHandle, VisualizationCanvasProps>(function VisualizationCanvas(
{
  data,
  selectedLevels,
  activeGenes,
  matrix,
  coordMap,
  widthMap,
  asmIndex,
  geneIndex,
  countMap,
  onLineageClick,
  onDomainClick,
  onWidthChange,
  getColorScale,
  rugMode = 'binary',
  onDownloadTSV,
  showTopTree = false,
  treeNewick = null,
  treeLayoutMode = 'phlogram',
  tipExtensionMode = 'none',
}: VisualizationCanvasProps,
ref
) {
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1200);
  const [lastSvgHeight, setLastSvgHeight] = useState(0);
  const prevCanvasMetaRef = useRef<CanvasRenderMeta | null>(null);

  const downloadSVG = useCallback(() => {
    if (!svgRef.current) return;
    const original = svgRef.current;
    const clone = original.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    clone.setAttribute('version', '1.1');
    const vbWidth = containerWidth;
    const vbHeight = (lastSvgHeight && lastSvgHeight > 0) ? lastSvgHeight : (canvasRef.current ? Math.round((canvasRef.current.height || 0) / (window.devicePixelRatio || 1)) : 0);
    if (vbWidth && vbHeight) {
      clone.setAttribute('viewBox', `0 0 ${vbWidth} ${vbHeight}`);
    }
    const canvas = canvasRef.current;
    if (canvas && canvas.width > 0 && canvas.height > 0) {
      const dataUrl = canvas.toDataURL('image/png');
      const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
      try { img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', dataUrl); } catch {}
      img.setAttribute('href', dataUrl);
      img.setAttribute('x', '0');
      img.setAttribute('y', '0');
      img.setAttribute('width', String(containerWidth));
      img.setAttribute('height', String((lastSvgHeight && lastSvgHeight > 0) ? lastSvgHeight : Math.round((canvas.height || 0) / (window.devicePixelRatio || 1)) || canvas.getBoundingClientRect().height));
      img.setAttribute('preserveAspectRatio', 'none');
      clone.insertBefore(img, clone.firstChild);
    }
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(clone);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gene-visualization.svg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [containerWidth, lastSvgHeight]);
  const [tooltip, setTooltip] = useState<{
    isVisible: boolean;
    x: number;
    y: number;
    level: string;
    category: string;
    count: number;
    label?: string;
  }>({
    isVisible: false,
    x: 0,
    y: 0,
    level: '',
    category: '',
    count: 0,
  });

  const [highlightedRect, setHighlightedRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const EXTRA_BOTTOM_PADDING = 50;
  const TREE_PANEL_HEIGHT = 230;
  const TREE_PANEL_GAP = 8;
  const topTreeOffset = showTopTree && treeNewick ? TREE_PANEL_HEIGHT + TREE_PANEL_GAP : 0;
  const parsedTree = useMemo(() => {
    if (!showTopTree || !treeNewick) return null;
    try {
      return parseNewick(treeNewick);
    } catch {
      return null;
    }
  }, [showTopTree, treeNewick]);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;

    const updateWidth = (newWidth: number) => {
      if (newWidth > 0 && Math.abs(newWidth - containerWidth) > 1) {
        setContainerWidth(newWidth);
        onWidthChange?.(newWidth);
      }
    };

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        let newWidth: number;
        if (entry.borderBoxSize && entry.borderBoxSize.length > 0) {
          newWidth = entry.borderBoxSize[0].inlineSize;
        } else {
          newWidth = entry.contentRect.width;
        }
        updateWidth(newWidth);
      }
    });

    resizeObserver.observe(container);

    const handleWindowResize = () => {
      const rect = container.getBoundingClientRect();
      updateWidth(rect.width);
    };

    window.addEventListener('resize', handleWindowResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [containerWidth, onWidthChange]);

  useEffect(() => {
    const detectWidth = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width > 0) {
          setContainerWidth(rect.width);
          onWidthChange?.(rect.width);
          return true;
        }
      }
      return false;
    };

    const timeouts: NodeJS.Timeout[] = [];

    if (!detectWidth()) {
      timeouts.push(setTimeout(() => {
        if (!detectWidth()) {
          timeouts.push(setTimeout(() => {
            if (!detectWidth()) {
              timeouts.push(setTimeout(() => {
                detectWidth();
              }, 1000));
            }
          }, 200));
        }
      }, 50));
    }

    const rafId = requestAnimationFrame(() => {
      detectWidth();
    });

    return () => {
      timeouts.forEach(clearTimeout);
      cancelAnimationFrame(rafId);
    };
  }, [onWidthChange]);

  useEffect(() => {
    if (!svgRef.current || !data.length || containerWidth <= 0 || coordMap.size === 0 || widthMap.size === 0) {
      return;
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const MARGINS = { top: 20 + topTreeOffset, right: 16, bottom: 24 + EXTRA_BOTTOM_PADDING, left: 100 };
    const AVAILABLE_WIDTH = containerWidth - MARGINS.left - MARGINS.right;
    if (AVAILABLE_WIDTH <= 100) {
      return;
    }

    const LEVEL_HEIGHT = 21;
    const INNER_PAD = 2;
    const RUG_HEIGHT = 10;
    const RUG_PAD = 3;
    const BASE_GAP = 15;

    const totalLevels = selectedLevels.length + 1;
    const svgHeight = MARGINS.top + totalLevels * LEVEL_HEIGHT + MARGINS.bottom;

    svg.attr('width', containerWidth)
       .attr('height', svgHeight);
    setLastSvgHeight(svgHeight);

    const plot = svg.append('g')
      .attr('class', 'plot-root')
      .attr('transform', `translate(${MARGINS.left},${MARGINS.top})`);

    const assemblies = data.map(d => d.assembly);
    const counts: Record<string, Map<string, number>> = {};

    selectedLevels.forEach(level => {
      const levelCounts = new Map<string, number>();
      data.forEach((record) => {
        const key = record[level];
        levelCounts.set(key, (levelCounts.get(key) ?? 0) + 1);
      });
      counts[level] = levelCounts;
    });

    const cleanLineageName = (name: string) => name.replace(/^[a-z]__/, '');
    const textFillForBg = (bg: string) => {
      const c = d3.color(bg);
      if (!c) return '#111827';
      const rgb = c.rgb();
      const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
      return brightness < 130 ? '#ffffff' : '#111827';
    };

    if (parsedTree) {
      const treeBottomY = MARGINS.top - 2;
      const treeTopY = 10;
      const treeHeight = treeBottomY - treeTopY;
      if (treeHeight > 12) {
        const treeGroup = svg.append('g')
          .attr('class', 'top-tree')
          .attr('transform', `translate(${MARGINS.left},${treeTopY})`);
        drawTopTree({
          group: treeGroup,
          root: parsedTree,
          data,
          coordMap,
          widthMap,
          treeHeight,
          treeLayoutMode,
          tipExtensionMode,
        });
      }
    }

    {
      const y = 0;
      const g = plot.append('g')
        .attr('class', 'level domain')
        .attr('transform', `translate(0,${y})`);

      const firstAsm = assemblies[0];
      const lastAsm = assemblies[assemblies.length - 1];
      const startX = coordMap.get(firstAsm) || 0;
      const endX = coordMap.get(lastAsm) || 0;
      const endW = widthMap.get(lastAsm) || 0;
      const rectWidth = endX + endW - startX;

      g.append('rect')
        .attr('x', startX)
        .attr('y', 0)
        .attr('width', rectWidth)
        .attr('height', LEVEL_HEIGHT - INNER_PAD)
        .attr('fill', 'var(--viz-domain-bg)')
        .attr('stroke', 'var(--viz-domain-stroke)')
        .attr('stroke-width', 0.5)
        .style('cursor', 'pointer')
        .on('click', () => {
          onDomainClick();
        })
        .on('mouseover', (e: MouseEvent) => {
          setHighlightedRect({
            x: startX,
            y: 0,
            width: rectWidth,
            height: LEVEL_HEIGHT - INNER_PAD,
          });
          const containerRect = containerRef.current?.getBoundingClientRect();
          if (containerRect && e) {
            setTooltip({
              isVisible: true,
              x: e.clientX - containerRect.left,
              y: e.clientY - containerRect.top,
              level: 'domain',
              category: 'Bacteria',
              count: assemblies.length,
            });
          }
        })
        .on('mouseout', () => {
          setHighlightedRect(null);
          setTooltip(prev => ({ ...prev, isVisible: false }));
        });

      const domainLabel = 'Bacteria';
      const approxCharWidth = 6;
      if (rectWidth - 6 > domainLabel.length * approxCharWidth) {
        g.append('text')
          .attr('x', startX + rectWidth / 2)
          .attr('y', (LEVEL_HEIGHT - INNER_PAD) / 2)
          .attr('dy', '.35em')
          .attr('text-anchor', 'middle')
          .text(domainLabel)
          .style('font-size', '10px')
          .style('font-weight', '500')
          .style('fill', 'var(--viz-label)');
      }

      g.append('text')
        .attr('x', -6)
        .attr('y', LEVEL_HEIGHT / 2)
        .attr('dy', '.35em')
        .attr('text-anchor', 'end')
        .text('domain')
        .style('font-size', '10px')
        .style('font-weight', '500')
        .style('fill', 'var(--viz-label)');
    }

    selectedLevels.forEach((level, i) => {
      const y = (i + 1) * LEVEL_HEIGHT;
      const g = plot.append('g')
        .attr('class', 'level')
        .attr('transform', `translate(0,${y})`);

      const runs: LineageRun[] = [];
      let start = 0;
      let currentCat = data[0][level];

      for (let k = 1; k < assemblies.length; k++) {
        if (data[k][level] !== currentCat) {
          runs.push({ cat: currentCat, start, end: k - 1 });
          currentCat = data[k][level];
          start = k;
        }
      }
      runs.push({ cat: currentCat, start, end: assemblies.length - 1 });

      const scale = getColorScale(level, Array.from(counts[level].keys()));

      g.selectAll('rect')
        .data(runs)
        .join('rect')
        .attr('x', (d: LineageRun) => coordMap.get(assemblies[d.start]) || 0)
        .attr('y', 0)
        .attr('width', (d: LineageRun) => {
          const startX = coordMap.get(assemblies[d.start]) || 0;
          const endX = coordMap.get(assemblies[d.end]) || 0;
          const endW = widthMap.get(assemblies[d.end]) || 0;
          return endX + endW - startX;
        })
        .attr('height', LEVEL_HEIGHT - INNER_PAD)
        .attr('fill', (d: LineageRun) => scale(d.cat))
        .attr('stroke', 'var(--viz-surface)')
        .attr('stroke-width', 0.5)
        .style('cursor', 'pointer')
        .on('click', (_event: MouseEvent, d: LineageRun) => {
          onLineageClick(level, d.cat, { start: d.start, end: d.end });
        })
        .on('mouseover', (e: MouseEvent, d: LineageRun) => {
          const startX = coordMap.get(assemblies[d.start]) || 0;
          const endX = coordMap.get(assemblies[d.end]) || 0;
          const endW = widthMap.get(assemblies[d.end]) || 0;
          const rectWidth = endX + endW - startX;

          setHighlightedRect({
            x: startX,
            y: y,
            width: rectWidth,
            height: LEVEL_HEIGHT - INNER_PAD,
          });

          const containerRect = containerRef.current?.getBoundingClientRect();
          if (containerRect && e) {
            setTooltip({
              isVisible: true,
              x: e.clientX - containerRect.left,
              y: e.clientY - containerRect.top,
              level: level,
              category: d.cat,
              count: counts[level].get(d.cat) || 0,
            });
          }
        })
        .on('mousemove', (evt: MouseEvent) => {
          const containerRect = containerRef.current?.getBoundingClientRect();
          if (containerRect) {
            setTooltip(prev => ({
              ...prev,
              x: evt.clientX - containerRect.left,
              y: evt.clientY - containerRect.top,
            }));
          }
        })
        .on('mouseout', () => {
          setHighlightedRect(null);
          setTooltip(prev => ({ ...prev, isVisible: false }));
        });

      g.selectAll('text.run-label')
        .data(runs)
        .join('text')
        .attr('class', 'run-label')
        .attr('x', (d: LineageRun) => {
          const startX = coordMap.get(assemblies[d.start]) || 0;
          const endX = coordMap.get(assemblies[d.end]) || 0;
          const endW = widthMap.get(assemblies[d.end]) || 0;
          return startX + (endX + endW - startX) / 2;
        })
        .attr('y', (LEVEL_HEIGHT - INNER_PAD) / 2)
        .attr('dy', '.35em')
        .attr('text-anchor', 'middle')
        .text((d: LineageRun) => cleanLineageName(d.cat))
        .style('font-size', '9px')
        .style('font-weight', '500')
        .style('fill', (d: LineageRun) => textFillForBg(scale(d.cat)))
        .style('pointer-events', 'none')
        .each(function(this: SVGTextElement, d: LineageRun) {
          const startX = coordMap.get(assemblies[d.start]) || 0;
          const endX = coordMap.get(assemblies[d.end]) || 0;
          const endW = widthMap.get(assemblies[d.end]) || 0;
          const w = endX + endW - startX;
          const label = cleanLineageName(d.cat);
          const approxCharWidth = 5.5;
          const fits = w - 6 > label.length * approxCharWidth;
          d3.select(this).style('opacity', fits ? 1 : 0);
        });

      g.append('text')
        .attr('x', -6)
        .attr('y', LEVEL_HEIGHT / 2)
        .attr('dy', '.35em')
        .attr('text-anchor', 'end')
        .text(level)
        .style('font-size', '10px')
        .style('font-weight', '500')
        .style('fill', 'var(--viz-label)');
    });

    plot.append('g').attr('class', 'rug-labels');
    plot.append('g').attr('class', 'highlight-layer');

  }, [data, selectedLevels, coordMap, widthMap, onLineageClick, getColorScale, containerWidth, onDomainClick, topTreeOffset, parsedTree, treeLayoutMode, tipExtensionMode]);

  useEffect(() => {
    if (!svgRef.current || !data.length || containerWidth <= 0) return;
    const svg = d3.select(svgRef.current);
    const plot = svg.select('g.plot-root');
    if (plot.empty()) return;

    const MARGINS = { top: 20 + topTreeOffset, right: 16, bottom: 24 + EXTRA_BOTTOM_PADDING, left: 100 };
    const LEVEL_HEIGHT = 21;
    const RUG_HEIGHT = 10;
    const RUG_PAD = 3;
    const BASE_GAP = 15;
    const totalLevels = selectedLevels.length + 1;
    const svgHeight = MARGINS.top +
                      totalLevels * LEVEL_HEIGHT +
                      (activeGenes.length ? BASE_GAP + activeGenes.length * (RUG_HEIGHT + RUG_PAD) : 0) +
                      MARGINS.bottom;

    svg.attr('width', containerWidth)
      .attr('height', svgHeight);
    setLastSvgHeight(svgHeight);

    const baseY = (selectedLevels.length + 1) * LEVEL_HEIGHT + BASE_GAP;
    const rugLabels = plot.select('g.rug-labels');
    rugLabels.selectAll('*').remove();

    if (activeGenes.length > 0) {
      activeGenes.forEach((gene, geneIdx) => {
        const y = baseY + geneIdx * (RUG_HEIGHT + RUG_PAD);
        rugLabels.append('text')
          .attr('x', -6)
          .attr('y', y + RUG_HEIGHT / 2)
          .attr('dy', '.35em')
          .attr('text-anchor', 'end')
          .text(gene.replace(/_count$/, ''))
          .style('font-size', '9px')
          .style('font-weight', '500')
          .style('fill', gene.includes('-') || gene.includes('>') ? 'var(--primary-strong)' : 'var(--viz-label)');
      });
    }
  }, [data, selectedLevels, activeGenes, containerWidth, topTreeOffset]);

  useEffect(() => {
    if (!canvasRef.current || containerWidth <= 0) {
      return;
    }

    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    if (!context) return;

    const MARGINS = { top: 20 + topTreeOffset, right: 16, bottom: 24 + EXTRA_BOTTOM_PADDING, left: 100 };
    const LEVEL_HEIGHT = 21;
    const RUG_HEIGHT = 10;
    const RUG_PAD = 3;
    const BASE_GAP = 15;

    const svgHeight = MARGINS.top +
                      (selectedLevels.length + 1) * LEVEL_HEIGHT +
                      (activeGenes.length ? BASE_GAP + activeGenes.length * (RUG_HEIGHT + RUG_PAD) : 0) +
                      MARGINS.bottom;

    const dpr = window.devicePixelRatio || 1;
    const prevMeta = prevCanvasMetaRef.current;
    const dependenciesStable = !!prevMeta &&
      prevMeta.dataRef === data &&
      prevMeta.matrixRef === matrix &&
      prevMeta.selectedLevelsRef === selectedLevels &&
      prevMeta.coordMapRef === coordMap &&
      prevMeta.widthMapRef === widthMap &&
      prevMeta.countMapRef === countMap &&
      prevMeta.rugMode === rugMode &&
      prevMeta.containerWidth === containerWidth &&
      prevMeta.topTreeOffset === topTreeOffset;
    const isAppendAtEnd = dependenciesStable &&
      activeGenes.length === prevMeta.activeGenes.length + 1 &&
      prevMeta.activeGenes.every((g, i) => g === activeGenes[i]);
    const isTrimAtEnd = dependenciesStable &&
      activeGenes.length + 1 === prevMeta.activeGenes.length &&
      activeGenes.every((g, i) => g === prevMeta.activeGenes[i]);
    const canIncremental = isAppendAtEnd || isTrimAtEnd;

    let previousImage: HTMLCanvasElement | null = null;
    if (canIncremental && canvas.width > 0 && canvas.height > 0) {
      previousImage = document.createElement('canvas');
      previousImage.width = canvas.width;
      previousImage.height = canvas.height;
      const prevCtx = previousImage.getContext('2d');
      if (prevCtx) prevCtx.drawImage(canvas, 0, 0);
    }

    canvas.width = containerWidth * dpr;
    canvas.height = svgHeight * dpr;
    canvas.style.width = `${containerWidth}px`;
    canvas.style.height = `${svgHeight}px`;
    const anyContext = context as unknown as { setTransform?: (a: number, b: number, c: number, d: number, e: number, f: number) => void };
    if (typeof anyContext.setTransform === 'function') {
      anyContext.setTransform(1, 0, 0, 1, 0, 0);
    }
    context.scale(dpr, dpr);

    context.clearRect(0, 0, canvas.width, canvas.height);

    if (!matrix || activeGenes.length === 0) {
      prevCanvasMetaRef.current = {
        activeGenes: [...activeGenes],
        dataRef: data,
        matrixRef: matrix,
        selectedLevelsRef: selectedLevels,
        coordMapRef: coordMap,
        widthMapRef: widthMap,
        countMapRef: countMap,
        rugMode,
        containerWidth,
        topTreeOffset,
        svgHeight,
      };
      return;
    }

    const assemblies = data.map(d => d.assembly);
    const baseY = MARGINS.top + (selectedLevels.length + 1) * LEVEL_HEIGHT + BASE_GAP;

    const drawGeneRow = (gene: string, geneIdx: number, maxCount: number) => {
      const y = baseY + geneIdx * (RUG_HEIGHT + RUG_PAD);
      assemblies.forEach((assembly) => {
        const cm = countMap.get(assembly);
        const count = cm ? (cm[gene] || 0) : 0;
        const x = (coordMap.get(assembly) || 0) + MARGINS.left;
        const width = widthMap.get(assembly) || 0;
        context.fillStyle = getRugColor(gene, count, maxCount, rugMode);
        context.globalAlpha = 1.0;
        context.fillRect(x, y, width, RUG_HEIGHT);
      });
    };

    const maxCountForGene = (gene: string) => {
      let maxCount = 0;
      assemblies.forEach((assembly) => {
        const cm = countMap.get(assembly);
        const cnt = cm ? (cm[gene] || 0) : 0;
        if (cnt > maxCount) maxCount = cnt;
      });
      return maxCount;
    };

    if (canIncremental && previousImage && prevMeta) {
      if (isAppendAtEnd) {
        context.drawImage(previousImage, 0, 0, previousImage.width, previousImage.height, 0, 0, containerWidth, prevMeta.svgHeight);
        const newGene = activeGenes[activeGenes.length - 1];
        drawGeneRow(newGene, activeGenes.length - 1, rugMode === 'normalized' ? maxCountForGene(newGene) : 0);
      } else if (isTrimAtEnd) {
        context.drawImage(
          previousImage,
          0,
          0,
          previousImage.width,
          Math.round(svgHeight * dpr),
          0,
          0,
          containerWidth,
          svgHeight,
        );
      }
    } else {
      activeGenes.forEach((gene, geneIdx) => {
        drawGeneRow(gene, geneIdx, rugMode === 'normalized' ? maxCountForGene(gene) : 0);
      });
    }

    prevCanvasMetaRef.current = {
      activeGenes: [...activeGenes],
      dataRef: data,
      matrixRef: matrix,
      selectedLevelsRef: selectedLevels,
      coordMapRef: coordMap,
      widthMapRef: widthMap,
      countMapRef: countMap,
      rugMode,
      containerWidth,
      topTreeOffset,
      svgHeight,
    };

  }, [data, selectedLevels, activeGenes, matrix, coordMap, widthMap, asmIndex, geneIndex, containerWidth, countMap, rugMode, topTreeOffset]);

  useImperativeHandle(ref, () => ({
    downloadSVG,
  }), [downloadSVG]);

  useEffect(() => {
    if (!containerRef.current || activeGenes.length === 0) return;

    const container = containerRef.current;
    const MARGINS = { top: 20 + topTreeOffset, right: 16, bottom: 24, left: 100 };
    const LEVEL_HEIGHT = 21;
    const RUG_HEIGHT = 10;
    const RUG_PAD = 3;
    const BASE_GAP = 15;

    const handleMouseMove = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      const baseY = MARGINS.top + (selectedLevels.length + 1) * LEVEL_HEIGHT + BASE_GAP;
      const lineageAreaMaxY = MARGINS.top + (selectedLevels.length + 1) * LEVEL_HEIGHT;

      if (y < lineageAreaMaxY) {
        return;
      }

      let hoveredGene: string | null = null;
      let hoveredAssembly: string | null = null;

      for (let geneIdx = 0; geneIdx < activeGenes.length; geneIdx++) {
        const gene = activeGenes[geneIdx];
        const rugY = baseY + geneIdx * (RUG_HEIGHT + RUG_PAD);

        if (y >= rugY && y <= rugY + RUG_HEIGHT) {
          const assemblies = data.map(d => d.assembly);
          for (const assembly of assemblies) {
            const asmX = (coordMap.get(assembly) || 0) + MARGINS.left;
            const asmWidth = widthMap.get(assembly) || 0;

            if (x >= asmX && x <= asmX + asmWidth) {
              const geneIndexValue = geneIndex.get(gene);
              const asmIndexValue = asmIndex.get(assembly);

              if (geneIndexValue !== undefined && asmIndexValue !== undefined) {
                const cm = countMap.get(assembly);
                const present = (cm ? (cm[gene] || 0) : 0) > 0;
                if (!present) continue;
                hoveredGene = gene;
                hoveredAssembly = assembly;
                break;
              }
            }
          }
          break;
        }
      }

      if (hoveredGene && hoveredAssembly) {
        const assemblyData = countMap.get(hoveredAssembly);
        const actualCount = assemblyData?.[hoveredGene] || 0;
        const label: string | undefined = undefined;
        setTooltip({
          isVisible: true,
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          level: 'Gene',
          category: hoveredGene.replace(/_count$/, ''),
          count: actualCount,
          label,
        });
      } else {
        setTooltip(prev => ({ ...prev, isVisible: false }));
      }
    };

    const handleMouseLeave = () => {
      setTooltip(prev => ({ ...prev, isVisible: false }));
    };

    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [activeGenes, matrix, data, selectedLevels, coordMap, widthMap, asmIndex, geneIndex, countMap, rugMode, topTreeOffset]);

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const highlightLayer = svg.select('.highlight-layer');

    if (highlightLayer.empty()) return;

    highlightLayer.selectAll('.highlight-rect').remove();

    if (highlightedRect) {
      highlightLayer.append('rect')
        .attr('class', 'highlight-rect')
        .attr('x', highlightedRect.x)
        .attr('y', highlightedRect.y)
        .attr('width', highlightedRect.width)
        .attr('height', highlightedRect.height)
        .attr('fill', 'none')
        .attr('stroke', 'var(--viz-highlight-stroke)')
        .attr('stroke-width', 2)
        .attr('pointer-events', 'none');
    }
  }, [highlightedRect]);

  const handleFileUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.tsv';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          void (e.target?.result as string);
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  if (!data.length) {
    return (
      <Card className="border-dashed border-2 border-gray-300">
        <CardContent className="flex flex-col items-center justify-center py-16">
          <Database className="w-16 h-16 text-gray-400 mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Data Loaded</h3>
          <p className="text-sm text-gray-600 mb-6 text-center max-w-md">
            Upload a TSV file containing gene count data to start visualizing gene presence across GTDB taxonomic lineages
          </p>
          <Button onClick={handleFileUpload} size="lg" className="mb-4">
            <Upload className="w-5 h-5 mr-2" />
            Load TSV File
          </Button>
          <div className="text-xs text-gray-500 text-center">
            <p>Expected format: Assembly ID in first column, gene counts in subsequent columns</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Badge variant="outline" className="flex items-center gap-2">
            <Database className="w-3 h-3" />
            {data.length.toLocaleString()} assemblies
          </Badge>
          <Badge variant="outline" className="flex items-center gap-2">
            <MousePointer className="w-3 h-3" />
            Click blocks to filter
          </Badge>
        </div>
        <div className="flex items-center space-x-2">
          <Button size="sm" variant="outline" onClick={downloadSVG}>
            <Download className="w-3 h-3 mr-1.5" />
            Download SVG
          </Button>
          {onDownloadTSV && (
            <Button size="sm" variant="outline" onClick={onDownloadTSV}>
              <Download className="w-3 h-3 mr-1.5" />
              Download TSV
            </Button>
          )}
          {activeGenes.length > 0 && (
            <Badge variant="secondary" className="bg-blue-100 text-blue-800">
              {activeGenes.length} genes visualized
            </Badge>
          )}
        </div>
      </div>

      <Card className="w-full">
        <CardContent className="p-0 w-full">
          <div
            ref={containerRef}
            className="relative bg-white rounded-lg overflow-hidden w-full min-h-[200px] flex-1"
            style={{ maxWidth: '100%' }}
          >
            <svg
              ref={svgRef}
              className="w-full h-auto block min-h-[200px] max-w-full"
              style={{ background: 'transparent', width: '100%', height: 'auto' }}
            />
            <canvas
              ref={canvasRef}
              className="absolute top-0 left-0 max-w-full"
              style={{ width: '100%', height: 'auto', pointerEvents: 'none', maxWidth: '100%' }}
            />
            <Tooltip
              isVisible={tooltip.isVisible}
              x={tooltip.x}
              y={tooltip.y}
              category={tooltip.category}
              count={tooltip.count}
              containerWidth={0}
              containerHeight={0}
              label={tooltip.label}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
});

type NewickNode = {
  name?: string;
  length?: number;
  children: NewickNode[];
  x?: number;
  dist?: number;
};

function parseNewick(newickString: string): NewickNode {
  const s = newickString.trim();
  let i = 0;

  function parseName(): string {
    if (s[i] === "'") {
      i++;
      let out = '';
      while (i < s.length && s[i] !== "'") out += s[i++];
      i++;
      return out;
    }
    const start = i;
    while (i < s.length && !/,|\(|\)|:|;/.test(s[i])) i++;
    return s.slice(start, i).trim();
  }

  function parseNumber(): number | null {
    const match = s.slice(i).match(/^[+-]?(?:\d+\.?\d*|\d*\.\d+)(?:[eE][+-]?\d+)?/);
    if (!match) return null;
    i += match[0].length;
    return Number(match[0]);
  }

  function parseLength(n: NewickNode) {
    if (s[i] === ':') {
      i++;
      n.length = parseNumber() ?? 0;
    }
  }

  function parseSubtree(): NewickNode {
    if (s[i] === '(') {
      i++;
      const node: NewickNode = { children: [], length: 0 };
      while (true) {
        const child = parseSubtree();
        parseLength(child);
        node.children.push(child);
        if (s[i] === ',') {
          i++;
          continue;
        }
        if (s[i] === ')') {
          i++;
          break;
        }
      }
      if (/[^,:);]/.test(s[i] || '')) {
        parseName();
      }
      return node;
    }
    return { name: parseName(), children: [], length: 0 };
  }

  const root = parseSubtree();
  parseLength(root);
  if (s[i] !== ';') throw new Error('Invalid Newick: missing ;');
  return root;
}

function cloneAndPruneTree(node: NewickNode, keep: Set<string>): NewickNode | null {
  if (!node.children.length) {
    return node.name && keep.has(node.name) ? { name: node.name, length: node.length ?? 0, children: [] } : null;
  }
  const nextChildren: NewickNode[] = [];
  for (const child of node.children) {
    const pruned = cloneAndPruneTree(child, keep);
    if (pruned) nextChildren.push(pruned);
  }
  if (!nextChildren.length) return null;
  return { name: node.name, length: node.length ?? 0, children: nextChildren };
}

function assignPhlogramDistances(root: NewickNode): number {
  let maxDist = 0;
  const walk = (node: NewickNode, dist: number) => {
    const nextDist = dist + (node.length || 0);
    node.dist = nextDist;
    if (nextDist > maxDist) maxDist = nextDist;
    node.children.forEach((child) => walk(child, nextDist));
  };
  walk(root, 0);
  return maxDist;
}

function getMaxDepth(node: NewickNode): number {
  if (!node.children.length) return 0;
  return 1 + Math.max(...node.children.map(getMaxDepth));
}

function assignCladogramDistances(root: NewickNode): number {
  const maxDepth = getMaxDepth(root);
  const walk = (node: NewickNode, depth: number) => {
    node.dist = node.children.length ? depth : maxDepth;
    node.children.forEach((child) => walk(child, depth + 1));
  };
  walk(root, 0);
  return maxDepth;
}

function assignXByAssembly(node: NewickNode, leafCenterX: Map<string, number>): number {
  if (!node.children.length) {
    node.x = leafCenterX.get(node.name || '') ?? 0;
    return node.x;
  }
  let total = 0;
  let count = 0;
  node.children.forEach((child) => {
    total += assignXByAssembly(child, leafCenterX);
    count += 1;
  });
  node.x = count > 0 ? total / count : 0;
  return node.x;
}

function normalizeTreeLeafLabel(label: string, level: TaxonomicLevel): string {
  if (level !== 'order') return label;
  return label.replace(/ \(p__[^)]*\)$/, '');
}

function buildLeafCenterXMap(
  data: GTDBRecord[],
  coordMap: Map<string, number>,
  widthMap: Map<string, number>,
  root: NewickNode
): Map<string, number> {
  const leafNodes: NewickNode[] = [];
  collectLeaves(root, leafNodes);
  const leafNames = leafNodes.map((leaf) => leaf.name || '').filter(Boolean);
  if (!leafNames.length) return new Map<string, number>();

  const assemblyCenterX = new Map<string, number>();
  data.forEach((record) => {
    const x = coordMap.get(record.assembly);
    const w = widthMap.get(record.assembly);
    if (x === undefined || w === undefined) return;
    assemblyCenterX.set(record.assembly, x + w / 2);
  });

  let bestMatches = leafNames.filter((name) => assemblyCenterX.has(name)).length;
  let bestLevel: TaxonomicLevel | null = null;
  let bestGroupedCenters = new Map<string, number>();

  TREE_MATCH_LEVELS.forEach((level) => {
    const spans = new Map<string, { start: number; end: number }>();
    data.forEach((record) => {
      const x = coordMap.get(record.assembly);
      const w = widthMap.get(record.assembly);
      if (x === undefined || w === undefined) return;
      const key = record[level];
      const end = x + w;
      const existing = spans.get(key);
      if (!existing) {
        spans.set(key, { start: x, end });
        return;
      }
      existing.start = Math.min(existing.start, x);
      existing.end = Math.max(existing.end, end);
    });

    const groupedCenters = new Map<string, number>();
    spans.forEach((span, key) => {
      groupedCenters.set(key, (span.start + span.end) / 2);
    });

    const matchCount = leafNames.filter((name) =>
      groupedCenters.has(normalizeTreeLeafLabel(name, level))
    ).length;

    if (matchCount > bestMatches) {
      bestMatches = matchCount;
      bestLevel = level;
      bestGroupedCenters = groupedCenters;
    }
  });

  if (!bestLevel) return assemblyCenterX;
  const matchedLevel = bestLevel;

  const matchedLeafCenters = new Map<string, number>();
  leafNames.forEach((name) => {
    const normalizedName = normalizeTreeLeafLabel(name, matchedLevel);
    const centerX = bestGroupedCenters.get(normalizedName);
    if (centerX !== undefined) {
      matchedLeafCenters.set(name, centerX);
    }
  });
  return matchedLeafCenters;
}

function drawTopTree({
  group,
  root,
  data,
  coordMap,
  widthMap,
  treeHeight,
  treeLayoutMode,
  tipExtensionMode,
}: {
  group: any;
  root: NewickNode;
  data: GTDBRecord[];
  coordMap: Map<string, number>;
  widthMap: Map<string, number>;
  treeHeight: number;
  treeLayoutMode: TreeLayoutMode;
  tipExtensionMode: 'none' | 'solid' | 'dashed';
}) {
  const leafCenterX = buildLeafCenterXMap(data, coordMap, widthMap, root);
  if (!leafCenterX.size) return;

  const keep = new Set(leafCenterX.keys());
  const pruned = cloneAndPruneTree(root, keep);
  if (!pruned) return;

  assignXByAssembly(pruned, leafCenterX);
  const maxDist = Math.max(
    treeLayoutMode === 'cladogram'
      ? assignCladogramDistances(pruned)
      : assignPhlogramDistances(pruned),
    1e-6
  );
  const branchHeight = Math.max(8, treeHeight - 6);
  const yScale = branchHeight / maxDist;
  const tipY = treeHeight;

  const branches = group.append('g')
    .attr('fill', 'none')
    .attr('stroke', '#36454F')
    .attr('stroke-width', 1);

  const walk = (node: NewickNode) => {
    if (!node.children.length) return;
    const parentY = (node.dist || 0) * yScale;
    const childXs = node.children.map((child) => child.x || 0);
    branches.append('line')
      .attr('x1', d3.min(childXs) ?? 0)
      .attr('x2', d3.max(childXs) ?? 0)
      .attr('y1', parentY)
      .attr('y2', parentY);

    node.children.forEach((child) => {
      const childY = (child.dist || 0) * yScale;
      branches.append('line')
        .attr('x1', child.x || 0)
        .attr('x2', child.x || 0)
        .attr('y1', parentY)
        .attr('y2', childY);
      walk(child);
    });
  };
  walk(pruned);

  if (tipExtensionMode !== 'none') {
    const leaves: NewickNode[] = [];
    collectLeaves(pruned, leaves);
    const tipExtensions = group.append('g')
      .attr('fill', 'none')
      .attr('stroke', '#36454F')
      .attr('stroke-width', 1);
    if (tipExtensionMode === 'dashed') {
      tipExtensions.attr('stroke-dasharray', '2 2');
    }
    leaves.forEach((leaf) => {
      const x = leaf.x || 0;
      const y = (leaf.dist || 0) * yScale;
      if (y < tipY) {
        tipExtensions.append('line')
          .attr('x1', x)
          .attr('x2', x)
          .attr('y1', y)
          .attr('y2', tipY);
      }
    });
  }
}

function collectLeaves(node: NewickNode, out: NewickNode[]) {
  if (!node.children.length) {
    out.push(node);
    return;
  }
  node.children.forEach((child) => collectLeaves(child, out));
}
