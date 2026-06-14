"use client";

import * as d3 from "d3";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { escapeHtml } from "@/lib/geneCorrelation/jaccardHeatmapCore";
import { classifyGene } from "@/lib/flagellaGeneClassification";
import {
  getFlagellaCategoryColor,
  getFlagellaCategoryLabelTextColor,
  FLAGELLA_CATEGORY_ORDER
} from "@/lib/flagellaCategoryColors";
import { DownloadActionButton } from "@/components/DownloadActionButton";
import type { DirectedEdge, UndirectedEdge } from "@/lib/operonSummary/operonAssociationsCore";

const VIEW_W = 940;
const VIEW_H = 640;
const NODE_RADIUS = 20;
const NODE_EDGE_PAD = 4;
const ARROW_LENGTH = 12;
const ARROW_WIDTH = 16;
const RECIPROCAL_CURVE_OFFSET = 78;
const SELF_LOOP_WIDTH = 38;
const SELF_LOOP_DEPTH = 72;
const EDGE_DISTANCE_OFFSET = 170;
const MIN_GAP_LINK_DISTANCE = 45;
const MAX_GAP_LINK_DISTANCE = 240;
const DISTANCE_CONSTRAINT_ITERATIONS = 3;
const DISTANCE_CONSTRAINT_STRENGTH = 0.55;
const LEGEND_PAD = 12;
const LEGEND_INNER_PAD = 10;
const LEGEND_ITEM_H = 15;
const LEGEND_SWATCH_R = 5;
const LEGEND_TITLE_SIZE = 10;
const LEGEND_TEXT_SIZE = 8.5;

type NetworkTheme = {
  canvasBg: string;
  edge: string;
  edgeOutline: string;
  nodeStroke: string;
  isolatedNode: string;
  labelText: string;
  legendBg: string;
  legendBorder: string;
  legendTitle: string;
  legendText: string;
  tickStroke: string;
};

const NETWORK_THEME_LIGHT: NetworkTheme = {
  canvasBg: "#ffffff",
  edge: "#5f6775",
  edgeOutline: "#ffffff",
  nodeStroke: "#ffffff",
  isolatedNode: "#c2c8d2",
  labelText: "#1f2430",
  legendBg: "#ffffff",
  legendBorder: "#d1d5db",
  legendTitle: "#1f2430",
  legendText: "#3a4150",
  tickStroke: "#6b7280"
};

const NETWORK_THEME_DARK: NetworkTheme = {
  canvasBg: "#222228",
  edge: "#9aa3b2",
  edgeOutline: "#222228",
  nodeStroke: "#222228",
  isolatedNode: "#525a6b",
  labelText: "#e8ecf4",
  legendBg: "#222228",
  legendBorder: "#5c6678",
  legendTitle: "#e8ecf4",
  legendText: "#c8d0de",
  tickStroke: "#8a93a8"
};

type SimNode = {
  id: string;
  index: number;
  neighborCount: number;
  degree: number;
  category: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
};

type SimLink = {
  source: SimNode | string;
  target: SimNode | string;
  count: number;
  weight: number;
  averageGapBp?: number;
  targetDistance: number;
  edgeWidth: number;
  curveSign: -1 | 0 | 1;
};

type RawLink = {
  source: string;
  target: string;
  count: number;
  weight: number;
  averageGapBp?: number;
  targetDistance: number;
  curveSign: -1 | 0 | 1;
};

type LayoutMode = "force" | "backbone";

type BackboneLayout = {
  positions: Map<string, { x: number; y: number }>;
  curveSigns: Map<string, -1 | 0 | 1>;
};

type TooltipState = { x: number; y: number; html: string } | null;

type EdgePhylumBreakdownItem = {
  phylum: string;
  label: string;
  assembliesWithEdge: number;
  phylumTotal: number;
  percent: number;
  meetsConservationThreshold: boolean;
};

type PinnedEdgeState = {
  source: string;
  target: string;
  count: number;
  averageGapBp?: number;
  breakdown: EdgePhylumBreakdownItem[];
};

function formatAverageGapBp(averageGapBp: number | undefined): string | null {
  if (typeof averageGapBp !== "number" || !Number.isFinite(averageGapBp)) {
    return null;
  }
  return `${Math.round(averageGapBp).toLocaleString()} bp`;
}

function buildEdgeHoverHtml(
  source: string,
  target: string,
  count: number,
  averageGapBp: number | undefined,
  directed: boolean
): string {
  const arrow = directed ? " → " : " ↔ ";
  const averageDistance = formatAverageGapBp(averageGapBp);
  return (
    `<b>${escapeHtml(source)}</b>${arrow}<b>${escapeHtml(target)}</b><br>` +
    `<b>Average prevalence:</b> ${count.toFixed(1)}%<br>` +
    (averageDistance ? `<b>Avg distance:</b> ${averageDistance}<br>` : "") +
    `<i>Click for phylum prevalence</i>`
  );
}

function orderedLegendCategories(categories: Iterable<string>): string[] {
  const present = new Set(categories);
  return FLAGELLA_CATEGORY_ORDER.filter((category) => present.has(category));
}

function prepareNetworkSvgForExport(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.querySelectorAll("[style]").forEach((element) => {
    element.removeAttribute("style");
  });
  const serializer = new XMLSerializer();
  return serializer.serializeToString(clone);
}

function nodeTranslate(node: SimNode): string {
  return `translate(${node.x ?? 0},${node.y ?? 0})`;
}

function getNodeCoords(node: SimNode | string, nodeById: Map<string, SimNode>): { x: number; y: number } {
  if (typeof node === "object") {
    return { x: node.x ?? 0, y: node.y ?? 0 };
  }
  const resolved = nodeById.get(node);
  return { x: resolved?.x ?? 0, y: resolved?.y ?? 0 };
}

function resolveSimNode(node: SimNode | string): SimNode | null {
  return typeof node === "object" ? node : null;
}

