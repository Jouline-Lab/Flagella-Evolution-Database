# Scripts overview

These Node and Python utilities turn raw tables and assets under `public/` into JSON (or other files) that the Next.js app loads at runtime. Run them from the **repository root** after changing the corresponding source data.

Typical order when refreshing the main phyletic TSV (`public/flagellar_genes_phyletic_distribution.tsv`):

1. `npm run build:taxonomy-index`
2. `npm run build:species-flagella-index`
3. `npm run build:gene-profiles-index`
4. Optionally: `npm run split-large-alignments` (only if you add oversized FASTAs)
5. Optionally: `npm run precompute:gene-logos` (sequence logos on gene pages)

---

## Node scripts (`*.mjs`)

| Script | npm command | Primary inputs | Primary outputs | Role |
|--------|-------------|----------------|-----------------|------|
| `build-taxonomy-index.mjs` | `npm run build:taxonomy-index` | `public/flagellar_genes_phyletic_distribution.tsv` (needs columns `phylum` … `species`) | `public/taxonomy-index.json` | Collects unique taxonomy paths for browsing/filtering. |
| `build-species-flagella-index.mjs` | `npm run build:species-flagella-index` | Same TSV | `public/species-flagella-index.json` | Per-species gene presence, counts, and paired GTDB/NCBI IDs for each gene column. Used for species pages and for matching gene rows to alignment headers. |
| `build-gene-profiles-index.mjs` | `npm run build:gene-profiles-index` | TSV, `public/representative-species.json`, `public/operon_coords/*.tsv`, `public/alignments/*.fasta` | `public/gene-profiles.json`, **`public/alignments-index.json`** | Builds each gene’s profile (prevalence, category text, top neighbors from operon coords, representative IDs, alignment filename hint). **Also lists every `.fasta` in `public/alignments/`** into `alignments-index.json` so the browser can resolve `{GeneName}_*.fasta` by prefix. |
| `split-large-alignments.mjs` | `npm run split-large-alignments` | `public/alignments/*.fasta` | New `*.part001.fasta`, … (and removes originals unless `--keep-original`) | Splits files **≥ 100 MiB** into ~50 MiB chunks at FASTA record boundaries for Git hosting. Skips files under 100 MiB and skips names that already look like `*.partNNN.fasta`. Flags: `--dry-run`, `--keep-original`; optional path argument to process one file. |
| `precompute-gene-logos.mjs` | `npm run precompute:gene-logos` | `public/gene-profiles.json`, `public/alignments-index.json`, alignment FASTAs | `public/precomputed-logos/{slug}.json` | For each gene, loads the same FASTA set as the site (including parts), computes **per-column** gap percentage and amino-acid counts. The app uses this for the **sequence logo** and gap filtering without loading the full MSA. **Keep column math aligned with `src/lib/sequenceLogoMath.ts`** (comments in the script refer to this). |
| `check-assembly-duplicates.mjs` | `npm run check-assembly-duplicates` | `public/flagellar_genes_phyletic_distribution.tsv` | _(console only)_ | Reports duplicate values in the first column (assembly ID), useful for data QA. |
| `build-flagella-svg-labels.mjs` | `npm run build:flagella-svg-labels` | `public/Flagella_figure.svg` (default) | `public/Flagella_figure.labeled.svg`, `public/Flagella_figure.label-map.json` | Post-processes the flagella diagram SVG: associates text labels with nearby shapes and writes a labeled copy plus a JSON map. CLI: `--input`, `--output`, `--map-output`. |

All `.mjs` scripts use `process.cwd()` as the project root; paths are written relative to that.

---

## Python script

| File | npm | Role |
|------|-----|------|
| `split_coords_into_assemblies.py` | _(run with Python; not wired in `package.json`)_ | Splits a single large operon/coordinate TSV into **one TSV per assembly** using a mapping file (`assembly`, `genome_id` where `genome_id` matches contig IDs in the main file). Intended output layout matches `public/operon_coords/` used by `build-gene-profiles-index.mjs`. The `main` block at the bottom contains **author-specific absolute paths**; edit those (or import `split_main_tsv_by_assembly` from another driver) before running. Requires `pandas`. |

---

## Relationship to the app

- **Gene pages** read `gene-profiles.json`, `alignments-index.json`, optional `precomputed-logos/{slug}.json`, and fetch alignment FASTA only when the user requests species rows (streaming match by GTDB ID in headers).
- **Species / taxonomy** views consume `species-flagella-index.json` and `taxonomy-index.json`.
- After you change TSVs, SVG sources, or alignment files, rerun the relevant scripts and commit the updated `public/*.json` (and any new FASTA parts or precompute JSON) so production stays in sync.

If you introduce new file formats or column layouts, update both the affected script(s) and any matching logic in `src/lib/` (for example `browserGenes.ts`, `sequenceLogoMath.ts`, or parsers in components).
