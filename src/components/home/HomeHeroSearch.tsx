"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SpeciesSearch from "@/components/SpeciesSearch";
import { speciesNameToSlug } from "@/lib/speciesNaming";

const modelOrganisms = [
  "Escherichia coli",
  "Bacillus subtilis",
  "Pseudomonas aeruginosa"
];

export default function HomeHeroSearch() {
  const [query, setQuery] = useState("");
  const router = useRouter();

  return (
    <section className="hero">
      <div className="container hero-content hero-content-search-only">
        <p className="hero-search-title">Find Your Species</p>
        <SpeciesSearch
          className="hero-search"
          inputClassName="species-search-input"
          placeholder="Search for a species (e.g., Escherichia coli)"
          query={query}
          onQueryChange={setQuery}
        />
        <div className="hero-model-organisms" aria-label="Model organism examples">
          <span className="hero-model-label">Examples:</span>
          <span className="hero-model-list">
            {modelOrganisms.map((name, index) => (
              <span key={name}>
                <button
                  type="button"
                  className="hero-model-link"
                  onClick={() => {
                    router.push(`/species?slug=${encodeURIComponent(speciesNameToSlug(name))}`);
                  }}
                >
                  {name}
                </button>
                {index < modelOrganisms.length - 1 ? (
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
