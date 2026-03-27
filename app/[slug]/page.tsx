import Link from "next/link";
import { notFound } from "next/navigation";
import { withBasePath } from "@/lib/assetPaths";
import { getAllGeneProfiles, getGeneProfileBySlug } from "@/lib/geneProfiles";

type GeneAliasPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

const RESERVED_SLUGS = new Set([
  "api",
  "species",
  "genes",
  "faq",
  "cite-us",
  "phyletic-distribution-table",
  "phyletic-distribution-visualization"
]);

export async function generateStaticParams() {
  const genes = await getAllGeneProfiles();
  return genes
    .filter((gene) => !RESERVED_SLUGS.has(gene.slug))
    .map((gene) => ({ slug: gene.slug }));
}

export default async function GeneAliasPage({ params }: GeneAliasPageProps) {
  const { slug } = await params;

  if (slug.includes(".") || RESERVED_SLUGS.has(slug)) {
    notFound();
  }

  const gene = await getGeneProfileBySlug(slug);

  if (!gene) {
    notFound();
  }

  const targetPath = withBasePath(`/genes/${gene.slug}`);

  return (
    <main className="page-shell">
      <div className="container">
        <p>
          Redirecting to the gene page. If nothing happens, use{" "}
          <Link href={`/genes/${gene.slug}`}>this link</Link>.
        </p>
      </div>
      <script
        dangerouslySetInnerHTML={{
          __html: `window.location.replace(${JSON.stringify(targetPath)});`
        }}
      />
    </main>
  );
}
