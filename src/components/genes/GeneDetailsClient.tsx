"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PageShell from "@/components/layout/PageShell";
import SequenceLogoChart from "@/components/SequenceLogoChart";
import {
  getAlignmentPathForGeneClient,
  getGeneProfileBySlugClient,
  getSpeciesGeneIdsByGeneClient,
  type GeneProfile
} from "@/lib/browserGenes";
import { PAGE_ENTITY_ID_QUERY, genePageHref } from "@/lib/pageEntityQuery";

export default function GeneDetailsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const idParam = searchParams.get(PAGE_ENTITY_ID_QUERY)?.trim() ?? "";
  const legacySlugParam = searchParams.get("slug")?.trim() ?? "";
  const entityId = idParam || legacySlugParam;

  useEffect(() => {
    if (legacySlugParam && !idParam) {
      router.replace(genePageHref(legacySlugParam));
    }
  }, [idParam, legacySlugParam, router]);
  const [gene, setGene] = useState<GeneProfile | null>(null);
  const [alignmentPath, setAlignmentPath] = useState<string | null>(null);
  const [speciesGeneIdsByName, setSpeciesGeneIdsByName] = useState<
    Record<string, { gtdb: string[]; ncbi: Array<string | null> }>
  >({});
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!entityId) {
      setGene(null);
      setAlignmentPath(null);
      setSpeciesGeneIdsByName({});
      setLoadError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);

    getGeneProfileBySlugClient(entityId)
      .then(async (profile) => {
        if (cancelled) {
          return;
        }

        if (!profile) {
          setGene(null);
          setAlignmentPath(null);
          setSpeciesGeneIdsByName({});
          setLoadError("Gene not found.");
          return;
        }

        setGene(profile);

        const [nextAlignmentPath, nextSpeciesGeneIdsByName] = await Promise.all([
          getAlignmentPathForGeneClient(profile.name),
          getSpeciesGeneIdsByGeneClient(profile.name)
        ]);

        if (cancelled) {
          return;
        }

        setAlignmentPath(nextAlignmentPath);
        setSpeciesGeneIdsByName(nextSpeciesGeneIdsByName);
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Failed to load gene details.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [entityId]);

  const maxNeighborCount = Math.max(...(gene?.topNeighbors ?? []).map((neighbor) => neighbor.count), 1);

  return (
    <PageShell>
      <section className="species-grid species-grid-details">
        <article className="species-card species-card-wide">
          {!entityId ? <p>Select a gene from a link in the site.</p> : null}
          {isLoading ? <p>Loading gene details...</p> : null}
          {loadError ? <p>{loadError}</p> : null}

          {gene ? (
            <>
              <h1 className="species-profile-title">Gene: {gene.name}</h1>
              <p>{gene.knownFunctionSummary}</p>
              <dl className="species-taxonomy">
                <div>
                  <dt>Genome assemblies present</dt>
                  <dd>
                    {gene.presentAssemblies.toLocaleString()} /{" "}
                    {gene.totalAssemblies.toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt>Known function</dt>
                  <dd>{gene.functionalCategory}</dd>
                </div>
                <div>
                  <dt>Component label</dt>
                  <dd>{gene.componentLabel}</dd>
                </div>
              </dl>
            </>
          ) : null}
        </article>

        {gene ? (
          <article className="species-card species-card-wide">
            <h2>Most Frequent Neighboring Genes</h2>
            {gene.topNeighbors.length === 0 ? (
              <p>No neighboring gene frequencies are available for this gene in the current dataset.</p>
            ) : (
              <div className="gene-neighbor-chart" aria-label="Top neighboring genes bar chart">
                {gene.topNeighbors.map((neighbor) => (
                  <div key={neighbor.name} className="gene-neighbor-row">
                    <div className="gene-neighbor-labels">
                      <span className="gene-neighbor-name">{neighbor.name}</span>
                      <span className="gene-neighbor-count">{neighbor.count.toLocaleString()}</span>
                    </div>
                    <div className="gene-neighbor-bar-track" aria-hidden="true">
                      <div
                        className="gene-neighbor-bar-fill"
                        style={{
                          width: `${(neighbor.count / maxNeighborCount) * 100}%`
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>
        ) : null}

        {gene ? (
          <article className="species-card species-card-wide">
            <SequenceLogoChart
              geneName={gene.name}
              alignmentPath={alignmentPath}
              speciesGeneIdsByName={speciesGeneIdsByName}
            />
          </article>
        ) : null}
      </section>
    </PageShell>
  );
}
