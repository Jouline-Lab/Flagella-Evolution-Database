import { notFound } from "next/navigation";
import PageShell from "@/components/layout/PageShell";
import SequenceLogoChart from "@/components/SequenceLogoChart";
import { getAlignmentPathForGene } from "@/lib/geneAlignments";
import { getAllGeneProfiles, getGeneProfileBySlug } from "@/lib/geneProfiles";
import { getSpeciesGeneIdsByGene } from "@/lib/speciesGeneLookup";

type GeneDetailsPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export async function generateStaticParams() {
  const genes = await getAllGeneProfiles();
  return genes.map((gene) => ({ slug: gene.slug }));
}

export default async function GeneDetailsPage({ params }: GeneDetailsPageProps) {
  const { slug } = await params;
  const gene = await getGeneProfileBySlug(slug);

  if (!gene) {
    notFound();
  }

  const maxNeighborCount = Math.max(...gene.topNeighbors.map((neighbor) => neighbor.count), 1);
  const alignmentPath = await getAlignmentPathForGene(gene.name);
  const speciesGeneIdsByName = await getSpeciesGeneIdsByGene(gene.name);

  return (
    <PageShell>
      <section className="species-grid species-grid-details">
        <article className="species-card species-card-wide">
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
        </article>

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

        <article className="species-card species-card-wide">
          <SequenceLogoChart
            geneName={gene.name}
            alignmentPath={alignmentPath}
            speciesGeneIdsByName={speciesGeneIdsByName}
          />
        </article>
      </section>
    </PageShell>
  );
}
