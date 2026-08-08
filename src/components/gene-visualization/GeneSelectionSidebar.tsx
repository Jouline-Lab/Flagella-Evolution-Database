"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { EyeOff, Eye, CheckSquare, Square, Dna, GitCompare, Search, ChevronDown } from "lucide-react";

interface GeneSelectionSidebarProps {
  geneNames: string[];
  defaultGeneNames?: string[];
  customGeneNames?: string[];
  customDataKind?: "user" | "operon" | "insertion";
  activeGenes: string[];
  onToggleGene: (gene: string) => void;
  onToggleGeneGroup: (genes: string[]) => void;
  onTogglePresence: () => void;
  showPresence: boolean;
}

export function GeneSelectionSidebar({
  geneNames,
  defaultGeneNames,
  customGeneNames = [],
  customDataKind = "user",
  activeGenes,
  onToggleGene,
  onToggleGeneGroup,
  onTogglePresence,
  showPresence
}: GeneSelectionSidebarProps) {
  const [regularOpen, setRegularOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [regularQuery, setRegularQuery] = useState("");
  const [customQuery, setCustomQuery] = useState("");
  const [diffQuery, setDiffQuery] = useState("");
  const [regularActiveIndex, setRegularActiveIndex] = useState(-1);
  const [customActiveIndex, setCustomActiveIndex] = useState(-1);
  const [diffActiveIndex, setDiffActiveIndex] = useState(-1);
  const regularRef = useRef<HTMLDivElement>(null);
  const customRef = useRef<HTMLDivElement>(null);
  const diffRef = useRef<HTMLDivElement>(null);

  const customGeneSet = new Set(customGeneNames);
  const isComparisonGene = (gene: string) => !customGeneSet.has(gene) && (gene.includes(">") || gene.includes("-"));
  const defaultGeneSet = defaultGeneNames && defaultGeneNames.length > 0 ? defaultGeneNames : geneNames;
  const regularGenes = defaultGeneSet.filter((gene) => !isComparisonGene(gene));
  const customGenes = customGeneNames;
  const differenceGenes = geneNames.filter(isComparisonGene);
  const activeRegularGenes = activeGenes.filter((gene) => regularGenes.includes(gene));
  const activeCustomGenes = activeGenes.filter((gene) => customGenes.includes(gene));
  const activeDifferenceGenes = activeGenes.filter(isComparisonGene);
  const hasActiveRegularGenes = activeRegularGenes.length > 0;
  const hasActiveCustomGenes = activeCustomGenes.length > 0;

  const differenceGenesSorted = React.useMemo(() => {
    return [...differenceGenes].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }, [differenceGenes]);

  // Preserve TSV header order for default, user, operon, and insertion data.
  const regularOptions = useMemo(() => regularGenes, [regularGenes]);
  const customOptions = useMemo(() => customGenes, [customGenes]);

  const filteredRegularOptions = useMemo(() => {
    const q = regularQuery.trim().toLowerCase();
    if (!q) return regularOptions;
    return regularOptions.filter((gene) => gene.replace(/_count$/, "").toLowerCase().includes(q));
  }, [regularOptions, regularQuery]);

  const filteredDifferenceOptions = useMemo(() => {
    const q = diffQuery.trim().toLowerCase();
    if (!q) return differenceGenesSorted;
    return differenceGenesSorted.filter((gene) => gene.toLowerCase().includes(q));
  }, [differenceGenesSorted, diffQuery]);

  const filteredCustomOptions = useMemo(() => {
    const q = customQuery.trim().toLowerCase();
    if (!q) return customOptions;
    return customOptions.filter((gene) => gene.replace(/_count$/, "").toLowerCase().includes(q));
  }, [customOptions, customQuery]);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (regularRef.current && !regularRef.current.contains(target)) {
        setRegularOpen(false);
      }
      if (customRef.current && !customRef.current.contains(target)) {
        setCustomOpen(false);
      }
      if (diffRef.current && !diffRef.current.contains(target)) {
        setDiffOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  useEffect(() => {
    if (!regularOpen) setRegularActiveIndex(-1);
  }, [regularOpen]);

  useEffect(() => {
    if (!customOpen) setCustomActiveIndex(-1);
  }, [customOpen]);

  useEffect(() => {
    if (!diffOpen) setDiffActiveIndex(-1);
  }, [diffOpen]);

  return (
    <div className="flex flex-col">
      <CardHeader className="pb-1 px-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Dna className="w-5 h-5 text-blue-600" />
          Gene Selection
        </CardTitle>
        <div className="flex flex-wrap gap-1 mt-1">
          <Button
            onClick={onTogglePresence}
            size="sm"
            variant="outline"
            className="flex items-center gap-1 text-xs h-7 px-2"
          >
            {showPresence ? (
              <>
                <EyeOff className="w-3 h-3" />
                Show Absence
              </>
            ) : (
              <>
                <Eye className="w-3 h-3" />
                Show Presence
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-0 px-3 pb-3">
        <div className="space-y-3 flex flex-col">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {regularGenes.length > 0 && (
                  <Badge variant="secondary" className="text-sm">
                    {regularGenes.length} total
                  </Badge>
                )}
                {activeRegularGenes.length > 0 && (
                  <Badge variant="default" className="text-sm bg-blue-100 text-blue-800">
                    {activeRegularGenes.length} active
                  </Badge>
                )}
              </div>
            </div>

            <CardContent className="p-0">
                {regularGenes.length === 0 ? (
                  <div className="p-6 text-center text-gray-700">
                    <Dna className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                    <p className="text-sm font-medium mb-1">No genes available</p>
                    <p className="text-xs">Load a TSV file to see genes</p>
                  </div>
                ) : (
                  <div ref={regularRef} className="relative space-y-2">
                    <Button
                      onClick={() => onToggleGeneGroup(regularGenes)}
                      size="sm"
                      variant="outline"
                      className="flex items-center gap-1 text-xs h-7 px-2"
                    >
                      {hasActiveRegularGenes ? (
                        <>
                          <Square className="w-3 h-3" />
                          Deselect All
                        </>
                      ) : (
                        <>
                          <CheckSquare className="w-3 h-3" />
                          Select All
                        </>
                      )}
                    </Button>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
                      <input
                        value={regularQuery}
                        onChange={(e) => setRegularQuery(e.target.value)}
                        onFocus={() => setRegularOpen(true)}
                        onKeyDown={(e) => {
                          const max = filteredRegularOptions.length - 1;
                          if (e.key === "ArrowDown") {
                            e.preventDefault();
                            setRegularOpen(true);
                            setRegularActiveIndex((prev) => (max < 0 ? -1 : Math.min(prev + 1, max)));
                          } else if (e.key === "ArrowUp") {
                            e.preventDefault();
                            setRegularOpen(true);
                            setRegularActiveIndex((prev) => (max < 0 ? -1 : Math.max(prev - 1, 0)));
                          } else if (e.key === "Enter") {
                            if (!regularOpen || max < 0) return;
                            e.preventDefault();
                            const idx = regularActiveIndex >= 0 ? regularActiveIndex : 0;
                            const gene = filteredRegularOptions[idx];
                            if (gene) onToggleGene(gene);
                          } else if (e.key === "Escape") {
                            setRegularOpen(false);
                          }
                        }}
                        className="h-9 w-full rounded border border-gray-300 bg-white pl-7 pr-8 text-sm text-gray-900"
                        placeholder="Select Genes"
                      />
                      <button
                        type="button"
                        onClick={() => setRegularOpen((v) => !v)}
                        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-gray-700 hover:bg-gray-100"
                        aria-label="Toggle gene menu"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {regularOpen && (
                      <div className="viz-opaque-menu absolute z-30 mt-1 max-h-52 w-full overflow-auto rounded border border-gray-300 bg-white p-1 shadow-md">
                        {filteredRegularOptions.length === 0 ? (
                          <div className="px-2 py-1 text-sm text-gray-600">No matches</div>
                        ) : (
                          filteredRegularOptions.map((gene, idx) => (
                            <label
                              key={gene}
                              className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-gray-900 hover:bg-gray-100 ${regularActiveIndex === idx ? "bg-gray-100" : ""}`}
                            >
                              <Checkbox
                                checked={activeGenes.includes(gene)}
                                onCheckedChange={() => onToggleGene(gene)}
                              />
                              <span className="truncate">{gene.replace(/_count$/, "")}</span>
                            </label>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
            </CardContent>
          </div>

          {customGenes.length > 0 ? (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-medium text-sm text-gray-900">
                  {customDataKind === "insertion"
                    ? "Insertions"
                    : customDataKind === "operon"
                      ? "Operon Data"
                      : "User Data"}
                </h3>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {customGenes.length} total
                  </Badge>
                  {activeCustomGenes.length > 0 && (
                    <Badge variant="default" className="text-xs bg-blue-100 text-blue-800">
                      {activeCustomGenes.length} active
                    </Badge>
                  )}
                </div>
              </div>
              <div ref={customRef} className="relative space-y-2">
                <Button
                  onClick={() => onToggleGeneGroup(customGenes)}
                  size="sm"
                  variant="outline"
                  className="flex items-center gap-1 text-xs h-7 px-2"
                >
                  {hasActiveCustomGenes ? (
                    <>
                      <Square className="w-3 h-3" />
                      Deselect All
                    </>
                  ) : (
                    <>
                      <CheckSquare className="w-3 h-3" />
                      Select All
                    </>
                  )}
                </Button>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
                  <input
                    value={customQuery}
                    onChange={(e) => setCustomQuery(e.target.value)}
                    onFocus={() => setCustomOpen(true)}
                    onKeyDown={(e) => {
                      const max = filteredCustomOptions.length - 1;
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setCustomOpen(true);
                        setCustomActiveIndex((prev) => (max < 0 ? -1 : Math.min(prev + 1, max)));
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setCustomOpen(true);
                        setCustomActiveIndex((prev) => (max < 0 ? -1 : Math.max(prev - 1, 0)));
                      } else if (e.key === "Enter") {
                        if (!customOpen || max < 0) return;
                        e.preventDefault();
                        const idx = customActiveIndex >= 0 ? customActiveIndex : 0;
                        const gene = filteredCustomOptions[idx];
                        if (gene) onToggleGene(gene);
                      } else if (e.key === "Escape") {
                        setCustomOpen(false);
                      }
                    }}
                    className="h-9 w-full rounded border border-gray-300 bg-white pl-7 pr-8 text-sm text-gray-900"
                    placeholder={
                      customDataKind === "operon"
                        ? "Select operon columns"
                        : customDataKind === "insertion"
                          ? "Select insertions"
                        : "Select user data columns"
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setCustomOpen((v) => !v)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-gray-700 hover:bg-gray-100"
                    aria-label={`Toggle ${
                      customDataKind === "insertion"
                        ? "insertion"
                        : customDataKind === "operon"
                          ? "operon"
                          : "user data"
                    } column menu`}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>
                {customOpen && (
                  <div className="viz-opaque-menu absolute z-30 mt-1 max-h-52 w-full overflow-auto rounded border border-gray-300 bg-white p-1 shadow-md">
                    {filteredCustomOptions.length === 0 ? (
                      <div className="px-2 py-1 text-sm text-gray-600">No matches</div>
                    ) : (
                      filteredCustomOptions.map((gene, idx) => (
                        <label
                          key={gene}
                          className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-gray-900 hover:bg-gray-100 ${customActiveIndex === idx ? "bg-gray-100" : ""}`}
                        >
                          <Checkbox
                            checked={activeGenes.includes(gene)}
                            onCheckedChange={() => onToggleGene(gene)}
                          />
                          <span className="truncate">{gene.replace(/_count$/, "")}</span>
                        </label>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          <Separator className="my-2" />

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-sm text-gray-900 flex items-center gap-2">
                <GitCompare className="w-4 h-4 text-purple-600" />
                Comparisons
              </h3>
              <div className="flex items-center gap-2">
                {differenceGenes.length > 0 && (
                  <Badge variant="secondary" className="text-xs bg-purple-100 text-purple-800">
                    {differenceGenes.length} total
                  </Badge>
                )}
                {activeDifferenceGenes.length > 0 && (
                  <Badge variant="default" className="text-xs bg-purple-100 text-purple-800">
                    {activeDifferenceGenes.length} active
                  </Badge>
                )}
              </div>
            </div>

            <div className="space-y-2">
                {differenceGenes.length === 0 ? (
                  <div className="py-2 text-center text-gray-700">
                    <GitCompare className="w-6 h-6 mx-auto mb-2 text-gray-300" />
                    <p className="text-xs font-medium mb-1">No comparisons created</p>
                    <p className="text-xs">Use the "Gene Comparison" controls above</p>
                  </div>
                ) : (
                  <div ref={diffRef} className="relative space-y-2">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
                      <input
                        value={diffQuery}
                        onChange={(e) => setDiffQuery(e.target.value)}
                        onFocus={() => setDiffOpen(true)}
                        onKeyDown={(e) => {
                          const max = filteredDifferenceOptions.length - 1;
                          if (e.key === "ArrowDown") {
                            e.preventDefault();
                            setDiffOpen(true);
                            setDiffActiveIndex((prev) => (max < 0 ? -1 : Math.min(prev + 1, max)));
                          } else if (e.key === "ArrowUp") {
                            e.preventDefault();
                            setDiffOpen(true);
                            setDiffActiveIndex((prev) => (max < 0 ? -1 : Math.max(prev - 1, 0)));
                          } else if (e.key === "Enter") {
                            if (!diffOpen || max < 0) return;
                            e.preventDefault();
                            const idx = diffActiveIndex >= 0 ? diffActiveIndex : 0;
                            const gene = filteredDifferenceOptions[idx];
                            if (gene) onToggleGene(gene);
                          } else if (e.key === "Escape") {
                            setDiffOpen(false);
                          }
                        }}
                        className="h-9 w-full rounded border border-gray-300 bg-white pl-7 pr-8 text-sm text-gray-900"
                        placeholder="Search comparisons"
                      />
                      <button
                        type="button"
                        onClick={() => setDiffOpen((v) => !v)}
                        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-gray-700 hover:bg-gray-100"
                        aria-label="Toggle comparison menu"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {diffOpen && (
                      <div className="viz-opaque-menu absolute z-30 mt-1 max-h-52 w-full overflow-auto rounded border border-gray-300 bg-white p-1 shadow-md">
                        {filteredDifferenceOptions.length === 0 ? (
                          <div className="px-2 py-1 text-sm text-gray-600">No matches</div>
                        ) : (
                          filteredDifferenceOptions.map((gene, idx) => (
                            <label
                              key={gene}
                              className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-gray-900 hover:bg-gray-100 ${diffActiveIndex === idx ? "bg-gray-100" : ""}`}
                            >
                              <Checkbox
                                checked={activeGenes.includes(gene)}
                                onCheckedChange={() => onToggleGene(gene)}
                              />
                              <span className="truncate">{gene}</span>
                            </label>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
            </div>
          </div>
        </div>
      </CardContent>
    </div>
  );
}
