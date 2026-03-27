import { readFile } from "fs/promises";
import path from "path";

const SOURCE_FILE = "flagella_phylogeny_37_genes_rooted_alpha0.8_cov0.8_NJ_rooted_for_visualization.tree";

export async function GET() {
  const filePath = path.join(process.cwd(), "public", SOURCE_FILE);
  const body = await readFile(filePath, "utf8");

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8"
    }
  });
}
