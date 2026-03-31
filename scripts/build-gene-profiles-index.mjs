import { createReadStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const TSV_FILENAME = "flagellar_genes_phyletic_distribution.tsv";
const TSV_PATH = path.join(process.cwd(), "public", TSV_FILENAME);
const OUTPUT_PATH = path.join(process.cwd(), "public", "gene-profiles.json");
const REPRESENTATIVE_SPECIES_PATH = path.join(process.cwd(), "public", "representative-species.json");
const OPERON_COORDS_DIR = path.join(process.cwd(), "public", "operon_coords");
const ALIGNMENTS_DIR = path.join(process.cwd(), "public", "alignments");
const ALIGNMENTS_INDEX_PATH = path.join(process.cwd(), "public", "alignments-index.json");
const NEIGHBOR_DISTANCE_BP = 500;

const EXCLUDED_CORE_GENE_NAMES = new Set([
  "flhe",
  "flhc",
  "flhd",
  "flgq",
  "flaf",
  "flbt",
  "flgo",
  "flgp"
]);

const regulationGenes = new Set([
  "flia",
  "fliz",
  "flhc",
  "flhd",
  "fleq",
  "flra",
  "flrb",
  "flrc",
  "rflm"
]);
const chaperoneGenes = new Set(["flis", "flit", "flgn", "flga"]);
const motorGenes = new Set(["mota", "motb", "motx", "moty", "flig", "flim", "flin", "fliy"]);
const exportGenes = new Set(["flha", "flhb", "flip", "fliq", "flir", "flio", "flih", "flij"]);
const filamentGenes = new Set(["flic", "flid", "flik", "flif", "flbg", "flad", "flaf"]);

function normalizeGeneName(value) {
  return value.replace(/_count$/i, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function formatSpeciesName(value) {
  return value.replace(/^[a-z]__/i, "").trim();
}

function normalizeSpeciesName(value) {
  return formatSpeciesName(value).toLowerCase().trim();
}

function speciesNameToSlug(name) {
  return formatSpeciesName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-") || "species";
}

function geneNameToSlug(value) {
  return (value ?? "")
    .replace(/_count$/i, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function classifyGene(geneName) {
  const gene = normalizeGeneName(geneName);
  if (regulationGenes.has(gene)) return "Regulation";
  if (chaperoneGenes.has(gene)) return "Chaperones & assembly factors";
  if (motorGenes.has(gene)) return "Motor & switch";
  if (exportGenes.has(gene)) return "Export apparatus";
  if (filamentGenes.has(gene)) return "Filament & junction";
  if (gene.startsWith("flg")) return "Basal body & hook";
  if (gene.startsWith("fli") || gene.startsWith("flh") || gene.startsWith("mot")) {
    return "Flagellar structural proteins";
  }
  return "Other flagella-associated genes";
}

function getGeneKnownFunctionSummary(geneName) {
  const category = classifyGene(geneName);

  switch (category) {
    case "Basal body & hook":
      return "This gene is grouped with basal body and hook-associated flagellar components in the current dataset.";
    case "Motor & switch":
      return "This gene is grouped with flagellar motor and switch-associated components in the current dataset.";
    case "Export apparatus":
      return "This gene is grouped with the flagellar export apparatus in the current dataset.";
    case "Filament & junction":
      return "This gene is grouped with filament and junction-associated flagellar components in the current dataset.";
    case "Regulation":
      return "This gene is grouped with flagellar regulatory components in the current dataset.";
    case "Chaperones & assembly factors":
      return "This gene is grouped with flagellar chaperones and assembly factors in the current dataset.";
    case "Flagellar structural proteins":
      return "This gene is grouped with flagellar structural proteins in the current dataset.";
    default:
      return "This gene is grouped as another flagella-associated component in the current dataset.";
  }
}

function getGeneComponentLabel(geneName) {
  return EXCLUDED_CORE_GENE_NAMES.has(normalizeGeneName(geneName))
    ? "Auxiliary/Acquired component"
    : "Ancestral component";
}

function parseIds(rawValue) {
  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value && value !== "-");
}

function buildGeneDefs(headers) {
  const map = new Map();

  headers.forEach((rawHeader, idx) => {
    const header = (rawHeader ?? "").trim();

    if (header.endsWith("_count")) {
      const geneName = header.replace(/_count$/i, "");
      const def = map.get(geneName) ?? { name: geneName, index: -1, gtdbIdx: [], ncbiIdx: [] };
      def.index = idx;
      map.set(geneName, def);
      return;
    }

    if (header.includes("_GTDB_")) {
      const geneName = header.split("_GTDB_")[0];
      const def = map.get(geneName) ?? { name: geneName, index: -1, gtdbIdx: [], ncbiIdx: [] };
      def.gtdbIdx.push(idx);
      map.set(geneName, def);
      return;
    }

    if (header.includes("_NCBI_")) {
      const geneName = header.split("_NCBI_")[0];
      const def = map.get(geneName) ?? { name: geneName, index: -1, gtdbIdx: [], ncbiIdx: [] };
      def.ncbiIdx.push(idx);
      map.set(geneName, def);
    }
  });

  return Array.from(map.values())
    .filter((def) => def.index >= 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function loadRepresentativeSpecies() {
  if (!existsSync(REPRESENTATIVE_SPECIES_PATH)) {
    return [];
  }

  const raw = await readFile(REPRESENTATIVE_SPECIES_PATH, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.species) ? parsed.species : [];
}

async function loadAlignmentFiles() {
  if (!existsSync(ALIGNMENTS_DIR)) {
    return [];
  }

  const filenames = await readdir(ALIGNMENTS_DIR);
  return filenames
    .filter((filename) => !filename.startsWith("."))
    .filter((filename) => filename.toLowerCase().endsWith(".fasta"))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function getAlignmentFileForGene(geneName, alignmentFiles) {
  const lowerGeneName = geneName.toLowerCase();
  const match = alignmentFiles.find((filename) =>
    filename.toLowerCase().startsWith(`${lowerGeneName}_`)
  );
  return match ?? null;
}

function parseOperonRows(tsv) {
  const lines = tsv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return [];
  }

  const headers = lines[0].split("\t").map((value) => value.trim().toLowerCase());
  const idxGeneName = headers.indexOf("gene_name");
  const idxContig = headers.indexOf("genome_id");
  const idxStart = headers.indexOf("start");
  const idxStop = headers.indexOf("stop");
  const idxStrand = headers.indexOf("strand");

  if (idxGeneName === -1 || idxContig === -1 || idxStart === -1 || idxStop === -1) {
    return [];
  }

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split("\t");
    const geneName = parts[idxGeneName]?.trim() ?? "";
    const contig = parts[idxContig]?.trim() ?? "";
    const start = Number(parts[idxStart] ?? "");
    const stop = Number(parts[idxStop] ?? "");
    const strandRaw = idxStrand !== -1 ? Number(parts[idxStrand] ?? "") : 1;
    const strand = strandRaw === -1 ? -1 : 1;

    if (!geneName || !contig || !Number.isFinite(start) || !Number.isFinite(stop)) {
      continue;
    }

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

async function buildNeighborIndex() {
  const neighborCountsByGene = new Map();

  if (!existsSync(OPERON_COORDS_DIR)) {
    return neighborCountsByGene;
  }

  const filenames = await readdir(OPERON_COORDS_DIR);

  for (const filename of filenames) {
    if (!filename.endsWith(".tsv")) {
      continue;
    }

    const filePath = path.join(OPERON_COORDS_DIR, filename);
    const raw = await readFile(filePath, "utf8");
    const rows = parseOperonRows(raw);
    const byContigStrand = new Map();

    for (const row of rows) {
      const key = `${row.contig}\t${row.strand}`;
      const existing = byContigStrand.get(key) ?? [];
      existing.push(row);
      byContigStrand.set(key, existing);
    }

    for (const contigRows of byContigStrand.values()) {
      const sorted = [...contigRows].sort((a, b) => a.start - b.start || a.stop - b.stop);

      for (let i = 0; i < sorted.length; i += 1) {
        const current = sorted[i];

        for (let j = i + 1; j < sorted.length; j += 1) {
          const candidate = sorted[j];
          const gapBp = Math.max(0, candidate.start - current.stop);

          if (gapBp > NEIGHBOR_DISTANCE_BP) {
            break;
          }

          if (!neighborCountsByGene.has(current.geneName)) {
            neighborCountsByGene.set(current.geneName, new Map());
          }
          if (!neighborCountsByGene.has(candidate.geneName)) {
            neighborCountsByGene.set(candidate.geneName, new Map());
          }

          const currentCounts = neighborCountsByGene.get(current.geneName);
          const candidateCounts = neighborCountsByGene.get(candidate.geneName);

          currentCounts.set(candidate.geneName, (currentCounts.get(candidate.geneName) ?? 0) + 1);
          candidateCounts.set(current.geneName, (candidateCounts.get(current.geneName) ?? 0) + 1);
        }
      }
    }
  }

  return neighborCountsByGene;
}

async function buildGeneProfilesIndex() {
  if (!existsSync(TSV_PATH)) {
    throw new Error(`TSV file not found: ${TSV_PATH}`);
  }

  const stream = createReadStream(TSV_PATH, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let totalAssemblies = 0;
  let headers = [];
  let speciesIdx = -1;
  let countColumns = [];
  let assemblyCounts = [];
  const representativeSpecies = await loadRepresentativeSpecies();
  const representativeSpeciesByName = new Map(
    representativeSpecies.map((species) => [normalizeSpeciesName(species.name), species])
  );
  const representativeGeneIdsBySpecies = new Map();

  for await (const line of rl) {
    if (!line.trim()) continue;

    if (countColumns.length === 0) {
      headers = line.split("\t");
      speciesIdx = headers.indexOf("species");
      if (speciesIdx === -1) {
        throw new Error("Column 'species' not found in TSV header.");
      }
      countColumns = buildGeneDefs(headers);
      assemblyCounts = new Array(countColumns.length).fill(0);
      continue;
    }

    totalAssemblies += 1;
    const values = line.split("\t");
    const speciesName = formatSpeciesName(values[speciesIdx] ?? "");
    const normalizedSpeciesName = normalizeSpeciesName(speciesName);
    const representativeSpeciesEntry = representativeSpeciesByName.get(normalizedSpeciesName);

    countColumns.forEach((column, columnIndex) => {
      const count = Number(values[column.index] ?? "");
      if (!Number.isNaN(count) && count > 0) {
        assemblyCounts[columnIndex] += 1;
      }

      if (!representativeSpeciesEntry) {
        return;
      }

      if (!representativeGeneIdsBySpecies.has(normalizedSpeciesName)) {
        representativeGeneIdsBySpecies.set(normalizedSpeciesName, new Map());
      }

      const geneIdsByGene = representativeGeneIdsBySpecies.get(normalizedSpeciesName);
      const geneIdEntry = geneIdsByGene.get(column.name) ?? {
        gtdbIds: new Set(),
        ncbiIds: new Set()
      };

      for (const idx of column.gtdbIdx) {
        for (const id of parseIds(values[idx] ?? "")) {
          geneIdEntry.gtdbIds.add(id);
        }
      }

      for (const idx of column.ncbiIdx) {
        for (const id of parseIds(values[idx] ?? "")) {
          geneIdEntry.ncbiIds.add(id);
        }
      }

      geneIdsByGene.set(column.name, geneIdEntry);
    });
  }

  const neighborCountsByGene = await buildNeighborIndex();
  const alignmentFiles = await loadAlignmentFiles();

  const genes = countColumns.map((column, columnIndex) => ({
    name: column.name,
    slug: geneNameToSlug(column.name),
    presentAssemblies: assemblyCounts[columnIndex] ?? 0,
    totalAssemblies,
    functionalCategory: classifyGene(column.name),
    knownFunctionSummary: getGeneKnownFunctionSummary(column.name),
    componentLabel: getGeneComponentLabel(column.name),
    alignmentFile: getAlignmentFileForGene(column.name, alignmentFiles),
    representativeSpecies: representativeSpecies.map((species) => {
      const normalizedSpeciesName = normalizeSpeciesName(species.name);
      const geneIdsByGene = representativeGeneIdsBySpecies.get(normalizedSpeciesName);
      const geneIds = geneIdsByGene?.get(column.name);

      return {
        name: species.name,
        slug: species.slug ?? speciesNameToSlug(species.name),
        assemblyCount: species.assemblyCount ?? 0,
        gtdbIds: geneIds ? Array.from(geneIds.gtdbIds).sort((a, b) => a.localeCompare(b)) : [],
        ncbiIds: geneIds ? Array.from(geneIds.ncbiIds).sort((a, b) => a.localeCompare(b)) : []
      };
    }),
    topNeighbors: Array.from(neighborCountsByGene.get(column.name)?.entries() ?? [])
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }))
  }));

  const payload = {
    version: 1,
    sourceTsv: TSV_FILENAME,
    genes
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(payload), "utf8");

  // eslint-disable-next-line no-console
  console.log(`Gene profiles index written: ${OUTPUT_PATH}`);
  // eslint-disable-next-line no-console
  console.log(`Genes indexed: ${genes.length}`);

  const alignmentIndex = {
    version: 1,
    files: alignmentFiles
  };
  await writeFile(ALIGNMENTS_INDEX_PATH, JSON.stringify(alignmentIndex, null, 2), "utf8");
  // eslint-disable-next-line no-console
  console.log(`Alignments index written: ${ALIGNMENTS_INDEX_PATH} (${alignmentFiles.length} .fasta files)`);
}

buildGeneProfilesIndex().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
