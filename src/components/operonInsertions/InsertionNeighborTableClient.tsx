"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { withBasePath } from "@/lib/assetPaths";
import { cn } from "@/lib/utils";
import type {
  InsertionNeighborAssociation,
  InsertionNeighborBundle,
  InsertionNeighborDirection
} from "@/lib/operonInsertions/types";

const KEGG_DATA_URL = "/operon-insertions/insertion-neighbor-associations.json";
const PFAM_DATA_URL = "/operon-insertions/pfam-insertion-neighbor-associations.json";
const KEGG_NAMES_URL = "/operon-insertions/kegg-orthology-names.json";
const PFAM_METADATA_URL = "/operon-insertions/pfam-entry-metadata.json";
const PFAM_OVERLAP_URL = "/operon-insertions/pfam-domain-overlap-groups.json";
const KO_PFAM_OVERLAP_URL = "/operon-insertions/ko-pfam-overlap-groups.json";
const INSERTION_PHYLETIC_SPARSE_URL = "/operon-insertions/insertion-association-phyletic-sparse.json";
const OPERON_PHYLETIC_TRANSFER_PREFIX = "operon-phyletic-transfer:";

type SortKey =
  | "count"
  | "occurrencePercent"
  | "meanDistanceBp"
  | "medianDistanceBp"
  | "standardDeviationBp";

type AnnotationTable = "kegg" | "pfam" | "combined";

type PfamEntryMetadata = {
  shortName: string | null;
  name: string | null;
  description: string | null;
  type: string | null;
  integrated: string | null;
};

type PfamOverlapGroup = {
  representative: string;
  members: string[];
  minimumWithinGroupJaccard: number;
  maximumWithinGroupJaccard: number;
};

type PfamOverlapPair = {
  domainA: string;
  domainB: string;
  countA: number;
  countB: number;
  intersection: number;
  union: number;
  jaccard: number;
  coverageAByB: number;
  coverageBByA: number;
  overlapCoefficient: number;
};

type KoPfamOverlapPair = {
  koId: string;
  pfamRepresentative: string;
  pfamMembers: string[];
  koCount: number;
  pfamCount: number;
  intersection: number;
  union: number;
  jaccard: number;
  coverageKoByPfam: number;
  coveragePfamByKo: number;
  maxCoverage: number;
};

type KoPfamCombinedOverlap = {
  koId: string;
  pfamRepresentatives: string[];
  pfamMembers: string[];
  koCount: number;
  pfamCount: number;
  intersection: number;
  union: number;
  jaccard: number;
  coverageKoByPfam: number;
  coveragePfamByKo: number;
  maxCoverage: number;
};

type KoPfamOverlapReport = {
  threshold: number;
  summary?: {
    matchedKeggGroups: number;
    matchedPairs: number;
  };
  pfamByKo: Record<string, KoPfamOverlapPair[]>;
  combinedByKo?: Record<string, KoPfamCombinedOverlap>;
  pairs: KoPfamOverlapPair[];
};

type CombinedAssociationRow = {
  koRow: InsertionNeighborAssociation | null;
  pfamRow: InsertionNeighborAssociation | null;
  koId: string | null;
  pfamRepresentative: string | null;
  pfamRepresentatives: string[];
  pfamMembers: string[];
  neighborGene: string;
  direction: InsertionNeighborDirection;
  keggCoverage: number | null;
  pfamCoverage: number | null;
};

type OverlapHeatmapMetric = "containment" | "jaccard";

type AnnotationTooltip = {
  x: number;
  y: number;
  accession: string;
  shortName: string | null;
  description: string;
  sourceLabel: string;
  mergedMembers: string[];
  totalCount: number;
  operonCount: number;
  totalAssociationPercent: number;
  maxDistanceBp: number;
} | null;

type CombinedTooltipSource = "kegg" | "pfam";

type InsertionPhyleticAssociation = {
  source: string;
  sourceType: "kegg" | "pfam";
  target: string;
  count: number;
  occurrencePercent: number;
  meanDistanceBp: number;
};

const TSV_LIST_DELIMITER = ",";

function formatNumber(value: number, maximumFractionDigits = 1): string {
  return value.toLocaleString(undefined, { maximumFractionDigits });
}

function normalizePfamId(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return /^PF\d{5}(?:\.\d+)?$/.test(normalized) ? normalized.split(".")[0] : null;
}

function annotationEntryUrl(value: string, table: AnnotationTable): string | null {
  if (table === "kegg") {
    return /^K\d{5}$/i.test(value)
      ? `https://www.genome.jp/entry/${value.toUpperCase()}`
      : null;
  }
  if (table === "combined") return null;
  const pfamId = normalizePfamId(value);
  return pfamId ? `https://www.ebi.ac.uk/interpro/entry/pfam/${pfamId}/` : null;
}

function keggShortName(label: string | undefined): string | null {
  if (!label) return null;
  return label.split(";")[0]?.trim() || null;
}

