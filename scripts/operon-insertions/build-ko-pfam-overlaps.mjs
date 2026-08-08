/**
 * Compare KO groups against merged Pfam model groups by protein occurrence.
 *
 * This does not combine coordinates. It writes a lookup report that lets the
 * page show KO rows and matching reciprocal-coverage Pfam groups side by side.
 * When one KO matches multiple Pfam groups, the combined KO entry uses the union
 * of only those directly matched Pfam group occurrence sets.
 *
 * Usage:
 *   npm run build:ko-pfam-overlaps
 *
 * Optional:
 *   --kegg <file>          KO coordinate TSV
 *   --pfam <file>          Merged Pfam coordinate TSV
 *   --pfam-report <file>   Pfam merge report JSON
 *   --output <file>        KO/Pfam overlap report JSON
 *   --threshold <0..1>     Minimum either-side coverage (default: 0.7)
 */
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

const DEFAULT_KEGG_INPUT = path.join(
  process.cwd(),
  "public",
  "flagellar_gene_neighbors_top100_domain_proteins_coordinates.tsv"
);
const DEFAULT_PFAM_INPUT = path.join(
  process.cwd(),
  "public",
  "operon-insertions",
  "pfam-top100-merged90-coordinates.tsv"
);
const DEFAULT_PFAM_REPORT = path.join(
  process.cwd(),
  "public",
  "operon-insertions",
  "pfam-domain-overlap-groups.json"
);
const DEFAULT_OUTPUT = path.join(
  process.cwd(),
  "public",
  "operon-insertions",
  "ko-pfam-overlap-groups.json"
);
const REQUIRED_COLUMNS = ["gene_name", "gene_id", "genome_id"];
const KEGG_PATTERN = /^K\d{5}$/i;
const PFAM_PATTERN = /^PF\d{5}(?:\.\d+)?$/i;

function parseUnitInterval(value, argument) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error(`${argument} must be between 0 and 1.`);
  }
  return number;
}

