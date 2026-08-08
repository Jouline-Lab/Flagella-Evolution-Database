/**
 * Fetch KEGG Orthology labels used by the generated insertion-association bundle.
 *
 * Run:
 *   npm run fetch:kegg-insertion-names
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const BUNDLE_PATH = path.join(
  process.cwd(),
  "public",
  "operon-insertions",
  "insertion-neighbor-associations.json"
);
const OUTPUT_PATH = path.join(
  process.cwd(),
  "public",
  "operon-insertions",
  "kegg-orthology-names.json"
);
const KEGG_ID_PATTERN = /^K\d{5}$/;
const BATCH_SIZE = 10;

const bundle = JSON.parse(await readFile(BUNDLE_PATH, "utf8"));
const ids = [
  ...new Set(
    (bundle.associations ?? [])
      .map((row) => String(row.insertedGene ?? "").toUpperCase())
      .filter((value) => KEGG_ID_PATTERN.test(value))
  )
].sort((a, b) => a.localeCompare(b));

if (ids.length === 0) {
  throw new Error(`No KEGG Orthology IDs found in ${BUNDLE_PATH}`);
}

const names = {};
for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
  const batch = ids.slice(offset, offset + BATCH_SIZE);
  const url = `https://rest.kegg.jp/list/${batch.join("+")}`;
  const response = await fetch(url, {
    headers: {
      Accept: "text/plain",
      "User-Agent": "Flagella-Evolution-Database/1.0"
    }
  });
  if (!response.ok) {
    throw new Error(`KEGG request failed with HTTP ${response.status}: ${url}`);
  }

  const text = await response.text();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [rawId, ...labelParts] = line.split("\t");
    const id = rawId.replace(/^ko:/i, "").trim().toUpperCase();
    const rawLabel = labelParts.join("\t").trim();
    const label = rawLabel.replace(new RegExp(`^${id}\\s*;\\s*`, "i"), "");
    if (KEGG_ID_PATTERN.test(id) && label) {
      names[id] = label;
    }
  }
  console.log(`Fetched ${Math.min(offset + BATCH_SIZE, ids.length)}/${ids.length} KEGG labels`);
}

const missingIds = ids.filter((id) => !names[id]);
await writeFile(
  OUTPUT_PATH,
  JSON.stringify(
    {
      source: "KEGG REST API",
      sourceUrl: "https://rest.kegg.jp",
      retrievedAt: new Date().toISOString(),
      names,
      missingIds
    },
    null,
    2
  ),
  "utf8"
);

console.log(`Wrote ${OUTPUT_PATH}`);
console.log(`${Object.keys(names).length}/${ids.length} KEGG Orthology labels retrieved`);
if (missingIds.length > 0) {
  console.warn(`Missing labels: ${missingIds.join(", ")}`);
}
