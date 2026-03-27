import { Suspense } from "react";
import GeneDetailsClient from "@/components/genes/GeneDetailsClient";

export default function GenesPage() {
  return (
    <Suspense fallback={<main className="page-shell"><div className="container">Loading gene page...</div></main>}>
      <GeneDetailsClient />
    </Suspense>
  );
}