function parseArguments(argv) {
  const options = {
    keggPath: DEFAULT_KEGG_INPUT,
    pfamPath: DEFAULT_PFAM_INPUT,
    pfamReportPath: DEFAULT_PFAM_REPORT,
    outputPath: DEFAULT_OUTPUT,
    threshold: 0.7
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--kegg") {
      options.keggPath = path.resolve(value ?? "");
      index += 1;
    } else if (argument === "--pfam") {
      options.pfamPath = path.resolve(value ?? "");
      index += 1;
    } else if (argument === "--pfam-report") {
      options.pfamReportPath = path.resolve(value ?? "");
      index += 1;
    } else if (argument === "--output") {
      options.outputPath = path.resolve(value ?? "");
      index += 1;
    } else if (argument === "--threshold") {
      options.threshold = parseUnitInterval(value, argument);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

async function readPfamMembersByRepresentative(reportPath) {
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const membersByRepresentative = new Map();
  for (const group of report.groups ?? []) {
    if (!group?.representative) continue;
    membersByRepresentative.set(
      group.representative,
      Array.isArray(group.members) && group.members.length > 0
        ? group.members
        : [group.representative]
    );
  }
  return membersByRepresentative;
}

function parseHeader(line, filePath) {
  const headers = line
    .replace(/^\uFEFF/, "")
    .split("\t")
    .map((header) => header.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length > 0) {
    throw new Error(`${filePath} is missing columns: ${missing.join(", ")}`);
  }
  return Object.fromEntries(
    REQUIRED_COLUMNS.map((column) => [column, headers.indexOf(column)])
  );
}

function normalizeKegg(value) {
  const normalized = value.trim().toUpperCase();
  return KEGG_PATTERN.test(normalized) ? normalized : null;
}

function normalizePfam(value) {
  const normalized = value.trim().toUpperCase();
  return PFAM_PATTERN.test(normalized) ? normalized.split(".")[0] : null;
}

async function scanOccurrenceSets(inputPath, normalizeName) {
  const reader = createInterface({
    input: createReadStream(inputPath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });
  const occurrenceSets = new Map();
  let indexes = null;
  let rowsRead = 0;
  let rowsUsed = 0;

  for await (const line of reader) {
    if (!line.trim()) continue;
    if (!indexes) {
      indexes = parseHeader(line, inputPath);
      continue;
    }

    rowsRead += 1;
    const fields = line.split("\t");
    const name = normalizeName(fields[indexes.gene_name] ?? "");
    const geneId = (fields[indexes.gene_id] ?? "").trim();
    const genomeId = (fields[indexes.genome_id] ?? "").trim();
    if (!name || !geneId || !genomeId) continue;

    const occurrenceKey = `${genomeId}\t${geneId}`;
    const set = occurrenceSets.get(name) ?? new Set();
    const sizeBefore = set.size;
    set.add(occurrenceKey);
    if (set.size > sizeBefore) rowsUsed += 1;
    occurrenceSets.set(name, set);
  }

  if (!indexes) throw new Error(`${inputPath} does not contain a header.`);
  return { occurrenceSets, rowsRead, rowsUsed };
}

function intersectionSize(setA, setB) {
  const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  let intersection = 0;
  for (const value of smaller) {
    if (larger.has(value)) intersection += 1;
  }
  return intersection;
}

function unionOccurrenceSets(sets) {
  const union = new Set();
  for (const set of sets) {
    for (const value of set) union.add(value);
  }
  return union;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));

  console.log(`Reading KO coordinates: ${options.keggPath}`);
  const keggScan = await scanOccurrenceSets(options.keggPath, normalizeKegg);
  console.log(`Reading merged Pfam coordinates: ${options.pfamPath}`);
  const pfamScan = await scanOccurrenceSets(options.pfamPath, normalizePfam);
  console.log(`Reading Pfam merge report: ${options.pfamReportPath}`);
  const pfamMembersByRepresentative = await readPfamMembersByRepresentative(
    options.pfamReportPath
  );

  const pairs = [];
  for (const [koId, koOccurrences] of keggScan.occurrenceSets.entries()) {
    for (const [pfamRepresentative, pfamOccurrences] of pfamScan.occurrenceSets.entries()) {
      const intersection = intersectionSize(koOccurrences, pfamOccurrences);
      if (intersection === 0) continue;
      const union = koOccurrences.size + pfamOccurrences.size - intersection;
      const coverageKoByPfam = intersection / koOccurrences.size;
      const coveragePfamByKo = intersection / pfamOccurrences.size;
      const maxCoverage = Math.max(coverageKoByPfam, coveragePfamByKo);
      if (maxCoverage < options.threshold) continue;

      pairs.push({
        koId,
        pfamRepresentative,
        pfamMembers: pfamMembersByRepresentative.get(pfamRepresentative) ?? [
          pfamRepresentative
        ],
        koCount: koOccurrences.size,
        pfamCount: pfamOccurrences.size,
        intersection,
        union,
        jaccard: union > 0 ? intersection / union : 0,
        coverageKoByPfam,
        coveragePfamByKo,
        maxCoverage
      });
    }
  }

  pairs.sort(
    (a, b) =>
      a.koId.localeCompare(b.koId) ||
      b.maxCoverage - a.maxCoverage ||
      b.jaccard - a.jaccard ||
      a.pfamRepresentative.localeCompare(b.pfamRepresentative)
  );

  const pfamByKo = {};
  for (const pair of pairs) {
    const rows = pfamByKo[pair.koId] ?? [];
    rows.push(pair);
    pfamByKo[pair.koId] = rows;
  }

  const combinedByKo = {};
  for (const [koId, matchedPairs] of Object.entries(pfamByKo)) {
    const koOccurrences = keggScan.occurrenceSets.get(koId);
    if (!koOccurrences) continue;
    const pfamRepresentatives = matchedPairs.map((pair) => pair.pfamRepresentative);
    const combinedPfamOccurrences = unionOccurrenceSets(
      pfamRepresentatives
        .map((representative) => pfamScan.occurrenceSets.get(representative))
        .filter(Boolean)
    );
    const intersection = intersectionSize(koOccurrences, combinedPfamOccurrences);
    const union = koOccurrences.size + combinedPfamOccurrences.size - intersection;
    combinedByKo[koId] = {
      koId,
      pfamRepresentatives,
      pfamMembers: [
        ...new Set(
          matchedPairs.flatMap((pair) => pair.pfamMembers ?? [pair.pfamRepresentative])
        )
      ],
      koCount: koOccurrences.size,
      pfamCount: combinedPfamOccurrences.size,
      intersection,
      union,
      jaccard: union > 0 ? intersection / union : 0,
      coverageKoByPfam:
        koOccurrences.size > 0 ? intersection / koOccurrences.size : 0,
      coveragePfamByKo:
        combinedPfamOccurrences.size > 0 ? intersection / combinedPfamOccurrences.size : 0,
      maxCoverage:
        Math.max(
          koOccurrences.size > 0 ? intersection / koOccurrences.size : 0,
          combinedPfamOccurrences.size > 0
            ? intersection / combinedPfamOccurrences.size
            : 0
        )
    };
  }

  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await writeFile(
    options.outputPath,
    JSON.stringify(
      {
        schemaVersion: 2,
        generatedAt: new Date().toISOString(),
        occurrenceDefinition: "unique genome_id + gene_id",
        sourceFiles: {
          kegg: path.basename(options.keggPath),
          pfam: path.basename(options.pfamPath),
          pfamReport: path.basename(options.pfamReportPath)
        },
        threshold: options.threshold,
        thresholdMetric: "maxCoverage",
        thresholdRule:
          "merged reciprocal-coverage Pfam groups are retained when KO coverage by Pfam or Pfam coverage by KO is at least threshold",
        summary: {
          keggRows: keggScan.rowsRead,
          keggOccurrenceRowsUsed: keggScan.rowsUsed,
          keggGroups: keggScan.occurrenceSets.size,
          pfamRows: pfamScan.rowsRead,
          pfamOccurrenceRowsUsed: pfamScan.rowsUsed,
          pfamGroups: pfamScan.occurrenceSets.size,
          matchedKeggGroups: Object.keys(pfamByKo).length,
          matchedPairs: pairs.length
        },
        pfamByKo,
        combinedByKo,
        pairs
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`Wrote ${options.outputPath}`);
  console.log(
    `${Object.keys(pfamByKo).length} KO IDs have ${pairs.length} merged Pfam-group matches at either-side coverage >= ${options.threshold}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
