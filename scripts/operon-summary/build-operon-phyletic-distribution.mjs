/**
 * Build an assembly-by-operon phyletic distribution TSV.
 *
 * The output mirrors the shape expected by the phyletic distribution explorer:
 *   assembly, <Upstream_to_Downstream>_count..., domain, phylum, class, order, family, genus, species
 *
 * Operon columns count directed consecutive same-contig/same-strand gene pairs within 500 bp.
 * Run: node scripts/operon-summary/build-operon-phyletic-distribution.mjs
 */
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const MAX_GAP_BP = 500;
const OPERON_COORDS_DIR = path.join(process.cwd(), "public", "operon_coords");
const PHYLETIC_TSV_PATH = path.join(process.cwd(), "public", "flagellar_genes_phyletic_distribution.tsv");
const OUT_DIR = path.join(process.cwd(), "public", "operon-summary");
const OUT_PATH = path.join(OUT_DIR, "operon_phyletic_distribution.tsv");
const TAXONOMY_COLUMNS = ["domain", "phylum", "class", "order", "family", "genus", "species"];

function getValue(parts, idx) {
  if (idx < 0 || idx >= parts.length) return "";
  return parts[idx]?.trim() ?? "";
}

function sanitizeTsvCell(value) {
  return String(value ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ").trim();
}

function sanitizeFeatureName(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "Unknown";
}

function parseCoordFile(tsv, assemblyFallback = "") {
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
    idxStrand === -1
  ) {
    return [];
  }

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split("\t");
    const geneName = getValue(parts, idxGeneName);
    const geneId = getValue(parts, idxGeneId);
    const contig = getValue(parts, idxContig);
    const start = Number(getValue(parts, idxStart));
    const stop = Number(getValue(parts, idxStop));
    const strandRaw = Number(getValue(parts, idxStrand));
    const assembly =
      idxAssembly === -1 ? assemblyFallback : getValue(parts, idxAssembly) || assemblyFallback;
    if (!geneName || !geneId || !contig || !assembly) continue;
    if (!Number.isFinite(start) || !Number.isFinite(stop)) continue;
    rows.push({
      geneName,
      contig,
      start: Math.min(start, stop),
      stop: Math.max(start, stop),
      strand: strandRaw === -1 ? -1 : 1
    });
  }
  return rows;
}

function extractDirectedConsecutivePairs(rows, maxGapBp = MAX_GAP_BP) {
  const byContigStrand = new Map();
  for (const row of rows) {
    const key = `${row.contig}\t${row.strand}`;
    const existing = byContigStrand.get(key) ?? [];
    existing.push(row);
    byContigStrand.set(key, existing);
  }

  const pairs = [];
  for (const contigRows of byContigStrand.values()) {
    const sorted = [...contigRows].sort(
      (a, b) => a.start - b.start || a.stop - b.stop || a.geneName.localeCompare(b.geneName)
    );

    for (let i = 0; i < sorted.length - 1; i += 1) {
      const current = sorted[i];
      const candidate = sorted[i + 1];
      const gapBp = Math.max(0, candidate.start - current.stop);
      if (gapBp > maxGapBp) continue;

      pairs.push({
        upstream: current.strand === 1 ? current.geneName : candidate.geneName,
        downstream: current.strand === 1 ? candidate.geneName : current.geneName
      });
    }
  }
  return pairs;
}

function directedPairKey(upstream, downstream) {
  return `${upstream}\t${downstream}`;
}

function buildFeatureHeader(upstream, downstream, usedHeaders) {
  const base = `${sanitizeFeatureName(upstream)}_to_${sanitizeFeatureName(downstream)}_count`;
  if (!usedHeaders.has(base)) {
    usedHeaders.add(base);
    return base;
  }

  let suffix = 2;
  while (usedHeaders.has(`${base}_${suffix}`)) {
    suffix += 1;
  }
  const header = `${base}_${suffix}`;
  usedHeaders.add(header);
  return header;
}

