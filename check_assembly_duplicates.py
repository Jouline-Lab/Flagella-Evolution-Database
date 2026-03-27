"""Check for duplicate assembly IDs in the TSV file."""
from collections import Counter

tsv_path = "public/flagellar_genes_phyletic_distribution.tsv"

with open(tsv_path, "r", encoding="utf-8") as f:
    lines = f.readlines()

data_rows = lines[1:]  # Exclude header
total_rows = len(data_rows)
assemblies = [line.split("\t")[0].strip() for line in data_rows]
unique_assemblies = len(set(assemblies))
duplicates = total_rows - unique_assemblies

print(f"Total data rows (excl. header): {total_rows}")
print(f"Unique assembly IDs: {unique_assemblies}")
print(f"Duplicate rows: {duplicates}")

if duplicates > 0:
    counts = Counter(assemblies)
    dups = [(a, c) for a, c in counts.items() if c > 1]
    dups.sort(key=lambda x: -x[1])
    print("\nExample assembly IDs with occurrence counts (up to 10):")
    for a, c in dups[:10]:
        print(f"  {a}: {c}")
