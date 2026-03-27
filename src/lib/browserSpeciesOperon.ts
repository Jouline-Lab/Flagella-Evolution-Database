import { withBasePath } from "@/lib/assetPaths";
import { formatSpeciesName, normalizeSpeciesQuery } from "@/lib/speciesNaming";
import type { SpeciesOperonContent } from "@/lib/speciesData";

type GtdbLineageRow = {
  assembly: string;
  species: string;
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

const SMALL_GAP_THRESHOLD_BP = 1000;
const TRACK_FLANK_BP = 500;

let lineageRowsPromise: Promise<GtdbLineageRow[]> | null = null;

function normalizeSpeciesName(value: string): string {
  return normalizeSpeciesQuery(formatSpeciesName(value));
}

async function loadLineageRows(): Promise<GtdbLineageRow[]> {
  if (!lineageRowsPromise) {
    lineageRowsPromise = fetch(withBasePath("/GTDB214_lineage_ordered.json")).then(
      async (response) => {
        if (!response.ok) {
          return [];
        }

        const parsed = (await response.json()) as unknown;
        if (!Array.isArray(parsed)) {
          return [];
        }

        return parsed
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
      }
    );
  }

  return lineageRowsPromise;
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

function rowsToTracks(rows: CoordRow[]): SpeciesOperonContent["tracks"] {
  const byContig = new Map<string, CoordRow[]>();
  for (const row of rows) {
    const key = `${row.assembly}::${row.contig}`;
    const existing = byContig.get(key) ?? [];
    existing.push(row);
    byContig.set(key, existing);
  }

  const tracks: SpeciesOperonContent["tracks"] = [];
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

    const lineSegments: SpeciesOperonContent["tracks"][number]["lineSegments"] = [];
    const items: SpeciesOperonContent["tracks"][number]["items"] = [];
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
    (a, b) => a.assembly.localeCompare(b.assembly) || a.contig.localeCompare(b.contig)
  );
}

export async function getSpeciesOperonContentClient(
  speciesName: string
): Promise<SpeciesOperonContent> {
  const normalized = normalizeSpeciesName(speciesName);
  const lineageRows = await loadLineageRows();
  const assemblies = Array.from(
    new Set(
      lineageRows
        .filter((row) => normalizeSpeciesName(row.species) === normalized)
        .map((row) => row.assembly)
    )
  );

  if (assemblies.length === 0) {
    return {
      matchedAssemblies: 0,
      assemblyCount: 0,
      contigCount: 0,
      geneCount: 0,
      missingAssemblies: [],
      tracks: []
    };
  }

  const responses = await Promise.all(
    assemblies.map(async (assembly) => {
      const response = await fetch(withBasePath(`/operon_coords/coords_${assembly}.tsv`));
      if (!response.ok) {
        return { assembly, rows: null as CoordRow[] | null };
      }

      const raw = await response.text();
      return { assembly, rows: parseCoordFile(raw) };
    })
  );

  const parsedRows = responses.flatMap((item) => item.rows ?? []);
  const missingAssemblies = responses.filter((item) => item.rows === null).map((item) => item.assembly);
  const tracks = rowsToTracks(parsedRows);

  return {
    matchedAssemblies: assemblies.length,
    assemblyCount: assemblies.length - missingAssemblies.length,
    contigCount: tracks.length,
    geneCount: parsedRows.length,
    missingAssemblies,
    tracks
  };
}
