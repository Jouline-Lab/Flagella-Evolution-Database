# -*- coding: utf-8 -*-
"""
Created on Sat Feb 28 22:47:15 2026

@author: selcuk.1
"""

import pandas as pd
from pathlib import Path

def load_contig_to_assembly_map(mapping_path, sep="\t") -> pd.DataFrame:
    """
    Mapping file must have exactly these columns (or at least these two):
      assembly   genome_id
    where genome_id == contig ID in your main coordinate TSV.
    Returns a DF with columns: ['assembly', 'genome_id'] (strings).
    """
    mapping_path = Path(mapping_path)
    m = pd.read_csv(mapping_path, sep=sep, dtype=str)

    required = {"assembly", "genome_id"}
    missing = required - set(m.columns)
    if missing:
        raise ValueError(f"Mapping file missing columns: {missing}. Found: {list(m.columns)}")

    m = m[["assembly", "genome_id"]].copy()
    m["assembly"] = m["assembly"].astype(str).str.strip()
    m["genome_id"] = m["genome_id"].astype(str).str.strip()

    # drop empties + deduplicate contigs (keep first)
    m = m[(m["assembly"] != "") & (m["genome_id"] != "")]
    m = m.drop_duplicates(subset=["genome_id"], keep="first").reset_index(drop=True)
    return m


def annotate_with_assembly(main_df: pd.DataFrame, contig_map_df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Adds 'assembly' column to main_df by mapping genome_id (contig) -> assembly.

    Returns:
      annotated_df, missing_contigs_df
    """
    df = main_df.copy()
    if "genome_id" not in df.columns:
        raise ValueError(f"main_df must contain a 'genome_id' column. Found: {list(df.columns)}")

    df["genome_id"] = df["genome_id"].astype(str).str.strip()

    annotated = df.merge(
        contig_map_df[["assembly", "genome_id"]],
        how="left",
        on="genome_id",
    )

    missing = (
        annotated.loc[annotated["assembly"].isna(), ["genome_id"]]
        .drop_duplicates()
        .rename(columns={"genome_id": "missing_contig_id"})
        .reset_index(drop=True)
    )
    return annotated, missing


def contigs_per_assembly(annotated_df: pd.DataFrame) -> pd.DataFrame:
    """
    Summary table:
      assembly | n_contigs | contig_list
    """
    if "assembly" not in annotated_df.columns:
        raise ValueError("annotated_df must have an 'assembly' column (run annotate_with_assembly first).")

    g = (
        annotated_df.dropna(subset=["assembly"])
        .groupby("assembly")["genome_id"]
        .unique()
        .reset_index()
    )
    g["n_contigs"] = g["genome_id"].apply(len)
    g["contig_list"] = g["genome_id"].apply(lambda xs: ",".join(sorted(xs)))
    return g[["assembly", "n_contigs", "contig_list"]].sort_values("n_contigs", ascending=False).reset_index(drop=True)


def split_main_tsv_by_assembly(
    main_tsv_path,
    mapping_path,
    out_dir,
    main_sep="\t",
    map_sep="\t",
    keep_unmapped=False,
    file_prefix="coords_",
):
    """
    Reads:
      - main coordinate TSV (must include genome_id column)
      - mapping TSV with columns: assembly, genome_id

    Writes one TSV per assembly:
      out_dir/assembly_<ASSEMBLY>.tsv

    Returns:
      annotated_df, summary_df, missing_df, written_files
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    main_df = pd.read_csv(main_tsv_path, sep=main_sep, dtype=str)
    contig_map_df = load_contig_to_assembly_map(mapping_path, sep=map_sep)

    annotated_df, missing_df = annotate_with_assembly(main_df, contig_map_df)
    summary_df = contigs_per_assembly(annotated_df)

    written_files = []
    for assembly, sub in annotated_df.dropna(subset=["assembly"]).groupby("assembly"):
        safe = str(assembly).replace("/", "_").replace(" ", "_")
        out_path = out_dir / f"{file_prefix}{safe}.tsv"
        sub.to_csv(out_path, sep="\t", index=False)
        written_files.append(str(out_path))

    if keep_unmapped:
        unmapped = annotated_df[annotated_df["assembly"].isna()].copy()
        if len(unmapped) > 0:
            out_path = out_dir / f"{file_prefix}UNMAPPED.tsv"
            unmapped.to_csv(out_path, sep="\t", index=False)
            written_files.append(str(out_path))

    return annotated_df, summary_df, missing_df, written_files

#%%
main_tsv = r"C:\Users\selcuk.1\OneDrive - The Ohio State University\Desktop\Flagella\operons\flagellar_genes_homologs_Feb28_coordinates.tsv"              # your coordinates output
mapping  = r"C:\Users\selcuk.1\OneDrive - The Ohio State University\Desktop\assembly_genome_mapping_corrected.tsv"    # columns: assembly, genome_id
out_dir  = r"C:\Users\selcuk.1\OneDrive - The Ohio State University\Desktop\Flagella_Evolution_DB\public\operon_coords"

annotated_df, summary_df, missing_df, written = split_main_tsv_by_assembly(
    main_tsv_path=main_tsv,
    mapping_path=mapping,
    out_dir=out_dir,
    keep_unmapped=True
)

print(summary_df.head(10))
print("Missing contigs:", len(missing_df))
print("Files written:", len(written))