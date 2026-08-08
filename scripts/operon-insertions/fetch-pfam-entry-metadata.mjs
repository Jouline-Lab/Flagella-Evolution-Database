/**
 * Fetch InterPro metadata for the Pfam accessions used by the generated
 * Pfam insertion-association bundle.
 *
 * Usage:
 *   npm run fetch:pfam-insertion-metadata
 *
 * Optional:
 *   --bundle <file>       Pfam association JSON bundle
 *   --output <file>       Metadata JSON output
 *   --concurrency <count> Simultaneous InterPro requests (default: 5)
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BUNDLE_PATH = path.join(
  process.cwd(),
  "public",
  "operon-insertions",
  "pfam-insertion-neighbor-associations.json"
);
const DEFAULT_OUTPUT_PATH = path.join(
  process.cwd(),
  "public",
  "operon-insertions",
  "pfam-entry-metadata.json"
);
const PFAM_ID_PATTERN = /^PF\d{5}(?:\.\d+)?$/i;

function parseArguments(argv) {
  const options = {
    bundlePath: DEFAULT_BUNDLE_PATH,
    outputPath: DEFAULT_OUTPUT_PATH,
    concurrency: 5
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--bundle") {
      options.bundlePath = path.resolve(value ?? "");
      index += 1;
    } else if (argument === "--output") {
      options.outputPath = path.resolve(value ?? "");
      index += 1;
    } else if (argument === "--concurrency") {
      options.concurrency = Number(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!options.bundlePath || !options.outputPath) {
    throw new Error("--bundle and --output must not be empty.");
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer.");
  }
  return options;
}

function normalizePfamId(value) {
  const normalized = String(value).trim().toUpperCase();
  if (!PFAM_ID_PATTERN.test(normalized)) return null;
  return normalized.split(".")[0];
}

function decodeHtml(value) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchWithRetry(url, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, {
      headers: { Accept: "application/json" }
    });
    if (response.ok || response.status === 404) return response;
    if (attempt === attempts || (response.status !== 429 && response.status < 500)) {
      throw new Error(`InterPro request failed with HTTP ${response.status}: ${url}`);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
  }
  throw new Error(`InterPro request failed: ${url}`);
}

async function fetchEntry(id) {
  const url = `https://www.ebi.ac.uk/interpro/api/entry/pfam/${id}/`;
  const response = await fetchWithRetry(url);
  if (response.status === 404) return null;

  const payload = await response.json();
  const metadata = payload?.metadata ?? {};
  const descriptions = Array.isArray(metadata.description) ? metadata.description : [];
  const description = descriptions
    .map((item) => decodeHtml(typeof item === "string" ? item : item?.text ?? ""))
    .filter(Boolean)
    .join(" ");

  return {
    shortName: metadata.name?.short?.trim() || null,
    name: metadata.name?.name?.trim() || null,
    description: description || null,
    type: metadata.type?.trim() || null,
    integrated: metadata.integrated?.trim() || null
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const bundle = JSON.parse(await readFile(options.bundlePath, "utf8"));
  const ids = [
    ...new Set(
      (bundle.associations ?? [])
        .map((row) => normalizePfamId(row.insertedGene))
        .filter(Boolean)
    )
  ].sort((a, b) => a.localeCompare(b));

  if (ids.length === 0) {
    throw new Error(`No Pfam accessions found in ${options.bundlePath}`);
  }

  const entries = {};
  const missingIds = [];
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (nextIndex < ids.length) {
      const id = ids[nextIndex];
      nextIndex += 1;
      const entry = await fetchEntry(id);
      if (entry) entries[id] = entry;
      else missingIds.push(id);
      completed += 1;
      if (completed % 25 === 0 || completed === ids.length) {
        console.log(`Fetched ${completed}/${ids.length} Pfam entries`);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(options.concurrency, ids.length) }, () => worker())
  );

  await writeFile(
    options.outputPath,
    JSON.stringify(
      {
        metadata: {
          source: "InterPro API",
          sourceUrl: "https://www.ebi.ac.uk/interpro/api/",
          generatedAt: new Date().toISOString(),
          totalIds: ids.length,
          retrievedIds: Object.keys(entries).length,
          missingIds: missingIds.sort((a, b) => a.localeCompare(b))
        },
        entries
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`Wrote ${options.outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
