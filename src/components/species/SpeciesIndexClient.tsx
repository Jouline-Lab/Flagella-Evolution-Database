"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PageHeader from "@/components/layout/PageHeader";
import PageShell from "@/components/layout/PageShell";
import SpeciesFlagellaInteractivePanel from "@/components/species/SpeciesFlagellaInteractivePanel";
import SpeciesOperonTracks from "@/components/species/SpeciesOperonTracks";
import { getAllSpeciesProfilesClient } from "@/lib/browserSpecies";
import { getSpeciesFlagellaContentClient } from "@/lib/browserSpeciesFlagella";
import { getSpeciesOperonContentClient } from "@/lib/browserSpeciesOperon";
import { PAGE_ENTITY_ID_QUERY, speciesPageHref } from "@/lib/pageEntityQuery";
import type {
  SpeciesFlagellaContent,
  SpeciesOperonContent,
  SpeciesProfile
} from "@/lib/speciesData";

export default function SpeciesIndexClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const idParam = searchParams.get(PAGE_ENTITY_ID_QUERY)?.trim() ?? "";
  const legacySlugParam = searchParams.get("slug")?.trim() ?? "";
  const entityId = idParam || legacySlugParam;

  useEffect(() => {
    if (legacySlugParam && !idParam) {
      router.replace(speciesPageHref(legacySlugParam));
    }
  }, [idParam, legacySlugParam, router]);
  const [species, setSpecies] = useState<SpeciesProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flagellaContent, setFlagellaContent] = useState<SpeciesFlagellaContent | null>(null);
  const [operonContent, setOperonContent] = useState<SpeciesOperonContent | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getAllSpeciesProfilesClient()
      .then((rows) => {
        if (cancelled) {
          return;
        }

        setSpecies(rows);
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

  const selectedSpecies = useMemo(
    () => species.find((item) => item.slug === entityId) ?? null,
    [entityId, species]
  );

  useEffect(() => {
    if (!selectedSpecies) {
      setFlagellaContent(null);
      setOperonContent(null);
      setDetailError(entityId ? "Species not found." : null);
      setDetailLoading(false);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);

    Promise.all([
      getSpeciesFlagellaContentClient(selectedSpecies.name),
      getSpeciesOperonContentClient(selectedSpecies.name)
    ])
      .then(([flagella, operon]) => {
        if (cancelled) {
          return;
        }

        setFlagellaContent(flagella);
        setOperonContent(operon);
      })
      .catch((error) => {
        if (!cancelled) {
          setDetailError(
            error instanceof Error ? error.message : "Failed to load species details."
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSpecies, entityId]);

  return (
    <PageShell>
      {entityId ? (
        <section className="species-grid species-grid-details">
          <article className="species-card species-card-wide">
            {isLoading || detailLoading ? <p>Loading species details...</p> : null}
            {loadError ? <p>{loadError}</p> : null}
            {detailError ? <p>{detailError}</p> : null}

            {!isLoading && !detailLoading && !loadError && !detailError && selectedSpecies && flagellaContent && operonContent ? (
              <>
                <h1 className="species-profile-title">Species: {selectedSpecies.name}</h1>
                <h2>Taxonomy</h2>
                {selectedSpecies.summary.trim() ? <p>{selectedSpecies.summary}</p> : null}
                <dl className="species-taxonomy">
                  <div>
                    <dt>Phylum</dt>
                    <dd>{selectedSpecies.taxonomy.phylum}</dd>
                  </div>
                  <div>
                    <dt>Class</dt>
                    <dd>{selectedSpecies.taxonomy.className}</dd>
                  </div>
                  <div>
                    <dt>Order</dt>
                    <dd>{selectedSpecies.taxonomy.order}</dd>
                  </div>
                  <div>
                    <dt>Family</dt>
                    <dd>{selectedSpecies.taxonomy.family}</dd>
                  </div>
                  <div>
                    <dt>Genus</dt>
                    <dd>{selectedSpecies.taxonomy.genus}</dd>
                  </div>
                </dl>
              </>
            ) : null}
          </article>

          {!isLoading && !detailLoading && !loadError && !detailError && selectedSpecies && flagellaContent && operonContent ? (
            <>
              <article className="species-card species-card-wide">
                <h2>Flagellar Content</h2>
                {flagellaContent.matchedAssemblies === 0 ? (
                  <p>
                    No matching assemblies were found in the main phyletic table for this
                    species.
                  </p>
                ) : (
                  <>
                    <p className="species-flagella-summary">
                      Total flagellar gene counts:{" "}
                      <strong>{flagellaContent.totalGeneCount.toLocaleString()}</strong>
                    </p>
                    <SpeciesFlagellaInteractivePanel groups={flagellaContent.groups} />
                  </>
                )}
              </article>

              <article className="species-card species-card-wide">
                <h2>Operon Organization by Contig</h2>
                <SpeciesOperonTracks content={operonContent} />
              </article>
            </>
          ) : null}
        </section>
      ) : (
        <>
          <PageHeader
            eyebrow="Species"
            title="Species page unavailable"
            description="The species index listing has been removed."
          />
          <p>Use direct species links if you still need a species detail page.</p>
        </>
      )}
    </PageShell>
  );
}
