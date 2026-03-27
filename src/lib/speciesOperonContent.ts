import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { formatSpeciesName, normalizeSpeciesQuery } from "@/lib/speciesNaming";

type GtdbLineageRow = {
  assembly: string;
  species: string;
};

export type OperonGeneItem = {
  kind: "gene";
  id: string;
  geneName: string;
  geneId: string;
  assembly: string;
  contig: string;
  start: number;
  stop: number;
  strand: 1 | -1;
};

export type OperonGapItem = {
  kind: "gap";
  id: string;
  leftBp: number;
  rightBp: number;
};

export type OperonTrack = {
  id: string;
  assembly: string;
  contig: string;
  spanStart: number;
  spanEnd: number;
  lineSegments: Array<{
    id: string;
    start: number;
    stop: number;
  }>;
  items: Array<OperonGeneItem | OperonGapItem>;
};

export type SpeciesOperonContent = {
  matchedAssemblies: number;
  assemblyCount: number;
  contigCount: number;
  geneCount: number;
  missingAssemblies: string[];
  tracks: OperonTrack[];
};

type CoordRow = {
  geneName: string;
  geneId: string;
  contig: string;
  start: number;
  stop: number;
  strand: 1 | -1;
  assembly: string;
};

const LINEAGE_PATH = path.join(process.cwd(), "public", "GTDB214_lineage_ordered.json");
const COORD_DIR = path.join(process.cwd(), "public", "operon_coords");
const SMALL_GAP_THRESHOLD_BP = 1000;
const TRACK_FLANK_BP = 500;

let cachedLineageRows: GtdbLineageRow[] | null = null;

function normalizeSpeciesName(value: string): string {
  return normalizeSpeciesQuery(formatSpeciesName(value));
}

async function loadLineageRows(): Promise<GtdbLineageRow[]> {
  if (cachedLineageRows) return cachedLineageRows;
  if (!existsSync(LINEAGE_PATH)) {
    cachedLineageRows = [];
    return cachedLineageRows;
  }

  const raw = await readFile(LINEAGE_PATH, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    cachedLineageRows = [];
    return cachedLineageRows;
  }

  const rows = parsed
    .filter((item): item is GtdbLineageRow => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Partial<GtdbLineageRow>;
      return typeof candidate.assembly === "string" && typeof candidate.species === "string";
    })
    .map((item) => ({
      assembly: item.assembly.trim(),
      species: item.species.trim()
    }))
    .filter((item) => item.assembly && item.species);

  cachedLineageRows = rows;
  return cachedLineageRows;
}

function getValue(parts: string[], idx: number): string {
  if (idx < 0 || idx >= parts.length) return "";
  return parts[idx]?.trim() ?? "";
}

function parseCoordFile(tsv: string): CoordRow[] {
  const lines = tsv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) return [];

  const headers = lines[0].split("\t").map((value) => value.trim().toLowerCase());
  const idxGeneName = headers.indexOf("gene_name");
  const idxGeneId = headers.indexOf("gene_id");
  const idxContig = headers.indexOf("genome_id");
  const idxStart = headers.indexOf("start");
  const idxStop = headers.indexOf("stop");
  const idxStrand = headers.indexOf("strand");
  const idxAssembly = headers.indexOf("assembly");

  if (
    idxGeneName === -1 ||
    idxGeneId === -1 ||
    idxContig === -1 ||
    idxStart === -1 ||
    idxStop === -1 ||
    idxStrand === -1 ||
    idxAssembly === -1
  ) {
    return [];
  }

  const rows: CoordRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split("\t");
    const geneName = getValue(parts, idxGeneName);
    const geneId = getValue(parts, idxGeneId);
    const contig = getValue(parts, idxContig);
    const start = Number(getValue(parts, idxStart));
    const stop = Number(getValue(parts, idxStop));
    const strandRaw = Number(getValue(parts, idxStrand));
    const assembly = getValue(parts, idxAssembly);
    if (!geneName || !geneId || !contig || !assembly) continue;
    if (!Number.isFinite(start) || !Number.isFinite(stop)) continue;
    const strand: 1 | -1 = strandRaw === -1 ? -1 : 1;
    rows.push({
      geneName,
      geneId,
      contig,
      start: Math.min(start, stop),
      stop: Math.max(start, stop),
      strand,
      assembly
    });
  }

  return rows;
}

