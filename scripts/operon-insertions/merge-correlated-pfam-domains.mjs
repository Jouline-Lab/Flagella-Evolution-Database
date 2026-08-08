/**
 * Detect redundant Pfam models by protein-level occurrence overlap and write a
 * deduplicated coordinate file in which correlated models share one
 * representative accession.
 *
 * The merge core is intentionally fixed-point/agglomerative: start with every
 * Pfam model as a singleton cluster, repeatedly merge the strongest eligible
 * cluster pair, recompute overlap against the new union, and stop only when no
 * candidate pair passes the merge gates.
 *
 * Usage:
 *   npm run merge:pfam-insertion-domains
 *
 * Optional:
 *   --input <file>                     Source Pfam coordinate TSV
 *   --output <file>                    Merged coordinate TSV
 *   --report <file>                    Pairwise-overlap and merge-group JSON
 *   --threshold <0..1>                 Alias for --coverage-threshold
 *   --coverage-threshold <0..1>        Minimum reciprocal pair coverage (default: 0.7)
 *   --min-intersection <count>         Minimum shared proteins (default: 10)
 *   --representative-strategy <mode>   central or largest (default: central)
 */
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

const DEFAULT_INPUT = path.join(
  process.cwd(),
  "public",
  "flagellar_genes_homologs_June5_neighbors_db_pfam_top100_coordinates.tsv"
);
const DEFAULT_OUTPUT = path.join(
  process.cwd(),
  "public",
  "operon-insertions",
  "pfam-top100-merged90-coordinates.tsv"
);
const DEFAULT_REPORT = path.join(
  process.cwd(),
  "public",
  "operon-insertions",
  "pfam-domain-overlap-groups.json"
);
const REQUIRED_COLUMNS = ["gene_name", "gene_id", "genome_id", "start", "stop", "strand"];
const PFAM_PATTERN = /^PF\d{5}(?:\.\d+)?$/i;
const REPRESENTATIVE_STRATEGIES = new Set(["central", "largest"]);
const EPSILON = 1e-12;

function parseUnitInterval(value, argument) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error(`${argument} must be between 0 and 1.`);
  }
  return number;
}

function parseArguments(argv) {
  const options = {
    inputPath: DEFAULT_INPUT,
    outputPath: DEFAULT_OUTPUT,
    reportPath: DEFAULT_REPORT,
    coverageThreshold: 0.7,
    minIntersection: 10,
    representativeStrategy: "central"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--input") {
      options.inputPath = path.resolve(value ?? "");
      index += 1;
    } else if (argument === "--output") {
      options.outputPath = path.resolve(value ?? "");
      index += 1;
    } else if (argument === "--report") {
      options.reportPath = path.resolve(value ?? "");
      index += 1;
    } else if (argument === "--threshold" || argument === "--coverage-threshold") {
      options.coverageThreshold = parseUnitInterval(value, argument);
      index += 1;
    } else if (argument === "--min-intersection") {
      options.minIntersection = Number(value);
      index += 1;
    } else if (argument === "--representative-strategy") {
      options.representativeStrategy = String(value ?? "").toLowerCase();
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!Number.isInteger(options.minIntersection) || options.minIntersection < 1) {
    throw new Error("--min-intersection must be a positive integer.");
  }
  if (!REPRESENTATIVE_STRATEGIES.has(options.representativeStrategy)) {
    throw new Error(
      `--representative-strategy must be one of: ${[...REPRESENTATIVE_STRATEGIES].join(", ")}.`
    );
  }
  return options;
}

function normalizePfam(value) {
  const normalized = value.trim().toUpperCase();
  return PFAM_PATTERN.test(normalized) ? normalized.split(".")[0] : null;
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
  return {
    headers,
    indexes: Object.fromEntries(
      REQUIRED_COLUMNS.map((column) => [column, headers.indexOf(column)])
    )
  };
}

function pairKey(a, b) {
  return a < b ? `${a}\t${b}` : `${b}\t${a}`;
}

