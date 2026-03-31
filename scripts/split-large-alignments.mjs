import { createReadStream } from "node:fs";
import { readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const ALIGNMENTS_DIR = path.join(process.cwd(), "public", "alignments");
/** Only split files at or above this size (GitHub limit is 100MB). */
const SPLIT_THRESHOLD_BYTES = 100 * 1024 * 1024;
/** Target maximum UTF-8 size per chunk (split only at FASTA record boundaries). */
const TARGET_CHUNK_BYTES = 50 * 1024 * 1024;

function recordUtf8Bytes(lines) {
  return Buffer.byteLength(lines.join("\n") + "\n", "utf8");
}

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  const keepOriginal = argv.includes("--keep-original");
  const positional = argv.filter((a) => !a.startsWith("--"));
  return { dryRun, keepOriginal, onlyFile: positional[0] ?? null };
}

async function splitFastaFile(filePath, { dryRun, keepOriginal }) {
  const basename = path.basename(filePath);
  if (!basename.toLowerCase().endsWith(".fasta")) {
    return;
  }
  if (/\.part\d+\.fasta$/i.test(basename)) {
    console.log(`Skip (already a part file): ${basename}`);
    return;
  }

  const st = await stat(filePath);
  if (st.size < SPLIT_THRESHOLD_BYTES) {
    console.log(`Skip (<100MB): ${basename} (${(st.size / (1024 * 1024)).toFixed(1)} MiB)`);
    return;
  }

  const dir = path.dirname(filePath);
  const baseNoExt = basename.replace(/\.fasta$/i, "");
  console.log(`Splitting: ${basename} (${(st.size / (1024 * 1024)).toFixed(1)} MiB)`);

  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  let partNum = 1;
  /** @type {string[][]} */
  let chunk = [];
  let chunkBytes = 0;

  async function writePartFromChunk() {
    if (chunk.length === 0) {
      return;
    }
    const text = chunk.map((rec) => rec.join("\n")).join("\n") + "\n";
    const outName = `${baseNoExt}.part${String(partNum).padStart(3, "0")}.fasta`;
    const outPath = path.join(dir, outName);
    const bytes = Buffer.byteLength(text, "utf8");
    if (!dryRun) {
      await writeFile(outPath, text, "utf8");
    }
    console.log(`  → ${outName} (${chunk.length} sequence(s), ${(bytes / (1024 * 1024)).toFixed(1)} MiB)`);
    partNum += 1;
    chunk = [];
    chunkBytes = 0;
  }

  async function addRecord(rec) {
    const sz = recordUtf8Bytes(rec);
    if (sz > TARGET_CHUNK_BYTES) {
      if (chunk.length > 0) {
        await writePartFromChunk();
      }
      const text = rec.join("\n") + "\n";
      const outName = `${baseNoExt}.part${String(partNum).padStart(3, "0")}.fasta`;
      const outPath = path.join(dir, outName);
      if (!dryRun) {
        await writeFile(outPath, text, "utf8");
      }
      console.log(
        `  → ${outName} (single sequence >50 MiB, ${(Buffer.byteLength(text, "utf8") / (1024 * 1024)).toFixed(1)} MiB)`
      );
      partNum += 1;
      return;
    }
    if (chunkBytes + sz > TARGET_CHUNK_BYTES && chunk.length > 0) {
      await writePartFromChunk();
    }
    chunk.push(rec);
    chunkBytes += sz;
  }

  let current = [];
  for await (const line of rl) {
    if (line.startsWith(">")) {
      if (current.length > 0) {
        await addRecord(current);
      }
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    await addRecord(current);
  }

  await writePartFromChunk();

  if (dryRun) {
    console.log(`  (dry-run: original not removed)`);
    return;
  }
  if (keepOriginal) {
    console.log(`  Kept original (--keep-original): ${basename}`);
    return;
  }
  await unlink(filePath);
  console.log(`  Removed original: ${basename}`);
}

async function main() {
  const { dryRun, keepOriginal, onlyFile } = parseArgs(process.argv.slice(2));

  if (dryRun) {
    console.log("Dry run: no files written, originals kept.\n");
  }

  let targets;
  if (onlyFile) {
    const resolved = path.isAbsolute(onlyFile) ? onlyFile : path.join(process.cwd(), onlyFile);
    targets = [resolved];
  } else {
    const names = await readdir(ALIGNMENTS_DIR);
    targets = names
      .filter((n) => n.toLowerCase().endsWith(".fasta"))
      .filter((n) => !n.startsWith("."))
      .map((n) => path.join(ALIGNMENTS_DIR, n));
  }

  for (const filePath of targets) {
    try {
      await splitFastaFile(filePath, { dryRun, keepOriginal });
    } catch (err) {
      console.error(`Error processing ${filePath}:`, err);
      process.exitCode = 1;
    }
  }

  console.log("\nRe-run: npm run build:gene-profiles-index  (refreshes public/alignments-index.json)");
}

main();
