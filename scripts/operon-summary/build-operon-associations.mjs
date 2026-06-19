/**
 * Build static operon association data for the /operon-summary page.
 *
 * Prerequisites: node scripts/operon-summary/build-operon-cache.mjs
 *
 * Run: node scripts/operon-summary/build-operon-associations.mjs
 *
 * Writes public/operon-summary/operon-associations-bundle.json (gitignored).
 */
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

const CACHE_DIR = path.join(process.cwd(), "public", "operon-summary");
const CACHE_PATH = path.join(CACHE_DIR, "pair-occurrences-cache.jsonl");
const CACHE_META_PATH = path.join(CACHE_DIR, "pair-occurrences-cache.meta.json");
const TSV_PATH = path.join(process.cwd(), "public", "flagellar_genes_phyletic_distribution.tsv");
const OUT_PATH = path.join(CACHE_DIR, "operon-associations-bundle.json");

const THRESHOLD_STEPS = [500];
const MIN_FLAGELLAR_GENE_COUNT = 25;

function undirectedKey(a, b) {
  return a <= b ? `${a}\t${b}` : `${b}\t${a}`;
}

function formatPhylumLabel(phylumId) {
  return phylumId.replace(/^p__/, "").replace(/_/g, " ") || phylumId;
}

function addEdgePhylumAssembly(store, edgeKey, phylum, assembly) {
  if (!assembly || !phylum || phylum === "Unknown") {
    return;
  }
  let phylumMap = store.get(edgeKey);
  if (!phylumMap) {
    phylumMap = new Map();
    store.set(edgeKey, phylumMap);
  }
  let assemblies = phylumMap.get(phylum);
  if (!assemblies) {
    assemblies = new Set();
    phylumMap.set(phylum, assemblies);
  }
  assemblies.add(assembly);
}

function isEligibleAssembly(assembly, assemblyMeta) {
  const meta = assemblyMeta.get(assembly);
  return Boolean(
    meta &&
      meta.phylum &&
      meta.phylum !== "Unknown" &&
      meta.flagellarGeneCount >= MIN_FLAGELLAR_GENE_COUNT
  );
}

function buildPhylumAssemblyTotals(occurrences, assemblyMeta) {
  const sets = new Map();
  for (const occ of occurrences) {
    if (!occ.assembly || !isEligibleAssembly(occ.assembly, assemblyMeta)) {
      continue;
    }
    const phylum = assemblyMeta.get(occ.assembly).phylum;
    const assemblySet = sets.get(phylum) ?? new Set();
    assemblySet.add(occ.assembly);
    sets.set(phylum, assemblySet);
  }
  return new Map([...sets.entries()].map(([phylum, assemblies]) => [phylum, assemblies.size]));
}

function phylumPrevalenceList(phylumAssemblyMap, phylumTotals) {
  const rates = [];
  for (const [phylum, assemblies] of phylumAssemblyMap.entries()) {
    const phylumTotal = phylumTotals.get(phylum) ?? 0;
    if (phylumTotal <= 0) {
      continue;
    }
    const assembliesWithEdge = assemblies.size;
    if (assembliesWithEdge <= 0) {
      continue;
    }
    rates.push({
      phylum,
      assembliesWithEdge,
      phylumTotal,
      percent: (100 * assembliesWithEdge) / phylumTotal
    });
  }

  rates.sort(
    (a, b) =>
      b.percent - a.percent ||
      b.assembliesWithEdge - a.assembliesWithEdge ||
      a.phylum.localeCompare(b.phylum)
  );

  return rates.map(({ phylum, assembliesWithEdge, phylumTotal }) => [
    phylum,
    assembliesWithEdge,
    phylumTotal
  ]);
}

function buildGenePresenceByPhylum(assemblyMeta, phylumTotals) {
  const genePresence = new Map();
  for (const [assembly, meta] of assemblyMeta.entries()) {
    if (
      !meta.phylum ||
      meta.phylum === "Unknown" ||
      meta.flagellarGeneCount < MIN_FLAGELLAR_GENE_COUNT ||
      !phylumTotals.has(meta.phylum)
    ) {
      continue;
    }

    for (const gene of meta.genes) {
      let phylumMap = genePresence.get(gene);
      if (!phylumMap) {
        phylumMap = new Map();
        genePresence.set(gene, phylumMap);
      }
      let assemblies = phylumMap.get(meta.phylum);
      if (!assemblies) {
        assemblies = new Set();
        phylumMap.set(meta.phylum, assemblies);
      }
      assemblies.add(assembly);
    }
  }
  return genePresence;
}