function getAverageGapLinkDistance(
  averageGapBp: number | undefined,
  minAverageGapBp: number,
  maxAverageGapBp: number
): number {
  if (typeof averageGapBp !== "number" || !Number.isFinite(averageGapBp)) {
    return EDGE_DISTANCE_OFFSET + (MIN_GAP_LINK_DISTANCE + MAX_GAP_LINK_DISTANCE) / 2;
  }
  if (maxAverageGapBp <= minAverageGapBp) {
    return EDGE_DISTANCE_OFFSET + MIN_GAP_LINK_DISTANCE;
  }
  const ratio = Math.max(0, Math.min(1, (averageGapBp - minAverageGapBp) / (maxAverageGapBp - minAverageGapBp)));
  return EDGE_DISTANCE_OFFSET + MIN_GAP_LINK_DISTANCE + ratio * (MAX_GAP_LINK_DISTANCE - MIN_GAP_LINK_DISTANCE);
}

function constrainLinkDistances(links: SimLink[]) {
  for (let iteration = 0; iteration < DISTANCE_CONSTRAINT_ITERATIONS; iteration += 1) {
    for (const link of links) {
      const source = resolveSimNode(link.source);
      const target = resolveSimNode(link.target);
      if (!source || !target) {
        continue;
      }

      const dx = (target.x ?? 0) - (source.x ?? 0);
      const dy = (target.y ?? 0) - (source.y ?? 0);
      const currentDistance = Math.hypot(dx, dy);
      if (currentDistance === 0) {
        continue;
      }

      const targetDistance = link.targetDistance;
      const correction = ((currentDistance - targetDistance) / currentDistance) * DISTANCE_CONSTRAINT_STRENGTH;
      const offsetX = dx * correction;
      const offsetY = dy * correction;
      const sourceFixed = source.fx != null || source.fy != null;
      const targetFixed = target.fx != null || target.fy != null;

      if (sourceFixed && targetFixed) {
        continue;
      }

      if (sourceFixed) {
        target.x = (target.x ?? 0) - offsetX;
        target.y = (target.y ?? 0) - offsetY;
      } else if (targetFixed) {
        source.x = (source.x ?? 0) + offsetX;
        source.y = (source.y ?? 0) + offsetY;
      } else {
        source.x = (source.x ?? 0) + offsetX / 2;
        source.y = (source.y ?? 0) + offsetY / 2;
        target.x = (target.x ?? 0) - offsetX / 2;
        target.y = (target.y ?? 0) - offsetY / 2;
      }
    }
  }
}

function getArrowSize(edgeWidth: number): { length: number; width: number } {
  return {
    length: Math.max(ARROW_LENGTH, edgeWidth * 1.7),
    width: Math.max(ARROW_WIDTH, edgeWidth * 2.2)
  };
}

function unorderedPairKey(a: string, b: string): string {
  return a <= b ? `${a}\t${b}` : `${b}\t${a}`;
}

function directedPairKey(source: string, target: string): string {
  return `${source}\t${target}`;
}

function connectedComponents(nodes: string[], links: RawLink[]): string[][] {
  const adjacency = new Map<string, Set<string>>();
  for (const node of nodes) {
    adjacency.set(node, new Set());
  }
  for (const link of links) {
    adjacency.get(link.source)?.add(link.target);
    adjacency.get(link.target)?.add(link.source);
  }

  const seen = new Set<string>();
  const components: string[][] = [];
  for (const node of nodes) {
    if (seen.has(node)) {
      continue;
    }
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
    components.push(component.sort((a, b) => a.localeCompare(b)));
  }
  return components.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

function strongestUndirectedEdges(links: RawLink[]): RawLink[] {
  const bestByPair = new Map<string, RawLink>();
  for (const link of links) {
    const key = unorderedPairKey(link.source, link.target);
    const existing = bestByPair.get(key);
    if (!existing || link.count > existing.count) {
      bestByPair.set(key, link);
    }
  }
  return [...bestByPair.values()].sort(
    (a, b) => b.count - a.count || a.source.localeCompare(b.source) || a.target.localeCompare(b.target)
  );
}

function maximumSpanningTree(nodes: string[], links: RawLink[]): RawLink[] {
  const parent = new Map(nodes.map((node) => [node, node]));
  const find = (node: string): string => {
    const next = parent.get(node) ?? node;
    if (next === node) {
      return node;
    }
    const root = find(next);
    parent.set(node, root);
    return root;
  };
  const union = (a: string, b: string): boolean => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) {
      return false;
    }
    parent.set(rootB, rootA);
    return true;
  };

  const tree: RawLink[] = [];
  for (const link of strongestUndirectedEdges(links)) {
    if (union(link.source, link.target)) {
      tree.push(link);
    }
  }
  return tree;
}

function pathBetween(start: string, end: string, adjacency: Map<string, RawLink[]>): RawLink[] {
  const stack: Array<{ node: string; path: RawLink[] }> = [{ node: start, path: [] }];
  const seen = new Set<string>([start]);
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.node === end) {
      return current.path;
    }
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

function nodesFromPath(start: string, path: RawLink[]): string[] {
  const nodes = [start];
  let current = start;
  for (const edge of path) {
    current = edge.source === current ? edge.target : edge.source;
    nodes.push(current);
  }
  return nodes;
}

function chooseBackbonePath(nodes: string[], tree: RawLink[]): { nodePath: string[]; edgeKeys: Set<string> } {
  if (nodes.length <= 1) {
    return { nodePath: nodes, edgeKeys: new Set() };
  }
  if (tree.length === 0) {
    return { nodePath: nodes.slice(0, 1), edgeKeys: new Set() };
  }

  const adjacency = new Map<string, RawLink[]>();
  for (const node of nodes) {
    adjacency.set(node, []);
  }
  for (const edge of tree) {
    adjacency.get(edge.source)?.push(edge);
    adjacency.get(edge.target)?.push(edge);
  }

  const terminals = nodes.filter((node) => (adjacency.get(node)?.length ?? 0) <= 1);
  const candidates = terminals.length >= 2 ? terminals : nodes;
  let bestStart = candidates[0];
  let bestPath: RawLink[] = [];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const path = pathBetween(candidates[i], candidates[j], adjacency);
      const score = path.reduce((sum, edge) => sum + edge.count, 0);
      if (
        score > bestScore ||
        (score === bestScore && path.length > bestPath.length)
      ) {
        bestScore = score;
        bestStart = candidates[i];
        bestPath = path;
      }
    }
  }

  return {
    nodePath: nodesFromPath(bestStart, bestPath),
    edgeKeys: new Set(bestPath.map((edge) => unorderedPairKey(edge.source, edge.target)))
  };
}

