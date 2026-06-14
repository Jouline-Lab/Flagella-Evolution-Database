/**
 * Build the operon pair-occurrence cache used by /operon-summary.
 * Run once locally: node scripts/operon-summary/build-operon-cache.mjs
 *
 * After this finishes, the dev page loads associations in seconds and threshold
 * changes are instant.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_SCAN_GAP_BP = 500;
const OPERON_COORDS_DIR = path.join(process.cwd(), "public", "operon_coords");
const CACHE_DIR = path.join(process.cwd(), "public", "operon-summary");
const CACHE_PATH = path.join(CACHE_DIR, "pair-occurrences-cache.jsonl");
const CACHE_META_PATH = path.join(CACHE_DIR, "pair-occurrences-cache.meta.json");

function getValue(parts, idx) {
  if (idx < 0 || idx >= parts.length) return "";
  return parts[idx]?.trim() ?? "";
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
    const strand = strandRaw === -1 ? -1 : 1;
    rows.push({
      geneName,
      contig,
      start: Math.min(start, stop),
      stop: Math.max(start, stop),
      strand
    });
  }
  return rows;
}

function extractNeighborhoodPairs(rows, maxGapBp = MAX_SCAN_GAP_BP) {
  const byContigStrand = new Map();
  for (const row of rows) {
    const key = `${row.contig}\t${row.strand}`;
    const existing = byContigStrand.get(key) ?? [];
    existing.push(row);
    byContigStrand.set(key, existing);
  }

  const occurrences = [];
  for (const contigRows of byContigStrand.values()) {
    const sorted = [...contigRows].sort(
      (a, b) => a.start - b.start || a.stop - b.stop || a.geneName.localeCompare(b.geneName)
    );

    for (let i = 0; i < sorted.length - 1; i += 1) {
      const current = sorted[i];
      const candidate = sorted[i + 1];
      const gapBp = Math.max(0, candidate.start - current.stop);
      if (gapBp > maxGapBp) continue;

      occurrences.push({
        geneA: current.geneName,
        geneB: candidate.geneName,
        gap: gapBp,
        upstream: current.strand === 1 ? current.geneName : candidate.geneName,
        downstream: current.strand === 1 ? candidate.geneName : current.geneName
      });
    }
  }
  return occurrences;
}

async function main() {
  if (!existsSync(OPERON_COORDS_DIR)) {
    throw new Error(`Missing operon coords directory: ${OPERON_COORDS_DIR}`);
  }

  const filenames = (await readdir(OPERON_COORDS_DIR)).filter((name) => name.endsWith(".tsv"));
  const occurrences = [];
  let assembliesWithCoords = 0;
  const batchSize = 500;
  const started = Date.now();

  for (let offset = 0; offset < filenames.length; offset += batchSize) {
    const batch = filenames.slice(offset, offset + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (filename) => {
        const assemblyFallback = filename.replace(/^coords_/, "").replace(/\.tsv$/, "");
        const raw = await readFile(path.join(OPERON_COORDS_DIR, filename), "utf8");
        const rows = parseCoordFile(raw, assemblyFallback);
        if (rows.length === 0) return [];
        return extractNeighborhoodPairs(rows, MAX_SCAN_GAP_BP).map((occ) => ({
          ...occ,
          assembly: assemblyFallback
        }));
      })
    );

    for (const pairs of batchResults) {
      if (pairs.length > 0) assembliesWithCoords += 1;
      occurrences.push(...pairs);
    }

    const done = Math.min(offset + batchSize, filenames.length);
    if (done % 5000 === 0 || done === filenames.length) {
      console.log(`Scanned ${done}/${filenames.length} assemblies…`);
    }
  }

  await mkdir(CACHE_DIR, { recursive: true });
  const lines = occurrences.map(
    (occ) =>
      `${occ.geneA}\t${occ.geneB}\t${occ.gap}\t${occ.upstream}\t${occ.downstream}\t${occ.assembly ?? ""}`
  );
  await writeFile(CACHE_PATH, `${lines.join("\n")}\n`, "utf8");
  await writeFile(
    CACHE_META_PATH,
    JSON.stringify(
      {
        assembliesScanned: filenames.length,
        assembliesWithCoords,
        scannedAt: Date.now(),
        pairOccurrences: occurrences.length
      },
      null,
      2
    ),
    "utf8"
  );

  const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`Cache written to ${CACHE_DIR}`);
  console.log(
    `${filenames.length} assemblies, ${assembliesWithCoords} with coords, ${occurrences.length} pair instances (${elapsedSec}s)`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