function intersectionSize(a, b) {
  if (!a || !b) {
    return 0;
  }
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let count = 0;
  for (const value of small) {
    if (large.has(value)) {
      count += 1;
    }
  }
  return count;
}

function buildOpportunityPrevalenceMap(edgePhylumAssemblies, genePresenceByPhylum) {
  return Object.fromEntries(
    [...edgePhylumAssemblies.entries()].map(([edgeKey, phylumAssemblies]) => {
      const [source, target] = edgeKey.split("\t");
      const opportunityCounts = new Map();
      const sourcePhyla = genePresenceByPhylum.get(source) ?? new Map();
      const targetPhyla = genePresenceByPhylum.get(target) ?? new Map();
      const phyla = new Set([...sourcePhyla.keys(), ...targetPhyla.keys()]);

      for (const phylum of phyla) {
        const opportunityCount = intersectionSize(sourcePhyla.get(phylum), targetPhyla.get(phylum));
        if (opportunityCount > 0) {
          opportunityCounts.set(phylum, opportunityCount);
        }
      }

      const rows = [...opportunityCounts.entries()]
        .map(([phylum, opportunityCount]) => {
          const assembliesWithEdge = phylumAssemblies.get(phylum)?.size ?? 0;
          return [phylum, assembliesWithEdge, opportunityCount];
        })
        .filter(([, , opportunityCount]) => opportunityCount > 0)
        .sort((a, b) => {
          const percentA = a[2] > 0 ? (100 * a[1]) / a[2] : 0;
          const percentB = b[2] > 0 ? (100 * b[1]) / b[2] : 0;
          return percentB - percentA || b[1] - a[1] || a[0].localeCompare(b[0]);
        });

      return [edgeKey, rows];
    })
  );
}

function buildSummaryFromCounts(
  undirectedCounts,
  directedCounts,
  geneNeighborCounts,
  threshold,
  meta,
  undirectedGapSums = new Map(),
  directedGapSums = new Map()
) {
  const undirected = [];
  for (const [key, count] of undirectedCounts.entries()) {
    const [source, target] = key.split("\t");
    const averageGapBp = count > 0 ? (undirectedGapSums.get(key) ?? 0) / count : 0;
    undirected.push({ source, target, count, averageGapBp });
  }
  undirected.sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));

  const directed = [];
  for (const [key, count] of directedCounts.entries()) {
    const [source, target] = key.split("\t");
    const averageGapBp = count > 0 ? (directedGapSums.get(key) ?? 0) / count : 0;
    directed.push({ source, target, count, averageGapBp });
  }
  directed.sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));

  let pairOccurrences = 0;
  for (const count of undirectedCounts.values()) {
    pairOccurrences += count;
  }

  return {
    thresholdBp: threshold,
    assembliesScanned: meta.assembliesScanned,
    assembliesWithCoords: meta.assembliesWithCoords,
    pairOccurrences,
    undirected,
    directed,
    geneNeighborCounts: Object.fromEntries(geneNeighborCounts.entries())
  };
}

