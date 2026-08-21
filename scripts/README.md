# Scripts overview

These Node and Python utilities turn raw tables and assets under `public/` into JSON (or other files) that the Next.js app loads at runtime. Run them from the **repository root** after changing the corresponding source data.

Typical order when refreshing the main phyletic TSV (`public/flagellar_genes_phyletic_distribution.tsv`):

1. `npm run build:taxonomy-index`
2. `npm run build:species-flagella-index`
3. `npm run build:gene-profiles-index`
4. `npm run build:home-stats`
5. Optionally: `npm run split-large-alignments` (only if you add oversized FASTAs)
6. Optionally: `npm run precompute:gene-logos` (sequence logos on gene pages)

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
| `build-home-stats.mjs` | `npm run build:home-stats` | `public/flagellar_genes_phyletic_distribution.tsv` | `public/home-stats.json` | Precomputes homepage summary statistics from TSV columns (total protein sequences from `*_count` sums, unique genes from number of `*_count` columns, bacterial assembly count from `domain`), plus row-level QA counts for non-zero coverage. |

All `.mjs` scripts use `process.cwd()` as the project root; paths are written relative to that.

---

## Python scripts

| File | npm | Role |
|------|-----|------|
| `split_coords_into_assemblies.py` | _(run with Python; not wired in `package.json`)_ | Splits a single large operon/coordinate TSV into **one TSV per assembly** using a mapping file (`assembly`, `genome_id` where `genome_id` matches contig IDs in the main file). Intended output layout matches `public/operon_coords/` used by `build-gene-profiles-index.mjs`. The `main` block at the bottom contains **author-specific absolute paths**; edit those (or import `split_main_tsv_by_assembly` from another driver) before running. Requires `pandas`. |
| `build-flagella-phylogeny-json.py` | `python scripts/build-flagella-phylogeny-json.py` | Builds the **"Flagella Phylogeny"** dataset JSONs — one per taxonomic resolution (`family`, `order`, `class`, `phylum`) registered in `DATASETS`/`DATASET_TREE_FILE` (`src/lib/visualization/config.ts`) — keeping each one's row order in sync with its paired tree. For each resolution it parses `public/flagella_phylogeny_<level>_rooted_for_visualization.tree` (Newick, leaves named by that taxonomic rank, e.g. `o__Enterobacterales` for order, `p__Proteobacteria` for phylum) with Biopython, then filters `GTDB214_lineage_ordered.json` down to records whose matching rank field equals a leaf and sorts them into that leaf order, writing `public/flagella_phylogeny_<level>_rooted_for_visualization.json`. With no flags it (re)builds every resolution that has a tree file present in `public/`, skipping ones that don't; pass `--level family\|order\|class\|phylum` to build just one. Does **not** build the trees themselves — those come from an external phylogenetics pipeline (37-gene alignment → coverage/alpha filtering → neighbor-joining → rooting) that must drop the `.tree` file(s) into `public/` first, named per the convention above. **Rerun this whenever a `.tree` file is added or replaced**, or the paired dataset JSON's ordering will drift out of sync with the tree drawn above it. Flags: `--lineage-json`, `--level`. Requires `biopython`. |
| `operon-insertions/build-insertion-neighbor-associations.mjs` | `npm run build:operon-insertions -- --reference <flagellar.tsv-or-directory> --insertions <insertions.tsv> --max-distance 500` | Two coordinate datasets containing `gene_name`, `gene_id`, `genome_id`, `start`, `stop`, and `strand`; the reference may be one TSV or a directory of TSVs | `public/operon-insertions/insertion-neighbor-associations.json` | Finds the nearest reference feature on each genomic side of every insertion, converts sides to transcriptional upstream/downstream using insertion strand, and summarizes counts and distance statistics for the experimental `/operon-insertions` page. |

---

## Relationship to the app

- **Gene pages** read `gene-profiles.json`, `alignments-index.json`, optional `precomputed-logos/{slug}.json`, and fetch alignment FASTA only when the user requests species rows (streaming match by GTDB ID in headers).
- **Species / taxonomy** views consume `species-flagella-index.json` and `taxonomy-index.json`.
- **Homepage stats** read `home-stats.json` (build with `npm run build:home-stats` after updating the main phyletic TSV).
- **Phyletic distribution page** (`src/components/gene-visualization`) reads dataset JSON/`.tree` pairs registered in `DATASETS`/`DATASET_TREE_FILE` (`src/lib/visualization/config.ts`); the four "Flagella Phylogeny" datasets (family/order/class/phylum resolution) have their JSON built with `build-flagella-phylogeny-json.py`.
- After you change TSVs, SVG sources, alignment files, or swap in a new `.tree` file, rerun the relevant scripts and commit the updated `public/*.json` (and any new FASTA parts or precompute JSON) so production stays in sync.

If you introduce new file formats or column layouts, update both the affected script(s) and any matching logic in `src/lib/` (for example `browserGenes.ts`, `sequenceLogoMath.ts`, or parsers in components).
