import PageHeader from "@/components/layout/PageHeader";
import PageShell from "@/components/layout/PageShell";

export default function CiteUsPage() {
  return (
    <PageShell>
      <PageHeader
        className="page-header-prominent"
        title="Cite Us"
        description="Please cite the Flagella Database and related work when using these resources."
      />
      <section className="content-card">
        <p className="eyebrow citation-section-label">Preprint</p>
        <article className="citation-entry">
          <h2>The last bacterial common ancestor encoded a complex flagellum</h2>
          <p>
            Berkay Selcuk, Ekaterina P. Andrianova, Morgan Beeby, Daniel B. Kearns,
            Marc Erhardt, Igor B. Zhulin
          </p>
          <p>
            <span className="font-semibold">bioRxiv</span> 2026.06.11.731707; doi:{" "}
            <a href="https://doi.org/10.64898/2026.06.11.731707">
              https://doi.org/10.64898/2026.06.11.731707
            </a>
          </p>
        </article>
      </section>
    </PageShell>
  );
}