function aggregateAtThreshold(occurrences, threshold, assemblyMeta, phylumAssemblyTotals) {
  const undirectedCounts = new Map();
  const directedCounts = new Map();
  const undirectedGapSums = new Map();
  const directedGapSums = new Map();
  const geneNeighborCounts = new Map();
  const undirectedPhylumAssemblies = new Map();
  const directedPhylumAssemblies = new Map();
  const phylumUndirected = new Map();
  const phylumDirected = new Map();
  const phylumUndirectedGapSums = new Map();
  const phylumDirectedGapSums = new Map();
  const phylumGeneNeighbors = new Map();

  for (const occ of occurrences) {
    if (occ.gap > threshold) continue;
    if (!isEligibleAssembly(occ.assembly, assemblyMeta)) continue;

    const phylum = assemblyMeta.get(occ.assembly).phylum;

    const uKey = undirectedKey(occ.geneA, occ.geneB);
    const dKey = `${occ.upstream}\t${occ.downstream}`;

    undirectedCounts.set(uKey, (undirectedCounts.get(uKey) ?? 0) + 1);
    directedCounts.set(dKey, (directedCounts.get(dKey) ?? 0) + 1);
    undirectedGapSums.set(uKey, (undirectedGapSums.get(uKey) ?? 0) + occ.gap);
    directedGapSums.set(dKey, (directedGapSums.get(dKey) ?? 0) + occ.gap);
    addEdgePhylumAssembly(undirectedPhylumAssemblies, uKey, phylum, occ.assembly);
    addEdgePhylumAssembly(directedPhylumAssemblies, dKey, phylum, occ.assembly);

    geneNeighborCounts.set(occ.geneA, (geneNeighborCounts.get(occ.geneA) ?? 0) + 1);
    geneNeighborCounts.set(occ.geneB, (geneNeighborCounts.get(occ.geneB) ?? 0) + 1);

    if (!phylumUndirected.has(phylum)) {
      phylumUndirected.set(phylum, new Map());
      phylumDirected.set(phylum, new Map());
      phylumUndirectedGapSums.set(phylum, new Map());
      phylumDirectedGapSums.set(phylum, new Map());
      phylumGeneNeighbors.set(phylum, new Map());
    }
    const pUndirected = phylumUndirected.get(phylum);
    const pDirected = phylumDirected.get(phylum);
    const pUndirectedGapSums = phylumUndirectedGapSums.get(phylum);
    const pDirectedGapSums = phylumDirectedGapSums.get(phylum);
    const pGeneNeighbors = phylumGeneNeighbors.get(phylum);
    pUndirected.set(uKey, (pUndirected.get(uKey) ?? 0) + 1);
    pDirected.set(dKey, (pDirected.get(dKey) ?? 0) + 1);
    pUndirectedGapSums.set(uKey, (pUndirectedGapSums.get(uKey) ?? 0) + occ.gap);
    pDirectedGapSums.set(dKey, (pDirectedGapSums.get(dKey) ?? 0) + occ.gap);
    pGeneNeighbors.set(occ.geneA, (pGeneNeighbors.get(occ.geneA) ?? 0) + 1);
    pGeneNeighbors.set(occ.geneB, (pGeneNeighbors.get(occ.geneB) ?? 0) + 1);
  }

  const edgePhylum = {
    undirected: Object.fromEntries(
      [...undirectedPhylumAssemblies.entries()].map(([edgeKey, phylumAssemblies]) => [
        edgeKey,
        phylumPrevalenceList(phylumAssemblies, phylumAssemblyTotals)
      ])
    ),
    directed: Object.fromEntries(
      [...directedPhylumAssemblies.entries()].map(([edgeKey, phylumAssemblies]) => [
        edgeKey,
        phylumPrevalenceList(phylumAssemblies, phylumAssemblyTotals)
      ])
    )
  };
  const genePresenceByPhylum = buildGenePresenceByPhylum(assemblyMeta, phylumAssemblyTotals);
  const edgeOpportunity = {
    undirected: buildOpportunityPrevalenceMap(
      undirectedPhylumAssemblies,
      genePresenceByPhylum
    ),
    directed: buildOpportunityPrevalenceMap(
      directedPhylumAssemblies,
      genePresenceByPhylum
    )
  };

  const phylumSummaries = {};
  for (const [phylum, counts] of phylumUndirected.entries()) {
    phylumSummaries[phylum] = buildSummaryFromCounts(
      counts,
      phylumDirected.get(phylum) ?? new Map(),
      phylumGeneNeighbors.get(phylum) ?? new Map(),
      threshold,
      { assembliesScanned: 0, assembliesWithCoords: phylumAssemblyTotals.get(phylum) ?? 0 },
      phylumUndirectedGapSums.get(phylum) ?? new Map(),
      phylumDirectedGapSums.get(phylum) ?? new Map()
    );
  }

  const phyla = [...phylumAssemblyTotals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([phylum, assembliesWithCoords]) => ({
      id: phylum,
      label: formatPhylumLabel(phylum),
      assembliesWithCoords
    }));

  return {
    summary: buildSummaryFromCounts(
      undirectedCounts,
      directedCounts,
      geneNeighborCounts,
      threshold,
      {
        assembliesScanned: 0,
        assembliesWithCoords: 0
      },
      undirectedGapSums,
      directedGapSums
    ),
    phylumSummaries,
    phyla,
    edgePhylum,
    edgeOpportunity
  };
}

