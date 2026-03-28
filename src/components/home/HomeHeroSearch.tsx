"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ScopeSearchBar, { type SearchScope } from "@/components/search/ScopeSearchBar";
import { genePageHref, speciesPageHref } from "@/lib/pageEntityQuery";
import { geneNameToSlug } from "@/lib/flagellaGeneClassification";
import { speciesNameToSlug } from "@/lib/speciesNaming";

const modelSpecies = ["Escherichia coli", "Bacillus subtilis", "Pseudomonas aeruginosa"];
const modelGenes = ["FliG", "FlgB", "MotA"];

export default function HomeHeroSearch() {
  const router = useRouter();
  const [scope, setScope] = useState<SearchScope>("species");

  return (
    <section className="hero">
      <div className="container hero-content hero-content-search-only">
        <p className="hero-search-title">
          {scope === "species" ? "Find Your Species" : "Find Your Gene"}
        </p>

        <ScopeSearchBar variant="hero" onScopeChange={setScope} />

        <div className="hero-model-organisms" aria-label="Example searches">
          <span className="hero-model-label">Examples:</span>
          <span className="hero-model-list">
            {scope === "species"
              ? modelSpecies.map((name, index) => (
                  <span key={name}>
                    <button
                      type="button"
                      className="hero-model-link"
                      onClick={() => router.push(speciesPageHref(speciesNameToSlug(name)))}
                    >
                      {name}
                    </button>
                    {index < modelSpecies.length - 1 ? (
                      <span className="hero-model-separator">, </span>
                    ) : null}
                  </span>
                ))
              : modelGenes.map((name, index) => (
                  <span key={name}>
                    <button
                      type="button"
                      className="hero-model-link"
                      onClick={() => router.push(genePageHref(geneNameToSlug(name)))}
                    >
                      {name}
                    </button>
                    {index < modelGenes.length - 1 ? (
                      <span className="hero-model-separator">, </span>
                    ) : null}
                  </span>
                ))}
          </span>
        </div>
      </div>
    </section>
  );
}
