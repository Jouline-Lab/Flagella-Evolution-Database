"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckSquare, Download, RotateCcw, Square, Table2 } from "lucide-react";
import Link from "next/link";
import {
  getPhyleticHeadersClient,
  getTaxonomySuggestionsClient,
  queryPhyleticMatrixClient
} from "@/lib/browserPhyletic";
import { speciesNameToSlug } from "@/lib/speciesNaming";

type PhyleticTableExplorerProps = {
  headers: string[];
};

const TAXONOMY_COLUMNS = [
  "phylum",
  "class",
  "order",
  "family",
  "genus",
  "species"
];
const TAXONOMY_PLACEHOLDER_EXAMPLES: Record<string, string> = {
  phylum: "e.g. Pseudomonadota",
  class: "e.g. Gammaproteobacteria",
  order: "e.g. Enterobacterales",
  family: "e.g. Enterobacteriaceae",
  genus: "e.g. Escherichia",
  species: "e.g. Escherichia coli"
};

const TAXONOMY_ORDER = new Map(TAXONOMY_COLUMNS.map((column, idx) => [column, idx]));

type ColumnType = "assembly" | "count" | "gtdb" | "ncbi" | "taxonomy" | "other";
type GeneColumnSet = {
  count?: string;
  gtdb?: string;
  ncbi?: string;
};
type VisibleColumnMeta = {
  column: string;
  groupLabel: string;
  subLabel: string;
};
type IdDialogState = {
  column: string;
  ids: string[];
};