function mergeCoordinateDuplicates(rows: CoordRow[]): CoordRow[] {
  const merged: Array<CoordRow & { geneNames: Set<string>; geneIds: Set<string> }> = [];

  for (const row of rows) {
    const prev = merged[merged.length - 1];
    const canMerge =
      prev &&
      prev.start === row.start &&
      prev.stop === row.stop &&
      prev.strand === row.strand;

    if (!canMerge) {
      merged.push({
        ...row,
        geneNames: new Set([row.geneName]),
        geneIds: new Set([row.geneId])
      });
      continue;
    }

    prev.geneNames.add(row.geneName);
    prev.geneIds.add(row.geneId);
  }

  return merged.map((row) => ({
    geneName: Array.from(row.geneNames).join("/"),
    geneId: Array.from(row.geneIds).join(","),
    contig: row.contig,
    start: row.start,
    stop: row.stop,
    strand: row.strand,
    assembly: row.assembly
  }));
}

function rowsToTracks(rows: CoordRow[]): OperonTrack[] {
  const byContig = new Map<string, CoordRow[]>();
  for (const row of rows) {
    const key = `${row.assembly}::${row.contig}`;
    const existing = byContig.get(key) ?? [];
    existing.push(row);
    byContig.set(key, existing);
  }

  const tracks: OperonTrack[] = [];
  for (const [key, contigRows] of byContig.entries()) {
    const sorted = [...contigRows].sort(
      (a, b) => a.start - b.start || a.stop - b.stop || a.strand - b.strand
    );
    const mergedRows = mergeCoordinateDuplicates(sorted);
    if (mergedRows.length === 0) continue;

    const first = mergedRows[0];
    const last = mergedRows[mergedRows.length - 1];
    const spanStart = Math.max(0, first.start - TRACK_FLANK_BP);
    const spanEnd = last.stop + TRACK_FLANK_BP;

    const lineSegments: OperonTrack["lineSegments"] = [];
    const items: OperonTrack["items"] = [];
    let segmentStart = mergedRows[0].start;
    let segmentStop = mergedRows[0].stop;

    for (let i = 0; i < mergedRows.length; i += 1) {
      const gene = mergedRows[i];
      items.push({
        kind: "gene",
        id: `${key}::gene::${i + 1}`,
        geneName: gene.geneName,
        geneId: gene.geneId,
        assembly: gene.assembly,
        contig: gene.contig,
        start: gene.start,
        stop: gene.stop,
        strand: gene.strand
      });

      const next = mergedRows[i + 1];
      if (!next) {
        segmentStop = Math.max(segmentStop, gene.stop);
        lineSegments.push({
          id: `${key}::segment::${lineSegments.length + 1}`,
          start: segmentStart,
          stop: segmentStop
        });
        continue;
      }

      const gap = next.start - gene.stop;
      if (gap <= SMALL_GAP_THRESHOLD_BP) {
        segmentStop = Math.max(segmentStop, next.stop);
        continue;
      }

      lineSegments.push({
        id: `${key}::segment::${lineSegments.length + 1}`,
        start: segmentStart,
        stop: Math.max(segmentStop, gene.stop)
      });
      items.push({
        kind: "gap",
        id: `${key}::gap::${i + 1}`,
        leftBp: gene.stop,
        rightBp: next.start
      });
      segmentStart = next.start;
      segmentStop = next.stop;
    }

    const [assembly, contig] = key.split("::");
    tracks.push({
      id: key,
      assembly,
      contig,
      spanStart,
      spanEnd,
      lineSegments,
      items
    });
  }

  return tracks.sort(
    (a, b) =>
      a.assembly.localeCompare(b.assembly) || a.contig.localeCompare(b.contig)
  );
}

export async function getSpeciesOperonContent(speciesName: string): Promise<SpeciesOperonContent> {
  if (!existsSync(COORD_DIR)) {
    return {
      matchedAssemblies: 0,
      assemblyCount: 0,
      contigCount: 0,
      geneCount: 0,
      missingAssemblies: [],
      tracks: []
    };
  }

  const normalized = normalizeSpeciesName(speciesName);
  const lineageRows = await loadLineageRows();
  const assemblies = Array.from(
    new Set(
      lineageRows
        .filter((row) => normalizeSpeciesName(row.species) === normalized)
        .map((row) => row.assembly)
    )
  );

  const parsedRows: CoordRow[] = [];
  const missingAssemblies: string[] = [];
  for (const assembly of assemblies) {
    const filePath = path.join(COORD_DIR, `coords_${assembly}.tsv`);
    if (!existsSync(filePath)) {
      missingAssemblies.push(assembly);
      continue;
    }

    const raw = await readFile(filePath, "utf8");
    parsedRows.push(...parseCoordFile(raw));
  }

  const tracks = rowsToTracks(parsedRows);
  const contigCount = tracks.length;
  const geneCount = parsedRows.length;

  return {
    matchedAssemblies: assemblies.length,
    assemblyCount: assemblies.length - missingAssemblies.length,
    contigCount,
    geneCount,
    missingAssemblies,
    tracks
  };
}
