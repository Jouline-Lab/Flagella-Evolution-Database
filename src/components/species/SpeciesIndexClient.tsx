"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import EmptyState from "@/components/layout/EmptyState";
import PageHeader from "@/components/layout/PageHeader";
import PageShell from "@/components/layout/PageShell";
import { getAllSpeciesProfilesClient } from "@/lib/browserSpecies";
import { normalizeSpeciesQuery } from "@/lib/speciesNaming";

export default function SpeciesIndexClient() {
  const searchParams = useSearchParams();
  const query = searchParams.get("query")?.trim() ?? "";
  const normalizedQuery = normalizeSpeciesQuery(query);
  const [species, setSpecies] = useState<Array<{ name: string; slug: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getAllSpeciesProfilesClient()
      .then((rows) => {
        if (cancelled) {
          return;
        }

        setSpecies(rows.map((item) => ({ name: item.name, slug: item.slug })));
        setLoadError(null);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setLoadError(error instanceof Error ? error.message : "Failed to load species index.");
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredSpecies = useMemo(() => {
    const rows = normalizedQuery
      ? species.filter((item) => normalizeSpeciesQuery(item.name).includes(normalizedQuery))
      : species;

    return rows.slice(0, 120);
  }, [normalizedQuery, species]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Species Index"
        title="Species pages"
        description="Browse species records and jump to each dedicated page for taxonomy and flagella-related notes."
      />

      {query ? (
        <p className="species-query-result">
          Search: <strong>{query}</strong>
        </p>
      ) : null}

      {isLoading ? <p>Loading species index...</p> : null}
      {loadError ? <p>{loadError}</p> : null}

      {!isLoading && !loadError && filteredSpecies.length === 0 ? (
        <EmptyState
          title="No species found"
          description="Try a different species name."
          actionHref="/"
          actionLabel="Back to homepage"
        />
      ) : null}

      {!isLoading && !loadError && filteredSpecies.length > 0 ? (
        <section className="species-grid">
          {filteredSpecies.map((item) => (
            <article key={item.slug} className="species-card">
              <h2>{item.name}</h2>
              <p>Taxonomy-derived species profile from the phyletic matrix dataset.</p>
              <Link href={`/species/${item.slug}`} className="button button-primary">
                Navigate to species page
              </Link>
            </article>
          ))}
        </section>
      ) : null}
    </PageShell>
  );
}