function pfamEntryFor(
  value: string,
  entries: Record<string, PfamEntryMetadata>
): PfamEntryMetadata | undefined {
  return entries[normalizePfamId(value) ?? value];
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function pfamShortNames(
  ids: string[],
  entries: Record<string, PfamEntryMetadata>
): string[] {
  return uniqueNonEmpty(ids.map((id) => pfamEntryFor(id, entries)?.shortName));
}

function pfamSearchText(
  ids: string[],
  entries: Record<string, PfamEntryMetadata>
): string {
  return ids
    .flatMap((id) => {
      const entry = pfamEntryFor(id, entries);
      return [id, entry?.shortName];
    })
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function keggDescription(label: string | undefined): string {
  if (!label) return "No KEGG description is available.";
  const parts = label.split(";");
  return parts.length > 1 ? parts.slice(1).join(";").trim() : label.trim();
}

function positionAnnotationTooltip(clientX: number, clientY: number) {
  const tooltipWidth = 360;
  const tooltipHeightEstimate = Math.min(360, Math.max(220, window.innerHeight - 24));
  const x = Math.max(
    12,
    Math.min(clientX + 14, window.innerWidth - tooltipWidth - 12)
  );
  const belowY = clientY + 14;
  const aboveY = clientY - tooltipHeightEstimate - 14;
  const y =
    belowY + tooltipHeightEstimate <= window.innerHeight - 12
      ? belowY
      : Math.max(12, aboveY);
  return { x, y };
}

async function fetchOptionalJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(withBasePath(url));
    if (!response.ok) return fallback;
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

function escapeTsvCell(value: string | number): string {
  return String(value).replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

function formatTsvDecimal(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) : "";
}

function escapeSvgText(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizePhyleticFeatureName(value: string): string {
  return (
    value
      .trim()
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "Unknown"
  );
}

function insertionPhyleticColumnName(
  source: string,
  target: string
): string {
  return `${sanitizePhyleticFeatureName(source)}_to_${sanitizePhyleticFeatureName(target)}_count`;
}

function insertionPhyleticDisplayName(
  source: string,
  target: string
): string {
  return `${source}->${target}_count`;
}

function downloadTextFile(filename: string, contents: string, type: string) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

type SvgTableColumn = {
  header: string;
  width: number;
  align?: "left" | "center" | "right";
};

type SvgTableHeaderGroup = {
  header: string;
  start: number;
  span: number;
};

type SvgTableCellSpan = {
  rowIndex: number;
  columnIndex: number;
  rowSpan: number;
};

function formatDirectionLabel(value: InsertionNeighborDirection): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function wrapSvgLines(value: string | number, width: number, fontSize: number): string[] {
  const text = String(value || "-").trim() || "-";
  const maxChars = Math.max(4, Math.floor(width / (fontSize * 0.58)));
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";

  const pushLongWord = (word: string) => {
    for (let index = 0; index < word.length; index += maxChars) {
      lines.push(word.slice(index, index + maxChars));
    }
  };

  for (const word of words) {
    if (word.length > maxChars) {
      if (line) {
        lines.push(line);
        line = "";
      }
      pushLongWord(word);
      continue;
    }
    const nextLine = line ? `${line} ${word}` : word;
    if (nextLine.length > maxChars) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = nextLine;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : ["-"];
}

function renderSvgText(
  lines: string[],
  x: number,
  y: number,
  width: number,
  height: number,
  fontSize: number,
  align: SvgTableColumn["align"] = "left",
  color = "#17233f",
  fontWeight = 500
): string {
  const lineHeight = fontSize + 4;
  const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
  const textX = align === "center" ? x + width / 2 : align === "right" ? x + width - 6 : x + 6;
  const firstY = y + Math.max(fontSize + 3, (height - lines.length * lineHeight) / 2 + fontSize);
  return lines
    .map(
      (line, index) =>
        `<text x="${textX}" y="${firstY + index * lineHeight}" text-anchor="${anchor}" font-size="${fontSize}" font-weight="${fontWeight}" fill="${color}">${escapeSvgText(line)}</text>`
    )
    .join("");
}

function downloadSvgTable(
  filename: string,
  columns: SvgTableColumn[],
  rows: string[][],
  headerGroups: SvgTableHeaderGroup[] = [],
  cellSpans: SvgTableCellSpan[] = [],
  rowStripeIndexes: number[] = []
) {
  const fontFamily = "Arial, Helvetica, sans-serif";
  const headerFontSize = 12;
  const bodyFontSize = 12;
  const paddingX = 6;
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
  const headerLineHeight = headerFontSize + 4;
  const bodyLineHeight = bodyFontSize + 4;
  const headerLines = columns.map((column) =>
    wrapSvgLines(column.header, column.width - paddingX * 2, headerFontSize)
  );
  const groupedColumnIndexes = new Set<number>();
  for (const group of headerGroups) {
    for (let index = group.start; index < group.start + group.span; index += 1) {
      groupedColumnIndexes.add(index);
    }
  }
  const headerTopHeight = headerGroups.length > 0 ? 26 : 0;
  const headerLeafHeight = Math.max(
    26,
    Math.max(...headerLines.map((lines) => lines.length * headerLineHeight + 10))
  );
  const headerHeight =
    headerGroups.length > 0 ? headerTopHeight + headerLeafHeight : headerLeafHeight;
  const rowLines = rows.map((row) =>
    row.map((cell, index) =>
      wrapSvgLines(cell, columns[index]?.width ?? 80, bodyFontSize)
    )
  );
  if (rowLines.length === 0) {
    rowLines.push(columns.map(() => ["No rows match the current filters."]));
  }
  const rowHeights = rowLines.map((lineGroups) =>
    Math.max(22, ...lineGroups.map((lines) => lines.length * bodyLineHeight + 8))
  );
  for (const span of cellSpans) {
    const lines = rowLines[span.rowIndex]?.[span.columnIndex];
    if (!lines) continue;
    const currentHeight = rowHeights
      .slice(span.rowIndex, span.rowIndex + span.rowSpan)
      .reduce((sum, height) => sum + height, 0);
    const neededHeight = lines.length * bodyLineHeight + 8;
    if (neededHeight > currentHeight) {
      rowHeights[span.rowIndex] += neededHeight - currentHeight;
    }
  }
  const totalHeight = headerHeight + rowHeights.reduce((sum, row) => sum + row, 0);
  const rowYPositions: number[] = [];
  let nextRowY = headerHeight;
  for (const rowHeight of rowHeights) {
    rowYPositions.push(nextRowY);
    nextRowY += rowHeight;
  }
  const spanByAnchor = new Map<string, SvgTableCellSpan>();
  const coveredCells = new Set<string>();
  for (const span of cellSpans) {
    spanByAnchor.set(`${span.rowIndex}\t${span.columnIndex}`, span);
    for (let offset = 1; offset < span.rowSpan; offset += 1) {
      coveredCells.add(`${span.rowIndex + offset}\t${span.columnIndex}`);
    }
  }
  const svgParts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tableWidth}" height="${totalHeight}" viewBox="0 0 ${tableWidth} ${totalHeight}">`,
    `<rect width="${tableWidth}" height="${totalHeight}" fill="#ffffff"/>`,
    `<g font-family="${fontFamily}">`
  ];

  let x = 0;
  if (headerGroups.length > 0) {
    for (const [index, column] of columns.entries()) {
      if (groupedColumnIndexes.has(index)) {
        x += column.width;
        continue;
      }
      svgParts.push(
        `<rect x="${x}" y="0" width="${column.width}" height="${headerHeight}" fill="#263a6b" stroke="#c9d5ee" stroke-width="1"/>`,
        renderSvgText(
          headerLines[index],
          x,
          0,
          column.width,
          headerHeight,
          headerFontSize,
          "center",
          "#ffffff",
          700
        )
      );
      x += column.width;
    }

    for (const group of headerGroups) {
      const groupX = columns
        .slice(0, group.start)
        .reduce((sum, column) => sum + column.width, 0);
      const groupWidth = columns
        .slice(group.start, group.start + group.span)
        .reduce((sum, column) => sum + column.width, 0);
      svgParts.push(
        `<rect x="${groupX}" y="0" width="${groupWidth}" height="${headerTopHeight}" fill="#263a6b" stroke="#c9d5ee" stroke-width="1"/>`,
        renderSvgText(
          wrapSvgLines(group.header, groupWidth - paddingX * 2, headerFontSize),
          groupX,
          0,
          groupWidth,
          headerTopHeight,
          headerFontSize,
          "center",
          "#ffffff",
          700
        )
      );
    }

    x = 0;
    for (const [index, column] of columns.entries()) {
      if (!groupedColumnIndexes.has(index)) {
        x += column.width;
        continue;
      }
      svgParts.push(
        `<rect x="${x}" y="${headerTopHeight}" width="${column.width}" height="${headerLeafHeight}" fill="#263a6b" stroke="#c9d5ee" stroke-width="1"/>`,
        renderSvgText(
          headerLines[index],
          x,
          headerTopHeight,
          column.width,
          headerLeafHeight,
          headerFontSize,
          "center",
          "#ffffff",
          700
        )
      );
      x += column.width;
    }
  } else {
    for (const [index, column] of columns.entries()) {
      svgParts.push(
        `<rect x="${x}" y="0" width="${column.width}" height="${headerHeight}" fill="#263a6b" stroke="#c9d5ee" stroke-width="1"/>`,
        renderSvgText(
          headerLines[index],
          x,
          0,
          column.width,
          headerHeight,
          headerFontSize,
          "center",
          "#ffffff",
          700
        )
      );
      x += column.width;
    }
  }

  rowLines.forEach((lineGroups, rowIndex) => {
    const y = rowYPositions[rowIndex];
    const rowHeight = rowHeights[rowIndex];
    const stripeIndex = rowStripeIndexes[rowIndex] ?? rowIndex;
    const fill = stripeIndex % 2 === 0 ? "#ffffff" : "#f8fbff";
    let cellX = 0;
    lineGroups.forEach((lines, columnIndex) => {
      const column = columns[columnIndex] ?? columns[columns.length - 1];
      if (!column) return;
      const cellKey = `${rowIndex}\t${columnIndex}`;
      if (coveredCells.has(cellKey)) {
        cellX += column.width;
        return;
      }
      const span = spanByAnchor.get(cellKey);
      const cellHeight = span
        ? rowHeights
            .slice(rowIndex, rowIndex + span.rowSpan)
            .reduce((sum, height) => sum + height, 0)
        : rowHeight;
      svgParts.push(
        `<rect x="${cellX}" y="${y}" width="${column.width}" height="${cellHeight}" fill="${fill}" stroke="#c9d5ee" stroke-width="1"/>`,
        renderSvgText(
          lines,
          cellX,
          y,
          column.width,
          cellHeight,
          bodyFontSize,
          column.align ?? "left",
          columnIndex <= 1 ? "#10224d" : "#17233f",
          columnIndex <= 1 ? 700 : 500
        )
      );
      cellX += column.width;
    });
  });

  svgParts.push("</g></svg>");
  downloadTextFile(filename, svgParts.join(""), "image/svg+xml;charset=utf-8");
}

function downloadRows(
  rows: InsertionNeighborAssociation[],
  table: AnnotationTable,
  keggNames: Record<string, string>,
  pfamEntries: Record<string, PfamEntryMetadata>,
  pfamOverlapGroups: Record<string, PfamOverlapGroup>
) {
  const isPfamTable = table === "pfam";
  const headers = [
    "inserted_gene",
    "inserted_gene_short_name",
    ...(isPfamTable ? ["pfam_members", "pfam_member_short_names"] : []),
    "neighbor_gene",
    "direction",
    "count",
    "insertion_count",
    "operon_insertion_count",
    "occurrence_percent",
    "mean_distance_bp",
    "standard_deviation_bp",
    "median_distance_bp",
    "q1_distance_bp",
    "q3_distance_bp"
  ];
  const lines = rows.map((row) => {
    const pfamMembers =
      isPfamTable
        ? (pfamOverlapGroups[normalizePfamId(row.insertedGene) ?? ""]?.members ?? [
            row.insertedGene
          ])
        : [];
    const insertedGeneShortName = isPfamTable
      ? pfamShortNames([row.insertedGene], pfamEntries).join(TSV_LIST_DELIMITER)
      : (keggShortName(keggNames[row.insertedGene.toUpperCase()]) ?? "");

    return [
      row.insertedGene,
      insertedGeneShortName,
      ...(isPfamTable
        ? [
            pfamMembers.join(TSV_LIST_DELIMITER),
            pfamShortNames(pfamMembers, pfamEntries).join(TSV_LIST_DELIMITER)
          ]
        : []),
      row.neighborGene,
      row.direction,
      row.count,
      row.insertionCount,
      row.operonInsertionCount,
      formatTsvDecimal(row.occurrencePercent),
      formatTsvDecimal(row.meanDistanceBp),
      formatTsvDecimal(row.standardDeviationBp),
      formatTsvDecimal(row.medianDistanceBp),
      formatTsvDecimal(row.lowerQuartileBp),
      formatTsvDecimal(row.upperQuartileBp)
    ]
      .map(escapeTsvCell)
      .join("\t");
  });
  downloadTextFile(
    "filtered-insertion-neighbor-associations.tsv",
    [headers.join("\t"), ...lines].join("\n"),
    "text/tab-separated-values;charset=utf-8"
  );
}

function downloadCombinedRows(
  rows: CombinedAssociationRow[],
  keggNames: Record<string, string>,
  pfamEntries: Record<string, PfamEntryMetadata>
) {
  const headers = [
    "ko_id",
    "ko_short_name",
    "pfam_representative",
    "pfam_representative_short_names",
    "pfam_members",
    "pfam_member_short_names",
    "neighbor_gene",
    "direction",
    "ko_count",
    "ko_occurrence_percent",
    "ko_mean_distance_bp",
    "pfam_count",
    "pfam_occurrence_percent",
    "pfam_mean_distance_bp"
  ];
  const lines = rows.map((row) =>
    [
      row.koId ?? "",
      row.koId ? (keggShortName(keggNames[row.koId.toUpperCase()]) ?? "") : "",
      row.pfamRepresentatives.join(TSV_LIST_DELIMITER),
      pfamShortNames(row.pfamRepresentatives, pfamEntries).join(TSV_LIST_DELIMITER),
      row.pfamMembers.join(TSV_LIST_DELIMITER),
      pfamShortNames(row.pfamMembers, pfamEntries).join(TSV_LIST_DELIMITER),
      row.neighborGene,
      row.direction,
      row.koRow?.count ?? "",
      formatTsvDecimal(row.koRow?.occurrencePercent),
      formatTsvDecimal(row.koRow?.meanDistanceBp),
      row.pfamRow?.count ?? "",
      formatTsvDecimal(row.pfamRow?.occurrencePercent),
      formatTsvDecimal(row.pfamRow?.meanDistanceBp)
    ]
      .map(escapeTsvCell)
      .join("\t")
  );
  downloadTextFile(
    "filtered-ko-pfam-insertion-neighbor-associations.tsv",
    [headers.join("\t"), ...lines].join("\n"),
    "text/tab-separated-values;charset=utf-8"
  );
}

function keggDisplayName(id: string | null, names: Record<string, string>): string {
  if (!id) return "-";
  const shortName = keggShortName(names[id.toUpperCase()]);
  return shortName ? `${id} / ${shortName}` : id;
}

function pfamDisplayName(id: string, entries: Record<string, PfamEntryMetadata>): string {
  const shortName = pfamEntryFor(id, entries)?.shortName;
  return shortName ? `${id} / ${shortName}` : id;
}

function downloadAssociationRowsSvg(
  rows: InsertionNeighborAssociation[],
  table: AnnotationTable,
  keggNames: Record<string, string>,
  pfamEntries: Record<string, PfamEntryMetadata>,
  pfamOverlapGroups: Record<string, PfamOverlapGroup>
) {
  const isPfamTable = table === "pfam";
  const columns: SvgTableColumn[] = [
    { header: table === "kegg" ? "KO ID" : "PFAM ID", width: 180, align: "center" },
    { header: "NEIGHBOR", width: 95, align: "center" },
    { header: "DIRECTION", width: 95, align: "center" },
    { header: "COUNT", width: 70, align: "center" },
    { header: "% INSERT", width: 85, align: "center" },
    { header: "MEAN GAP", width: 85, align: "center" },
    { header: "SD", width: 80, align: "center" },
    { header: "MEDIAN GAP", width: 90, align: "center" },
    { header: "IQR (Q1-Q3)", width: 125, align: "center" }
  ];
  const rowStripeIndexes: number[] = [];
  let currentGroupIndex = -1;
  let previousInsertedGene: string | null = null;
  const svgRows = rows.map((row) => {
    if (row.insertedGene !== previousInsertedGene) {
      currentGroupIndex += 1;
      previousInsertedGene = row.insertedGene;
    }
    rowStripeIndexes.push(currentGroupIndex);
    const insertedGeneLabel = isPfamTable
      ? (pfamOverlapGroups[normalizePfamId(row.insertedGene) ?? ""]?.members ?? [
          row.insertedGene
        ])
          .map((member) => pfamDisplayName(member, pfamEntries))
          .join(", ")
      : keggDisplayName(row.insertedGene, keggNames);

    return [
      insertedGeneLabel,
      row.neighborGene,
      formatDirectionLabel(row.direction),
      row.count.toLocaleString(),
      `${formatNumber(row.occurrencePercent)}%`,
      `${formatNumber(row.meanDistanceBp)} bp`,
      `${formatNumber(row.standardDeviationBp)} bp`,
      `${formatNumber(row.medianDistanceBp)} bp`,
      `${formatNumber(row.lowerQuartileBp)}-${formatNumber(row.upperQuartileBp)} bp`
    ];
  });

  downloadSvgTable(
    "filtered-insertion-neighbor-associations.svg",
    columns,
    svgRows,
    [],
    [],
    rowStripeIndexes
  );
}

function downloadCombinedRowsSvg(
  groups: Array<{ key: string; rows: CombinedAssociationRow[] }>,
  keggNames: Record<string, string>,
  pfamEntries: Record<string, PfamEntryMetadata>
) {
  const columns: SvgTableColumn[] = [
    { header: "KO ID", width: 140, align: "center" },
    { header: "PFAM ID", width: 210, align: "center" },
    { header: "NEIGHBOR", width: 100, align: "center" },
    { header: "DIRECTION", width: 105, align: "center" },
    { header: "COUNT", width: 75, align: "center" },
    { header: "% INSERT", width: 105, align: "center" },
    { header: "MEAN GAP", width: 90, align: "center" },
    { header: "COUNT", width: 75, align: "center" },
    { header: "% INSERT", width: 105, align: "center" },
    { header: "MEAN GAP", width: 90, align: "center" }
  ];
  const svgRows: string[][] = [];
  const cellSpans: SvgTableCellSpan[] = [];
  const rowStripeIndexes: number[] = [];

  for (const [groupIndex, group] of groups.entries()) {
    const groupStart = svgRows.length;
    const firstRow = group.rows[0];
    const groupPfamMembers = [
      ...new Set(group.rows.flatMap((groupRow) => groupRow.pfamMembers))
    ];

    group.rows.forEach((row, rowIndex) => {
      rowStripeIndexes.push(groupIndex);
      svgRows.push([
        rowIndex === 0 ? keggDisplayName(firstRow?.koId ?? null, keggNames) : "",
        rowIndex === 0
          ? groupPfamMembers.map((member) => pfamDisplayName(member, pfamEntries)).join(", ") || "-"
          : "",
        row.neighborGene,
        formatDirectionLabel(row.direction),
        row.koRow ? row.koRow.count.toLocaleString() : "-",
        row.koRow ? `${formatNumber(row.koRow.occurrencePercent)}%` : "-",
        row.koRow ? `${formatNumber(row.koRow.meanDistanceBp)} bp` : "-",
        row.pfamRow ? row.pfamRow.count.toLocaleString() : "-",
        row.pfamRow ? `${formatNumber(row.pfamRow.occurrencePercent)}%` : "-",
        row.pfamRow ? `${formatNumber(row.pfamRow.meanDistanceBp)} bp` : "-"
      ]);
    });

    if (group.rows.length > 1) {
      cellSpans.push(
        { rowIndex: groupStart, columnIndex: 0, rowSpan: group.rows.length },
        { rowIndex: groupStart, columnIndex: 1, rowSpan: group.rows.length }
      );
    }
  }

  downloadSvgTable(
    "filtered-ko-pfam-insertion-neighbor-associations.svg",
    columns,
    svgRows,
    [
      { header: "KEGG ORTHOLOGY", start: 4, span: 3 },
      { header: "PFAM", start: 7, span: 3 }
    ],
    cellSpans,
    rowStripeIndexes
  );
}

function buildTotalAssociationPercentByInsertedGene(
  rows: InsertionNeighborAssociation[] = []
) {
  const associationCounts = new Map<string, number>();
  const insertionCounts = new Map<string, number>();
  for (const row of rows) {
    associationCounts.set(
      row.insertedGene,
      (associationCounts.get(row.insertedGene) ?? 0) + row.count
    );
    insertionCounts.set(row.insertedGene, row.insertionCount);
  }
  return new Map(
    [...associationCounts.entries()].map(([insertedGene, associationCount]) => {
      const insertionCount = insertionCounts.get(insertedGene) ?? 0;
      return [
        insertedGene,
        insertionCount > 0 ? (100 * associationCount) / insertionCount : 0
      ];
    })
  );
}

function overlapPairKey(domainA: string, domainB: string): string {
  return domainA < domainB ? `${domainA}\t${domainB}` : `${domainB}\t${domainA}`;
}

function heatmapColor(value: number): string {
  const fraction = Math.max(0, Math.min(1, (value - 0.5) / 0.5));
  const start = [219, 234, 254];
  const end = [29, 78, 216];
  const channels = start.map((channel, index) =>
    Math.round(channel + (end[index] - channel) * fraction)
  );
  return `rgb(${channels.join(",")})`;
}

function PfamOverlapHeatmap({
  pairs,
  entries,
  initialThreshold
}: {
  pairs: PfamOverlapPair[];
  entries: Record<string, PfamEntryMetadata>;
  initialThreshold: number;
}) {
  const minimumDisplayedSimilarity = 0.5;
  const [highlightThreshold, setHighlightThreshold] = useState(initialThreshold);
  const [metric, setMetric] = useState<OverlapHeatmapMetric>("containment");
  const pairValue = (pair: PfamOverlapPair) =>
    metric === "containment" ? pair.overlapCoefficient : pair.jaccard;

  const heatmap = useMemo(() => {
    const displayedPairs = pairs.filter(
      (pair) => pairValue(pair) >= minimumDisplayedSimilarity
    );
    const domains = new Set<string>();
    const neighbors = new Map<string, Set<string>>();
    const weightedDegree = new Map<string, number>();
    const pairByKey = new Map<string, PfamOverlapPair>();

    for (const pair of pairs) {
      pairByKey.set(overlapPairKey(pair.domainA, pair.domainB), pair);
    }
    for (const pair of displayedPairs) {
      domains.add(pair.domainA);
      domains.add(pair.domainB);
      const neighborsA = neighbors.get(pair.domainA) ?? new Set<string>();
      const neighborsB = neighbors.get(pair.domainB) ?? new Set<string>();
      neighborsA.add(pair.domainB);
      neighborsB.add(pair.domainA);
      neighbors.set(pair.domainA, neighborsA);
      neighbors.set(pair.domainB, neighborsB);
      weightedDegree.set(
        pair.domainA,
        (weightedDegree.get(pair.domainA) ?? 0) + pairValue(pair)
      );
      weightedDegree.set(
        pair.domainB,
        (weightedDegree.get(pair.domainB) ?? 0) + pairValue(pair)
      );
    }

    const components: string[][] = [];
    const visited = new Set<string>();
    for (const start of [...domains].sort((a, b) => a.localeCompare(b))) {
      if (visited.has(start)) continue;
      const component: string[] = [];
      const stack = [start];
      visited.add(start);
      while (stack.length > 0) {
        const domain = stack.pop()!;
        component.push(domain);
        for (const neighbor of neighbors.get(domain) ?? []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            stack.push(neighbor);
          }
        }
      }
      component.sort(
        (a, b) =>
          (weightedDegree.get(b) ?? 0) - (weightedDegree.get(a) ?? 0) ||
          a.localeCompare(b)
      );
      components.push(component);
    }
    components.sort(
      (a, b) =>
        b.length - a.length ||
        (weightedDegree.get(b[0]) ?? 0) - (weightedDegree.get(a[0]) ?? 0) ||
        a[0].localeCompare(b[0])
    );

    return {
      domains: components.flat(),
      pairByKey,
      displayedPairCount: displayedPairs.length
    };
  }, [metric, pairs]);

  if (heatmap.domains.length === 0) return null;

  const cellSize = 12;
  const labelWidth = 132;
  const topMargin = 130;
  const width = labelWidth + heatmap.domains.length * cellSize + 18;
  const height = topMargin + heatmap.domains.length * cellSize + 18;
  const highlightedPairCount = pairs.filter(
    (pair) => pairValue(pair) >= highlightThreshold
  ).length;
  const metricLabel = metric === "containment" ? "containment" : "Jaccard";

  return (
    <section className="rounded-lg border border-[var(--input-border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="m-0 text-lg font-semibold text-[var(--text)]">
            Pfam domain overlap
          </h2>
          <p className="m-0 mt-1 max-w-3xl text-sm text-[var(--text-soft)]">
            Pairwise protein-level domain overlap. Containment measures what fraction of the
            smaller occurrence set is covered by the larger set; Jaccard measures intersection
            over union.
          </p>
        </div>
        <div className="flex min-w-64 flex-col gap-3">
          <div
            className="inline-flex h-9 self-end rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] p-0.5"
            role="group"
            aria-label="Domain overlap metric"
          >
            {([
              ["containment", "Containment"],
              ["jaccard", "Jaccard"]
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMetric(value)}
                className={cn(
                  "rounded px-3 text-xs font-semibold transition-colors",
                  metric === value
                    ? "bg-[var(--nav-hover-bg)] text-[var(--text)] shadow-xs"
                    : "text-[var(--text-soft)] hover:bg-[var(--dropdown-hover)] hover:text-[var(--text)]"
                )}
                aria-pressed={metric === value}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="text-xs font-semibold text-[var(--text-soft)]">
            <span className="flex justify-between gap-4">
              <span>Candidate merge threshold</span>
              <span className="tabular-nums text-[var(--text)]">
                {highlightThreshold.toFixed(2)}
              </span>
            </span>
            <input
              className="mt-2 w-full accent-[var(--primary)]"
              type="range"
              min={0.5}
              max={1}
              step={0.01}
              value={highlightThreshold}
              onChange={(event) => setHighlightThreshold(Number(event.target.value))}
            />
            <span className="mt-1 block font-normal">
              {highlightedPairCount.toLocaleString()} pairs meet this threshold
            </span>
          </label>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-md border border-[var(--input-border)] bg-[var(--surface-muted)] p-2">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Pairwise Pfam ${metricLabel} heatmap with ${heatmap.domains.length} domains`}
        >
          {heatmap.domains.map((domain, index) => (
            <g key={`labels-${domain}`}>
              <text
                x={labelWidth - 6}
                y={topMargin + index * cellSize + cellSize * 0.75}
                textAnchor="end"
                fontSize="8"
                fill="var(--text)"
              >
                {domain}
              </text>
              <text
                transform={`translate(${
                  labelWidth + index * cellSize + cellSize * 0.7
                } ${topMargin - 6}) rotate(-60)`}
                textAnchor="start"
                fontSize="8"
                fill="var(--text)"
              >
                {domain}
              </text>
            </g>
          ))}
          {heatmap.domains.flatMap((rowDomain, rowIndex) =>
            heatmap.domains.map((columnDomain, columnIndex) => {
              const pair =
                rowDomain === columnDomain
                  ? null
                  : heatmap.pairByKey.get(overlapPairKey(rowDomain, columnDomain));
              const value = rowDomain === columnDomain ? 1 : pair ? pairValue(pair) : 0;
              const displayed = value >= minimumDisplayedSimilarity;
              const highlighted = value >= highlightThreshold;
              const rowName = entries[rowDomain]?.shortName;
              const columnName = entries[columnDomain]?.shortName;
              return (
                <rect
                  key={`${rowDomain}-${columnDomain}`}
                  x={labelWidth + columnIndex * cellSize}
                  y={topMargin + rowIndex * cellSize}
                  width={cellSize - 0.5}
                  height={cellSize - 0.5}
                  fill={displayed ? heatmapColor(value) : "var(--surface)"}
                  opacity={displayed && !highlighted ? 0.32 : 1}
                  stroke={highlighted ? "var(--text)" : "var(--input-border)"}
                  strokeWidth={highlighted ? 0.8 : 0.25}
                >
                  <title>
                    {`${rowDomain}${rowName ? ` (${rowName})` : ""} × ${columnDomain}${
                      columnName ? ` (${columnName})` : ""
                    }\nContainment: ${
                      pair ? pair.overlapCoefficient.toFixed(4) : "1.0000"
                    }\nJaccard: ${pair ? pair.jaccard.toFixed(4) : "1.0000"}${
                      pair
                        ? `\n${rowDomain} covered by ${columnDomain}: ${
                            rowDomain === pair.domainA
                              ? pair.coverageAByB.toFixed(4)
                              : pair.coverageBByA.toFixed(4)
                          }\n${columnDomain} covered by ${rowDomain}: ${
                            columnDomain === pair.domainA
                              ? pair.coverageAByB.toFixed(4)
                              : pair.coverageBByA.toFixed(4)
                          }\nIntersection: ${pair.intersection.toLocaleString()}\nUnion: ${pair.union.toLocaleString()}`
                        : ""
                    }`}
                  </title>
                </rect>
              );
            })
          )}
        </svg>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--text-soft)]">
        <span>
          {heatmap.domains.length} domains · {heatmap.displayedPairCount} pairs at {metricLabel} ≥
          0.50
        </span>
        <span className="flex items-center gap-2">
          <span>0.50</span>
          <span
            className="h-3 w-28 rounded-sm"
            style={{
              background: `linear-gradient(to right, ${heatmapColor(0.5)}, ${heatmapColor(1)})`
            }}
          />
          <span>1.00</span>
        </span>
      </div>
    </section>
  );
}

export default function InsertionNeighborTableClient() {
  const [bundle, setBundle] = useState<InsertionNeighborBundle | null>(null);
  const [pfamBundle, setPfamBundle] = useState<InsertionNeighborBundle | null>(null);
  const [keggNames, setKeggNames] = useState<Record<string, string>>({});
  const [pfamEntries, setPfamEntries] = useState<Record<string, PfamEntryMetadata>>({});
  const [pfamOverlapGroups, setPfamOverlapGroups] = useState<
    Record<string, PfamOverlapGroup>
  >({});
  const [pfamOverlapPairs, setPfamOverlapPairs] = useState<PfamOverlapPair[]>([]);
  const [pfamMergeThreshold, setPfamMergeThreshold] = useState(0.7);
  const [koPfamOverlap, setKoPfamOverlap] = useState<KoPfamOverlapReport | null>(null);
  const [annotationTable, setAnnotationTable] = useState<AnnotationTable>("combined");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [minimumCount, setMinimumCount] = useState(1000);
  const [minimumTotalAssociationPercent, setMinimumTotalAssociationPercent] = useState(0);
  const [minimumOccurrencePercent, setMinimumOccurrencePercent] = useState(15);
  const [maximumMeanDistance, setMaximumMeanDistance] = useState<number | "">(100);
  const [sortKey, setSortKey] = useState<SortKey>("count");
  const [annotationTooltip, setAnnotationTooltip] = useState<AnnotationTooltip>(null);
  const [hoveredAnnotationGroupKey, setHoveredAnnotationGroupKey] = useState<string | null>(
    null
  );

  const showAnnotationTooltip = (
    clientX: number,
    clientY: number,
    row: InsertionNeighborAssociation,
    displayedAccession = row.insertedGene
  ) => {
    const keggLabel = keggNames[row.insertedGene.toUpperCase()];
    const pfamId = normalizePfamId(displayedAccession) ?? "";
    const representativePfamId = normalizePfamId(row.insertedGene) ?? "";
    const pfamEntry = pfamEntries[pfamId];
    const pfamGroup = pfamOverlapGroups[representativePfamId];
    const currentBundle = annotationTable === "pfam" ? pfamBundle : bundle;
    const { x, y } = positionAnnotationTooltip(clientX, clientY);
    setAnnotationTooltip({
      x,
      y,
      accession: displayedAccession,
      shortName:
        annotationTable === "kegg" ? keggShortName(keggLabel) : pfamEntry?.shortName ?? null,
      description:
        annotationTable === "kegg"
          ? keggDescription(keggLabel)
          : pfamEntry?.name ??
            pfamEntry?.description ??
            "No Pfam description is available.",
      sourceLabel: annotationTable === "kegg" ? "KEGG Orthology" : "Pfam",
      mergedMembers:
        annotationTable === "pfam"
          ? (pfamGroup?.members ?? []).filter((member) => member !== pfamId)
          : [],
      totalCount: row.insertionCount,
      operonCount: row.operonInsertionCount,
      totalAssociationPercent:
        totalAssociationPercentByInsertedGene.get(row.insertedGene) ?? 0,
      maxDistanceBp:
        currentBundle?.options.maxDistanceBp ?? 500
    });
  };

  const showCombinedAnnotationTooltip = (
    clientX: number,
    clientY: number,
    row: CombinedAssociationRow,
    source: CombinedTooltipSource,
    displayedAccession?: string
  ) => {
    const { x, y } = positionAnnotationTooltip(clientX, clientY);

    if (source === "kegg") {
      const koId = row.koId;
      if (!koId) return;
      const sourceRow =
        row.koRow ?? keggRepresentativeRowsByInsertedGene.get(koId) ?? null;
      const keggLabel = keggNames[koId.toUpperCase()];
      setAnnotationTooltip({
        x,
        y,
        accession: koId,
        shortName: keggShortName(keggLabel),
        description: keggDescription(keggLabel),
        sourceLabel: "KEGG Orthology",
        mergedMembers: [],
        totalCount: sourceRow?.insertionCount ?? 0,
        operonCount: sourceRow?.operonInsertionCount ?? 0,
        totalAssociationPercent:
          keggTotalAssociationPercentByInsertedGene.get(koId) ?? 0,
        maxDistanceBp: bundle?.options.maxDistanceBp ?? 500
      });
      return;
    }

    const accession = displayedAccession ?? row.pfamRepresentative;
    if (!accession) return;
    const pfamId = normalizePfamId(accession) ?? accession;
    const representative =
      row.pfamRepresentatives.includes(pfamId)
        ? pfamId
        : (row.pfamRepresentatives[0] ?? row.pfamRepresentative ?? null);
    if (!representative) return;
    const representativePfamId = normalizePfamId(representative) ?? representative;
    const pfamEntry = pfamEntries[pfamId];
    const sourceRow =
      row.pfamRow?.insertedGene === representativePfamId
        ? row.pfamRow
        : (pfamRepresentativeRowsByInsertedGene.get(representativePfamId) ?? null);
    setAnnotationTooltip({
      x,
      y,
      accession,
      shortName: pfamEntry?.shortName ?? null,
      description:
        pfamEntry?.name ??
        pfamEntry?.description ??
        "No Pfam description is available.",
      sourceLabel: "Pfam",
      mergedMembers: row.pfamMembers.filter((member) => member !== pfamId),
      totalCount: sourceRow?.insertionCount ?? 0,
      operonCount: sourceRow?.operonInsertionCount ?? 0,
      totalAssociationPercent:
        pfamTotalAssociationPercentByInsertedGene.get(representativePfamId) ??
        0,
      maxDistanceBp: pfamBundle?.options.maxDistanceBp ?? 500
    });
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(withBasePath(KEGG_DATA_URL)).then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as InsertionNeighborBundle;
      }),
      fetchOptionalJson<{ names?: Record<string, string> }>(KEGG_NAMES_URL, {}),
      fetchOptionalJson<InsertionNeighborBundle | null>(PFAM_DATA_URL, null),
      fetchOptionalJson<{ entries?: Record<string, PfamEntryMetadata> }>(
        PFAM_METADATA_URL,
        {}
      ),
      fetchOptionalJson<{
        threshold?: number;
        groups?: PfamOverlapGroup[];
        pairs?: PfamOverlapPair[];
      }>(
        PFAM_OVERLAP_URL,
        {}
      ),
      fetchOptionalJson<KoPfamOverlapReport | null>(KO_PFAM_OVERLAP_URL, null)
    ])
      .then(
        ([
          payload,
          keggPayload,
          pfamPayload,
          pfamMetadata,
          pfamOverlap,
          koPfamPayload
        ]) => {
        if (!cancelled) {
          setBundle(payload);
          setKeggNames(keggPayload.names ?? {});
          setPfamBundle(pfamPayload);
          setPfamEntries(pfamMetadata.entries ?? {});
          setPfamOverlapGroups(
            Object.fromEntries(
              (pfamOverlap.groups ?? []).map((group) => [group.representative, group])
            )
          );
          setPfamOverlapPairs(pfamOverlap.pairs ?? []);
          setPfamMergeThreshold(pfamOverlap.threshold ?? 0.7);
          setKoPfamOverlap(koPfamPayload);
          setMaximumMeanDistance(100);
          setLoadError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Could not load the data bundle.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeBundle = annotationTable === "pfam" ? pfamBundle : bundle;

  const totalAssociationPercentByInsertedGene = useMemo(() => {
    return buildTotalAssociationPercentByInsertedGene(activeBundle?.associations ?? []);
  }, [activeBundle]);

  const keggTotalAssociationPercentByInsertedGene = useMemo(() => {
    return buildTotalAssociationPercentByInsertedGene(bundle?.associations ?? []);
  }, [bundle]);

  const pfamTotalAssociationPercentByInsertedGene = useMemo(() => {
    return buildTotalAssociationPercentByInsertedGene(pfamBundle?.associations ?? []);
  }, [pfamBundle]);

  const keggRepresentativeRowsByInsertedGene = useMemo(() => {
    const rowsByGene = new Map<string, InsertionNeighborAssociation>();
    for (const row of bundle?.associations ?? []) {
      if (!rowsByGene.has(row.insertedGene)) rowsByGene.set(row.insertedGene, row);
    }
    return rowsByGene;
  }, [bundle]);

  const pfamRepresentativeRowsByInsertedGene = useMemo(() => {
    const rowsByGene = new Map<string, InsertionNeighborAssociation>();
    for (const row of pfamBundle?.associations ?? []) {
      if (!rowsByGene.has(row.insertedGene)) rowsByGene.set(row.insertedGene, row);
    }
    return rowsByGene;
  }, [pfamBundle]);

  const eligibleInsertedGenes = useMemo(() => {
    const eligible = new Set<string>();
    for (const row of activeBundle?.associations ?? []) {
      if (
        row.operonInsertionCount >= Math.max(1, minimumCount || 1) &&
        (totalAssociationPercentByInsertedGene.get(row.insertedGene) ?? 0) >=
          Math.max(0, minimumTotalAssociationPercent || 0)
      ) {
        eligible.add(row.insertedGene);
      }
    }
    return eligible;
  }, [
    activeBundle,
    minimumCount,
    minimumTotalAssociationPercent,
    totalAssociationPercentByInsertedGene
  ]);

  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const sortedRows = [...(activeBundle?.associations ?? [])]
      .filter((row) => eligibleInsertedGenes.has(row.insertedGene))
      .filter(
        (row) =>
          row.occurrencePercent >= Math.max(0, Math.min(100, minimumOccurrencePercent || 0))
      )
      .filter(
        (row) =>
          maximumMeanDistance === "" ||
          row.meanDistanceBp <= Math.max(0, maximumMeanDistance)
      )
      .filter(
        (row) => {
          if (!normalizedQuery) return true;
          const keggLabel = keggNames[row.insertedGene.toUpperCase()] ?? "";
          const pfamMembers =
            annotationTable === "pfam"
              ? (pfamOverlapGroups[normalizePfamId(row.insertedGene) ?? ""]?.members ?? [
                  row.insertedGene
                ])
              : [];
          return (
            row.insertedGene.toLowerCase().includes(normalizedQuery) ||
            row.neighborGene.toLowerCase().includes(normalizedQuery) ||
            (annotationTable === "kegg" &&
              keggLabel.toLowerCase().includes(normalizedQuery)) ||
            (annotationTable === "pfam" &&
              pfamSearchText(pfamMembers, pfamEntries).includes(normalizedQuery))
          );
        }
      )
      .sort(
        (a, b) =>
          b[sortKey] - a[sortKey] ||
          b.count - a.count ||
          a.insertedGene.localeCompare(b.insertedGene) ||
          a.neighborGene.localeCompare(b.neighborGene)
      );

    const groups = new Map<string, InsertionNeighborAssociation[]>();
    for (const row of sortedRows) {
      const group = groups.get(row.insertedGene) ?? [];
      group.push(row);
      groups.set(row.insertedGene, group);
    }
    return [...groups.values()].flat();
  }, [
    activeBundle,
    annotationTable,
    eligibleInsertedGenes,
    keggNames,
    maximumMeanDistance,
    minimumOccurrencePercent,
    pfamEntries,
    pfamOverlapGroups,
    query,
    sortKey
  ]);

  const combinedRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const rowPassesFilters = (
      row: InsertionNeighborAssociation,
      totalAssociationPercentByInsertedGeneForSource: Map<string, number>
    ) =>
      row.operonInsertionCount >= Math.max(1, minimumCount || 1) &&
      (totalAssociationPercentByInsertedGeneForSource.get(row.insertedGene) ?? 0) >=
        Math.max(0, minimumTotalAssociationPercent || 0) &&
      row.occurrencePercent >= Math.max(0, Math.min(100, minimumOccurrencePercent || 0)) &&
      (maximumMeanDistance === "" ||
        row.meanDistanceBp <= Math.max(0, maximumMeanDistance));

    const groupRowsByInsertedGene = (rowsToGroup: InsertionNeighborAssociation[]) => {
      const grouped = new Map<string, InsertionNeighborAssociation[]>();
      for (const row of rowsToGroup) {
        const group = grouped.get(row.insertedGene) ?? [];
        group.push(row);
        grouped.set(row.insertedGene, group);
      }
      return grouped;
    };

    const keggRowsByInsertedGene = groupRowsByInsertedGene(
      bundle?.associations ?? []
    );
    const pfamRowsByInsertedGene = groupRowsByInsertedGene(
      pfamBundle?.associations ?? []
    );
    const overlapPairs =
      koPfamOverlap?.pairs ??
      Object.values(koPfamOverlap?.pfamByKo ?? {}).flat();
    const pairedKoIds = new Set(overlapPairs.map((pair) => pair.koId));
    const pairedPfamIds = new Set(
      overlapPairs.map((pair) => pair.pfamRepresentative)
    );
    const builtRows: CombinedAssociationRow[] = [];

    for (const pfamOverlap of overlapPairs) {
      const combinedOverlap = koPfamOverlap?.combinedByKo?.[pfamOverlap.koId];
      const koRowsByNeighbor = new Map<string, InsertionNeighborAssociation>();
      const pfamRowsByNeighbor = new Map<string, InsertionNeighborAssociation>();

      for (const row of keggRowsByInsertedGene.get(pfamOverlap.koId) ?? []) {
        koRowsByNeighbor.set([row.neighborGene, row.direction].join("\t"), row);
      }
      for (const row of pfamRowsByInsertedGene.get(pfamOverlap.pfamRepresentative) ?? []) {
        pfamRowsByNeighbor.set([row.neighborGene, row.direction].join("\t"), row);
      }

      const neighborKeys = new Set([
        ...koRowsByNeighbor.keys(),
        ...pfamRowsByNeighbor.keys()
      ]);

      for (const neighborKey of neighborKeys) {
        const [neighborGene, rowDirection] = neighborKey.split("\t") as [
          string,
          InsertionNeighborDirection
        ];
        const koRow = koRowsByNeighbor.get(neighborKey) ?? null;
        const pfamRow = pfamRowsByNeighbor.get(neighborKey) ?? null;
        if (!koRow && pfamRow) continue;

        const passesFilter = koRow
          ? rowPassesFilters(koRow, keggTotalAssociationPercentByInsertedGene)
          : pfamRow
            ? rowPassesFilters(pfamRow, pfamTotalAssociationPercentByInsertedGene)
            : false;
        if (!passesFilter) continue;

        builtRows.push({
          koRow,
          pfamRow,
          koId: pfamOverlap.koId,
          pfamRepresentative: pfamOverlap.pfamRepresentative,
          pfamRepresentatives: [pfamOverlap.pfamRepresentative],
          pfamMembers: pfamOverlap.pfamMembers ?? [pfamOverlap.pfamRepresentative],
          neighborGene,
          direction: rowDirection,
          keggCoverage:
            combinedOverlap?.coverageKoByPfam ?? pfamOverlap.coverageKoByPfam,
          pfamCoverage:
            combinedOverlap?.coveragePfamByKo ?? pfamOverlap.coveragePfamByKo
        });
      }
    }

    for (const [koId, koRows] of keggRowsByInsertedGene) {
      if (pairedKoIds.has(koId)) continue;
      for (const koRow of koRows) {
        if (!rowPassesFilters(koRow, keggTotalAssociationPercentByInsertedGene)) {
          continue;
        }
        builtRows.push({
          koRow,
          pfamRow: null,
          koId,
          pfamRepresentative: null,
          pfamRepresentatives: [],
          pfamMembers: [],
          neighborGene: koRow.neighborGene,
          direction: koRow.direction,
          keggCoverage: null,
          pfamCoverage: null
        });
      }
    }

    for (const [pfamRepresentative, pfamRows] of pfamRowsByInsertedGene) {
      if (pairedPfamIds.has(pfamRepresentative)) continue;
      for (const pfamRow of pfamRows) {
        if (!rowPassesFilters(pfamRow, pfamTotalAssociationPercentByInsertedGene)) {
          continue;
        }
        const pfamMembers =
          pfamOverlapGroups[pfamRepresentative]?.members ?? [pfamRepresentative];
        builtRows.push({
          koRow: null,
          pfamRow,
          koId: null,
          pfamRepresentative,
          pfamRepresentatives: [pfamRepresentative],
          pfamMembers,
          neighborGene: pfamRow.neighborGene,
          direction: pfamRow.direction,
          keggCoverage: null,
          pfamCoverage: null
        });
      }
    }

    const mergedRows = new Map<string, CombinedAssociationRow>();
    const appendUnique = <T,>(target: T[], values: T[]) => {
      for (const value of values) {
        if (!target.includes(value)) target.push(value);
      }
    };
    for (const row of builtRows) {
      if (!row.koId || row.pfamRepresentatives.length === 0) {
        const standaloneKey = [
          row.koId ?? "",
          row.pfamRepresentative ?? "",
          row.neighborGene,
          row.direction
        ].join("\t");
        mergedRows.set(standaloneKey, row);
        continue;
      }

      const key = [row.koId, row.neighborGene, row.direction].join("\t");
      const existing = mergedRows.get(key);
      if (!existing) {
        mergedRows.set(key, { ...row });
        continue;
      }

      appendUnique(existing.pfamRepresentatives, row.pfamRepresentatives);
      appendUnique(existing.pfamMembers, row.pfamMembers);
      existing.keggCoverage ??= row.keggCoverage;
      existing.pfamCoverage ??= row.pfamCoverage;
      if (
        row.pfamRow &&
        (!existing.pfamRow || row.pfamRow.count > existing.pfamRow.count)
      ) {
        existing.pfamRow = row.pfamRow;
        existing.pfamRepresentative = row.pfamRepresentative;
      }
    }

    const combinedRowOperonCount = (row: CombinedAssociationRow) =>
      Math.max(
        row.koRow?.operonInsertionCount ?? 0,
        row.pfamRow?.operonInsertionCount ?? 0
      );

    const combinedRowPrimaryValue = (row: CombinedAssociationRow) =>
      sortKey === "count"
        ? combinedRowOperonCount(row)
        : Math.max(row.koRow?.[sortKey] ?? 0, row.pfamRow?.[sortKey] ?? 0);

    const compareCombinedRows = (
      a: CombinedAssociationRow,
      b: CombinedAssociationRow
    ) => {
      const primaryA = combinedRowPrimaryValue(a);
      const primaryB = combinedRowPrimaryValue(b);
      return (
        primaryB - primaryA ||
        combinedRowOperonCount(b) - combinedRowOperonCount(a) ||
        Math.max(b.koRow?.count ?? 0, b.pfamRow?.count ?? 0) -
          Math.max(a.koRow?.count ?? 0, a.pfamRow?.count ?? 0) ||
        (a.koId ?? "").localeCompare(b.koId ?? "") ||
        a.pfamRepresentatives.join(",").localeCompare(b.pfamRepresentatives.join(",")) ||
        a.neighborGene.localeCompare(b.neighborGene)
      );
    };

    const filteredRows = [...mergedRows.values()]
      .filter((row) => {
        if (!normalizedQuery) return true;
        const keggLabel = row.koId ? keggNames[row.koId.toUpperCase()] ?? "" : "";
        const pfamText = pfamSearchText(
          uniqueNonEmpty([
            row.pfamRepresentative,
            ...row.pfamRepresentatives,
            ...row.pfamMembers
          ]),
          pfamEntries
        );
        return (
          (row.koId?.toLowerCase().includes(normalizedQuery) ?? false) ||
          keggLabel.toLowerCase().includes(normalizedQuery) ||
          row.neighborGene.toLowerCase().includes(normalizedQuery) ||
          (row.pfamRepresentative?.toLowerCase().includes(normalizedQuery) ?? false) ||
          row.pfamRepresentatives.some((representative) =>
            representative.toLowerCase().includes(normalizedQuery)
          ) ||
          row.pfamMembers.some((member) =>
            member.toLowerCase().includes(normalizedQuery)
          ) ||
          pfamText.includes(normalizedQuery)
        );
      });

    const grouped = new Map<string, CombinedAssociationRow[]>();
    for (const row of filteredRows) {
      const groupKey =
        row.koId && row.pfamRepresentatives.length > 0
          ? row.koId
          : [row.koId ?? "", row.pfamRepresentative ?? ""].join("\t");
      const group = grouped.get(groupKey) ?? [];
      group.push(row);
      grouped.set(groupKey, group);
    }
    return [...grouped.values()]
      .map((group) => group.sort(compareCombinedRows))
      .sort((a, b) => {
        const maxCountA = Math.max(...a.map(combinedRowOperonCount));
        const maxCountB = Math.max(...b.map(combinedRowOperonCount));
        return maxCountB - maxCountA || compareCombinedRows(a[0]!, b[0]!);
      })
      .flat();
  }, [
    bundle,
    keggNames,
    keggTotalAssociationPercentByInsertedGene,
    koPfamOverlap,
    maximumMeanDistance,
    minimumCount,
    minimumOccurrencePercent,
    minimumTotalAssociationPercent,
    pfamBundle,
    pfamEntries,
    pfamOverlapGroups,
    pfamTotalAssociationPercentByInsertedGene,
    query,
    sortKey
  ]);

  const visibleInsertionPhyleticAssociations = useMemo((): InsertionPhyleticAssociation[] => {
    if (annotationTable === "combined") {
      return combinedRows
        .map((row) => {
          const insertedFeature = row.koId ?? row.pfamRepresentative ?? row.pfamRepresentatives[0] ?? null;
          if (!insertedFeature) return null;
          const sourceType: "kegg" | "pfam" = row.koId ? "kegg" : "pfam";
          const metricRow = sourceType === "kegg" ? row.koRow : row.pfamRow;
          const source = row.direction === "upstream" ? insertedFeature : row.neighborGene;
          const target = row.direction === "upstream" ? row.neighborGene : insertedFeature;
          return {
            source,
            sourceType,
            target,
            count: metricRow?.count ?? 0,
            occurrencePercent: metricRow?.occurrencePercent ?? 0,
            meanDistanceBp: metricRow?.meanDistanceBp ?? 0
          };
        })
        .filter((row): row is InsertionPhyleticAssociation => row != null);
    }

    const sourceType: "kegg" | "pfam" = annotationTable === "kegg" ? "kegg" : "pfam";
    return rows.map((row) => ({
      source: row.direction === "upstream" ? row.insertedGene : row.neighborGene,
      sourceType,
      target: row.direction === "upstream" ? row.neighborGene : row.insertedGene,
      count: row.count,
      occurrencePercent: row.occurrencePercent,
      meanDistanceBp: row.meanDistanceBp
    }));
  }, [annotationTable, combinedRows, rows]);

  const openPhyleticDistributionForVisibleRows = useCallback(() => {
    if (visibleInsertionPhyleticAssociations.length === 0) {
      return;
    }

    const columns: string[] = [];
    const displayNames: Record<string, string> = {};
    const seenColumns = new Set<string>();
    const columnMetrics: Array<{
      column: string;
      source: string;
      target: string;
      role: "backbone" | "alternative";
      direction?: InsertionNeighborDirection;
      sourceType: "kegg" | "pfam";
      count: number;
      occurrencePercent: number;
      meanDistanceBp: number;
      cladeAveragePercent: number;
      genePresentAveragePercent: number;
    }> = [];

    for (const association of visibleInsertionPhyleticAssociations) {
      const column = insertionPhyleticColumnName(
        association.source,
        association.target
      );
      if (seenColumns.has(column)) {
        continue;
      }
      seenColumns.add(column);
      columns.push(column);
      displayNames[column] = insertionPhyleticDisplayName(
        association.source,
        association.target
      );
      columnMetrics.push({
        column,
        source: association.source,
        target: association.target,
        role: "backbone",
        sourceType: association.sourceType,
        count: association.count,
        occurrencePercent: association.occurrencePercent,
        meanDistanceBp: association.meanDistanceBp,
        cladeAveragePercent: association.occurrencePercent,
        genePresentAveragePercent: association.occurrencePercent
      });
    }

    const transferId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const labelParts = [
      annotationTable === "combined"
        ? "Visible KO/Pfam insertion associations"
        : annotationTable === "kegg"
          ? "Visible KEGG insertion associations"
          : "Visible Pfam insertion associations",
      `${columns.length} directed associations`,
      `min ${minimumOccurrencePercent}% insertion occurrence`,
      maximumMeanDistance === "" ? "no mean-gap ceiling" : `mean gap <= ${maximumMeanDistance} bp`
    ];

    window.localStorage.setItem(
      `${OPERON_PHYLETIC_TRANSFER_PREFIX}${transferId}`,
      JSON.stringify({
        version: 1,
        label: labelParts.join(" - "),
        sourceUrl: INSERTION_PHYLETIC_SPARSE_URL,
        sourceFormat: "sparse-association-v1",
        customDataKind: "insertion",
        columns,
        backboneColumns: columns,
        alternativeColumns: [],
        displayNames,
        columnMetrics
      })
    );

    const targetUrl = withBasePath(
      `/phyletic-distribution-visualization?operonTransfer=${encodeURIComponent(transferId)}`
    );
    const link = document.createElement("a");
    link.href = targetUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [
    annotationTable,
    maximumMeanDistance,
    minimumOccurrencePercent,
    visibleInsertionPhyleticAssociations
  ]);

  const visibleInsertedGeneCount = useMemo(
    () => new Set(rows.map((row) => row.insertedGene)).size,
    [rows]
  );

  const visibleCombinedKoCount = useMemo(
    () => new Set(combinedRows.map((row) => row.koId).filter(Boolean)).size,
    [combinedRows]
  );

  const visibleCombinedPfamCount = useMemo(
    () =>
      new Set(combinedRows.flatMap((row) => row.pfamRepresentatives)).size,
    [combinedRows]
  );

  const combinedRowGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string;
        rows: CombinedAssociationRow[];
      }
    >();

    for (const row of combinedRows) {
      const key =
        row.koId && row.pfamRepresentatives.length > 0
          ? row.koId
          : [row.koId ?? "", row.pfamRepresentative ?? ""].join("\t");
      const group = groups.get(key) ?? { key, rows: [] };
      group.rows.push(row);
      groups.set(key, group);
    }

    return [...groups.values()];
  }, [combinedRows]);

  const insertedGeneRowCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.insertedGene, (counts.get(row.insertedGene) ?? 0) + 1);
    }
    return counts;
  }, [rows]);

  const insertedGeneGroupIndexes = useMemo(() => {
    const indexes: number[] = [];
    let currentGroupIndex = -1;
    let previousInsertedGene: string | null = null;
    for (const row of rows) {
      if (row.insertedGene !== previousInsertedGene) {
        currentGroupIndex += 1;
        previousInsertedGene = row.insertedGene;
      }
      indexes.push(currentGroupIndex);
    }
    return indexes;
  }, [rows]);

  if (loadError) {
    return (
      <section className="rounded-lg border border-[var(--input-border)] bg-[var(--surface)] p-5">
        <h2 className="m-0 text-xl font-semibold text-[var(--text)]">No generated bundle found</h2>
        <p className="mt-2 text-sm text-[var(--text-soft)]">
          Could not load <code>{KEGG_DATA_URL}</code> ({loadError}). Generate it with:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-md bg-[var(--surface-muted)] p-3 text-xs text-[var(--text)]">
          node scripts/operon-insertions/build-insertion-neighbor-associations.mjs
          {" --reference <flagellar.tsv> --insertions <insertions.tsv> --max-distance 500"}
        </pre>
      </section>
    );
  }

  if (!bundle) {
    return <p className="text-sm text-[var(--text-soft)]">Loading insertion associations…</p>;
  }

  const displayBundle = activeBundle ?? bundle;
  const identifierLabel =
    annotationTable === "combined"
      ? "KO / Pfam"
      : annotationTable === "kegg"
        ? "KO ID"
        : "Pfam ID";
  const selectedTableReady =
    annotationTable === "kegg" ||
    (annotationTable === "pfam" && Boolean(pfamBundle)) ||
    (annotationTable === "combined" && Boolean(pfamBundle && koPfamOverlap));

  return (
    <div className="space-y-5">
      <div
        className="inline-flex h-10 shrink-0 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] p-0.5"
        role="group"
        aria-label="Insertion annotation table"
      >
        {([
          ["combined", "Combined"],
          ["kegg", "KEGG Orthology"],
          ["pfam", "Pfam"]
        ] as const).map(([table, label]) => (
          <button
            key={table}
            type="button"
            onClick={() => {
              setAnnotationTable(table);
              setAnnotationTooltip(null);
              setHoveredAnnotationGroupKey(null);
              if (
                table === "combined" &&
                (sortKey === "medianDistanceBp" || sortKey === "standardDeviationBp")
              ) {
                setSortKey("count");
              }
              setMaximumMeanDistance(100);
            }}
            className={cn(
              "whitespace-nowrap rounded px-4 text-sm font-semibold transition-colors hover:bg-[var(--dropdown-hover)]",
              annotationTable === table
                ? "bg-[var(--nav-hover-bg)] text-[var(--text)] shadow-xs"
                : "text-[var(--text-soft)] hover:text-[var(--text)]"
            )}
            aria-pressed={annotationTable === table}
          >
            {label}
          </button>
        ))}
      </div>

      {!selectedTableReady ? (
        <section className="rounded-lg border border-[var(--input-border)] bg-[var(--surface)] p-8 text-center">
          <h2 className="m-0 text-lg font-semibold text-[var(--text)]">
            {annotationTable === "combined"
              ? "Combined data are ready to be connected"
              : "Pfam data are ready to be connected"}
          </h2>
          <p className="m-0 mt-2 text-sm text-[var(--text-soft)]">
            {annotationTable === "combined" ? (
              <>
                Generate <code>{KO_PFAM_OVERLAP_URL}</code> after the KO and Pfam bundles are
                available.
              </>
            ) : (
              <>
                Generate <code>{PFAM_DATA_URL}</code> from the Pfam coordinate TSV to populate this
                table.
              </>
            )}
          </p>
        </section>
      ) : (
      <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Insertion rows", displayBundle.inputs.insertionRows],
          ["Insertions with neighbors", displayBundle.summary.insertionsWithNeighbors],
          ["Association occurrences", displayBundle.summary.associationOccurrences],
          ["Summarized associations", displayBundle.summary.associationRows]
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded-lg border border-[var(--input-border)] bg-[var(--surface)] p-4"
          >
            <p className="m-0 text-xs font-semibold uppercase tracking-wide text-[var(--text-soft)]">
              {label}
            </p>
            <p className="m-0 mt-1 text-2xl font-semibold tabular-nums text-[var(--text)]">
              {Number(value).toLocaleString()}
            </p>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-[var(--input-border)] bg-[var(--surface)] p-4">
        <div className="grid items-end gap-4 md:grid-cols-2 xl:grid-cols-7">
          <label className="flex flex-col justify-end xl:col-span-2">
            <span className="mb-1 block text-xs font-semibold text-[var(--text-soft)]">
              {identifierLabel}, short name, or neighbor
            </span>
            <input
              className="w-full rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text)]"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter IDs, short names, or neighbors..."
            />
          </label>
          <label className="flex flex-col justify-end">
            <span className="mb-1 block text-xs font-semibold text-[var(--text-soft)]">
              Minimum insertions within {displayBundle.options.maxDistanceBp.toLocaleString()} bp
            </span>
            <input
              className="w-full rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text)]"
              type="number"
              min={1}
              step={1}
              value={minimumCount}
              onChange={(event) => setMinimumCount(Number(event.target.value))}
            />
          </label>
          <label className="flex flex-col justify-end">
            <span className="mb-1 block text-xs font-semibold text-[var(--text-soft)]">
              Minimum total association (%)
            </span>
            <input
              className="w-full rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text)]"
              type="number"
              min={0}
              max={200}
              step={0.1}
              value={minimumTotalAssociationPercent}
              onChange={(event) =>
                setMinimumTotalAssociationPercent(Number(event.target.value))
              }
            />
          </label>
          <label className="flex flex-col justify-end">
            <span className="mb-1 block text-xs font-semibold text-[var(--text-soft)]">
              Minimum association (%)
            </span>
            <input
              className="w-full rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text)]"
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={minimumOccurrencePercent}
              onChange={(event) => setMinimumOccurrencePercent(Number(event.target.value))}
            />
          </label>
          <label className="flex flex-col justify-end">
            <span className="mb-1 block text-xs font-semibold text-[var(--text-soft)]">
              Maximum mean gap (bp)
            </span>
            <input
              className="w-full rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text)]"
              type="number"
              min={0}
              step={1}
              value={maximumMeanDistance}
              placeholder={String(displayBundle.options.maxDistanceBp)}
              onChange={(event) =>
                setMaximumMeanDistance(
                  event.target.value === "" ? "" : Number(event.target.value)
                )
              }
            />
          </label>
          <label className="flex flex-col justify-end">
            <span className="mb-1 block text-xs font-semibold text-[var(--text-soft)]">
              Sort by
            </span>
            <select
              className="w-full rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text)]"
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value as SortKey)}
            >
              <option value="count">Count</option>
              <option value="occurrencePercent">Occurrence percent</option>
              <option value="meanDistanceBp">Mean distance</option>
              {annotationTable === "combined" ? null : (
                <>
                  <option value="medianDistanceBp">Median distance</option>
                  <option value="standardDeviationBp">Distance variation</option>
                </>
              )}
            </select>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="m-0 text-[var(--text-soft)]">
            {annotationTable === "combined" ? (
              <>
                {(koPfamOverlap?.summary?.matchedKeggGroups ?? 0).toLocaleString()} KO IDs have
                Pfam-group overlaps at either-side coverage &gt;={" "}
                {(koPfamOverlap?.threshold ?? 0.7).toFixed(2)}; showing{" "}
                {visibleCombinedKoCount.toLocaleString()} KO IDs,{" "}
                {visibleCombinedPfamCount.toLocaleString()} Pfam groups, and{" "}
                {combinedRows.length.toLocaleString()} neighbor rows after filters.
              </>
            ) : (
              <>
                {eligibleInsertedGenes.size.toLocaleString()} {identifierLabel}s pass the
                group-level thresholds; showing {visibleInsertedGeneCount.toLocaleString()}{" "}
                {identifierLabel}s and {rows.length.toLocaleString()} associations after row-level
                filters.
              </>
            )}{" "}
            Maximum neighbor gap: {displayBundle.options.maxDistanceBp.toLocaleString()} bp.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border border-[var(--input-border)] px-3 py-2 font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)]"
              onClick={() =>
                annotationTable === "combined"
                  ? downloadCombinedRows(combinedRows, keggNames, pfamEntries)
                  : downloadRows(
                      rows,
                      annotationTable,
                      keggNames,
                      pfamEntries,
                      pfamOverlapGroups
                    )
              }
            >
              Download filtered TSV
            </button>
            <button
              type="button"
              className="rounded-md border border-[var(--input-border)] px-3 py-2 font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)]"
              onClick={() =>
                annotationTable === "combined"
                  ? downloadCombinedRowsSvg(combinedRowGroups, keggNames, pfamEntries)
                  : downloadAssociationRowsSvg(
                      rows,
                      annotationTable,
                      keggNames,
                      pfamEntries,
                      pfamOverlapGroups
                    )
              }
            >
              Download filtered SVG
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--input-border)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="m-0 text-lg font-semibold text-[var(--text)]">
              Directed Association Rug Plots
            </h2>
            <p className="m-0 mt-1 max-w-4xl text-xs text-[var(--text-soft)]">
              Opens the current filtered table rows as phyletic distribution rugs. Combined rows use
              KEGG Orthology when present; rows without KEGG use the Pfam representative as the
              insertion reference. Direction is encoded in each rug label.
            </p>
          </div>
          <button
            type="button"
            onClick={openPhyleticDistributionForVisibleRows}
            disabled={visibleInsertionPhyleticAssociations.length === 0}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--text-soft)] transition-colors hover:border-[var(--primary)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Phyletic Distribution
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        <p className="m-0 mt-3 text-xs text-[var(--text-soft)] tabular-nums">
          {visibleInsertionPhyleticAssociations.length.toLocaleString()} visible rows map to{" "}
          {new Set(
            visibleInsertionPhyleticAssociations.map((association) =>
              insertionPhyleticColumnName(
                association.source,
                association.target
              )
            )
          ).size.toLocaleString()}{" "}
          directed rug columns. Data source: <code>{INSERTION_PHYLETIC_SPARSE_URL}</code>.
        </p>
      </section>

      {annotationTable === "combined" ? (
      <section className="mx-auto w-fit max-w-full overflow-hidden rounded-lg border border-[var(--input-border)] bg-[var(--surface)]">
        <div className="max-w-full overflow-x-auto">
          <table
            className="mx-auto border-collapse text-left text-xs leading-none"
            style={{
              tableLayout: "fixed",
              width: "1095px",
              minWidth: "1095px",
              fontFamily: "Arial, Helvetica, sans-serif"
            }}
          >
            <colgroup>
              <col style={{ width: "140px" }} />
              <col style={{ width: "210px" }} />
              <col style={{ width: "100px" }} />
              <col style={{ width: "105px" }} />
              <col style={{ width: "75px" }} />
              <col style={{ width: "105px" }} />
              <col style={{ width: "90px" }} />
              <col style={{ width: "75px" }} />
              <col style={{ width: "105px" }} />
              <col style={{ width: "90px" }} />
            </colgroup>
            <thead className="bg-[var(--header-bg-mid)] text-[11px] uppercase tracking-[0.03em] text-white">
              <tr>
                {["KO ID", "Pfam ID", "Neighbor", "Direction"].map((header) => (
                  <th
                    key={header}
                    rowSpan={2}
                    className="whitespace-normal border-b border-r border-white/20 px-2 py-0.5 text-center font-semibold leading-tight text-white last:border-r-0"
                  >
                    {header}
                  </th>
                ))}
                {[
                  ["KEGG Orthology", 3],
                  ["Pfam", 3]
                ].map(([header, span], index) => (
                  <th
                    key={`${header}-${index}`}
                    colSpan={Number(span)}
                    className="whitespace-normal border-b border-r border-white/20 px-2 py-0.5 text-center font-semibold leading-tight text-white last:border-r-0"
                  >
                    {header}
                  </th>
                ))}
              </tr>
              <tr>
                {[
                  "Count",
                  "% Insert",
                  "Mean gap",
                  "Count",
                  "% Insert",
                  "Mean gap"
                ].map((header, index) => (
                  <th
                    key={`${header}-${index}`}
                    className="whitespace-normal border-b border-r border-white/20 px-2 py-0.5 text-center font-semibold leading-tight text-white last:border-r-0"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {combinedRowGroups.flatMap((group, groupIndex) =>
                group.rows.map((row, rowIndex) => {
                  const keggLabel = row.koId
                    ? keggNames[row.koId.toUpperCase()]
                    : undefined;
                  const startsGroup = rowIndex === 0;
                  const groupPfamMembers = startsGroup
                    ? [...new Set(group.rows.flatMap((groupRow) => groupRow.pfamMembers))]
                    : [];
                  const groupPfamRepresentatives = startsGroup
                    ? [
                        ...new Set(
                          group.rows.flatMap((groupRow) => groupRow.pfamRepresentatives)
                        )
                      ]
                    : [];
                  const tooltipRow = startsGroup
                    ? {
                        ...row,
                        pfamRepresentative:
                          row.pfamRepresentative ?? groupPfamRepresentatives[0] ?? null,
                        pfamRepresentatives: groupPfamRepresentatives,
                        pfamMembers: groupPfamMembers
                      }
                    : row;
                  const combinedGroupBaseFillClass =
                    groupIndex % 2 === 0 ? "!bg-[var(--surface)]" : "!bg-[var(--surface-muted)]";
                  const combinedGroupFillClass =
                    hoveredAnnotationGroupKey === group.key
                      ? "!bg-[var(--dropdown-hover)]"
                      : combinedGroupBaseFillClass;
                  return (
                    <tr
                      key={`${group.key}\t${row.neighborGene}\t${row.direction}`}
                      className={cn(
                        "border-b border-[var(--input-border)] transition-colors last:border-b-0",
                        combinedGroupBaseFillClass,
                        startsGroup && groupIndex > 0
                          ? "border-t-2 border-t-[var(--text-soft)]"
                          : ""
                      )}
                      onMouseEnter={() => setHoveredAnnotationGroupKey(group.key)}
                      onMouseLeave={() => setHoveredAnnotationGroupKey(null)}
                    >
                      {startsGroup ? (
                        <>
                          <td
                            rowSpan={group.rows.length}
                            className={cn(
                              "px-2 py-0.5 align-top font-semibold leading-tight text-[var(--text)]",
                              combinedGroupFillClass
                            )}
                          >
                            {row.koId ? (
                              <a
                                href={annotationEntryUrl(row.koId, "kegg")!}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-block max-w-[136px] whitespace-normal break-words leading-tight text-[var(--link)] underline decoration-current/40 underline-offset-2 hover:decoration-current"
                                onMouseEnter={(event) =>
                                  showCombinedAnnotationTooltip(
                                    event.clientX,
                                    event.clientY,
                                    row,
                                    "kegg"
                                  )
                                }
                                onMouseMove={(event) =>
                                  showCombinedAnnotationTooltip(
                                    event.clientX,
                                    event.clientY,
                                    row,
                                    "kegg"
                                  )
                                }
                                onMouseLeave={() => setAnnotationTooltip(null)}
                                onFocus={(event) => {
                                  setHoveredAnnotationGroupKey(group.key);
                                  const bounds = event.currentTarget.getBoundingClientRect();
                                  showCombinedAnnotationTooltip(
                                    bounds.left,
                                    bounds.bottom,
                                    row,
                                    "kegg"
                                  );
                                }}
                                onBlur={() => {
                                  setAnnotationTooltip(null);
                                  setHoveredAnnotationGroupKey(null);
                                }}
                              >
                                {row.koId}
                                {keggShortName(keggLabel)
                                  ? ` / ${keggShortName(keggLabel)}`
                                  : ""}
                              </a>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td
                            rowSpan={group.rows.length}
                            className={cn(
                              "px-2 py-0.5 text-center align-top leading-tight",
                              combinedGroupFillClass
                            )}
                          >
                            {groupPfamMembers.length > 0 ? (
                              <div className="space-y-0.5 leading-tight">
                                {groupPfamMembers.map((member) => (
                                  <a
                                    key={member}
                                    href={annotationEntryUrl(member, "pfam")!}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block w-full whitespace-normal break-words text-center font-semibold leading-tight text-[var(--link)] underline decoration-current/40 underline-offset-2 hover:decoration-current"
                                    onMouseEnter={(event) =>
                                      showCombinedAnnotationTooltip(
                                        event.clientX,
                                        event.clientY,
                                        tooltipRow,
                                        "pfam",
                                        member
                                      )
                                    }
                                    onMouseMove={(event) =>
                                      showCombinedAnnotationTooltip(
                                        event.clientX,
                                        event.clientY,
                                        tooltipRow,
                                        "pfam",
                                        member
                                      )
                                    }
                                    onMouseLeave={() => setAnnotationTooltip(null)}
                                    onFocus={(event) => {
                                      setHoveredAnnotationGroupKey(group.key);
                                      const bounds =
                                        event.currentTarget.getBoundingClientRect();
                                      showCombinedAnnotationTooltip(
                                        bounds.left,
                                        bounds.bottom,
                                        tooltipRow,
                                        "pfam",
                                        member
                                      );
                                    }}
                                    onBlur={() => {
                                      setAnnotationTooltip(null);
                                      setHoveredAnnotationGroupKey(null);
                                    }}
                                  >
                                    {member}
                                    {pfamEntries[member]?.shortName
                                      ? ` / ${pfamEntries[member].shortName}`
                                      : ""}
                                  </a>
                                ))}
                              </div>
                            ) : (
                              <span className="font-semibold text-[var(--text)]">-</span>
                            )}
                          </td>
                        </>
                      ) : null}
                      <td
                        className={cn(
                          "break-words px-2 py-0.5 text-center align-top font-semibold leading-tight text-[var(--text)]",
                          combinedGroupFillClass
                        )}
                      >
                        {row.neighborGene}
                      </td>
                      <td
                        className={cn(
                          "whitespace-nowrap px-2 py-0.5 text-center align-top capitalize leading-tight text-[var(--text-soft)]",
                          combinedGroupFillClass
                        )}
                      >
                        {row.direction}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-0.5 text-center align-top tabular-nums leading-tight text-[var(--text)]",
                          combinedGroupFillClass
                        )}
                      >
                        {row.koRow ? row.koRow.count.toLocaleString() : "-"}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-0.5 text-center align-top tabular-nums leading-tight text-[var(--text)]",
                          combinedGroupFillClass
                        )}
                      >
                        {row.koRow ? `${formatNumber(row.koRow.occurrencePercent)}%` : "-"}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-0.5 text-center align-top tabular-nums leading-tight text-[var(--text)]",
                          combinedGroupFillClass
                        )}
                      >
                        {row.koRow ? `${formatNumber(row.koRow.meanDistanceBp)} bp` : "-"}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-0.5 text-center align-top tabular-nums leading-tight text-[var(--text)]",
                          combinedGroupFillClass
                        )}
                      >
                        {row.pfamRow ? row.pfamRow.count.toLocaleString() : "-"}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-0.5 text-center align-top tabular-nums leading-tight text-[var(--text)]",
                          combinedGroupFillClass
                        )}
                      >
                        {row.pfamRow
                          ? `${formatNumber(row.pfamRow.occurrencePercent)}%`
                          : "-"}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-0.5 text-center align-top tabular-nums leading-tight text-[var(--text)]",
                          combinedGroupFillClass
                        )}
                      >
                        {row.pfamRow ? `${formatNumber(row.pfamRow.meanDistanceBp)} bp` : "-"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {combinedRows.length === 0 ? (
          <p className="m-0 p-6 text-center text-sm text-[var(--text-soft)]">
            No KO/Pfam rows match the current filters.
          </p>
        ) : null}
      </section>
      ) : (
      <section className="mx-auto w-fit max-w-full overflow-hidden rounded-lg border border-[var(--input-border)] bg-[var(--surface)]">
        <div className="max-w-full overflow-x-auto">
          <table
            className="mx-auto border-collapse text-left text-sm"
            style={{
              tableLayout: "fixed",
              width: "820px",
              minWidth: "820px",
              fontFamily: "Arial, Helvetica, sans-serif"
            }}
          >
            <colgroup>
              <col style={{ width: "170px" }} />
              <col style={{ width: "85px" }} />
              <col style={{ width: "70px" }} />
              <col style={{ width: "60px" }} />
              <col style={{ width: "80px" }} />
              <col style={{ width: "75px" }} />
              <col style={{ width: "75px" }} />
              <col style={{ width: "75px" }} />
              <col style={{ width: "130px" }} />
            </colgroup>
            <thead className="bg-[var(--header-bg-mid)] text-[13px] uppercase tracking-[0.04em] text-white">
              <tr>
                {[
                  identifierLabel,
                  "Neighbor",
                  "Direction",
                  "Count",
                  "% Insert",
                  "Mean gap",
                  "SD",
                  "Median gap",
                  "IQR (Q1–Q3)"
                ].map((header) => (
                  <th
                    key={header}
                    className="whitespace-normal border-b border-r border-white/20 px-1 py-1 text-center font-semibold leading-tight text-white last:border-r-0"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => {
                const startsInsertedGeneGroup =
                  rowIndex === 0 || rows[rowIndex - 1].insertedGene !== row.insertedGene;
                const insertedGeneGroupIndex =
                  insertedGeneGroupIndexes[rowIndex] ?? rowIndex;
                const insertedGeneGroupFillClass =
                  hoveredAnnotationGroupKey === row.insertedGene
                    ? "bg-[var(--dropdown-hover)]"
                    : insertedGeneGroupIndex % 2 === 0
                      ? "bg-[var(--surface)]"
                      : "bg-[var(--surface-muted)]";
                return (
                <tr
                  key={`${row.insertedGene}\t${row.neighborGene}\t${row.direction}`}
                  className={cn(
                    "border-b border-[var(--input-border)] transition-colors last:border-b-0",
                    insertedGeneGroupFillClass,
                    startsInsertedGeneGroup && rowIndex > 0
                      ? "border-t-2 border-t-[var(--text-soft)]"
                      : ""
                  )}
                  onMouseEnter={() => setHoveredAnnotationGroupKey(row.insertedGene)}
                  onMouseLeave={() => setHoveredAnnotationGroupKey(null)}
                >
                  {startsInsertedGeneGroup ? (
                  <td
                    rowSpan={insertedGeneRowCounts.get(row.insertedGene) ?? 1}
                    className={cn(
                      "w-[200px] max-w-[200px] whitespace-normal border-r-2 border-r-[var(--input-border)] px-1 py-1 align-top font-semibold leading-snug text-[var(--text)]",
                      insertedGeneGroupFillClass
                    )}
                  >
                    {annotationTable === "pfam" ? (
                      <div className="space-y-1">
                        {(
                          pfamOverlapGroups[normalizePfamId(row.insertedGene) ?? ""]?.members ?? [
                            row.insertedGene
                          ]
                        ).map((member) => (
                          <a
                            key={member}
                            href={annotationEntryUrl(member, "pfam")!}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block max-w-[180px] whitespace-normal break-words text-[var(--link)] underline decoration-current/40 underline-offset-2 hover:decoration-current"
                            onMouseEnter={(event) =>
                              showAnnotationTooltip(event.clientX, event.clientY, row, member)
                            }
                            onMouseMove={(event) =>
                              showAnnotationTooltip(event.clientX, event.clientY, row, member)
                            }
                            onMouseLeave={() => setAnnotationTooltip(null)}
                            onFocus={(event) => {
                              setHoveredAnnotationGroupKey(row.insertedGene);
                              const bounds = event.currentTarget.getBoundingClientRect();
                              showAnnotationTooltip(bounds.left, bounds.bottom, row, member);
                            }}
                            onBlur={() => {
                              setAnnotationTooltip(null);
                              setHoveredAnnotationGroupKey(null);
                            }}
                          >
                            {member}
                            {pfamEntries[member]?.shortName
                              ? ` / ${pfamEntries[member].shortName}`
                              : ""}
                          </a>
                        ))}
                      </div>
                    ) : annotationEntryUrl(row.insertedGene, annotationTable) ? (
                      <a
                        href={annotationEntryUrl(row.insertedGene, annotationTable)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block max-w-[180px] whitespace-normal break-words text-[var(--link)] underline decoration-current/40 underline-offset-2 hover:decoration-current"
                        onMouseEnter={(event) =>
                          showAnnotationTooltip(event.clientX, event.clientY, row)
                        }
                        onMouseMove={(event) =>
                          showAnnotationTooltip(event.clientX, event.clientY, row)
                        }
                        onMouseLeave={() => setAnnotationTooltip(null)}
                        onFocus={(event) => {
                          setHoveredAnnotationGroupKey(row.insertedGene);
                          const bounds = event.currentTarget.getBoundingClientRect();
                          showAnnotationTooltip(bounds.left, bounds.bottom, row);
                        }}
                        onBlur={() => {
                          setAnnotationTooltip(null);
                          setHoveredAnnotationGroupKey(null);
                        }}
                      >
                        {row.insertedGene}
                        {keggShortName(keggNames[row.insertedGene.toUpperCase()])
                          ? ` / ${keggShortName(keggNames[row.insertedGene.toUpperCase()])}`
                          : ""}
                      </a>
                    ) : (
                      row.insertedGene
                    )}
                  </td>
                  ) : null}
                  <td className="px-1 py-1 font-semibold text-[var(--text)]">
                    {row.neighborGene}
                  </td>
                  <td className="px-1 py-1 capitalize text-[var(--text-soft)]">
                    {row.direction}
                  </td>
                  <td className="px-1 py-1 tabular-nums text-[var(--text)]">
                    {row.count.toLocaleString()}
                  </td>
                  <td className="px-1 py-1 tabular-nums text-[var(--text)]">
                    {formatNumber(row.occurrencePercent)}%
                  </td>
                  <td className="px-1 py-1 tabular-nums text-[var(--text)]">
                    {formatNumber(row.meanDistanceBp)} bp
                  </td>
                  <td className="px-1 py-1 tabular-nums text-[var(--text)]">
                    {formatNumber(row.standardDeviationBp)} bp
                  </td>
                  <td className="px-1 py-1 tabular-nums text-[var(--text)]">
                    {formatNumber(row.medianDistanceBp)} bp
                  </td>
                  <td className="px-1 py-1 tabular-nums text-[var(--text-soft)]">
                    {formatNumber(row.lowerQuartileBp)}–{formatNumber(row.upperQuartileBp)} bp
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 ? (
          <p className="m-0 p-6 text-center text-sm text-[var(--text-soft)]">
            No associations match the current filters.
          </p>
        ) : null}
      </section>
      )}

      {annotationTable === "pfam" ? (
        <PfamOverlapHeatmap
          pairs={pfamOverlapPairs}
          entries={pfamEntries}
          initialThreshold={pfamMergeThreshold}
        />
      ) : null}

      <section className="rounded-lg border border-[var(--input-border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-soft)]">
        <p className="m-0">
          <strong className="text-[var(--text)]">Method:</strong> nearest reference feature on each
          genomic side and the same strand, grouped by inserted gene, neighbor, and insertion
          direction relative to the reference gene.{" "}
          {displayBundle.options.directionDefinition
            ? `${displayBundle.options.directionDefinition}. `
            : ""}
          {displayBundle.options.distanceDefinition}.{" "}
          {annotationTable === "combined"
            ? `Combined rows align KO associations with merged Pfam groups whose KO-by-Pfam or Pfam-by-KO coverage is at least ${(
                koPfamOverlap?.threshold ?? 0.7
              ).toFixed(2)}. Pfam metrics are shown when the same Pfam group has an association to the same neighbor and direction.`
            : "Median is shown alongside mean and standard deviation because it is less sensitive to unusually large gaps."}
        </p>
        <p className="m-0 mt-2">
          Inputs: <code>{displayBundle.inputs.referenceFile}</code> and{" "}
          <code>{displayBundle.inputs.insertionFile}</code>. Generated{" "}
          {new Date(displayBundle.generatedAt).toLocaleString()}.
        </p>
      </section>
      {annotationTooltip
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[100] w-[360px] max-w-[calc(100vw-24px)] overflow-y-auto overflow-x-hidden rounded-lg border border-[var(--input-border)] bg-[var(--dropdown-bg)] shadow-2xl"
              style={{
                left: annotationTooltip.x,
                top: annotationTooltip.y,
                maxHeight: "min(360px, calc(100vh - 24px))"
              }}
              role="tooltip"
            >
              <div className="bg-[var(--header-bg-mid)] px-4 py-3 text-white">
                <p className="m-0 text-sm font-bold tracking-wide">
                  {annotationTooltip.accession}
                  {annotationTooltip.shortName ? ` / ${annotationTooltip.shortName}` : ""}
                </p>
                <p className="m-0 mt-1 text-xs text-white">
                  {annotationTooltip.sourceLabel}
                </p>
              </div>
              <div className="space-y-3 px-4 py-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md bg-[color-mix(in_srgb,var(--dropdown-bg)_88%,var(--header-bg-mid)_12%)] px-3 py-2">
                    <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-soft)]">
                      Total occurrences
                    </p>
                    <p className="m-0 mt-0.5 text-lg font-bold tabular-nums text-[var(--text)]">
                      {annotationTooltip.totalCount.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-md bg-[color-mix(in_srgb,var(--dropdown-bg)_88%,var(--header-bg-mid)_12%)] px-3 py-2">
                    <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-soft)]">
                      In operons (≤{annotationTooltip.maxDistanceBp.toLocaleString()} bp)
                    </p>
                    <p className="m-0 mt-0.5 text-lg font-bold tabular-nums text-[var(--text)]">
                      {annotationTooltip.operonCount.toLocaleString()}
                    </p>
                  </div>
                  <div className="col-span-2 rounded-md bg-[color-mix(in_srgb,var(--dropdown-bg)_88%,var(--header-bg-mid)_12%)] px-3 py-2">
                    <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-soft)]">
                      Total association
                    </p>
                    <p className="m-0 mt-0.5 text-lg font-bold tabular-nums text-[var(--text)]">
                      {formatNumber(annotationTooltip.totalAssociationPercent)}%
                    </p>
                  </div>
                </div>
                <div>
                  <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-soft)]">
                    Description
                  </p>
                  <p className="m-0 mt-1 whitespace-normal text-sm leading-relaxed text-[var(--text)]">
                    {annotationTooltip.description}
                  </p>
                </div>
                {annotationTooltip.mergedMembers.length > 0 ? (
                  <div>
                    <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-soft)]">
                      Merged correlated models
                    </p>
                    <p className="m-0 mt-1 whitespace-normal text-sm leading-relaxed text-[var(--text)]">
                      {annotationTooltip.mergedMembers.join(", ")}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>,
            document.body
          )
        : null}
      </>
      )}
    </div>
  );
}
