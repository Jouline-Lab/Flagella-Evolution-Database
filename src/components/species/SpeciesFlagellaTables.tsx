"use client";

import { useState } from "react";
import type { SpeciesFlagellaContent } from "@/lib/speciesFlagellaContent";

type IdDialogState = {
  column: "gtdb" | "ncbi";
  geneName: string;
  ids: string[];
};

type SpeciesFlagellaTablesProps = {
  groups: SpeciesFlagellaContent["groups"];
  activeGeneKey?: string | null;
  flashedGeneKey?: string | null;
  onGeneHover?: (geneKey: string, geneName: string) => void;
  onGeneLeave?: () => void;
  onGeneSelect?: (geneKey: string, geneName: string) => void;
};

function normalizeGeneKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getNcbiProteinUrl(id: string): string {
  return `https://www.ncbi.nlm.nih.gov/protein/${encodeURIComponent(id)}`;
}

function splitGroupsIntoBalancedColumns(groups: SpeciesFlagellaContent["groups"]) {
  const byName = new Map(groups.map((group) => [group.name, group]));
  const used = new Set<string>();

  const leftOrder = [
    "Flagellar structural proteins",
    "Export apparatus",
    "Motor & switch",
    "Filament & junction",
    "Chaperones & assembly factors"
  ] as const;
  const rightOrder = [
    "Basal body & hook",
    "Regulation",
    "Other flagella-associated genes"
  ] as const;

  const left: SpeciesFlagellaContent["groups"] = [];
  const right: SpeciesFlagellaContent["groups"] = [];

  for (const name of leftOrder) {
    const group = byName.get(name);
    if (group) {
      left.push(group);
      used.add(name);
    }
  }

  for (const name of rightOrder) {
    const group = byName.get(name);
    if (group) {
      right.push(group);
      used.add(name);
    }
  }

  // Keep all remaining groups visible, appended to left column.
  for (const group of groups) {
    if (used.has(group.name)) continue;
    left.push(group);
  }

  return { left, right };
}

export default function SpeciesFlagellaTables({
  groups,
  activeGeneKey = null,
  flashedGeneKey = null,
  onGeneHover,
  onGeneLeave,
  onGeneSelect
}: SpeciesFlagellaTablesProps) {
  const [idDialog, setIdDialog] = useState<IdDialogState | null>(null);
  const columns = splitGroupsIntoBalancedColumns(groups);

  return (
    <>
      <div className="species-flagella-columns">
        {[columns.left, columns.right].map((columnGroups, columnIndex) => (
          <div key={columnIndex} className="species-flagella-column">
            {columnGroups.map((group) => (
              <section key={group.name} className="species-flagella-group">
                <h3>{group.name}</h3>
                <table className="species-flagella-table">
                  <thead>
                    <tr>
                      <th>Gene</th>
                      <th>Count</th>
                      <th>GTDB IDs</th>
                      <th>NCBI IDs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.genes.map((gene) => {
                      const geneKey = normalizeGeneKey(gene.name);
                      const rowClasses = [
                        "species-flagella-row",
                        activeGeneKey === geneKey ? "species-flagella-row-active" : "",
                        flashedGeneKey === geneKey ? "species-flagella-row-flash" : ""
                      ]
                        .filter(Boolean)
                        .join(" ");

                      return (
                        <tr
                          key={gene.name}
                          id={`species-gene-row-${geneKey}`}
                          className={rowClasses}
                          onMouseEnter={() => onGeneHover?.(geneKey, gene.name)}
                          onMouseLeave={() => onGeneLeave?.()}
                          onClick={() => onGeneSelect?.(geneKey, gene.name)}
                        >
                          <td>{gene.name}</td>
                          <td>{gene.count.toLocaleString()}</td>
                          <td>
                            {gene.gtdb.length === 0 ? (
                              "-"
                            ) : gene.gtdb.length === 1 ? (
                              <code>{gene.gtdb[0]}</code>
                            ) : (
                              <button
                                type="button"
                                className="species-id-count-button"
                                onClick={() =>
                                  setIdDialog({
                                    column: "gtdb",
                                    geneName: gene.name,
                                    ids: gene.gtdb
                                  })
                                }
                              >
                                {gene.gtdb.length} ID{gene.gtdb.length === 1 ? "" : "s"}
                              </button>
                            )}
                          </td>
                          <td>
                            {gene.ncbi.length === 0 ? (
                              "-"
                            ) : gene.ncbi.length === 1 ? (
                              <a
                                href={getNcbiProteinUrl(gene.ncbi[0])}
                                target="_blank"
                                rel="noreferrer"
                                className="species-id-link"
                              >
                                {gene.ncbi[0]}
                              </a>
                            ) : (
                              <button
                                type="button"
                                className="species-id-count-button"
                                onClick={() =>
                                  setIdDialog({
                                    column: "ncbi",
                                    geneName: gene.name,
                                    ids: gene.ncbi
                                  })
                                }
                              >
                                {gene.ncbi.length} ID{gene.ncbi.length === 1 ? "" : "s"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            ))}
            <div className="species-flagella-spacer" aria-hidden="true" />
          </div>
        ))}
      </div>

      {idDialog ? (
        <div className="species-id-dialog-overlay" onClick={() => setIdDialog(null)}>
          <div className="species-id-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="species-id-dialog-header">
              <h4 className="species-id-dialog-title">
                {idDialog.column === "ncbi" ? "NCBI" : "GTDB"} IDs ({idDialog.ids.length}) -{" "}
                {idDialog.geneName}
              </h4>
              <button
                type="button"
                className="species-id-dialog-close"
                onClick={() => setIdDialog(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="species-id-dialog-list">
              {idDialog.ids.map((idValue) =>
                idDialog.column === "ncbi" ? (
                  <a
                    key={idValue}
                    href={getNcbiProteinUrl(idValue)}
                    target="_blank"
                    rel="noreferrer"
                    className="species-id-dialog-link"
                  >
                    {idValue}
                  </a>
                ) : (
                  <span key={idValue} className="species-id-dialog-text">
                    {idValue}
                  </span>
                )
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
