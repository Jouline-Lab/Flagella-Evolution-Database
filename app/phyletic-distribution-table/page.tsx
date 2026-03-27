import PhyleticTableExplorer from "@/components/PhyleticTableExplorer";
import { getPhyleticHeaders } from "@/lib/phyleticPreview";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PhyleticDistributionTablePage() {
  const headers = await getPhyleticHeaders();

  return <PhyleticTableExplorer headers={headers} />;
}
