import PageHeader from "@/components/layout/PageHeader";
import PageShell from "@/components/layout/PageShell";
import InsertionNeighborTableClient from "@/components/operonInsertions/InsertionNeighborTableClient";

export default function OperonInsertionsPage() {
  return (
    <PageShell>
      <PageHeader
        eyebrow="Experimental analysis"
        className="page-header-prominent"
        title="Operon Insertion Neighborhoods"
        description={
          <span className="text-[var(--text)]">
            Explore which flagellar genes most frequently neighbor candidate inserted proteins and
            compare the distributions of their genomic distances.
          </span>
        }
      />
      <InsertionNeighborTableClient />
    </PageShell>
  );
}
