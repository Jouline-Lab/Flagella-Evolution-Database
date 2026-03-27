#!/usr/bin/env node
/** Check for duplicate assembly IDs in the TSV file. */
import { createReadStream } from "fs";
import { createInterface } from "readline";

const tsvPath = "public/flagellar_genes_phyletic_distribution.tsv";

const assemblies = [];
const rl = createInterface({
  input: createReadStream(tsvPath),
  crlfDelay: Infinity,
});

let isHeader = true;
for await (const line of rl) {
  if (isHeader) {
    isHeader = false;
    continue;
  }
  const assembly = line.split("\t")[0]?.trim() ?? "";
  if (assembly) assemblies.push(assembly);
}

const totalRows = assemblies.length;
const uniqueSet = new Set(assemblies);
const uniqueCount = uniqueSet.size;
const duplicates = totalRows - uniqueCount;

// Count occurrences
const counts = new Map();
for (const a of assemblies) {
  counts.set(a, (counts.get(a) || 0) + 1);
}

const dupsList = [...counts.entries()]
  .filter(([, c]) => c > 1)
  .sort((a, b) => b[1] - a[1]);

console.log(`Total data rows (excl. header): ${totalRows}`);
console.log(`Unique assembly IDs: ${uniqueCount}`);
console.log(`Duplicate rows: ${duplicates}`);

if (duplicates > 0) {
  console.log("\nExample assembly IDs with occurrence counts (up to 10):");
  for (const [id, count] of dupsList.slice(0, 10)) {
    console.log(`  ${id}: ${count}`);
  }
}