async function loadAssemblyMetaMap() {
  if (!existsSync(TSV_PATH)) {
    throw new Error(`Missing taxonomy TSV: ${TSV_PATH}`);
  }

  const map = new Map();
  const stream = createReadStream(TSV_PATH, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let idxAssembly = -1;
  let idxPhylum = -1;
  let geneCountIndexes = [];
  let headers = [];

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (idxAssembly === -1) {
      headers = trimmed.split("\t");
      idxAssembly = headers.indexOf("assembly");
      idxPhylum = headers.indexOf("phylum");
      geneCountIndexes = headers
        .map((header, index) => (header.endsWith("_count") ? index : -1))
        .filter((index) => index >= 0);
      if (idxAssembly === -1 || idxPhylum === -1) {
        throw new Error("Phyletic distribution TSV must include assembly and phylum columns.");
      }
      if (geneCountIndexes.length === 0) {
        throw new Error("Phyletic distribution TSV must include *_count gene columns.");
      }
      continue;
    }

    const parts = trimmed.split("\t");
    const assembly = parts[idxAssembly]?.trim();
    const phylum = parts[idxPhylum]?.trim();
    if (assembly && phylum) {
      const genes = new Set();
      for (const index of geneCountIndexes) {
        const value = Number(parts[index]);
        if (Number.isFinite(value) && value > 0) {
          genes.add(headers[index].replace(/_count$/, ""));
        }
      }
      map.set(assembly, { phylum, flagellarGeneCount: genes.size, genes });
    }
  }

  return map;
}

async function loadOccurrencesFromCache() {
  if (!existsSync(CACHE_PATH)) {
    throw new Error(
      `Missing ${CACHE_PATH}. Run: node scripts/operon-summary/build-operon-cache.mjs`
    );
  }

  const metaRaw = await readFile(CACHE_META_PATH, "utf8");
  const meta = JSON.parse(metaRaw);

  const occurrences = [];
  const stream = createReadStream(CACHE_PATH, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("\t");
    if (parts.length < 5) continue;
    const gap = Number(parts[2]);
    if (!Number.isFinite(gap)) continue;
    occurrences.push({
      geneA: parts[0],
      geneB: parts[1],
      gap,
      upstream: parts[3],
      downstream: parts[4],
      assembly: parts[5]?.trim() ?? ""
    });
  }

  return {
    occurrences,
    assembliesScanned: meta.assembliesScanned ?? 0,
    assembliesWithCoords: meta.assembliesWithCoords ?? 0,
    scannedAt: meta.scannedAt ?? Date.now()
  };
}

const assemblyMeta = await loadAssemblyMetaMap();
console.log(`Loaded taxonomy/gene counts for ${assemblyMeta.size.toLocaleString()} assemblies.`);

const cache = await loadOccurrencesFromCache();
const phylumAssemblyTotals = buildPhylumAssemblyTotals(cache.occurrences, assemblyMeta);
const eligibleAssemblyCount = [...phylumAssemblyTotals.values()].reduce((sum, count) => sum + count, 0);
console.log(
  `Using ${eligibleAssemblyCount.toLocaleString()} cached assemblies with at least ${MIN_FLAGELLAR_GENE_COUNT} flagellar genes.`
);
const summaries = {};
const phylumSummariesByThreshold = {};
const edgePhylumByThreshold = {};
const edgeOpportunityByThreshold = {};
let phyla = [];

for (const threshold of THRESHOLD_STEPS) {
  const aggregated = aggregateAtThreshold(
    cache.occurrences,
    threshold,
    assemblyMeta,
    phylumAssemblyTotals
  );
  aggregated.summary.assembliesScanned = cache.assembliesScanned;
  aggregated.summary.assembliesWithCoords = cache.assembliesWithCoords;
  summaries[String(threshold)] = aggregated.summary;
  phylumSummariesByThreshold[String(threshold)] = aggregated.phylumSummaries;
  edgePhylumByThreshold[String(threshold)] = aggregated.edgePhylum;
  edgeOpportunityByThreshold[String(threshold)] = aggregated.edgeOpportunity;
  phyla = aggregated.phyla;
  console.log(
    `threshold ${String(threshold).padStart(4)} bp: ${aggregated.summary.pairOccurrences.toLocaleString()} instances, ${aggregated.summary.undirected.length} undirected edges, ${phyla.length} phyla`
  );
}

const bundle = {
  assembliesScanned: cache.assembliesScanned,
  assembliesWithCoords: cache.assembliesWithCoords,
  minFlagellarGeneCount: MIN_FLAGELLAR_GENE_COUNT,
  eligibleAssembliesWithMinFlagellarGenes: eligibleAssemblyCount,
  scannedAt: cache.scannedAt,
  thresholds: THRESHOLD_STEPS,
  summaries,
  phyla,
  phylumSummaries: phylumSummariesByThreshold,
  edgePhylumByThreshold,
  edgeOpportunityByThreshold
};

await mkdir(CACHE_DIR, { recursive: true });
await writeFile(OUT_PATH, JSON.stringify(bundle), "utf8");

console.log(`Wrote ${OUT_PATH}`);