function orientPathByDirection(nodePath: string[], links: RawLink[], directed: boolean): string[] {
  if (!directed || nodePath.length <= 1) {
    return nodePath;
  }

  const indexByNode = new Map(nodePath.map((node, index) => [node, index]));
  let forwardScore = 0;
  let reverseScore = 0;
  for (const link of links) {
    const sourceIndex = indexByNode.get(link.source);
    const targetIndex = indexByNode.get(link.target);
    if (sourceIndex == null || targetIndex == null || sourceIndex === targetIndex) {
      continue;
    }
    if (sourceIndex < targetIndex) {
      forwardScore += link.count;
    } else {
      reverseScore += link.count;
    }
  }

  return reverseScore > forwardScore ? [...nodePath].reverse() : nodePath;
}

function placeBranchNodeFromAnchors(
  node: string,
  links: RawLink[],
  positions: Map<string, { x: number; y: number }>,
  fallbackParent: { x: number; y: number },
  branchSide: number,
  branchDirection: number,
  fallbackDistance: number
): { x: number; y: number } {
  const anchors = links
    .map((link) => {
      const other = link.source === node ? link.target : link.target === node ? link.source : null;
      const position = other ? positions.get(other) : null;
      return other && position ? { position, distance: link.targetDistance, count: link.count } : null;
    })
    .filter((anchor): anchor is { position: { x: number; y: number }; distance: number; count: number } => anchor != null)
    .sort((a, b) => b.count - a.count);

  if (anchors.length >= 2) {
    const first = anchors[0];
    const second = anchors[1];
    const dx = second.position.x - first.position.x;
    const dy = second.position.y - first.position.y;
    const distanceBetweenAnchors = Math.hypot(dx, dy);
    if (distanceBetweenAnchors > 0) {
      const ux = dx / distanceBetweenAnchors;
      const uy = dy / distanceBetweenAnchors;
      const px = -uy;
      const py = ux;
      const along =
        (first.distance ** 2 - second.distance ** 2 + distanceBetweenAnchors ** 2) /
        (2 * distanceBetweenAnchors);
      const heightSquared = Math.max(0, first.distance ** 2 - along ** 2);
      const height = Math.sqrt(heightSquared);
      return {
        x: first.position.x + ux * along + px * height * branchSide,
        y: first.position.y + uy * along + py * height * branchSide
      };
    }
  }

  const branchAngle = Math.PI / 4;
  return {
    x: fallbackParent.x + branchDirection * Math.cos(branchAngle) * fallbackDistance,
    y: fallbackParent.y + branchSide * Math.sin(branchAngle) * fallbackDistance
  };
}

function buildBackboneLayout(nodes: string[], links: RawLink[], directed: boolean): BackboneLayout {
  const positions = new Map<string, { x: number; y: number }>();
  const curveSigns = new Map<string, -1 | 0 | 1>();
  const components = connectedComponents(nodes, links);
  let rowY = 110;
  for (const component of components) {
    const componentSet = new Set(component);
    const componentLinks = links.filter((link) => componentSet.has(link.source) && componentSet.has(link.target));
    const tree = maximumSpanningTree(component, componentLinks);
    const chosenPath = chooseBackbonePath(component, tree).nodePath;
    const nodePath = orientPathByDirection(chosenPath, componentLinks, directed);
    const backboneIndexByNode = new Map(nodePath.map((node, index) => [node, index]));
    const pathEdgeByPair = new Map(tree.map((edge) => [unorderedPairKey(edge.source, edge.target), edge]));
    const desiredXs = new Map<string, number>();
    let x = 90;
    for (let i = 0; i < nodePath.length; i += 1) {
      const node = nodePath[i];
      desiredXs.set(node, x);
      if (i < nodePath.length - 1) {
        const edge = pathEdgeByPair.get(unorderedPairKey(node, nodePath[i + 1]));
        x += edge?.targetDistance ?? MIN_GAP_LINK_DISTANCE;
      }
    }
    const scale = x > VIEW_W - 120 ? Math.max(0.55, (VIEW_W - 210) / Math.max(1, x - 90)) : 1;
    for (const node of nodePath) {
      positions.set(node, { x: 90 + ((desiredXs.get(node) ?? 90) - 90) * scale, y: rowY });
    }

    const treeAdjacency = new Map<string, RawLink[]>();
    for (const node of component) {
      treeAdjacency.set(node, []);
    }
    for (const edge of tree) {
      treeAdjacency.get(edge.source)?.push(edge);
      treeAdjacency.get(edge.target)?.push(edge);
    }

    const queue = nodePath.map((node, index) => ({ node, depth: 0, branchIndex: index }));
    const seen = new Set(nodePath);
    let extraBranchIndex = 0;
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of treeAdjacency.get(current.node) ?? []) {
        const next = edge.source === current.node ? edge.target : edge.source;
        if (seen.has(next)) {
          continue;
        }
        seen.add(next);
        const parent = positions.get(current.node) ?? { x: 90, y: rowY };
        const branchSide = extraBranchIndex % 2 === 0 ? -1 : 1;
        const branchDepth = current.depth + 1;
        const branchDirection = directed && edge.target === current.node ? -1 : 1;
        const nextLinks = componentLinks
          .filter((link) => link.source === next || link.target === next)
          .map((link) => ({ ...link, targetDistance: link.targetDistance * scale }));
        const branchPosition = placeBranchNodeFromAnchors(
          next,
          nextLinks,
          positions,
          parent,
          branchSide,
          branchDirection,
          edge.targetDistance * scale
        );
        positions.set(next, {
          x: branchPosition.x,
          y: branchPosition.y + branchSide * (branchDepth - 1) * 24
        });
        extraBranchIndex += 1;
        queue.push({ node: next, depth: branchDepth, branchIndex: extraBranchIndex });
      }
    }

    for (const node of component) {
      if (!positions.has(node)) {
        positions.set(node, { x: 90 + extraBranchIndex * 90, y: rowY + (extraBranchIndex % 2 === 0 ? -80 : 80) });
        extraBranchIndex += 1;
      }
    }

    const linksByPair = new Map<string, RawLink[]>();
    for (const link of componentLinks) {
      const pairKey = unorderedPairKey(link.source, link.target);
      const existing = linksByPair.get(pairKey) ?? [];
      existing.push(link);
      linksByPair.set(pairKey, existing);
    }

    for (const pairLinks of linksByPair.values()) {
      const firstLink = pairLinks[0];
      const sourceBackboneIndex = backboneIndexByNode.get(firstLink.source);
      const targetBackboneIndex = backboneIndexByNode.get(firstLink.target);
      const isBackboneSkipEdge =
        sourceBackboneIndex != null &&
        targetBackboneIndex != null &&
        Math.abs(sourceBackboneIndex - targetBackboneIndex) > 1;

      if (!directed || pairLinks.length <= 1) {
        for (const link of pairLinks) {
          curveSigns.set(directedPairKey(link.source, link.target), isBackboneSkipEdge ? 1 : 0);
        }
        continue;
      }

      const sortedPairLinks = [...pairLinks].sort(
        (a, b) => b.count - a.count || a.source.localeCompare(b.source) || a.target.localeCompare(b.target)
      );
      sortedPairLinks.forEach((link, index) => {
        curveSigns.set(directedPairKey(link.source, link.target), index === 0 && !isBackboneSkipEdge ? 0 : 1);
      });
    }

    rowY += 210;
  }

  return { positions, curveSigns };
}

