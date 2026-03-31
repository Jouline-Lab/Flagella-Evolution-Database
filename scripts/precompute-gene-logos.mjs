/**
 * Precomputes per-column MSA stats for the sequence logo (gap %, residue counts, alignment column index).
 * Keep column math in sync with src/lib/sequenceLogoMath.ts
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const GENE_PROFILES_PATH = path.join(ROOT, "public", "gene-profiles.json");
const ALIGNMENTS_INDEX_PATH = path.join(ROOT, "public", "alignments-index.json");
const ALIGNMENTS_DIR = path.join(ROOT, "public", "alignments");
const OUTPUT_DIR = path.join(ROOT, "public", "precomputed-logos");

const STANDARD_AMINO_ACIDS = "ACDEFGHIKLMNPQRSTVWY";
const PART_SUFFIX_RE = /\.part(\d+)\.fasta$/i;

function parseFastaBasic(fastaText) {
  const lines = fastaText.split(/\r?\n/).filter((line) => line.trim());
  const sequences = [];
  let currentHeader = "";
  let currentSequence = "";

  for (const line of lines) {
    if (line.startsWith(">")) {
      if (currentHeader && currentSequence) {
        sequences.push({
          header: currentHeader.substring(1),
          sequence: currentSequence
        });
      }
      currentHeader = line;
      currentSequence = "";
      continue;
    }
    currentSequence += line.trim();
  }
  if (currentHeader && currentSequence) {
    sequences.push({
      header: currentHeader.substring(1),
      sequence: currentSequence
    });
  }
  return sequences;
}

function alignmentPartNumber(filename) {
  const m = filename.match(PART_SUFFIX_RE);
  return m ? Number.parseInt(m[1], 10) : 0;
}

function stemKeyForPartFile(filename) {
  return filename.replace(PART_SUFFIX_RE, ".fasta");
}

function resolveAlignmentBasenames(geneName, files) {
  const prefix = `${geneName.toLowerCase()}_`;
  const matches = files.filter((filename) => filename.toLowerCase().startsWith(prefix));
  if (matches.length === 0) {
    return [];
  }

  const partFiles = matches.filter((f) => PART_SUFFIX_RE.test(f));
  if (partFiles.length > 0) {
    const byStem = new Map();
    for (const f of partFiles) {
      const stem = stemKeyForPartFile(f);
      const list = byStem.get(stem) ?? [];
      list.push(f);
      byStem.set(stem, list);
    }
    const stems = [...byStem.keys()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    const group = byStem.get(stems[0]) ?? [];
    group.sort((a, b) => alignmentPartNumber(a) - alignmentPartNumber(b));
    return group;
  }

  matches.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return [matches[0]];
}

function buildAlignmentColumnStats(sequences) {
  if (sequences.length === 0) {
    return [];
  }

  const n = sequences.length;
  const maxLength = Math.max(...sequences.map((s) => s.sequence.length));
  const stats = [];

  for (let col = 0; col < maxLength; col += 1) {
    const residueCounts = {};
    let gapCount = 0;

    for (const seq of sequences) {
      const residue = seq.sequence[col]?.toUpperCase() ?? "-";
      if (STANDARD_AMINO_ACIDS.includes(residue)) {
        residueCounts[residue] = (residueCounts[residue] || 0) + 1;
      } else {
        gapCount += 1;
      }
    }

    stats.push({
      alignmentColumn: col + 1,
      gapPercentage: (gapCount / n) * 100,
      residueCounts,
      gapCount,
      totalSequences: n
    });
  }

  return stats;
}

async function loadSequencesForGene(geneName, alignmentFilenames) {
  const basenames = resolveAlignmentBasenames(geneName, alignmentFilenames);
  if (basenames.length === 0) {
    return { sequences: [], sourceFiles: [] };
  }

  const chunks = [];
  for (const basename of basenames) {
    const filePath = path.join(ALIGNMENTS_DIR, basename);
    const text = await readFile(filePath, "utf8");
    chunks.push(text);
  }

  const sequences = parseFastaBasic(chunks.join("\n"));
  return { sequences, sourceFiles: basenames };
}

async function main() {
  const [profilesRaw, indexRaw] = await Promise.all([
    readFile(GENE_PROFILES_PATH, "utf8"),
    readFile(ALIGNMENTS_INDEX_PATH, "utf8")
  ]);

  const profiles = JSON.parse(profilesRaw);
  const index = JSON.parse(indexRaw);
  const alignmentFilenames = Array.isArray(index.files) ? index.files : [];

  if (!Array.isArray(profiles.genes)) {
    throw new Error("gene-profiles.json: missing genes array");
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  let written = 0;
  let skippedNoAlignment = 0;

  for (const gene of profiles.genes) {
    const name = gene.name;
    const slug = gene.slug;
    if (!name || !slug) {
      // eslint-disable-next-line no-console
      console.warn("Skip gene row missing name or slug:", gene);
      continue;
    }

    const { sequences, sourceFiles } = await loadSequencesForGene(name, alignmentFilenames);
    if (sequences.length === 0) {
      skippedNoAlignment += 1;
      continue;
    }

    const alignmentColumns = buildAlignmentColumnStats(sequences);
    const payload = {
      version: 1,
      geneName: name,
      geneSlug: slug,
      sourceAlignmentFiles: sourceFiles,
      totalSequences: sequences.length,
      alignmentColumns,
      generatedAt: new Date().toISOString()
    };

    const outPath = path.join(OUTPUT_DIR, `${slug}.json`);
    await writeFile(outPath, JSON.stringify(payload));
    written += 1;
    // eslint-disable-next-line no-console
    console.log(`${slug}.json — ${sequences.length} sequences, ${alignmentColumns.length} columns`);
  }

  // eslint-disable-next-line no-console
  console.log(`\nWrote ${written} file(s) to ${OUTPUT_DIR}`);
  // eslint-disable-next-line no-console
  console.log(`Skipped (no alignment match): ${skippedNoAlignment}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
