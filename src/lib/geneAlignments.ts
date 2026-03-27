import { readdir } from "node:fs/promises";
import path from "node:path";

const ALIGNMENTS_DIR = path.join(process.cwd(), "public", "alignments");

let cachedAlignmentFiles: string[] | null = null;

async function loadAlignmentFiles(forceRefresh = false): Promise<string[]> {
  if (cachedAlignmentFiles && !forceRefresh) {
    return cachedAlignmentFiles;
  }

  try {
    const filenames = await readdir(ALIGNMENTS_DIR);
    cachedAlignmentFiles = filenames.filter((filename) => !filename.startsWith("."));
    return cachedAlignmentFiles;
  } catch {
    cachedAlignmentFiles = [];
    return cachedAlignmentFiles;
  }
}

export async function getAlignmentPathForGene(geneName: string): Promise<string | null> {
  let filenames = await loadAlignmentFiles();
  const lowerGeneName = geneName.toLowerCase();
  let filename =
    filenames.find((item) => item.toLowerCase().startsWith(`${lowerGeneName}_`)) ?? null;

  if (!filename) {
    filenames = await loadAlignmentFiles(true);
    filename =
      filenames.find((item) => item.toLowerCase().startsWith(`${lowerGeneName}_`)) ?? null;
  }

  return filename ? `/alignments/${filename}` : null;
}
