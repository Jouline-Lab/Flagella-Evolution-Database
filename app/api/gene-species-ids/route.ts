import { NextResponse } from "next/server";
import { getSpeciesGeneIds } from "@/lib/speciesGeneLookup";

type GeneSpeciesIdsRequest = {
  geneName?: string;
  speciesName?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GeneSpeciesIdsRequest;
    const geneName = (body.geneName ?? "").trim();
    const speciesName = (body.speciesName ?? "").trim();

    if (!geneName || !speciesName) {
      return NextResponse.json(
        {
          error: "Both geneName and speciesName are required."
        },
        { status: 400 }
      );
    }

    const result = await getSpeciesGeneIds(speciesName, geneName);
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load species gene IDs"
      },
      { status: 500 }
    );
  }
}
