import Link from "next/link";
import EmptyState from "@/components/layout/EmptyState";
import PageHeader from "@/components/layout/PageHeader";
import PageShell from "@/components/layout/PageShell";
import { getSpeciesSuggestions } from "@/lib/speciesTaxonomy";
import { normalizeSpeciesQuery } from "@/lib/speciesNaming";

type SpeciesIndexPageProps = {
  searchParams?: Promise<{
    query?: string;
  }>;
};

export default async function SpeciesIndexPage({ searchParams }: SpeciesIndexPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const query = resolvedSearchParams?.query?.trim() ?? "";
  const normalizedQuery = normalizeSpeciesQuery(query);
  const filteredSpecies = await getSpeciesSuggestions(normalizedQuery, 120);

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

      {filteredSpecies.length === 0 ? (
        <EmptyState
          title="No species found"
          description="Try a different species name."
          actionHref="/"
          actionLabel="Back to homepage"
        />
      ) : (
        <section className="species-grid">
          {filteredSpecies.map((species) => (
            <article key={species.slug} className="species-card">
              <h2>{species.name}</h2>
              <p>Taxonomy-derived species profile from the phyletic matrix dataset.</p>
              <Link href={`/species/${species.slug}`} className="button button-primary">
                Navigate to species page
              </Link>
            </article>
          ))}
        </section>
      )}
    </PageShell>
  );
}
