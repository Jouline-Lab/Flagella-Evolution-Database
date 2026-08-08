/**
 * Build sparse assembly-by-directed-insertion association counts for phyletic rugs.
 *
 * The table UI decides which columns are visible; this script stores counts sparsely so
 * the visualization can materialize only the requested directed associations.
 *
 * Run:
 *   node scripts/operon-insertions/build-insertion-phyletic-distribution.mjs
 */
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

const MAX_DISTANCE_BP = 500;
const OPERON_COORDS_DIR = path.join(process.cwd(), "public", "operon_coords");
const PHYLETIC_TSV_PATH = path.join(process.cwd(), "public", "flagellar_genes_phyletic_distribution.tsv");
const KEGG_INSERTIONS_PATH = path.join(
  process.cwd(),
  "public",
  "flagellar_gene_neighbors_top100_domain_proteins_coordinates.tsv"
);
const PFAM_INSERTIONS_PATH = path.join(
  process.cwd(),
  "public",
  "operon-insertions",
  "pfam-top100-merged90-coordinates.tsv"
);
const OUT_PATH = path.join(
  process.cwd(),
  "public",
  "operon-insertions",
  "insertion-association-phyletic-sparse.json"
);

const REQUIRED_COLUMNS = ["gene_name", "gene_id", "genome_id", "start", "stop", "strand"];

function sanitizeFeatureName(value) {
  return (
    String(value ?? "")
      .trim()
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "Unknown"
  );
}

function insertionAssociationColumnName(source, target) {
  return `${sanitizeFeatureName(source)}_to_${sanitizeFeatureName(target)}_count`;
}

function parseCoordinateRow(parts, indexes, assemblyFallback = "") {
  const startRaw = Number(parts[indexes.start]?.trim());
  const stopRaw = Number(parts[indexes.stop]?.trim());
  const strandRaw = Number(parts[indexes.strand]?.trim());
  const geneName = parts[indexes.gene_name]?.trim() ?? "";
  const geneId = parts[indexes.gene_id]?.trim() ?? "";
  const genomeId = parts[indexes.genome_id]?.trim() ?? "";
  const assembly =
    indexes.assembly == null || indexes.assembly < 0
      ? assemblyFallback
      : parts[indexes.assembly]?.trim() || assemblyFallback;

  if (!geneName || !geneId || !genomeId || !Number.isFinite(startRaw) || !Number.isFinite(stopRaw)) {
    return null;
  }

  return {
    geneName,
    geneId,
    genomeId,
    assembly,
    start: Math.min(startRaw, stopRaw),
    stop: Math.max(startRaw, stopRaw),
    strand: strandRaw === -1 ? -1 : 1
  };
}

function indexesFromHeader(line) {
  const headers = line
    .replace(/^\uFEFF/, "")
    .split("\t")
    .map((header) => header.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length > 0) {
    throw new Error(`Coordinate file is missing columns: ${missing.join(", ")}`);
  }
  return Object.fromEntries(
    [...REQUIRED_COLUMNS, "assembly"].map((column) => [column, headers.indexOf(column)])
  );
}

async function loadAssemblyOrder() {
  const text = await readFile(PHYLETIC_TSV_PATH, "utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) throw new Error(`Missing rows in ${PHYLETIC_TSV_PATH}`);
  const headers = lines[0].split("\t");
  const assemblyIndex = headers.indexOf("assembly");
  if (assemblyIndex === -1) throw new Error(`${PHYLETIC_TSV_PATH} must include an assembly column.`);
  return lines
    .slice(1)
    .map((line) => line.split("\t")[assemblyIndex]?.trim() ?? "")
    .filter(Boolean);
}

async function loadReferenceRowsByContig() {
  const filenames = (await readdir(OPERON_COORDS_DIR))
    .filter((name) => name.toLowerCase().endsWith(".tsv"))
    .sort((a, b) => a.localeCompare(b));
  const rowsByContig = new Map();
  let validRows = 0;

  for (let index = 0; index < filenames.length; index += 1) {
    const filename = filenames[index];
    const assembly = filename.replace(/^coords_/, "").replace(/\.tsv$/i, "");
    const text = await readFile(path.join(OPERON_COORDS_DIR, filename), "utf8");
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length <= 1) continue;
    const indexes = indexesFromHeader(lines[0]);

    for (const line of lines.slice(1)) {
      const row = parseCoordinateRow(line.split("\t"), indexes, assembly);
      if (!row) continue;
      validRows += 1;
      const rows = rowsByContig.get(row.genomeId) ?? [];
      rows.push(row);
      rowsByContig.set(row.genomeId, rows);
    }

    const done = index + 1;
    if (done % 5000 === 0 || done === filenames.length) {
      console.log(`  Loaded ${done.toLocaleString()}/${filenames.length.toLocaleString()} operon coordinate files`);
    }
  }

  for (const rows of rowsByContig.values()) {
    rows.sort(
      (a, b) =>
        a.start - b.start ||
        a.stop - b.stop ||
        a.geneName.localeCompare(b.geneName) ||
        a.geneId.localeCompare(b.geneId)
    );
  }

  return { rowsByContig, validRows, fileCount: filenames.length };
}

