/**
 * Filter the operon phyletic distribution TSV by total feature occurrence.
 *
 * Default keeps operon count columns observed at least 500 times globally and drops
 * assembly rows whose retained operon counts are all zero.
 *
 * Run:
 *   node scripts/operon-summary/filter-operon-phyletic-distribution.mjs 500
 */
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

const MIN_OCCURRENCE = Number(process.argv[2] ?? 500);
const INPUT_PATH = path.join(process.cwd(), "public", "operon-summary", "operon_phyletic_distribution.tsv");
const OUT_DIR = path.join(process.cwd(), "public", "operon-summary");
const OUTPUT_PATH = path.join(
  OUT_DIR,
  `operon_phyletic_distribution_min${Number.isFinite(MIN_OCCURRENCE) ? MIN_OCCURRENCE : 500}.tsv`
);
const TAXONOMY_COLUMNS = new Set(["domain", "phylum", "class", "order", "family", "genus", "species"]);

async function writeStream(stream, chunk) {
  if (!stream.write(chunk)) {
    await new Promise((resolve) => stream.once("drain", resolve));
  }
}

async function readHeaderAndTotals() {
  const stream = createReadStream(INPUT_PATH, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let headers = null;
  let countColumnIndexes = [];
  let totals = [];
  let rows = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    if (!headers) {
      headers = line.split("\t");
      countColumnIndexes = headers
        .map((header, index) => ({ header, index }))
        .filter(({ header }) => header.endsWith("_count"))
        .map(({ index }) => index);
      totals = new Array(countColumnIndexes.length).fill(0);
      continue;
    }

    rows += 1;
    const parts = line.split("\t");
    for (let i = 0; i < countColumnIndexes.length; i += 1) {
      const value = Number(parts[countColumnIndexes[i]] ?? 0);
      if (Number.isFinite(value)) {
        totals[i] += value;
      }
    }
  }

  if (!headers) {
    throw new Error(`No header found in ${INPUT_PATH}`);
  }
  return { headers, countColumnIndexes, totals, rows };
}

async function writeFiltered(headers, keepIndexes) {
  const keepIndexSet = new Set(keepIndexes);
  const retainedHeaders = headers.filter((_, index) => keepIndexSet.has(index));

  await mkdir(OUT_DIR, { recursive: true });
  const output = createWriteStream(OUTPUT_PATH, { encoding: "utf8" });
  await writeStream(output, `${retainedHeaders.join("\t")}\n`);

  const stream = createReadStream(INPUT_PATH, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let isHeader = true;
  let retainedRows = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    if (isHeader) {
      isHeader = false;
      continue;
    }

    const parts = line.split("\t");
    const hasAnyCount = keepIndexes.some((index) => {
      const header = headers[index];
      if (!header.endsWith("_count")) {
        return false;
      }
      const value = Number(parts[index] ?? 0);
      return Number.isFinite(value) && value > 0;
    });
    if (!hasAnyCount) {
      continue;
    }

    retainedRows += 1;
    await writeStream(output, `${keepIndexes.map((index) => parts[index] ?? "").join("\t")}\n`);
  }

  await new Promise((resolve, reject) => {
    output.end(resolve);
    output.on("error", reject);
  });

  return { retainedHeaders, retainedRows };
}

async function main() {
  if (!Number.isFinite(MIN_OCCURRENCE) || MIN_OCCURRENCE < 1) {
    throw new Error("Minimum occurrence must be a positive number.");
  }
  if (!existsSync(INPUT_PATH)) {
    throw new Error(`Missing input TSV: ${INPUT_PATH}`);
  }

  const started = Date.now();
  const { headers, countColumnIndexes, totals, rows } = await readHeaderAndTotals();
  const retainedCountColumnIndexes = countColumnIndexes.filter(
    (_index, i) => totals[i] >= MIN_OCCURRENCE
  );
  const retainedMetadataIndexes = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => header === "assembly" || TAXONOMY_COLUMNS.has(header))
    .map(({ index }) => index);
  const keepIndexes = [...retainedMetadataIndexes, ...retainedCountColumnIndexes].sort((a, b) => a - b);
  const { retainedHeaders, retainedRows } = await writeFiltered(headers, keepIndexes);

  const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`Input rows: ${rows.toLocaleString()}`);
  console.log(`Input operon columns: ${countColumnIndexes.length.toLocaleString()}`);
  console.log(`Minimum occurrence: ${MIN_OCCURRENCE.toLocaleString()}`);
  console.log(`Retained operon columns: ${retainedCountColumnIndexes.length.toLocaleString()}`);
  console.log(`Retained nonzero rows: ${retainedRows.toLocaleString()}`);
  console.log(`Retained total columns: ${retainedHeaders.length.toLocaleString()}`);
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(`Elapsed: ${elapsedSec}s`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
