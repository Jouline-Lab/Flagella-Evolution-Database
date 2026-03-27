import { notFound, redirect } from "next/navigation";
import { getGeneProfileBySlug } from "@/lib/geneProfiles";

type GeneAliasPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function GeneAliasPage({ params }: GeneAliasPageProps) {
  const { slug } = await params;

  if (slug.includes(".")) {
    notFound();
  }

  const gene = await getGeneProfileBySlug(slug);

  if (!gene) {
    notFound();
  }

  redirect(`/genes/${gene.slug}`);
}