function intervalGap(a, b) {
  if (a.stop < b.start) return b.start - a.stop;
  if (b.stop < a.start) return a.start - b.stop;
  return 0;
}

function midpoint(row) {
  return (row.start + row.stop) / 2;
}

function pickNearestNeighbors(insertion, references) {
  let left = null;
  let right = null;

  for (const reference of references) {
    if (reference.strand !== insertion.strand) continue;
    const gap = intervalGap(insertion, reference);
    if (gap > MAX_DISTANCE_BP) continue;

    let side;
    if (reference.stop <= insertion.start) {
      side = "left";
    } else if (reference.start >= insertion.stop) {
      side = "right";
    } else {
      side =
        midpoint(reference) < midpoint(insertion) ||
        (midpoint(reference) === midpoint(insertion) && reference.start <= insertion.start)
          ? "left"
          : "right";
    }

    const candidate = {
      reference,
      gap,
      midpointDifference: Math.abs(midpoint(reference) - midpoint(insertion))
    };
    const current = side === "left" ? left : right;
    const isBetter =
      !current ||
      candidate.gap < current.gap ||
      (candidate.gap === current.gap && candidate.midpointDifference < current.midpointDifference) ||
      (candidate.gap === current.gap &&
        candidate.midpointDifference === current.midpointDifference &&
        candidate.reference.geneId.localeCompare(current.reference.geneId) < 0);

    if (isBetter) {
      if (side === "left") left = candidate;
      else right = candidate;
    }
  }

  return [
    left
      ? {
          ...left,
          direction: left.reference.strand === 1 ? "downstream" : "upstream"
        }
      : null,
    right
      ? {
          ...right,
          direction: right.reference.strand === 1 ? "upstream" : "downstream"
        }
      : null
  ].filter(Boolean);
}

