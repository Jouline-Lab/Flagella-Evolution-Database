/**
 * Build the data bundle for the experimental operon-insertion page.
 *
 * Both inputs must be tab-separated and contain:
 *   gene_name, gene_id, genome_id, start, stop, strand
 *
 * Example:
 *   node scripts/operon-insertions/build-insertion-neighbor-associations.mjs \
 *     --reference path/to/flagellar_coordinates.tsv \
 *     --insertions path/to/insertion_coordinates.tsv \
 *     --max-distance 500
 */
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const DEFAULT_OPTIONS = {
  referencePath: "",
  insertionPath: "",
  outputPath: path.join(
    process.cwd(),
    "public",
    "operon-insertions",
    "insertion-neighbor-associations.json"
  ),
  maxDistanceBp: 500,
  sameStrandOnly: true
};

const REQUIRED_COLUMNS = ["gene_name", "gene_id", "genome_id", "start", "stop", "strand"];

function printHelp() {
  console.log(`
Build insertion-to-flagellar-neighbor associations.

Required:
  --reference <path>      Flagellar/reference coordinate TSV or directory of TSVs
  --insertions <file>     Inserted-gene coordinate TSV

Optional:
  --output <file>         Output JSON bundle
  --max-distance <bp>     Maximum gap to a neighbor (default: 500)
  --allow-opposite-strand Include reference genes on the opposite strand
  --help                  Show this message
`.trim());
}

function parseArguments(argv) {
  const options = { ...DEFAULT_OPTIONS };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--help" || argument === "-h") {
      return { ...options, help: true };
    }
    if (argument === "--reference") {
      options.referencePath = value ?? "";
      index += 1;
    } else if (argument === "--insertions") {
      options.insertionPath = value ?? "";
      index += 1;
    } else if (argument === "--output") {
      options.outputPath = value ? path.resolve(value) : "";
      index += 1;
    } else if (argument === "--max-distance") {
      options.maxDistanceBp = Number(value);
      index += 1;
    } else if (argument === "--allow-opposite-strand") {
      options.sameStrandOnly = false;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!options.referencePath || !options.insertionPath) {
    throw new Error("Both --reference and --insertions are required.");
  }
  if (!options.outputPath) {
    throw new Error("--output must not be empty.");
  }
  if (!Number.isFinite(options.maxDistanceBp) || options.maxDistanceBp < 0) {
    throw new Error("--max-distance must be a non-negative number.");
  }

  options.referencePath = path.resolve(options.referencePath);
  options.insertionPath = path.resolve(options.insertionPath);
  return options;
}

function parseCoordinateRow(parts, indexes) {
  const startRaw = Number(parts[indexes.start]?.trim());
  const stopRaw = Number(parts[indexes.stop]?.trim());
  const strandRaw = Number(parts[indexes.strand]?.trim());
  const geneName = parts[indexes.gene_name]?.trim() ?? "";
  const geneId = parts[indexes.gene_id]?.trim() ?? "";
  const genomeId = parts[indexes.genome_id]?.trim() ?? "";

  if (
    !geneName ||
    !geneId ||
    !genomeId ||
    !Number.isFinite(startRaw) ||
    !Number.isFinite(stopRaw)
  ) {
    return null;
  }

  return {
    geneName,
    geneId,
    genomeId,
    start: Math.min(startRaw, stopRaw),
    stop: Math.max(startRaw, stopRaw),
    strand: strandRaw === -1 ? -1 : 1
  };
}

async function appendCoordinateFile(filePath, rowsByGenome) {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  let indexes = null;
  let totalLines = 0;
  let validRows = 0;
  let invalidRows = 0;

  for await (const line of reader) {
    if (!line.trim()) continue;
    if (!indexes) {
      const headers = line
        .replace(/^\uFEFF/, "")
        .split("\t")
        .map((header) => header.trim().toLowerCase());
      const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
      if (missing.length > 0) {
        throw new Error(`${filePath} is missing columns: ${missing.join(", ")}`);
      }
      indexes = Object.fromEntries(
        REQUIRED_COLUMNS.map((column) => [column, headers.indexOf(column)])
      );
      continue;
    }

    totalLines += 1;
    const row = parseCoordinateRow(line.split("\t"), indexes);
    if (!row) {
      invalidRows += 1;
      continue;
    }
    validRows += 1;
    const genomeRows = rowsByGenome.get(row.genomeId) ?? [];
    genomeRows.push(row);
    rowsByGenome.set(row.genomeId, genomeRows);
  }

  if (!indexes) {
    throw new Error(`${filePath} does not contain a header.`);
  }

  return { totalLines, validRows, invalidRows };
}

