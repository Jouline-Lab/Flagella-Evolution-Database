import { notFound } from "next/navigation";
import PageShell from "@/components/layout/PageShell";
import SpeciesFlagellaInteractivePanel from "@/components/species/SpeciesFlagellaInteractivePanel";
import { getSpeciesFlagellaContent } from "@/lib/speciesFlagellaContent";
import SpeciesOperonTracks from "@/components/species/SpeciesOperonTracks";
import { getSpeciesOperonContent } from "@/lib/speciesOperonContent";
import { getAllSpeciesProfiles, getSpeciesProfileBySlug } from "@/lib/speciesTaxonomy";

type SpeciesDetailsPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export async function generateStaticParams() {
  const species = await getAllSpeciesProfiles();
  return species.map((item) => ({ slug: item.slug }));
}

export default async function SpeciesDetailsPage({ params }: SpeciesDetailsPageProps) {
  const { slug } = await params;
  const species = await getSpeciesProfileBySlug(slug);

  if (!species) {
    notFound();
  }

  const flagellaContent = await getSpeciesFlagellaContent(species.name);
  const operonContent = await getSpeciesOperonContent(species.name);

  return (
    <PageShell>
      <section className="species-grid species-grid-details">
        <article className="species-card species-card-wide">
          <h1 className="species-profile-title">Species: {species.name}</h1>
          <h2>Taxonomy</h2>
          <dl className="species-taxonomy">
            <div>
              <dt>Phylum</dt>
              <dd>{species.taxonomy.phylum}</dd>
            </div>
            <div>
              <dt>Class</dt>
              <dd>{species.taxonomy.className}</dd>
            </div>
            <div>
              <dt>Order</dt>
              <dd>{species.taxonomy.order}</dd>
            </div>
            <div>
              <dt>Family</dt>
              <dd>{species.taxonomy.family}</dd>
            </div>
            <div>
              <dt>Genus</dt>
              <dd>{species.taxonomy.genus}</dd>
            </div>
          </dl>
        </article>

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
      </section>
    </PageShell>
  );
}