function clusterPairKey(a, b) {
  return a < b ? `${a}\t${b}` : `${b}\t${a}`;
}

async function scanOccurrences(inputPath) {
  const reader = createInterface({
    input: createReadStream(inputPath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });
  let indexes = null;
  let rowsRead = 0;
  let duplicateDomainRows = 0;
  const occurrenceIdByKey = new Map();
  const domainOccurrences = new Map();

  for await (const line of reader) {
    if (!line.trim()) continue;
    if (!indexes) {
      ({ indexes } = parseHeader(line, inputPath));
      continue;
    }

    rowsRead += 1;
    const fields = line.split("\t");
    const domain = normalizePfam(fields[indexes.gene_name] ?? "");
    const geneId = (fields[indexes.gene_id] ?? "").trim();
    const genomeId = (fields[indexes.genome_id] ?? "").trim();
    if (!domain || !geneId || !genomeId) continue;

    const occurrenceKey = `${genomeId}\t${geneId}`;
    let occurrenceId = occurrenceIdByKey.get(occurrenceKey);
    if (occurrenceId === undefined) {
      occurrenceId = occurrenceIdByKey.size;
      occurrenceIdByKey.set(occurrenceKey, occurrenceId);
    }

    const occurrences = domainOccurrences.get(domain) ?? new Set();
    const sizeBefore = occurrences.size;
    occurrences.add(occurrenceId);
    if (occurrences.size === sizeBefore) duplicateDomainRows += 1;
    domainOccurrences.set(domain, occurrences);
  }
  if (!indexes) throw new Error(`${inputPath} does not contain a header.`);

  const domainCounts = new Map(
    [...domainOccurrences.entries()].map(([domain, occurrences]) => [
      domain,
      occurrences.size
    ])
  );

  return {
    rowsRead,
    uniqueProteinOccurrences: occurrenceIdByKey.size,
    duplicateDomainRows,
    domainOccurrences,
    domainCounts
  };
}

function intersectionSize(setA, setB) {
  const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  let intersection = 0;
  for (const value of smaller) {
    if (larger.has(value)) intersection += 1;
  }
  return intersection;
}

function unionOccurrenceSets(setA, setB) {
  const [larger, smaller] = setA.size >= setB.size ? [setA, setB] : [setB, setA];
  const union = new Set(larger);
  for (const value of smaller) union.add(value);
  return union;
}

function compareOccurrenceSets(labelA, labelB, occurrencesA, occurrencesB) {
  const countA = occurrencesA.size;
  const countB = occurrencesB.size;
  const intersection = intersectionSize(occurrencesA, occurrencesB);
  const union = countA + countB - intersection;
  const coverageAByB = countA > 0 ? intersection / countA : 0;
  const coverageBByA = countB > 0 ? intersection / countB : 0;
  const maxCoverage = Math.max(coverageAByB, coverageBByA);
  const reciprocalCoverage = Math.min(coverageAByB, coverageBByA);

  return {
    domainA: labelA,
    domainB: labelB,
    countA,
    countB,
    intersection,
    union,
    jaccard: union > 0 ? intersection / union : 0,
    coverageAByB,
    coverageBByA,
    overlapCoefficient:
      Math.min(countA, countB) > 0 ? intersection / Math.min(countA, countB) : 0,
    maxCoverage,
    reciprocalCoverage
  };
}

function buildPairReport(scan) {
  const domains = [...scan.domainOccurrences.keys()].sort((a, b) => a.localeCompare(b));
  const pairs = [];
  const pairByKey = new Map();

  for (let left = 0; left < domains.length; left += 1) {
    for (let right = left + 1; right < domains.length; right += 1) {
      const domainA = domains[left];
      const domainB = domains[right];
      const pair = compareOccurrenceSets(
        domainA,
        domainB,
        scan.domainOccurrences.get(domainA),
        scan.domainOccurrences.get(domainB)
      );
      pairs.push(pair);
      pairByKey.set(pairKey(domainA, domainB), pair);
    }
  }

  return { domains, pairs, pairByKey };
}

function passesMergeGate(metrics, options) {
  return (
    metrics.intersection >= options.minIntersection &&
    metrics.reciprocalCoverage >= options.coverageThreshold
  );
}

function allMemberPairsPassMergeGate(left, right, pairByKey, options) {
  for (const leftMember of left.members) {
    for (const rightMember of right.members) {
      const pair = pairByKey.get(pairKey(leftMember, rightMember));
      if (!pair || !passesMergeGate(pair, options)) return false;
    }
  }
  return true;
}

function compareCandidateRank(candidate, best) {
  if (!best) return -1;
  const candidateMetrics = candidate.metrics;
  const bestMetrics = best.metrics;
  const rankingFields = [
    candidateMetrics.jaccard - bestMetrics.jaccard,
    candidateMetrics.maxCoverage - bestMetrics.maxCoverage,
    candidateMetrics.reciprocalCoverage - bestMetrics.reciprocalCoverage,
    candidateMetrics.intersection - bestMetrics.intersection,
    bestMetrics.union - candidateMetrics.union
  ];

  for (const difference of rankingFields) {
    if (Math.abs(difference) > EPSILON) return difference > 0 ? -1 : 1;
  }

  const candidateLabel = `${candidate.leftLabel}\t${candidate.rightLabel}`;
  const bestLabel = `${best.leftLabel}\t${best.rightLabel}`;
  return candidateLabel.localeCompare(bestLabel);
}

function createCluster(id, members, occurrences, children = []) {
  return {
    id,
    active: true,
    members,
    occurrences,
    children,
    label: members.join("+")
  };
}

function buildClusterCandidate(left, right, pairByKey, options) {
  const metrics = compareOccurrenceSets(
    left.label,
    right.label,
    left.occurrences,
    right.occurrences
  );
  return {
    leftId: left.id,
    rightId: right.id,
    leftLabel: left.label,
    rightLabel: right.label,
    metrics,
    eligible: allMemberPairsPassMergeGate(left, right, pairByKey, options)
  };
}

function buildRecursiveClusters(scan, pairReport, options) {
  const clusters = new Map();
  const activeIds = new Set();
  const candidates = new Map();
  const mergeSteps = [];
  let nextClusterId = 1;

  for (const domain of pairReport.domains) {
    const cluster = createCluster(
      nextClusterId,
      [domain],
      scan.domainOccurrences.get(domain)
    );
    clusters.set(cluster.id, cluster);
    activeIds.add(cluster.id);
    nextClusterId += 1;
  }

  function addCandidate(leftId, rightId) {
    const left = clusters.get(leftId);
    const right = clusters.get(rightId);
    const key = clusterPairKey(leftId, rightId);
    candidates.set(
      key,
      buildClusterCandidate(left, right, pairReport.pairByKey, options)
    );
  }

  const initialIds = [...activeIds];
  for (let left = 0; left < initialIds.length; left += 1) {
    for (let right = left + 1; right < initialIds.length; right += 1) {
      addCandidate(initialIds[left], initialIds[right]);
    }
  }

  while (activeIds.size > 1) {
    let best = null;
    for (const candidate of candidates.values()) {
      const left = clusters.get(candidate.leftId);
      const right = clusters.get(candidate.rightId);
      if (!left?.active || !right?.active || !candidate.eligible) continue;
      if (compareCandidateRank(candidate, best) < 0) best = candidate;
    }
    if (!best) break;

    const left = clusters.get(best.leftId);
    const right = clusters.get(best.rightId);
    left.active = false;
    right.active = false;
    activeIds.delete(left.id);
    activeIds.delete(right.id);

    for (const [key, candidate] of candidates.entries()) {
      if (
        candidate.leftId === left.id ||
        candidate.rightId === left.id ||
        candidate.leftId === right.id ||
        candidate.rightId === right.id
      ) {
        candidates.delete(key);
      }
    }

    const mergedMembers = [...left.members, ...right.members].sort((a, b) =>
      a.localeCompare(b)
    );
    const mergedCluster = createCluster(
      nextClusterId,
      mergedMembers,
      unionOccurrenceSets(left.occurrences, right.occurrences),
      [left.id, right.id]
    );
    clusters.set(mergedCluster.id, mergedCluster);
    activeIds.add(mergedCluster.id);
    nextClusterId += 1;

    mergeSteps.push({
      step: mergeSteps.length + 1,
      leftMembers: left.members,
      rightMembers: right.members,
      mergedMembers,
      countA: best.metrics.countA,
      countB: best.metrics.countB,
      intersection: best.metrics.intersection,
      unionBeforeMerge: best.metrics.union,
      mergedOccurrenceCount: mergedCluster.occurrences.size,
      jaccard: best.metrics.jaccard,
      coverageAByB: best.metrics.coverageAByB,
      coverageBByA: best.metrics.coverageBByA,
      maxCoverage: best.metrics.maxCoverage,
      reciprocalCoverage: best.metrics.reciprocalCoverage
    });

    for (const activeId of activeIds) {
      if (activeId !== mergedCluster.id) addCandidate(mergedCluster.id, activeId);
    }
  }

  return {
    clusters: [...activeIds].map((id) => clusters.get(id)),
    mergeSteps
  };
}

function pairMetricFor(member, other, pairByKey) {
  if (member === other) {
    return {
      jaccard: 1,
      memberCoverage: 1,
      otherCoverage: 1,
      maxCoverage: 1,
      reciprocalCoverage: 1
    };
  }
  const pair = pairByKey.get(pairKey(member, other));
  if (!pair) {
    return {
      jaccard: 0,
      memberCoverage: 0,
      otherCoverage: 0,
      maxCoverage: 0,
      reciprocalCoverage: 0
    };
  }
  const memberCoverage =
    member === pair.domainA ? pair.coverageAByB : pair.coverageBByA;
  const otherCoverage =
    member === pair.domainA ? pair.coverageBByA : pair.coverageAByB;
  return {
    jaccard: pair.jaccard,
    memberCoverage,
    otherCoverage,
    maxCoverage: pair.maxCoverage,
    reciprocalCoverage: pair.reciprocalCoverage
  };
}

function chooseRepresentative(members, scan, pairByKey, strategy) {
  if (members.length === 1) return members[0];
  if (strategy === "largest") {
    return [...members].sort(
      (a, b) =>
        scan.domainCounts.get(b) - scan.domainCounts.get(a) ||
        a.localeCompare(b)
    )[0];
  }

  let best = null;
  for (const member of members) {
    let centrality = 0;
    let jaccardSum = 0;
    let coverageSum = 0;
    for (const other of members) {
      if (member === other) continue;
      const metrics = pairMetricFor(member, other, pairByKey);
      jaccardSum += metrics.jaccard;
      coverageSum += metrics.maxCoverage;
      centrality += metrics.jaccard + metrics.reciprocalCoverage + 0.25 * metrics.maxCoverage;
    }
    const candidate = {
      member,
      centrality,
      jaccardSum,
      coverageSum,
      count: scan.domainCounts.get(member) ?? 0
    };
    if (
      !best ||
      candidate.centrality > best.centrality + EPSILON ||
      (Math.abs(candidate.centrality - best.centrality) <= EPSILON &&
        candidate.jaccardSum > best.jaccardSum + EPSILON) ||
      (Math.abs(candidate.centrality - best.centrality) <= EPSILON &&
        Math.abs(candidate.jaccardSum - best.jaccardSum) <= EPSILON &&
        candidate.coverageSum > best.coverageSum + EPSILON) ||
      (Math.abs(candidate.centrality - best.centrality) <= EPSILON &&
        Math.abs(candidate.jaccardSum - best.jaccardSum) <= EPSILON &&
        Math.abs(candidate.coverageSum - best.coverageSum) <= EPSILON &&
        candidate.count > best.count) ||
      (Math.abs(candidate.centrality - best.centrality) <= EPSILON &&
        Math.abs(candidate.jaccardSum - best.jaccardSum) <= EPSILON &&
        Math.abs(candidate.coverageSum - best.coverageSum) <= EPSILON &&
        candidate.count === best.count &&
        candidate.member.localeCompare(best.member) < 0)
    ) {
      best = candidate;
    }
  }
  return best.member;
}

function coverageByRepresentative(member, representative, pairByKey) {
  if (member === representative) return 1;
  return pairMetricFor(member, representative, pairByKey).memberCoverage;
}

function summarizeGroup(cluster, scan, pairReport, options) {
  const representative = chooseRepresentative(
    cluster.members,
    scan,
    pairReport.pairByKey,
    options.representativeStrategy
  );
  const memberSet = new Set(cluster.members);
  const withinPairs = pairReport.pairs.filter(
    (pair) => memberSet.has(pair.domainA) && memberSet.has(pair.domainB)
  );
  const sortedMembers = [...cluster.members].sort(
    (a, b) =>
      (a === representative ? -1 : b === representative ? 1 : 0) ||
      coverageByRepresentative(b, representative, pairReport.pairByKey) -
        coverageByRepresentative(a, representative, pairReport.pairByKey) ||
      (scan.domainCounts.get(b) ?? 0) - (scan.domainCounts.get(a) ?? 0) ||
      a.localeCompare(b)
  );

  return {
    representative,
    members: sortedMembers,
    memberCounts: Object.fromEntries(
      sortedMembers.map((member) => [member, scan.domainCounts.get(member)])
    ),
    occurrenceCountAfterMerge: cluster.occurrences.size,
    minimumWithinGroupJaccard:
      withinPairs.length > 0
        ? Math.min(...withinPairs.map((pair) => pair.jaccard))
        : 1,
    maximumWithinGroupJaccard:
      withinPairs.length > 0
        ? Math.max(...withinPairs.map((pair) => pair.jaccard))
        : 1,
    minimumWithinGroupOverlap:
      withinPairs.length > 0
        ? Math.min(...withinPairs.map((pair) => pair.overlapCoefficient))
        : 1,
    maximumWithinGroupOverlap:
      withinPairs.length > 0
        ? Math.max(...withinPairs.map((pair) => pair.overlapCoefficient))
        : 1,
    minimumWithinGroupReciprocalCoverage:
      withinPairs.length > 0
        ? Math.min(...withinPairs.map((pair) => pair.reciprocalCoverage))
        : 1,
    minimumMemberCoverageByRepresentative:
      sortedMembers.length > 1
        ? Math.min(
            ...sortedMembers
              .filter((member) => member !== representative)
              .map((member) =>
                coverageByRepresentative(member, representative, pairReport.pairByKey)
              )
          )
        : 1
  };
}

function buildOverlapReport(scan, options) {
  const pairReport = buildPairReport(scan);
  const clusterPlan = buildRecursiveClusters(scan, pairReport, options);
  const groups = clusterPlan.clusters
    .map((cluster) => summarizeGroup(cluster, scan, pairReport, options))
    .sort(
      (a, b) =>
        b.occurrenceCountAfterMerge - a.occurrenceCountAfterMerge ||
        a.representative.localeCompare(b.representative)
    );

  const representativeByDomain = Object.fromEntries(
    groups.flatMap((group) =>
      group.members.map((member) => [member, group.representative])
    )
  );

  return {
    domains: pairReport.domains,
    pairs: pairReport.pairs,
    groups,
    representativeByDomain,
    mergeSteps: clusterPlan.mergeSteps
  };
}

async function writeMergedCoordinates(inputPath, outputPath, representativeByDomain) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const reader = createInterface({
    input: createReadStream(inputPath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });
  const writer = createWriteStream(outputPath, { encoding: "utf8" });
  let indexes = null;
  let rowsWritten = 0;
  let duplicateRowsRemoved = 0;
  const seen = new Set();

  for await (const line of reader) {
    if (!line.trim()) continue;
    if (!indexes) {
      ({ indexes } = parseHeader(line, inputPath));
      writer.write(`${REQUIRED_COLUMNS.join("\t")}\n`);
      continue;
    }
    const fields = line.split("\t");
    const domain = normalizePfam(fields[indexes.gene_name] ?? "");
    if (!domain) continue;
    const representative = representativeByDomain[domain] ?? domain;
    const values = {
      gene_name: representative,
      gene_id: (fields[indexes.gene_id] ?? "").trim(),
      genome_id: (fields[indexes.genome_id] ?? "").trim(),
      start: (fields[indexes.start] ?? "").trim(),
      stop: (fields[indexes.stop] ?? "").trim(),
      strand: (fields[indexes.strand] ?? "").trim()
    };
    const deduplicationKey = `${representative}\t${values.genome_id}\t${values.gene_id}`;
    if (seen.has(deduplicationKey)) {
      duplicateRowsRemoved += 1;
      continue;
    }
    seen.add(deduplicationKey);
    writer.write(`${REQUIRED_COLUMNS.map((column) => values[column]).join("\t")}\n`);
    rowsWritten += 1;
  }
  await new Promise((resolve, reject) => {
    writer.end(resolve);
    writer.on("error", reject);
  });
  return { rowsWritten, duplicateRowsRemoved };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  console.log(`Scanning Pfam coordinates: ${options.inputPath}`);
  const scan = await scanOccurrences(options.inputPath);
  const overlap = buildOverlapReport(scan, options);
  const merged = await writeMergedCoordinates(
    options.inputPath,
    options.outputPath,
    overlap.representativeByDomain
  );
  const mergedGroups = overlap.groups.filter((group) => group.members.length > 1);

  await mkdir(path.dirname(options.reportPath), { recursive: true });
  const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    sourceFile: path.basename(options.inputPath),
    occurrenceDefinition: "unique genome_id + gene_id",
    clusteringMethod:
      "fixed-point agglomerative clustering; repeatedly merge the best cluster pair whose full set of raw Pfam member pairs passes the reciprocal coverage gate, and stop when no candidate passes all gates",
    similarityMetric:
      "raw Pfam model protein-occurrence reciprocal coverage; a merge passes only when every potential pair inside the resulting group has coverage of at least threshold from both sides",
    threshold: options.coverageThreshold,
    thresholds: {
      coverageThreshold: options.coverageThreshold,
      minIntersection: options.minIntersection
    },
    representativeStrategy: options.representativeStrategy,
    summary: {
      inputRows: scan.rowsRead,
      uniqueProteinOccurrences: scan.uniqueProteinOccurrences,
      duplicateDomainRows: scan.duplicateDomainRows,
      inputDomains: overlap.domains.length,
      outputDomains: overlap.groups.length,
      mergedGroups: mergedGroups.length,
      domainsAbsorbed: overlap.domains.length - overlap.groups.length,
      acceptedMergeSteps: overlap.mergeSteps.length,
      outputCoordinateRows: merged.rowsWritten,
      duplicateCoordinateRowsRemoved: merged.duplicateRowsRemoved
    },
    representativeByDomain: overlap.representativeByDomain,
    groups: overlap.groups,
    mergeSteps: overlap.mergeSteps,
    pairs: overlap.pairs
  };
  await writeFile(options.reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`Wrote ${options.outputPath}`);
  console.log(`Wrote ${options.reportPath}`);
  console.log(
    `${overlap.domains.length} input domains -> ${overlap.groups.length} merged domains; ` +
      `${merged.duplicateRowsRemoved} duplicate coordinate rows removed`
  );
  for (const group of mergedGroups) {
    console.log(
      `  ${group.representative}: ${group.members.join(", ")} ` +
        `(min member coverage ${group.minimumMemberCoverageByRepresentative.toFixed(3)}; ` +
        `min reciprocal pair coverage ${group.minimumWithinGroupReciprocalCoverage.toFixed(3)})`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
