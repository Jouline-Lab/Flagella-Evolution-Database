import { createReadStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const RANKS = ["phylum", "class", "order", "family", "genus", "species"];
const TSV_PATH = path.join(
  process.cwd(),
  "public",
  "flagellar_genes_phyletic_distribution.tsv"
);
const OUTPUT_PATH = path.join(process.cwd(), "public", "taxonomy-index.json");
const TUPLE_SEPARATOR = "\u001f";

async function buildTaxonomyIndex() {
  if (!existsSync(TSV_PATH)) {
    throw new Error(`TSV file not found: ${TSV_PATH}`);
  }

  const stream = createReadStream(TSV_PATH, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let headers = [];
  let rankIndexes = [];
  const uniqueTuples = new Set();

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    if (headers.length === 0) {
      headers = line.split("\t");
      rankIndexes = RANKS.map((rank) => headers.indexOf(rank));
      if (rankIndexes.some((idx) => idx === -1)) {
        throw new Error(
          `Could not find all taxonomy ranks in TSV header: ${RANKS.join(", ")}`
        );
      }
      continue;
    }

    const values = line.split("\t");
    const tuple = rankIndexes.map((idx) => (values[idx] ?? "").trim());
    uniqueTuples.add(tuple.join(TUPLE_SEPARATOR));
  }

  const rows = Array.from(uniqueTuples, (key) => key.split(TUPLE_SEPARATOR)).sort(
    (a, b) => a.join("|").localeCompare(b.join("|"))
  );

  const payload = {
    version: 1,
    ranks: RANKS,
    rows
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(payload), "utf8");

  // eslint-disable-next-line no-console
  console.log(`Taxonomy index written: ${OUTPUT_PATH}`);
  // eslint-disable-next-line no-console
  console.log(`Unique taxonomy tuples: ${rows.length}`);
}

buildTaxonomyIndex().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