function linkGeometry(
  link: SimLink,
  nodeById: Map<string, SimNode>,
  directed: boolean
): { pathD: string; labelX: number; labelY: number; arrowPath?: string } {
  const start = getNodeCoords(link.source, nodeById);
  const end = getNodeCoords(link.target, nodeById);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) {
    const centerDx = start.x - VIEW_W / 2;
    const centerDy = start.y - VIEW_H / 2;
    const centerLen = Math.hypot(centerDx, centerDy);
    const outX = centerLen > 1 ? centerDx / centerLen : 0;
    const outY = centerLen > 1 ? centerDy / centerLen : -1;
    const perpX = -outY;
    const perpY = outX;
    const nodePad = NODE_RADIUS + NODE_EDGE_PAD;
    const arrowSize = getArrowSize(link.edgeWidth);
    const startDirLen = Math.hypot(outX - perpX * 0.75, outY - perpY * 0.75) || 1;
    const endDirLen = Math.hypot(outX + perpX * 0.75, outY + perpY * 0.75) || 1;
    const x1 = start.x + ((outX - perpX * 0.75) / startDirLen) * nodePad;
    const y1 = start.y + ((outY - perpY * 0.75) / startDirLen) * nodePad;
    const tipX = start.x + ((outX + perpX * 0.75) / endDirLen) * nodePad;
    const tipY = start.y + ((outY + perpY * 0.75) / endDirLen) * nodePad;
    const c1x = start.x + outX * SELF_LOOP_DEPTH - perpX * SELF_LOOP_WIDTH;
    const c1y = start.y + outY * SELF_LOOP_DEPTH - perpY * SELF_LOOP_WIDTH;
    const c2x = start.x + outX * SELF_LOOP_DEPTH + perpX * SELF_LOOP_WIDTH;
    const c2y = start.y + outY * SELF_LOOP_DEPTH + perpY * SELF_LOOP_WIDTH;
    const tangentX = tipX - c2x;
    const tangentY = tipY - c2y;
    const tangentLen = Math.hypot(tangentX, tangentY) || 1;
    const tux = tangentX / tangentLen;
    const tuy = tangentY / tangentLen;
    const x2 = directed ? tipX - tux * arrowSize.length : tipX;
    const y2 = directed ? tipY - tuy * arrowSize.length : tipY;
    const pathD = `M${x1},${y1}C${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`;
    const labelX = start.x + outX * (SELF_LOOP_DEPTH + 10);
    const labelY = start.y + outY * (SELF_LOOP_DEPTH + 10);

    if (!directed) {
      return { pathD, labelX, labelY };
    }

    const tpx = -tuy;
    const tpy = tux;
    const halfWidth = arrowSize.width / 2;
    const arrowPath = [
      `M${tipX},${tipY}`,
      `L${x2 + tpx * halfWidth},${y2 + tpy * halfWidth}`,
      `L${x2 - tpx * halfWidth},${y2 - tpy * halfWidth}`,
      "Z"
    ].join("");

    return { pathD, labelX, labelY, arrowPath };
  }
  if (len <= NODE_RADIUS * 2) {
    return {
      pathD: `M${start.x},${start.y}L${end.x},${end.y}`,
      labelX: (start.x + end.x) / 2,
      labelY: (start.y + end.y) / 2
    };
  }

  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const curveOffset = link.curveSign * RECIPROCAL_CURVE_OFFSET;
  const sourcePad = NODE_RADIUS + NODE_EDGE_PAD;
  const targetPad = NODE_RADIUS + NODE_EDGE_PAD;
  const arrowSize = getArrowSize(link.edgeWidth);

  let x1 = start.x + ux * sourcePad;
  let y1 = start.y + uy * sourcePad;
  let tipX = end.x - ux * targetPad;
  let tipY = end.y - uy * targetPad;

  if (curveOffset !== 0) {
    const roughControlX = (start.x + end.x) / 2 + px * curveOffset;
    const roughControlY = (start.y + end.y) / 2 + py * curveOffset;
    const sourceDx = roughControlX - start.x;
    const sourceDy = roughControlY - start.y;
    const sourceLen = Math.hypot(sourceDx, sourceDy) || 1;
    const targetDx = roughControlX - end.x;
    const targetDy = roughControlY - end.y;
    const targetLen = Math.hypot(targetDx, targetDy) || 1;

    x1 = start.x + (sourceDx / sourceLen) * sourcePad;
    y1 = start.y + (sourceDy / sourceLen) * sourcePad;
    tipX = end.x + (targetDx / targetLen) * targetPad;
    tipY = end.y + (targetDy / targetLen) * targetPad;
  }

  const controlX = (x1 + tipX) / 2 + px * curveOffset;
  const controlY = (y1 + tipY) / 2 + py * curveOffset;

  const tangentX = curveOffset === 0 ? ux : tipX - controlX;
  const tangentY = curveOffset === 0 ? uy : tipY - controlY;
  const tangentLen = Math.hypot(tangentX, tangentY) || 1;
  const tux = tangentX / tangentLen;
  const tuy = tangentY / tangentLen;
  const x2 = directed ? tipX - tux * arrowSize.length : tipX;
  const y2 = directed ? tipY - tuy * arrowSize.length : tipY;
  const pathD = curveOffset === 0 ? `M${x1},${y1}L${x2},${y2}` : `M${x1},${y1}Q${controlX},${controlY} ${x2},${y2}`;
  const labelX = curveOffset === 0 ? (x1 + x2) / 2 : 0.25 * x1 + 0.5 * controlX + 0.25 * x2;
  const labelY = curveOffset === 0 ? (y1 + y2) / 2 : 0.25 * y1 + 0.5 * controlY + 0.25 * y2;

  if (!directed) {
    return { pathD, labelX, labelY };
  }

  const tpx = -tuy;
  const tpy = tux;
  const halfWidth = arrowSize.width / 2;
  const arrowPath = [
    `M${tipX},${tipY}`,
    `L${x2 + tpx * halfWidth},${y2 + tpy * halfWidth}`,
    `L${x2 - tpx * halfWidth},${y2 - tpy * halfWidth}`,
    "Z"
  ].join("");

  return { pathD, labelX, labelY, arrowPath };
}

