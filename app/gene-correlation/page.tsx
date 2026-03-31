import GeneCorrelationClient from "@/components/GeneCorrelationClient";
import PageHeader from "@/components/layout/PageHeader";
import PageShell from "@/components/layout/PageShell";

export default function GeneCorrelationPage() {
  return (
    <PageShell>
      <PageHeader
        title="Gene Co-presence Heatmap and Clustering"
        description={
          <span className="text-[var(--text)]">
            Explore which flagellar genes tend to be co-present in the same genomes, and how those
            genes cluster when genomes are compared by
            shared presence. The heatmap uses weighted Jaccard similarity; the dendrogram uses
            complete linkage on <span className="whitespace-nowrap">1 − similarity</span>.
          </span>
        }
      />
      <GeneCorrelationClient />
    </PageShell>
  );
}
