import { Suspense } from "react";
import SpeciesIndexClient from "@/components/species/SpeciesIndexClient";

export default function SpeciesIndexPage() {
  return (
    <Suspense fallback={<main className="page-shell"><div className="container">Loading species page...</div></main>}>
      <SpeciesIndexClient />
    </Suspense>
  );
}