function toTitleCase(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function normalizeValue(value: string): string {
  return value.toLowerCase().trim();
}

function formatTaxonomyValue(value: string): string {
  const stripped = value.replace(/^[a-z]__/i, "").trim();
  if (!stripped) {
    return value;
  }
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

function getSpeciesHref(rawSpecies: string): string | null {
  const formattedName = formatTaxonomyValue(rawSpecies);
  if (!formattedName || formattedName === "-") {
    return null;
  }
  return `/species/${speciesNameToSlug(formattedName)}`;
}

function classifyColumn(column: string): ColumnType {
  if (column === "assembly") {
    return "assembly";
  }
  if (TAXONOMY_ORDER.has(column)) {
    return "taxonomy";
  }
  if (column.endsWith("_count")) {
    return "count";
  }
  if (column.includes("_GTDB_")) {
    return "gtdb";
  }
  if (column.includes("_NCBI_")) {
    return "ncbi";
  }
  return "other";
}

function isIdColumn(column: string): boolean {
  const type = classifyColumn(column);
  return type === "gtdb" || type === "ncbi";
}

function isNcbiColumn(column: string): boolean {
  return classifyColumn(column) === "ncbi";
}

function getNcbiProteinUrl(id: string): string {
  return `https://www.ncbi.nlm.nih.gov/protein/${encodeURIComponent(id)}`;
}

function parseIds(rawValue: string): string[] {
  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value && value !== "-");
}

function sanitizeTsvCell(value: string): string {
  return value.replace(/\t/g, " ").replace(/\r?\n/g, " ").trim();
}

export default function PhyleticTableExplorer({
  headers
}: PhyleticTableExplorerProps) {
  const [availableHeaders, setAvailableHeaders] = useState(headers);
  const geneColumnsByGene = useMemo<Record<string, GeneColumnSet>>(() => {
    const map: Record<string, GeneColumnSet> = {};

    for (const header of availableHeaders) {
      if (header.endsWith("_count")) {
        const gene = header.slice(0, -"_count".length);
        map[gene] = { ...(map[gene] ?? {}), count: header };
        continue;
      }

      if (header.includes("_GTDB_")) {
        const gene = header.split("_GTDB_")[0];
        map[gene] = { ...(map[gene] ?? {}), gtdb: header };
        continue;
      }

      if (header.includes("_NCBI_")) {
        const gene = header.split("_NCBI_")[0];
        map[gene] = { ...(map[gene] ?? {}), ncbi: header };
      }
    }

    return map;
  }, [availableHeaders]);

  const geneOptions = useMemo(
    () => Object.keys(geneColumnsByGene).sort((a, b) => a.localeCompare(b)),
    [geneColumnsByGene]
  );

  const [groupEnabled, setGroupEnabled] = useState({
    count: true,
    gtdb: false,
    ncbi: false,
    assembly: false
  });
  const [taxonomyEnabled, setTaxonomyEnabled] = useState<Record<string, boolean>>(
    () =>
      Object.fromEntries(
        TAXONOMY_COLUMNS.map((column) => [column, false] as const)
      )
  );
  const [taxonomyFilters, setTaxonomyFilters] = useState<Record<string, string>>({});
  const [taxonomySelected, setTaxonomySelected] = useState<
    Record<string, string[]>
  >({});
  const [taxonomyDropdownOpen, setTaxonomyDropdownOpen] = useState<
    Record<string, boolean>
  >({});
  const [taxonomyActiveIndex, setTaxonomyActiveIndex] = useState<
    Record<string, number>
  >({});
  const [taxonomySuggestions, setTaxonomySuggestions] = useState<
    Record<string, string[]>
  >({});
  const [selectedGenes, setSelectedGenes] = useState<string[]>([]);
  const [geneSearch, setGeneSearch] = useState("");
  const [geneDropdownOpen, setGeneDropdownOpen] = useState(false);
  const [geneActiveIndex, setGeneActiveIndex] = useState(-1);
  const [idDialog, setIdDialog] = useState<IdDialogState | null>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [matchedRows, setMatchedRows] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasRendered, setHasRendered] = useState(false);
  const taxonomyContainerRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const taxonomyDebounceTimersRef = useRef<
    Record<string, ReturnType<typeof setTimeout> | undefined>
  >({});
  const taxonomyRequestSeqRef = useRef<Record<string, number>>({});

  const visibleColumns = useMemo(() => {
    const orderedColumns: string[] = [];

    for (const gene of selectedGenes) {
      const geneCols = geneColumnsByGene[gene];
      if (!geneCols) {
        continue;
      }

      if (groupEnabled.count && geneCols.count) {
        orderedColumns.push(geneCols.count);
      }
      if (groupEnabled.gtdb && geneCols.gtdb) {
        orderedColumns.push(geneCols.gtdb);
      }
      if (groupEnabled.ncbi && geneCols.ncbi) {
        orderedColumns.push(geneCols.ncbi);
      }
    }

    const taxonomyColumns = TAXONOMY_COLUMNS.filter(
      (column) => (taxonomyEnabled[column] ?? false) && availableHeaders.includes(column)
    ).sort((a, b) => (TAXONOMY_ORDER.get(a) ?? 999) - (TAXONOMY_ORDER.get(b) ?? 999));
    orderedColumns.push(...taxonomyColumns);

    if (groupEnabled.assembly && availableHeaders.includes("assembly")) {
      orderedColumns.push("assembly");
    }

    return orderedColumns;
  }, [availableHeaders, geneColumnsByGene, groupEnabled, selectedGenes, taxonomyEnabled]);

  const visibleColumnMeta = useMemo<VisibleColumnMeta[]>(() => {
    return visibleColumns.map((column) => {
      if (column === "assembly") {
        return {
          column,
          groupLabel: "Assembly",
          subLabel: "Assembly"
        };
      }

      if (column.endsWith("_count")) {
        return {
          column,
          groupLabel: column.slice(0, -"_count".length),
          subLabel: "Count"
        };
      }

      if (column.includes("_GTDB_")) {
        return {
          column,
          groupLabel: column.split("_GTDB_")[0],
          subLabel: "GTDB"
        };
      }

      if (column.includes("_NCBI_")) {
        return {
          column,
          groupLabel: column.split("_NCBI_")[0],
          subLabel: "NCBI"
        };
      }

      if (TAXONOMY_ORDER.has(column)) {
        return {
          column,
          groupLabel: "Taxonomy",
          subLabel: toTitleCase(column)
        };
      }

      return {
        column,
        groupLabel: "Other",
        subLabel: column
      };
    });
  }, [visibleColumns]);

  const groupedHeaderCells = useMemo(() => {
    const groups: Array<{ label: string; colSpan: number }> = [];

    for (const meta of visibleColumnMeta) {
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.label === meta.groupLabel) {
        lastGroup.colSpan += 1;
      } else {
        groups.push({ label: meta.groupLabel, colSpan: 1 });
      }
    }

    return groups;
  }, [visibleColumnMeta]);
  const groupToneByColumn = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    let groupIndex = -1;
    let lastGroupLabel = "";

    for (const meta of visibleColumnMeta) {
      if (meta.groupLabel !== lastGroupLabel) {
        groupIndex += 1;
        lastGroupLabel = meta.groupLabel;
      }
      map[meta.column] = groupIndex % 2;
    }

    return map;
  }, [visibleColumnMeta]);

  const toggleGeneSelection = (gene: string, checked: boolean) => {
    setSelectedGenes((current) => {
      if (checked) {
        if (current.includes(gene)) {
          return current;
        }
        return [...current, gene];
      }
      return current.filter((item) => item !== gene);
    });
  };

  const activeTaxonomyFilters = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const column of TAXONOMY_COLUMNS) {
      const selectedValues = taxonomySelected[column] ?? [];
      if (selectedValues.length > 0) {
        result[column] = selectedValues;
      }
    }
    return result;
  }, [taxonomySelected]);
  const requiredCountColumns = useMemo(() => {
    return selectedGenes
      .map((gene) => geneColumnsByGene[gene]?.count)
      .filter((column): column is string => Boolean(column));
  }, [geneColumnsByGene, selectedGenes]);
  const geneSuggestions = useMemo(() => {
    const query = normalizeValue(geneSearch);
    const base = query
      ? geneOptions.filter((gene) => normalizeValue(gene).includes(query))
      : geneOptions;

    return base.slice(0, 80);
  }, [geneOptions, geneSearch]);

  const loadTaxonomySuggestions = async (rank: string, query: string) => {
    const existingTimer = taxonomyDebounceTimersRef.current[rank];
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    taxonomyDebounceTimersRef.current[rank] = setTimeout(async () => {
      const requestSeq = (taxonomyRequestSeqRef.current[rank] ?? 0) + 1;
      taxonomyRequestSeqRef.current[rank] = requestSeq;

      try {
        const suggestions = await getTaxonomySuggestionsClient({
          rank,
          query,
          limit: 20,
          selectedTaxonomy: taxonomySelected
        });
        if (taxonomyRequestSeqRef.current[rank] !== requestSeq) {
          return;
        }

        setTaxonomySuggestions((current) => ({
          ...current,
          [rank]: suggestions
        }));
        setTaxonomyActiveIndex((current) => ({
          ...current,
          [rank]: suggestions.length > 0 ? 0 : -1
        }));
      } catch {
        // Keep previous suggestions when a request fails.
      }
    }, 180);
  };

  useEffect(() => {
    if (geneSuggestions.length === 0) {
      setGeneActiveIndex(-1);
      return;
    }

    setGeneActiveIndex((current) => {
      if (current < 0) {
        return 0;
      }
      if (current >= geneSuggestions.length) {
        return geneSuggestions.length - 1;
      }
      return current;
    });
  }, [geneSuggestions]);

  useEffect(() => {
    if (availableHeaders.length > 0) {
      return;
    }

    let cancelled = false;

    getPhyleticHeadersClient()
      .then((nextHeaders) => {
        if (!cancelled) {
          setAvailableHeaders(nextHeaders);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : "Failed to load phyletic matrix headers."
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [availableHeaders.length]);

  useEffect(() => {
    return () => {
      TAXONOMY_COLUMNS.forEach((rank) => {
        const timer = taxonomyDebounceTimersRef.current[rank];
        if (timer) {
          clearTimeout(timer);
        }
      });
    };
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      setTaxonomyDropdownOpen((current) => {
        const next = { ...current };
        let changed = false;

        for (const rank of TAXONOMY_COLUMNS) {
          if (!current[rank]) {
            continue;
          }
          const container = taxonomyContainerRefs.current[rank];
          if (container && !container.contains(target)) {
            next[rank] = false;
            changed = true;
          }
        }

        return changed ? next : current;
      });
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, []);

  useEffect(() => {
    TAXONOMY_COLUMNS.forEach((rank) => {
      if (taxonomyDropdownOpen[rank]) {
        void loadTaxonomySuggestions(rank, taxonomyFilters[rank] ?? "");
      }
    });
  }, [taxonomySelected]);

  useEffect(() => {
    // Any selection/filter change invalidates the currently rendered snapshot.
    setHasRendered(false);
    setRows([]);
    setMatchedRows(0);
    setLoadError(null);
  }, [visibleColumns, activeTaxonomyFilters, requiredCountColumns]);

  const renderTable = async () => {
    if (visibleColumns.length === 0) {
      setRows([]);
      setTotalRows(0);
      setMatchedRows(0);
      setLoadError("Select at least one column before rendering.");
      setHasRendered(false);
      return;
    }

    try {
      setIsLoading(true);
      setLoadError(null);

      const payload = await queryPhyleticMatrixClient({
        visibleColumns,
        taxonomyFilters: activeTaxonomyFilters,
        countFilters: {},
        requiredCountColumns
      });

      setRows(payload.rows ?? []);
      setTotalRows(payload.totalRows ?? 0);
      setMatchedRows(payload.matchedRows ?? 0);
      setHasRendered(true);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load data");
    } finally {
      setIsLoading(false);
    }
  };

  const toggleTaxonomySelection = (rank: string, value: string, checked: boolean) => {
    setTaxonomySelected((current) => {
      const currentValues = current[rank] ?? [];
      const nextValues = checked
        ? [...currentValues, value]
        : currentValues.filter((item) => item !== value);
      return {
        ...current,
        [rank]: nextValues
      };
    });
  };

  const downloadCurrentTableAsTsv = () => {
    if (!hasRendered || rows.length === 0 || visibleColumns.length === 0) {
      return;
    }

    const lines: string[] = [];
    lines.push(visibleColumns.join("\t"));

    for (const row of rows) {
      const cells = visibleColumns.map((column) => {
        const rawValue = row[column] ?? "";
        if (isIdColumn(column)) {
          const ids = parseIds(rawValue);
          return ids.length > 0 ? ids.join(",") : "-";
        }
        return sanitizeTsvCell(rawValue);
      });
      lines.push(cells.join("\t"));
    }

    const blob = new Blob([lines.join("\n")], {
      type: "text/tab-separated-values;charset=utf-8;"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "flagellar-gene-table.tsv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <main className="table-page">
      <div className="container table-page-inner">
        <header className="table-page-header">
          <h1>Flagellar Gene Table</h1>
          <p>
            Select flagellar genes to examine their genome-level count/presence,
            associated GTDB and NCBI protein IDs, and phyletic distribution across
            filtered assemblies.
          </p>
        </header>

        <section className="control-panel">
          <div className="control-header">
            <h2>Data to Visualize</h2>
            <p>{visibleColumns.length} visible columns</p>
          </div>

          <div className="visualize-split">
            <div className="visualize-panel">
              <h3 className="visualize-title">Genes to Visualize</h3>
              <div className="gene-picker">
                <p className="gene-picker-title">
                  <span className="taxonomy-rank-label">
                    Add genes
                    {selectedGenes.length > 0 ? (
                      <span className="taxonomy-rank-count">{selectedGenes.length}</span>
                    ) : null}
                  </span>
                </p>
                <div className="taxonomy-actions">
                  <button
                    type="button"
                    className="button button-secondary table-action-button"
                    onClick={() =>
                      setSelectedGenes(
                        selectedGenes.length > 0 ? [] : geneOptions
                      )
                    }
                  >
                    {selectedGenes.length > 0 ? (
                      <>
                        <Square className="table-action-icon" />
                        Deselect All
                      </>
                    ) : (
                      <>
                        <CheckSquare className="table-action-icon" />
                        Select All
                      </>
                    )}
                  </button>
                </div>
                <div className="gene-picker-row">
                  <div className="autocomplete-shell">
                    <input
                      type="text"
                      className="header-filter-input"
                      placeholder="Search gene name and add..."
                      value={geneSearch}
                      onFocus={() => setGeneDropdownOpen(true)}
                      onBlur={() => {
                        setTimeout(() => setGeneDropdownOpen(false), 120);
                      }}
                      onChange={(event) => {
                        setGeneSearch(event.target.value);
                        setGeneDropdownOpen(true);
                        setGeneActiveIndex(0);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          setGeneDropdownOpen(true);
                          setGeneActiveIndex((current) =>
                            Math.min(geneSuggestions.length - 1, Math.max(0, current + 1))
                          );
                          return;
                        }

                        if (event.key === "ArrowUp") {
                          event.preventDefault();
                          setGeneDropdownOpen(true);
                          setGeneActiveIndex((current) => Math.max(0, current - 1));
                          return;
                        }

                        if (event.key === "Enter") {
                          event.preventDefault();
                          if (
                            geneDropdownOpen &&
                            geneActiveIndex >= 0 &&
                            geneActiveIndex < geneSuggestions.length
                          ) {
                            const gene = geneSuggestions[geneActiveIndex];
                            const isChecked = selectedGenes.includes(gene);
                            toggleGeneSelection(gene, !isChecked);
                          }
                          return;
                        }

                        if (event.key === "Escape") {
                          event.preventDefault();
                          setGeneDropdownOpen(false);
                        }
                      }}
                    />

                    {geneDropdownOpen && geneSuggestions.length > 0 ? (
                      <div
                        className="autocomplete-dropdown"
                        onMouseDown={(event) => event.preventDefault()}
                      >
                        {geneSuggestions.map((gene, idx) => (
                          <label
                            className={`autocomplete-item autocomplete-item-checkbox ${
                              idx === geneActiveIndex ? "autocomplete-item-active" : ""
                            }`}
                            key={gene}
                            onMouseEnter={() => setGeneActiveIndex(idx)}
                            onMouseDown={(event) => event.preventDefault()}
                          >
                            <input
                              type="checkbox"
                              checked={selectedGenes.includes(gene)}
                              onChange={(event) =>
                                toggleGeneSelection(gene, event.target.checked)
                              }
                            />
                            <span>{gene}</span>
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                {selectedGenes.length === 0 ? (
                  <p className="control-empty">
                    No genes selected yet. Select genes to show count/GTDB/NCBI
                    columns.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="visualize-panel">
              <h3 className="visualize-title">Data Columns</h3>
              <div className="group-stack">
                <label className="group-option">
                  <input
                    type="checkbox"
                    checked={groupEnabled.count}
                    onChange={(event) =>
                      setGroupEnabled((current) => ({
                        ...current,
                        count: event.target.checked
                      }))
                    }
                  />
                  <span>Count</span>
                </label>

                <label className="group-option">
                  <input
                    type="checkbox"
                    checked={groupEnabled.gtdb}
                    onChange={(event) =>
                      setGroupEnabled((current) => ({
                        ...current,
                        gtdb: event.target.checked
                      }))
                    }
                  />
                  <span>GTDB IDs</span>
                </label>

                <label className="group-option">
                  <input
                    type="checkbox"
                    checked={groupEnabled.ncbi}
                    onChange={(event) =>
                      setGroupEnabled((current) => ({
                        ...current,
                        ncbi: event.target.checked
                      }))
                    }
                  />
                  <span>NCBI IDs</span>
                </label>

                <label className="group-option">
                  <input
                    type="checkbox"
                    checked={groupEnabled.assembly}
                    onChange={(event) =>
                      setGroupEnabled((current) => ({
                        ...current,
                        assembly: event.target.checked
                      }))
                    }
                  />
                  <span>Assembly</span>
                </label>
              </div>
            </div>
          </div>
        </section>

        <section className="control-panel">
          <div className="control-header">
            <h2>Taxonomy Ranks</h2>
            <button
              type="button"
              className="button button-secondary table-action-button"
              onClick={() => {
                setTaxonomyFilters({});
                setTaxonomySelected({});
              }}
            >
              <RotateCcw className="table-action-icon" />
              Reset taxonomy filters
            </button>
          </div>

          <p className="control-empty">
            Use taxonomy filters to focus the table on clades of interest. Leave a
            rank blank to include all values, or select one/multiple values from its
            dropdown to narrow the phyletic view.
          </p>

          <div className="taxonomy-grid">
            {TAXONOMY_COLUMNS.map((column) => (
              <div key={column} className="taxonomy-item">
                <label className="group-option">
                  <input
                    type="checkbox"
                    checked={taxonomyEnabled[column] ?? false}
                    onChange={(event) =>
                      setTaxonomyEnabled((current) => ({
                        ...current,
                        [column]: event.target.checked
                      }))
                    }
                  />
                  <span className="taxonomy-rank-label">
                    {toTitleCase(column)}
                    {(taxonomySelected[column]?.length ?? 0) > 0 ? (
                      <span className="taxonomy-rank-count">
                        {taxonomySelected[column]?.length}
                      </span>
                    ) : null}
                  </span>
                </label>

                <div
                  className="autocomplete-shell"
                  ref={(element) => {
                    taxonomyContainerRefs.current[column] = element;
                  }}
                >
                  <input
                    type="text"
                    className="header-filter-input"
                    placeholder={TAXONOMY_PLACEHOLDER_EXAMPLES[column] ?? "Example"}
                    value={taxonomyFilters[column] ?? ""}
                    onFocus={() => {
                      setTaxonomyDropdownOpen((current) => ({
                        ...current,
                        [column]: true
                      }));
                      void loadTaxonomySuggestions(column, taxonomyFilters[column] ?? "");
                    }}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setTaxonomyFilters((current) => ({
                        ...current,
                        [column]: nextValue
                      }));
                      setTaxonomyDropdownOpen((current) => ({
                        ...current,
                        [column]: true
                      }));
                      void loadTaxonomySuggestions(column, nextValue);
                    }}
                    onKeyDown={(event) => {
                      const suggestions = taxonomySuggestions[column] ?? [];
                      const activeIndex = taxonomyActiveIndex[column] ?? -1;

                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setTaxonomyActiveIndex((current) => ({
                          ...current,
                          [column]: Math.min(
                            suggestions.length - 1,
                            Math.max(0, activeIndex + 1)
                          )
                        }));
                        return;
                      }

                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setTaxonomyActiveIndex((current) => ({
                          ...current,
                          [column]: Math.max(0, activeIndex - 1)
                        }));
                        return;
                      }

                      if (event.key === "Enter") {
                        if (
                          (taxonomyDropdownOpen[column] ?? false) &&
                          activeIndex >= 0 &&
                          activeIndex < suggestions.length
                        ) {
                          event.preventDefault();
                          const value = suggestions[activeIndex];
                          const isChecked = (taxonomySelected[column] ?? []).includes(value);
                          toggleTaxonomySelection(column, value, !isChecked);
                        }
                        return;
                      }

                      if (event.key === "Escape") {
                        event.preventDefault();
                        setTaxonomyDropdownOpen((current) => ({
                          ...current,
                          [column]: false
                        }));
                      }
                    }}
                  />

                  {(taxonomyDropdownOpen[column] ?? false) &&
                  (taxonomySuggestions[column]?.length ?? 0) > 0 ? (
                    <div
                      className="autocomplete-dropdown"
                      onMouseDown={(event) => event.preventDefault()}
                    >
                      {(taxonomySuggestions[column] ?? []).map((value, idx) => (
                        <label
                          className={`autocomplete-item autocomplete-item-checkbox ${
                            idx === (taxonomyActiveIndex[column] ?? -1)
                              ? "autocomplete-item-active"
                              : ""
                          }`}
                          key={`${column}-${value}`}
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseEnter={() =>
                            setTaxonomyActiveIndex((current) => ({
                              ...current,
                              [column]: idx
                            }))
                          }
                        >
                          <input
                            type="checkbox"
                            checked={(taxonomySelected[column] ?? []).includes(value)}
                            onChange={(event) => {
                              toggleTaxonomySelection(column, value, event.target.checked);
                            }}
                          />
                          <span>{formatTaxonomyValue(value)}</span>
                        </label>
                      ))}
                    </div>
                  ) : (taxonomyDropdownOpen[column] ?? false) ? (
                    <div className="autocomplete-dropdown">
                      <div className="autocomplete-empty">No matches</div>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="table-result-meta">
          <p>
            Showing <strong>{matchedRows}</strong> matching rows from{" "}
            <strong>{totalRows}</strong> total rows.
          </p>
          {!hasRendered && !isLoading ? (
            <p className="loading-note">Click "Render table" to load rows.</p>
          ) : null}
          {isLoading ? <p className="loading-note">Loading rows...</p> : null}
          {loadError ? <p className="error-note">{loadError}</p> : null}
        </section>

        <section className="render-actions">
          <button
            type="button"
            className="button button-secondary table-action-button"
            onClick={renderTable}
          >
            <Table2 className="table-action-icon" />
            Render table
          </button>
          {hasRendered && rows.length > 0 ? (
            <button
              type="button"
              className="button button-secondary table-action-button"
              onClick={downloadCurrentTableAsTsv}
            >
              <Download className="table-action-icon" />
              Download Table as TSV
            </button>
          ) : null}
        </section>

        <section className="table-wrapper">
          {!hasRendered ? (
            <div className="table-empty">
              Click <strong>Render table</strong> to view the latest selected
              columns and filters.
            </div>
          ) : visibleColumns.length === 0 ? (
            <div className="table-empty">
              Add genes or enable taxonomy/assembly columns to start visualizing
              data.
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {groupedHeaderCells.map((group, index) => (
                      <th
                        key={`${group.label}-${index}`}
                        className={`th-group group-tone-${index % 2}`}
                        colSpan={group.colSpan}
                      >
                        <div className="th-title">{group.label}</div>
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {visibleColumnMeta.map((meta) => (
                      (() => {
                        const columnType = classifyColumn(meta.column);
                        return (
                      <th
                        key={`${meta.column}-sub`}
                        className={`th-sub col-type-${columnType} group-tone-${groupToneByColumn[meta.column] ?? 0} ${
                          isIdColumn(meta.column) ? "id-column-cell" : ""
                        }`}
                      >
                        <div className="th-title">{meta.subLabel}</div>
                      </th>
                        );
                      })()
                    ))}
                  </tr>
                  <tr>
                    {visibleColumns.map((column) => {
                      const columnType = classifyColumn(column);
                      return (
                        <th
                          key={`${column}-filter`}
                          className={`th-filter col-type-${columnType} group-tone-${groupToneByColumn[column] ?? 0} ${
                          isIdColumn(column) ? "id-column-cell" : ""
                        }`}
                        >
                          <span className="th-filter-disabled">-</span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr key={`${row.assembly ?? "row"}-${rowIndex}`}>
                      {visibleColumns.map((column) => {
                        const columnType = classifyColumn(column);
                        return (
                          <td
                            key={`${rowIndex}-${column}`}
                            className={`col-type-${columnType} group-tone-${groupToneByColumn[column] ?? 0} ${
                            isIdColumn(column) ? "id-column-cell" : ""
                          }`}
                          >
                            {isIdColumn(column) ? (
                              (() => {
                                const rawValue = row[column] ?? "";
                                const ids = parseIds(rawValue);
                                if (ids.length === 0) {
                                  return "-";
                                }

                                if (ids.length === 1) {
                                  return (
                                  isNcbiColumn(column) ? (
                                    <a
                                      href={getNcbiProteinUrl(ids[0])}
                                      className="id-single-value id-link"
                                      title={ids[0]}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      {ids[0]}
                                    </a>
                                  ) : (
                                    <code className="id-single-value" title={ids[0]}>
                                      {ids[0]}
                                    </code>
                                  )
                                  );
                                }

                                return (
                                  <button
                                    type="button"
                                    className="id-cell-button"
                                    onClick={() => setIdDialog({ column, ids })}
                                    title={rawValue}
                                  >
                                    {ids.length} ID{ids.length > 1 ? "s" : ""}
                                  </button>
                                );
                              })()
                            ) : classifyColumn(column) === "taxonomy" ? (
                              column === "species" ? (
                                (() => {
                                  const rawSpecies = row[column] ?? "";
                                  const formattedSpecies = formatTaxonomyValue(rawSpecies);
                                  const speciesHref = getSpeciesHref(rawSpecies);
                                  if (!speciesHref) {
                                    return formattedSpecies;
                                  }
                                  return (
                                    <Link
                                      href={speciesHref}
                                      title={`Navigate to the ${formattedSpecies} page`}
                                    >
                                      {formattedSpecies}
                                    </Link>
                                  );
                                })()
                              ) : (
                                formatTaxonomyValue(row[column] ?? "")
                              )
                            ) : (
                              row[column] ?? ""
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {idDialog ? (
          <div className="id-dialog-overlay" onClick={() => setIdDialog(null)}>
            <div className="id-dialog" onClick={(event) => event.stopPropagation()}>
              <div className="id-dialog-header">
                <button
                  type="button"
                  className="id-dialog-close"
                  onClick={() => setIdDialog(null)}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div className="id-dialog-list">
                {idDialog.ids.map((idValue) =>
                  isNcbiColumn(idDialog.column) ? (
                    <a
                      key={idValue}
                      href={getNcbiProteinUrl(idValue)}
                      target="_blank"
                      rel="noreferrer"
                      className="id-dialog-link"
                    >
                      {idValue}
                    </a>
                  ) : (
                    <code key={idValue}>{idValue}</code>
                  )
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