async function readCoordinatesByGenome(inputPath) {
  const inputStats = await stat(inputPath);
  const rowsByGenome = new Map();
  let totalLines = 0;
  let validRows = 0;
  let invalidRows = 0;
  let fileCount = 0;

  if (inputStats.isDirectory()) {
    const filenames = (await readdir(inputPath))
      .filter((filename) => filename.toLowerCase().endsWith(".tsv"))
      .sort((a, b) => a.localeCompare(b));
    if (filenames.length === 0) {
      throw new Error(`${inputPath} does not contain any TSV files.`);
    }

    const batchSize = 250;
    for (let offset = 0; offset < filenames.length; offset += batchSize) {
      const batch = filenames.slice(offset, offset + batchSize);
      const results = await Promise.all(
        batch.map((filename) =>
          appendCoordinateFile(path.join(inputPath, filename), rowsByGenome)
        )
      );
      for (const result of results) {
        totalLines += result.totalLines;
        validRows += result.validRows;
        invalidRows += result.invalidRows;
      }
      fileCount += batch.length;
      const completed = Math.min(offset + batchSize, filenames.length);
      if (completed % 5000 === 0 || completed === filenames.length) {
        console.log(`  Read ${completed.toLocaleString()}/${filenames.length.toLocaleString()} files`);
      }
    }
  } else {
    const result = await appendCoordinateFile(inputPath, rowsByGenome);
    totalLines = result.totalLines;
    validRows = result.validRows;
    invalidRows = result.invalidRows;
    fileCount = 1;
  }

  for (const rows of rowsByGenome.values()) {
    rows.sort(
      (a, b) =>
        a.start - b.start ||
        a.stop - b.stop ||
        a.geneName.localeCompare(b.geneName) ||
        a.geneId.localeCompare(b.geneId)
    );
  }

  return { rowsByGenome, totalLines, validRows, invalidRows, fileCount };
}

function intervalGap(a, b) {
  if (a.stop < b.start) return b.start - a.stop;
  if (b.stop < a.start) return a.start - b.stop;
  return 0;
}

function midpoint(row) {
  return (row.start + row.stop) / 2;
}

function pickNearestNeighbors(insertion, references, maxDistanceBp) {
  let left = null;
  let right = null;

  for (const reference of references) {
    const gap = intervalGap(insertion, reference);
    if (gap > maxDistanceBp) continue;

    let side;
    if (reference.stop <= insertion.start) {
      side = "left";
    } else if (reference.start >= insertion.stop) {
      side = "right";
    } else {
      const referenceMidpoint = midpoint(reference);
      const insertionMidpoint = midpoint(insertion);
      side =
        referenceMidpoint < insertionMidpoint ||
        (referenceMidpoint === insertionMidpoint && reference.start <= insertion.start)
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
      (candidate.gap === current.gap &&
        candidate.midpointDifference < current.midpointDifference) ||
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
          genomicSide: "left",
          direction: left.reference.strand === 1 ? "downstream" : "upstream"
        }
      : null,
    right
      ? {
          ...right,
          genomicSide: "right",
          direction: right.reference.strand === 1 ? "upstream" : "downstream"
        }
      : null
  ].filter(Boolean);
}

function median(sortedValues) {
  if (sortedValues.length === 0) return 0;
  const middle = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 === 0
    ? (sortedValues[middle - 1] + sortedValues[middle]) / 2
    : sortedValues[middle];
}