async function addInsertionFile({
  insertionPath,
  sourceType,
  rowsByContig,
  countsByColumn,
  metadataByColumn,
  assemblyIndexById,
  seenOccurrenceKeys
}) {
  const inputStats = await stat(insertionPath);
  if (!inputStats.isFile()) {
    throw new Error(`Missing insertion coordinate file: ${insertionPath}`);
  }

  const reader = createInterface({
    input: createReadStream(insertionPath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });
  let indexes = null;
  let insertionRows = 0;
  let matchedRows = 0;
  let associationOccurrences = 0;

  for await (const line of reader) {
    if (!line.trim()) continue;
    if (!indexes) {
      indexes = indexesFromHeader(line);
      continue;
    }

    const insertion = parseCoordinateRow(line.split("\t"), indexes);
    if (!insertion) continue;
    insertionRows += 1;
    const references = rowsByContig.get(insertion.genomeId);
    if (!references || references.length === 0) continue;

    const neighbors = pickNearestNeighbors(insertion, references);
    if (neighbors.length === 0) continue;
    matchedRows += 1;

    for (const neighbor of neighbors) {
      const assembly = neighbor.reference.assembly;
      const assemblyIndex = assemblyIndexById.get(assembly);
      if (assemblyIndex == null) continue;

      const edgeSource =
        neighbor.direction === "upstream" ? insertion.geneName : neighbor.reference.geneName;
      const edgeTarget =
        neighbor.direction === "upstream" ? neighbor.reference.geneName : insertion.geneName;
      const column = insertionAssociationColumnName(edgeSource, edgeTarget);
      const occurrenceKey = [
        sourceType,
        column,
        assembly,
        insertion.genomeId,
        insertion.geneId
      ].join("\t");
      if (seenOccurrenceKeys.has(occurrenceKey)) continue;
      seenOccurrenceKeys.add(occurrenceKey);

      const assemblyCounts = countsByColumn.get(column) ?? new Map();
      assemblyCounts.set(assemblyIndex, (assemblyCounts.get(assemblyIndex) ?? 0) + 1);
      countsByColumn.set(column, assemblyCounts);
      associationOccurrences += 1;

      if (!metadataByColumn.has(column)) {
        metadataByColumn.set(column, {
          column,
          source: edgeSource,
          target: edgeTarget,
          sourceType
        });
      }
    }
  }

  return { insertionRows, matchedRows, associationOccurrences };
}

async function main() {
  const started = Date.now();
  console.log("Loading assembly order...");
  const assemblies = await loadAssemblyOrder();
  const assemblyIndexById = new Map(assemblies.map((assembly, index) => [assembly, index]));

  console.log("Loading flagellar/reference coordinates...");
  const referenceData = await loadReferenceRowsByContig();

  const countsByColumn = new Map();
  const metadataByColumn = new Map();
  const seenOccurrenceKeys = new Set();

  console.log("Scanning KEGG insertion coordinates...");
  const keggSummary = await addInsertionFile({
    insertionPath: KEGG_INSERTIONS_PATH,
    sourceType: "kegg",
    rowsByContig: referenceData.rowsByContig,
    countsByColumn,
    metadataByColumn,
    assemblyIndexById,
    seenOccurrenceKeys
  });

  console.log("Scanning Pfam insertion coordinates...");
  const pfamSummary = await addInsertionFile({
    insertionPath: PFAM_INSERTIONS_PATH,
    sourceType: "pfam",
    rowsByContig: referenceData.rowsByContig,
    countsByColumn,
    metadataByColumn,
    assemblyIndexById,
    seenOccurrenceKeys
  });

  const associations = Object.fromEntries(
    [...countsByColumn.entries()]
      .sort((a, b) => {
        const totalA = [...a[1].values()].reduce((sum, value) => sum + value, 0);
        const totalB = [...b[1].values()].reduce((sum, value) => sum + value, 0);
        return totalB - totalA || a[0].localeCompare(b[0]);
      })
      .map(([column, counts]) => [
        column,
        [...counts.entries()].sort((a, b) => a[0] - b[0])
      ])
  );

  const metadata = Object.fromEntries(
    [...metadataByColumn.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  );

  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    options: {
      maxDistanceBp: MAX_DISTANCE_BP,
      sameStrandOnly: true
    },
    inputs: {
      referenceDirectory: path.relative(process.cwd(), OPERON_COORDS_DIR),
      keggInsertionFile: path.relative(process.cwd(), KEGG_INSERTIONS_PATH),
      pfamInsertionFile: path.relative(process.cwd(), PFAM_INSERTIONS_PATH),
      phyleticFile: path.relative(process.cwd(), PHYLETIC_TSV_PATH),
      referenceRows: referenceData.validRows,
      referenceFiles: referenceData.fileCount,
      keggInsertionRows: keggSummary.insertionRows,
      pfamInsertionRows: pfamSummary.insertionRows
    },
    summary: {
      assemblies: assemblies.length,
      directedAssociations: countsByColumn.size,
      keggMatchedInsertions: keggSummary.matchedRows,
      pfamMatchedInsertions: pfamSummary.matchedRows,
      keggAssociationOccurrences: keggSummary.associationOccurrences,
      pfamAssociationOccurrences: pfamSummary.associationOccurrences
    },
    assemblies,
    metadata,
    associations
  };

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(payload), "utf8");

  const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`Wrote ${OUT_PATH}`);
  console.log(`${assemblies.length.toLocaleString()} assemblies`);
  console.log(`${countsByColumn.size.toLocaleString()} directed insertion associations`);
  console.log(`Elapsed: ${elapsedSec}s`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