export default function OperonAssociationNetworkGraph({
  title,
  description,
  edges,
  geneNeighborCounts,
  directed,
  isDarkMode,
  minCount,
  hideIsolated,
  layoutMode,
  networkResetKey,
  downloadFilename,
  onOpenPhyleticDistribution,
  canOpenPhyleticDistribution = false,
  getEdgePhylumBreakdown
}: {
  title: string;
  description: string;
  edges: UndirectedEdge[] | DirectedEdge[];
  geneNeighborCounts: Record<string, number>;
  directed: boolean;
  isDarkMode: boolean;
  minCount: number;
  hideIsolated: boolean;
  layoutMode: LayoutMode;
  networkResetKey: string;
  downloadFilename: string;
  onOpenPhyleticDistribution?: () => void;
  canOpenPhyleticDistribution?: boolean;
  getEdgePhylumBreakdown?: (source: string, target: string) => EdgePhylumBreakdownItem[];
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const getEdgePhylumBreakdownRef = useRef(getEdgePhylumBreakdown);
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const [pinnedEdge, setPinnedEdge] = useState<PinnedEdgeState | null>(null);
  const [legendCollapsed, setLegendCollapsed] = useState(false);

  getEdgePhylumBreakdownRef.current = getEdgePhylumBreakdown;

  const theme = isDarkMode ? NETWORK_THEME_DARK : NETWORK_THEME_LIGHT;

  const { rawLinks, labels, maxCount } = useMemo(() => {
    const filtered = edges.filter((edge) => edge.count >= minCount);
    const labelSet = new Set<string>();
    let max = minCount;

    const directedEdgeKeys = new Set(filtered.map((edge) => `${edge.source}\t${edge.target}`));
    const finiteAverageGaps = filtered
      .map((edge) => edge.averageGapBp)
      .filter((averageGapBp): averageGapBp is number => Number.isFinite(averageGapBp));
    const minAverageGapBp = finiteAverageGaps.length > 0 ? Math.min(...finiteAverageGaps) : 0;
    const maxAverageGapBp = finiteAverageGaps.length > 0 ? Math.max(...finiteAverageGaps) : 0;
    const links: RawLink[] = filtered.map((edge) => {
      labelSet.add(edge.source);
      labelSet.add(edge.target);
      max = Math.max(max, edge.count);
      const hasReciprocal =
        directed &&
        edge.source !== edge.target &&
        directedEdgeKeys.has(`${edge.target}\t${edge.source}`);
      return {
        source: edge.source,
        target: edge.target,
        count: edge.count,
        weight: edge.count,
        averageGapBp: edge.averageGapBp,
        targetDistance: getAverageGapLinkDistance(
          edge.averageGapBp,
          minAverageGapBp,
          maxAverageGapBp
        ),
        curveSign: hasReciprocal ? 1 : 0
      };
    });

    for (const gene of Object.keys(geneNeighborCounts)) {
      labelSet.add(gene);
    }

    return {
      rawLinks: links,
      labels: Array.from(labelSet).sort((a, b) => a.localeCompare(b)),
      maxCount: max
    };
  }, [edges, geneNeighborCounts, minCount, directed]);

  const linkPreview = useMemo(() => {
    const connected = new Set<string>();
    for (const link of rawLinks) {
      connected.add(link.source);
      connected.add(link.target);
    }
    return {
      edgeCount: rawLinks.length,
      nodeCount: hideIsolated ? connected.size : labels.length
    };
  }, [rawLinks, labels.length, hideIsolated]);

  useEffect(() => {
    setPinnedEdge(null);
    setTooltip(null);
    positionsRef.current.clear();
  }, [networkResetKey]);

  const resolveLinkGeneIds = useCallback(
    (link: SimLink, nodeById: Map<string, SimNode>): { source: string; target: string } => {
      const sourceNode = typeof link.source === "object" ? link.source : nodeById.get(link.source);
      const targetNode = typeof link.target === "object" ? link.target : nodeById.get(link.target);
      return {
        source: sourceNode?.id ?? String(link.source),
        target: targetNode?.id ?? String(link.target)
      };
    },
    []
  );

  const handleEdgePin = useCallback(
    (link: SimLink, nodeById: Map<string, SimNode>) => {
      const { source, target } = resolveLinkGeneIds(link, nodeById);
      const breakdown = getEdgePhylumBreakdownRef.current?.(source, target) ?? [];
      setPinnedEdge({
        source,
        target,
        count: link.count,
        averageGapBp: link.averageGapBp,
        breakdown
      });
      setTooltip(null);
    },
    [resolveLinkGeneIds]
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || labels.length === 0) {
      if (svg) {
        while (svg.firstChild) {
          svg.removeChild(svg.firstChild);
        }
      }
      return;
    }

    const degree = new Map<string, number>();
    for (const label of labels) {
      degree.set(label, 0);
    }
    for (const link of rawLinks) {
      degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
      degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
    }

    const widthScale = d3
      .scaleLinear()
      .domain([minCount, maxCount])
      .range([1.5, 18])
      .clamp(true);
    const edgeOutlinePad = 2.4;

    const nodes: SimNode[] = labels
      .map((label, index) => {
        const cached = positionsRef.current.get(label);
        const nodeDegree = degree.get(label) ?? 0;
        return {
          id: label,
          index,
          neighborCount: geneNeighborCounts[label] ?? 0,
          degree: nodeDegree,
          category: classifyGene(label),
          x: cached?.x ?? VIEW_W / 2 + (Math.random() - 0.5) * 200,
          y: cached?.y ?? VIEW_H / 2 + (Math.random() - 0.5) * 200
        };
      })
      .filter((node) => !hideIsolated || node.degree > 0);

    const nodeById = new Map(nodes.map((node) => [node.id, node]));

    const links: SimLink[] = rawLinks
      .filter(
        (link) =>
          nodeById.has(link.source) &&
          nodeById.has(link.target)
      )
      .map((link) => ({
        source: link.source,
        target: link.target,
        count: link.count,
        weight: link.weight,
        averageGapBp: link.averageGapBp,
        targetDistance: link.targetDistance,
        edgeWidth: widthScale(link.count),
        curveSign: link.curveSign
      }));

    if (layoutMode === "backbone") {
      const layout = buildBackboneLayout(
        nodes.map((node) => node.id),
        rawLinks.filter((link) => nodeById.has(link.source) && nodeById.has(link.target)),
        directed
      );
      for (const node of nodes) {
        const position = layout.positions.get(node.id);
        if (position) {
          node.x = position.x;
          node.y = position.y;
        }
      }
      for (const link of links) {
        const source = typeof link.source === "string" ? link.source : link.source.id;
        const target = typeof link.target === "string" ? link.target : link.target.id;
        link.curveSign = layout.curveSigns.get(directedPairKey(source, target)) ?? link.curveSign;
      }
    }

    while (svg.firstChild) {
      svg.removeChild(svg.firstChild);
    }
    const root = d3.select(svg);
    root.attr("viewBox", `0 0 ${VIEW_W} ${VIEW_H}`);

    root
      .append("rect")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", VIEW_W)
      .attr("height", VIEW_H)
      .attr("fill", theme.canvasBg);

    const container = root.append("g").attr("class", "network-graph-layer");

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 6])
      .on("zoom", (event) => {
        container.attr("transform", event.transform.toString());
      });
    root.call(zoom);

    const linkOutlineSel = container
      .append("g")
      .attr("class", "network-link-outlines")
      .attr("stroke", theme.edgeOutline)
      .attr("fill", "none")
      .attr("stroke-linecap", directed ? "butt" : "round")
      .selectAll<SVGPathElement, SimLink>("path")
      .data(links)
      .join("path")
      .attr("stroke-width", (d: SimLink) => widthScale(d.count) + edgeOutlinePad)
      .attr("stroke-opacity", 1)
      .attr("pointer-events", "none");

    const linkSel = container
      .append("g")
      .attr("class", "network-links")
      .attr("fill", "none")
      .attr("stroke-linecap", directed ? "butt" : "round")
      .selectAll<SVGPathElement, SimLink>("path")
      .data(links)
      .join("path")
      .attr("stroke", theme.edge)
      .attr("stroke-width", (d: SimLink) => widthScale(d.count))
      .attr("stroke-opacity", 0.92)
      .style("cursor", getEdgePhylumBreakdownRef.current ? "pointer" : "default");

    const arrowOutlineSel = directed
      ? container
          .append("g")
          .attr("class", "network-arrow-outlines")
          .selectAll<SVGPathElement, SimLink>("path")
          .data(links)
          .join("path")
          .attr("fill", theme.edgeOutline)
          .attr("stroke", "none")
          .attr("opacity", 1)
      : null;

    const arrowSel = directed
      ? container
          .append("g")
          .attr("class", "network-arrows")
          .selectAll<SVGPathElement, SimLink>("path")
          .data(links)
          .join("path")
          .attr("stroke", "none")
          .attr("fill", theme.edge)
          .attr("opacity", 0.92)
          .style("cursor", getEdgePhylumBreakdownRef.current ? "pointer" : "default")
      : null;

    const edgeLabelSel = container
      .append("g")
      .attr("class", "network-edge-distance-labels")
      .selectAll<SVGTextElement, SimLink>("text")
      .data(links)
      .join("text")
      .text((d: SimLink) => formatAverageGapBp(d.averageGapBp) ?? "")
      .attr("font-size", 9)
      .attr("font-weight", 700)
      .attr("font-family", "Arial, sans-serif")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("fill", theme.labelText)
      .attr("stroke", theme.canvasBg)
      .attr("stroke-width", 3)
      .attr("paint-order", "stroke")
      .attr("pointer-events", "none");

    const nodeGroupSel = container
      .append("g")
      .selectAll<SVGGElement, SimNode>("g")
      .data(nodes)
      .join("g")
      .attr("transform", nodeTranslate);

    nodeGroupSel
      .append("circle")
      .attr("r", NODE_RADIUS)
      .attr("fill", (d: SimNode) => getFlagellaCategoryColor(d.category, isDarkMode))
      .attr("fill-opacity", (d: SimNode) => (d.degree === 0 ? 0.42 : 1))
      .attr("stroke", theme.nodeStroke)
      .attr("stroke-width", 1.5)
      .style("cursor", "grab");

    nodeGroupSel
      .append("text")
      .text((d: SimNode) => d.id)
      .attr("x", 0)
      .attr("y", 0)
      .attr("dy", "0.35em")
      .attr("font-size", 14)
      .attr("font-weight", 600)
      .attr("font-family", "Arial, sans-serif")
      .attr("text-anchor", "middle")
      .attr("pointer-events", "none")
      .attr("fill", (d: SimNode) =>
        getFlagellaCategoryLabelTextColor(d.category, isDarkMode, theme.labelText)
      );

    nodeGroupSel
      .on("mousemove", (event: MouseEvent, d: SimNode) => {
        const html =
          `<b>Gene:</b> ${escapeHtml(d.id)}<br>` +
          `<b>Category:</b> ${escapeHtml(d.category)}<br>` +
          `<b>Neighbor weight:</b> ${d.neighborCount.toLocaleString()}<br>` +
          `<b>Edges shown:</b> ${d.degree}`;
        setTooltip({ x: event.clientX, y: event.clientY, html });
      })
      .on("mouseleave", () => setTooltip(null));

    const attachEdgeInteractions = <TElement extends SVGLineElement | SVGPathElement>(
      selection: d3.Selection<TElement, SimLink, SVGGElement, unknown>
    ) => {
      selection.on("mousemove", (event: MouseEvent, d: SimLink) => {
        const { source, target } = resolveLinkGeneIds(d, nodeById);
        setTooltip({
          x: event.clientX,
          y: event.clientY,
          html: buildEdgeHoverHtml(source, target, d.count, d.averageGapBp, directed)
        });
      });
      selection.on("mouseleave", () => setTooltip(null));
      selection.on("click", (event: MouseEvent, d: SimLink) => {
        event.stopPropagation();
        if (!getEdgePhylumBreakdownRef.current) {
          return;
        }
        handleEdgePin(d, nodeById);
      });
    };

    attachEdgeInteractions(linkSel);
    if (arrowSel) {
      attachEdgeInteractions(arrowSel);
    }

    const simulation =
      layoutMode === "force"
        ? d3
            .forceSimulation<SimNode>(nodes)
            .force(
              "link",
              d3
                .forceLink<SimNode, SimLink>(links)
                .id((d) => d.id)
                .distance((d: SimLink) => d.targetDistance)
                .strength(0.2)
            )
            .force("charge", d3.forceManyBody().strength(-340))
            .force("center", d3.forceCenter(VIEW_W / 2, VIEW_H / 2))
            .force("x", d3.forceX(VIEW_W / 2).strength(0.04))
            .force("y", d3.forceY(VIEW_H / 2).strength(0.04))
            .force(
              "collide",
              d3
                .forceCollide()
                .radius(NODE_RADIUS + 14)
                .strength(1)
            )
        : null;

    type EdgeSelection = d3.Selection<SVGPathElement, SimLink, SVGGElement, unknown>;
    type ArrowSelection = d3.Selection<SVGPathElement, SimLink, SVGGElement, unknown>;
    type EdgeLabelSelection = d3.Selection<SVGTextElement, SimLink, SVGGElement, unknown>;

    const positionEdges = (sel: EdgeSelection) => {
      sel.attr("d", (d) => linkGeometry(d, nodeById, directed).pathD);
    };

    const positionArrows = (sel: ArrowSelection) => {
      sel.attr("d", (d) => {
        const geometry = linkGeometry(d, nodeById, true);
        return geometry.arrowPath ?? "";
      });
    };

    const positionEdgeLabels = (sel: EdgeLabelSelection) => {
      sel.each(function (d) {
        const geometry = linkGeometry(d, nodeById, directed);
        d3.select(this).attr("x", geometry.labelX).attr("y", geometry.labelY);
      });
    };

    const renderNetworkPositions = () => {
      if (layoutMode === "force") {
        constrainLinkDistances(links);
      }
      positionEdges(linkOutlineSel);
      positionEdges(linkSel);
      if (arrowOutlineSel) {
        positionArrows(arrowOutlineSel);
      }
      if (arrowSel) {
        positionArrows(arrowSel);
      }
      positionEdgeLabels(edgeLabelSel);
      nodeGroupSel.attr("transform", nodeTranslate);
      for (const node of nodes) {
        positionsRef.current.set(node.id, { x: node.x ?? 0, y: node.y ?? 0 });
      }
    };

    if (simulation) {
      simulation.on("tick", renderNetworkPositions);

      const drag = d3
        .drag<SVGGElement, SimNode>()
        .on("start", (event, d) => {
          if (!event.active) {
            simulation.alphaTarget(0.3).restart();
          }
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active) {
            simulation.alphaTarget(0);
          }
          d.fx = null;
          d.fy = null;
        });
      nodeGroupSel.call(drag);
    } else {
      renderNetworkPositions();
    }

    if (!legendCollapsed) {
      const categories = orderedLegendCategories(nodes.map((node) => node.category));
      const legendWidth = 140;
      const legendX = VIEW_W - legendWidth - LEGEND_PAD;
      const legendY = LEGEND_PAD;
      const legendLineLen = legendWidth - LEGEND_INNER_PAD * 2;
      const widthWedgeH = 22;
      const widthLegendH = LEGEND_TITLE_SIZE + 8 + widthWedgeH + 14;
      const catSectionH = categories.length > 0 ? 10 + LEGEND_TITLE_SIZE + 6 + categories.length * LEGEND_ITEM_H : 0;
      const legendH = LEGEND_INNER_PAD * 2 + widthLegendH + catSectionH;

      const legend = root
        .append("g")
        .attr("class", "network-legend")
        .attr("pointer-events", "none");

      legend
        .append("rect")
        .attr("x", legendX)
        .attr("y", legendY)
        .attr("width", legendWidth)
        .attr("height", legendH)
        .attr("rx", 8)
        .attr("fill", theme.legendBg)
        .attr("stroke", theme.legendBorder);

      let cursorY = legendY + LEGEND_INNER_PAD;
      const contentX = legendX + LEGEND_INNER_PAD;

      legend
        .append("text")
        .attr("x", contentX)
        .attr("y", cursorY)
        .attr("font-size", LEGEND_TITLE_SIZE)
        .attr("font-weight", 600)
        .attr("fill", theme.legendTitle)
        .text("Avg prevalence (width)");

      cursorY += LEGEND_TITLE_SIZE + 8;
      const wedgeTopY = cursorY;
      const wedgeBottomY = cursorY + widthWedgeH;
      legend
        .append("polygon")
        .attr(
          "points",
          [
            `${contentX},${wedgeBottomY}`,
            `${contentX + legendLineLen},${wedgeTopY}`,
            `${contentX + legendLineLen},${wedgeBottomY}`
          ].join(" ")
        )
        .attr("fill", theme.edge)
        .attr("fill-opacity", 0.92)
        .attr("stroke", theme.edge)
        .attr("stroke-width", 1);

      legend
        .append("line")
        .attr("x1", contentX + legendLineLen)
        .attr("y1", wedgeTopY)
        .attr("x2", contentX + legendLineLen)
        .attr("y2", wedgeBottomY)
        .attr("stroke", theme.edgeOutline)
        .attr("stroke-width", 1.5);

      cursorY = wedgeBottomY + 10;
      legend
        .append("text")
        .attr("x", contentX)
        .attr("y", cursorY)
        .attr("font-size", LEGEND_TEXT_SIZE)
        .attr("fill", theme.legendText)
        .text(`${minCount}%`);

      legend
        .append("text")
        .attr("x", contentX + legendLineLen)
        .attr("y", cursorY)
        .attr("text-anchor", "end")
        .attr("font-size", LEGEND_TEXT_SIZE)
        .attr("fill", theme.legendText)
        .text(`${maxCount.toFixed(1)}%`);

      if (categories.length > 0) {
        cursorY += 10;
        legend
          .append("text")
          .attr("x", contentX)
          .attr("y", cursorY)
          .attr("font-size", LEGEND_TITLE_SIZE)
          .attr("font-weight", 600)
          .attr("fill", theme.legendTitle)
          .text("Categories");
        cursorY += LEGEND_TITLE_SIZE + 6;
        for (const category of categories) {
          const fill = getFlagellaCategoryColor(category, isDarkMode);
          const swatchY = cursorY - LEGEND_SWATCH_R;
          legend
            .append("circle")
            .attr("cx", contentX + LEGEND_SWATCH_R)
            .attr("cy", swatchY)
            .attr("r", LEGEND_SWATCH_R)
            .attr("fill", fill);
          legend
            .append("text")
            .attr("x", contentX + LEGEND_SWATCH_R * 2 + 6)
            .attr("y", swatchY)
            .attr("dominant-baseline", "middle")
            .attr("font-size", LEGEND_TEXT_SIZE)
            .attr("fill", theme.legendText)
            .text(category);
          cursorY += LEGEND_ITEM_H;
        }
      }
    }

    return () => {
      simulation?.stop();
    };
  }, [
    labels,
    rawLinks,
    geneNeighborCounts,
    minCount,
    maxCount,
    hideIsolated,
    theme,
    isDarkMode,
    directed,
    layoutMode,
    legendCollapsed,
    handleEdgePin,
    resolveLinkGeneIds
  ]);

  const downloadNetworkSvg = useCallback(() => {
    const svg = svgRef.current;
    if (!svg?.firstChild) {
      return;
    }
    const serialized = prepareNetworkSvgForExport(svg);
    const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`], {
      type: "image/svg+xml;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = downloadFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [downloadFilename]);

  const hasData = labels.length > 0;

  return (
    <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-[var(--dialog-bg)] overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 dark:border-white/10 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-[var(--text)] m-0">{title}</h2>
          <p className="text-xs text-[var(--text-soft)] m-0 mt-1">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setLegendCollapsed((current) => !current)}
            className="rounded-md border border-black/10 dark:border-white/10 px-3 py-1.5 text-xs font-semibold text-[var(--text-soft)] hover:text-[var(--text)]"
            aria-pressed={legendCollapsed}
          >
            {legendCollapsed ? "Show legend" : "Hide legend"}
          </button>
          {onOpenPhyleticDistribution ? (
            <button
              type="button"
              onClick={onOpenPhyleticDistribution}
              disabled={!canOpenPhyleticDistribution}
              className="rounded-md border border-black/10 dark:border-white/10 px-3 py-1.5 text-xs font-semibold text-[var(--text-soft)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Go to Phyletic Distribution
            </button>
          ) : null}
          <DownloadActionButton onClick={downloadNetworkSvg} disabled={!hasData || linkPreview.edgeCount === 0}>
            Download SVG
          </DownloadActionButton>
        </div>
      </div>

      <p className="text-xs text-[var(--text-soft)] m-0 px-4 py-3 sm:px-5 border-b border-black/10 dark:border-white/10 tabular-nums">
        {linkPreview.nodeCount} genes · {linkPreview.edgeCount} edges shown
        {getEdgePhylumBreakdown ? " · Click an edge for phylum prevalence" : ""}
      </p>

      {pinnedEdge ? (
        <div className="border-b border-black/10 dark:border-white/10 px-4 py-4 sm:px-5 bg-[var(--surface)]">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
            <div>
              <p className="text-sm font-semibold text-[var(--text)] m-0">
                {pinnedEdge.source} {directed ? "→" : "↔"} {pinnedEdge.target}
              </p>
              <p className="text-xs text-[var(--text-soft)] m-0 mt-1 tabular-nums">
                {pinnedEdge.count.toFixed(1)}% average prevalence
                {formatAverageGapBp(pinnedEdge.averageGapBp)
                  ? ` · avg distance ${formatAverageGapBp(pinnedEdge.averageGapBp)}`
                  : ""}{" "}
                · top phyla by prevalence (% of each phylum&apos;s assemblies with this edge)
              </p>
            </div>
            <button
              type="button"
              className="text-xs font-semibold text-[var(--text-soft)] hover:text-[var(--text)]"
              onClick={() => setPinnedEdge(null)}
            >
              Close
            </button>
          </div>
          {pinnedEdge.breakdown.length > 0 ? (
            <ul className="space-y-1.5 m-0 p-0 list-none">
              {pinnedEdge.breakdown.map((item) => (
                <li key={item.phylum} className="text-xs text-[var(--text-soft)]">
                  <div className="flex items-center justify-between gap-3 tabular-nums">
                    <span
                      className={
                        item.meetsConservationThreshold
                          ? "text-[var(--text)] font-semibold"
                          : "text-[var(--text)]"
                      }
                    >
                      {item.label}
                      {item.meetsConservationThreshold ? " ✓" : ""}
                    </span>
                    <span className="font-semibold text-[var(--text)]">{item.percent.toFixed(1)}%</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 tabular-nums mt-0.5">
                    <span className="text-[10px]">
                      {item.assembliesWithEdge.toLocaleString()} of {item.phylumTotal.toLocaleString()}{" "}
                      assemblies
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[var(--header-bg-mid)]"
                      style={{ width: `${Math.max(0, Math.min(100, item.percent))}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-[var(--text-soft)] m-0">
              No phylum breakdown available for this edge. Rebuild the association bundle after updating
              the operon cache.
            </p>
          )}
        </div>
      ) : null}

      <div className="relative overflow-hidden min-h-[400px] bg-[var(--surface)]">
        {hasData ? (
          <svg ref={svgRef} className="block w-full h-auto" aria-label={title} />
        ) : (
          <p className="text-sm text-[var(--text-soft)] px-4 py-10 text-center">
            No operon association data available yet.
          </p>
        )}
        {hasData && linkPreview.edgeCount === 0 ? (
          <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-[var(--text-soft)] px-4">
            No edges meet the minimum average association of {minCount}%. Lower the average
            threshold.
          </p>
        ) : null}
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