function quantile(sortedValues, probability) {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const index = (sortedValues.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function summarizeDistances(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return {
    meanDistanceBp: mean,
    standardDeviationBp: Math.sqrt(variance),
    medianDistanceBp: median(sorted),
    lowerQuartileBp: quantile(sorted, 0.25),
    upperQuartileBp: quantile(sorted, 0.75),
    minimumDistanceBp: sorted[0],
    maximumDistanceBp: sorted[sorted.length - 1]
  };
}

function occurrenceKey(row) {
  return `${row.genomeId}\t${row.geneId}`;
}

export function buildAssociations(referenceData, insertionData, options) {
  const groups = new Map();
  const insertedGeneCounts = new Map();
  const insertedGeneOperonCounts = new Map();
  let insertionsWithNeighbors = 0;
  let insertionsWithoutReferenceContig = 0;
  let insertionsWithoutNeighborInRange = 0;
  let associationOccurrences = 0;

  for (const [genomeId, insertions] of insertionData.rowsByGenome.entries()) {
    const references = referenceData.rowsByGenome.get(genomeId);
    for (const insertion of insertions) {
      const insertionOccurrenceKey = occurrenceKey(insertion);
      const insertedGeneOccurrences =
        insertedGeneCounts.get(insertion.geneName) ?? new Set();
      insertedGeneOccurrences.add(insertionOccurrenceKey);
      insertedGeneCounts.set(insertion.geneName, insertedGeneOccurrences);
      if (!references || references.length === 0) {
        insertionsWithoutReferenceContig += 1;
        continue;
      }

      const eligibleReferences = options.sameStrandOnly
        ? references.filter((reference) => reference.strand === insertion.strand)
        : references;
      const neighbors = pickNearestNeighbors(
        insertion,
        eligibleReferences,
        options.maxDistanceBp
      );
      if (neighbors.length === 0) {
        insertionsWithoutNeighborInRange += 1;
        continue;
      }

      insertionsWithNeighbors += 1;
      const insertedGeneOperonOccurrences =
        insertedGeneOperonCounts.get(insertion.geneName) ?? new Set();
      insertedGeneOperonOccurrences.add(insertionOccurrenceKey);
      insertedGeneOperonCounts.set(insertion.geneName, insertedGeneOperonOccurrences);
      for (const neighbor of neighbors) {
        const key = [
          insertion.geneName,
          neighbor.reference.geneName,
          neighbor.direction
        ].join("\t");
        let group = groups.get(key);
        if (!group) {
          group = {
            insertedGene: insertion.geneName,
            neighborGene: neighbor.reference.geneName,
            direction: neighbor.direction,
            occurrences: new Set(),
            distances: [],
            sameStrandCount: 0
          };
          groups.set(key, group);
        }
        if (group.occurrences.has(insertionOccurrenceKey)) continue;
        group.occurrences.add(insertionOccurrenceKey);
        associationOccurrences += 1;
        group.distances.push(neighbor.gap);
        if (insertion.strand === neighbor.reference.strand) {
          group.sameStrandCount += 1;
        }
      }
    }
  }

  const associations = [...groups.values()]
    .map((group) => {
      const count = group.occurrences.size;
      const insertionCount = insertedGeneCounts.get(group.insertedGene)?.size ?? 0;
      const operonInsertionCount =
        insertedGeneOperonCounts.get(group.insertedGene)?.size ?? 0;
      return {
        insertedGene: group.insertedGene,
        neighborGene: group.neighborGene,
        direction: group.direction,
        count,
        insertionCount,
        operonInsertionCount,
        occurrencePercent: insertionCount > 0 ? (100 * count) / insertionCount : 0,
        sameStrandCount: group.sameStrandCount,
        sameStrandPercent: count > 0 ? (100 * group.sameStrandCount) / count : 0,
        ...summarizeDistances(group.distances)
      };
    })
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.insertedGene.localeCompare(b.insertedGene) ||
        a.direction.localeCompare(b.direction) ||
        a.neighborGene.localeCompare(b.neighborGene)
    );

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    options: {
      maxDistanceBp: options.maxDistanceBp,
      sameStrandOnly: options.sameStrandOnly,
      neighborMode: "nearest-on-each-side",
      occurrenceDefinition:
        "unique genome_id + gene_id per inserted group; duplicate coordinate rows do not inflate counts",
      directionDefinition:
        "upstream/downstream describes where the inserted gene is relative to the neighboring reference gene, using the reference gene strand",
      distanceDefinition:
        "interval gap; zero-gap spans are assigned upstream/downstream by relative midpoint"
    },
    inputs: {
      referenceFile: path.basename(options.referencePath),
      insertionFile: path.basename(options.insertionPath),
      referenceRows: referenceData.validRows,
      insertionRows: insertionData.validRows,
      referenceFiles: referenceData.fileCount,
      insertionFiles: insertionData.fileCount,
      invalidReferenceRows: referenceData.invalidRows,
      invalidInsertionRows: insertionData.invalidRows
    },
    summary: {
      insertedGeneTypes: insertedGeneCounts.size,
      insertionsWithNeighbors,
      insertionsWithoutReferenceContig,
      insertionsWithoutNeighborInRange,
      associationOccurrences,
      associationRows: associations.length
    },
    associations
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  console.log(`Reading reference coordinates: ${options.referencePath}`);
  const referenceData = await readCoordinatesByGenome(options.referencePath);
  console.log(`Reading insertion coordinates: ${options.insertionPath}`);
  const insertionData = await readCoordinatesByGenome(options.insertionPath);
  const bundle = buildAssociations(referenceData, insertionData, options);

  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, JSON.stringify(bundle, null, 2), "utf8");

  console.log(`Wrote ${options.outputPath}`);
  console.log(
    `${bundle.inputs.insertionRows.toLocaleString()} insertions; ` +
      `${bundle.summary.insertionsWithNeighbors.toLocaleString()} with neighbors; ` +
      `${bundle.summary.associationRows.toLocaleString()} summarized associations`
  );
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
