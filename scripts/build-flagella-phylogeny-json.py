# -*- coding: utf-8 -*-
"""
Rebuilds the "Flagella Phylogeny" dataset JSONs consumed by the phyletic
distribution page (src/components/gene-visualization), keeping each
resolution's row order in sync with its paired Newick tree.

Four resolutions are supported -- family, order, class, phylum -- each with
its own rooted tree whose leaf names are taxonomic strings at that rank
(e.g. "o__Enterobacterales" for order, "p__Proteobacteria" for phylum). For
each resolution, this script takes the full GTDB lineage table
(public/GTDB214_lineage_ordered.json) and keeps only the records whose
matching rank field (order/class/family/phylum) equals a tree leaf, sorted
into that same leaf order.

None of the tree topologies are built here -- each comes from an external
phylogenetics pipeline (37-gene alignment -> coverage/alpha filtering ->
neighbor-joining -> rooting) and only needs to be dropped into public/ as:

    flagella_phylogeny_<resolution>_rooted_for_visualization.tree

Run with no arguments to (re)build every resolution that has a tree file
present in public/ (resolutions without one are skipped with a message);
pass --level to build just one.

Rerun this whenever a new/updated .tree file is dropped into public/, so
the accompanying .json stays aligned with it.

Requires: biopython (`pip install biopython`)
"""

import argparse
import json
from pathlib import Path
from typing import Dict, List

from Bio import Phylo

REPO_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DIR = REPO_ROOT / "public"

RESOLUTIONS = ["family", "order", "class", "phylum"]


def tree_path_for(level: str) -> Path:
    return PUBLIC_DIR / f"flagella_phylogeny_{level}_rooted_for_visualization.tree"


def output_path_for(level: str) -> Path:
    return PUBLIC_DIR / f"flagella_phylogeny_{level}_rooted_for_visualization.json"


def extract_leaf_order_from_newick(newick_path: Path) -> List[str]:
    """Parse a Newick tree and return leaf names in left-to-right tree order."""
    tree = Phylo.read(str(newick_path), "newick")
    return [leaf.name.split()[0] for leaf in tree.get_terminals()]


def reorder_by_level_field(records: List[Dict], ordered_ids: List[str], level: str) -> List[Dict]:
    """
    Keep only records whose taxonomic `level` field matches a tree leaf name,
    sorted into that same leaf order.
    """
    order_index = {taxon: i for i, taxon in enumerate(ordered_ids)}
    return sorted(
        (r for r in records if r.get(level) in order_index),
        key=lambda r: order_index[r[level]],
    )


def build_one(level: str, records: List[Dict]) -> None:
    tree_path = tree_path_for(level)
    if not tree_path.exists():
        print(f"[{level}] skipped: no tree file at {tree_path.relative_to(REPO_ROOT)}")
        return

    ordered_ids = extract_leaf_order_from_newick(tree_path)
    print(f"[{level}] parsed {len(ordered_ids)} leaf names from {tree_path.name}")

    reordered = reorder_by_level_field(records, ordered_ids, level)
    print(f"[{level}] filtered + reordered to {len(reordered)} records matching tree leaf order")

    output_path = output_path_for(level)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(reordered, f, indent=2)
    print(f"[{level}] wrote {output_path.relative_to(REPO_ROOT)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--lineage-json",
        type=Path,
        default=PUBLIC_DIR / "GTDB214_lineage_ordered.json",
        help="Base GTDB lineage table to filter/reorder "
             "(default: public/GTDB214_lineage_ordered.json).",
    )
    parser.add_argument(
        "--level",
        choices=RESOLUTIONS,
        default=None,
        help="Build only this resolution. Default: build every resolution that "
             "has a tree file present in public/.",
    )
    args = parser.parse_args()

    with args.lineage_json.open("r", encoding="utf-8") as f:
        records = json.load(f)
    print(f"Loaded {len(records)} records from {args.lineage_json.name}")

    for level in [args.level] if args.level else RESOLUTIONS:
        build_one(level, records)


if __name__ == "__main__":
    main()