function loadPhyleticRows(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) {
    throw new Error(`Missing rows in ${PHYLETIC_TSV_PATH}`);
  }

  const headers = lines[0].split("\t");
  const idxAssembly = headers.indexOf("assembly");
  if (idxAssembly === -1) {
    throw new Error("Phyletic TSV must include an assembly column.");
  }

  const taxonomyIndexes = Object.fromEntries(
    TAXONOMY_COLUMNS.map((column) => [column, headers.indexOf(column)])
  );

  return lines.slice(1).map((line) => {
    const parts = line.split("\t");
    const taxonomy = {};
    for (const column of TAXONOMY_COLUMNS) {
      taxonomy[column] = getValue(parts, taxonomyIndexes[column]);
    }
    return {
      assembly: getValue(parts, idxAssembly),
      taxonomy
    };
  }).filter((row) => row.assembly);
}

async function writeStream(stream, chunk) {
  if (!stream.write(chunk)) {
    await new Promise((resolve) => stream.once("drain", resolve));
  }
}

async function main() {
  if (!existsSync(OPERON_COORDS_DIR)) {
    throw new Error(`Missing operon coords directory: ${OPERON_COORDS_DIR}`);
  }
  if (!existsSync(PHYLETIC_TSV_PATH)) {
    throw new Error(`Missing phyletic TSV: ${PHYLETIC_TSV_PATH}`);
  }

  const phyleticRows = loadPhyleticRows(await readFile(PHYLETIC_TSV_PATH, "utf8"));
  const assemblyCounts = new Map();
  const pairTotals = new Map();
  const pairLabels = new Map();

  const filenames = (await readdir(OPERON_COORDS_DIR)).filter((name) => name.endsWith(".tsv"));
  const started = Date.now();
  let assembliesWithPairs = 0;
  let totalPairOccurrences = 0;

  for (let index = 0; index < filenames.length; index += 1) {
    const filename = filenames[index];
    const assembly = filename.replace(/^coords_/, "").replace(/\.tsv$/, "");
    const raw = await readFile(path.join(OPERON_COORDS_DIR, filename), "utf8");
    const pairs = extractDirectedConsecutivePairs(parseCoordFile(raw, assembly), MAX_GAP_BP);
    if (pairs.length > 0) {
      assembliesWithPairs += 1;
    }

    const counts = new Map();
    for (const pair of pairs) {
      const key = directedPairKey(pair.upstream, pair.downstream);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      pairTotals.set(key, (pairTotals.get(key) ?? 0) + 1);
      pairLabels.set(key, pair);
      totalPairOccurrences += 1;
    }
    if (counts.size > 0) {
      assemblyCounts.set(assembly, counts);
    }

    const done = index + 1;
    if (done % 5000 === 0 || done === filenames.length) {
      console.log(`Scanned ${done.toLocaleString()}/${filenames.length.toLocaleString()} assemblies...`);
    }
  }

  const pairKeys = [...pairTotals.keys()].sort(
    (a, b) => (pairTotals.get(b) ?? 0) - (pairTotals.get(a) ?? 0) || a.localeCompare(b)
  );
  const usedHeaders = new Set();
  const pairHeaders = pairKeys.map((key) => {
    const label = pairLabels.get(key);
    return buildFeatureHeader(label.upstream, label.downstream, usedHeaders);
  });

  await mkdir(OUT_DIR, { recursive: true });
  const stream = createWriteStream(OUT_PATH, { encoding: "utf8" });
  await writeStream(stream, ["assembly", ...pairHeaders, ...TAXONOMY_COLUMNS].join("\t") + "\n");

  for (const row of phyleticRows) {
    const counts = assemblyCounts.get(row.assembly);
    const values = [
      sanitizeTsvCell(row.assembly),
      ...pairKeys.map((key) => String(counts?.get(key) ?? 0)),
      ...TAXONOMY_COLUMNS.map((column) => sanitizeTsvCell(row.taxonomy[column] || "-"))
    ];
    await writeStream(stream, values.join("\t") + "\n");
  }

  await new Promise((resolve, reject) => {
    stream.end(resolve);
    stream.on("error", reject);
  });

  const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`Wrote ${OUT_PATH}`);
  console.log(`${phyleticRows.length.toLocaleString()} phyletic rows`);
  console.log(`${filenames.length.toLocaleString()} coordinate files scanned`);
  console.log(`${assembliesWithPairs.toLocaleString()} assemblies with directed consecutive operon pairs`);
  console.log(`${totalPairOccurrences.toLocaleString()} directed pair occurrences`);
  console.log(`${pairKeys.length.toLocaleString()} unique directed operon combinations`);
  console.log(`Elapsed: ${elapsedSec}s`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
