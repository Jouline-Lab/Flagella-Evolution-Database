import { NextResponse } from "next/server";
import { getSpeciesSuggestions } from "@/lib/speciesTaxonomy";

type SpeciesSuggestionsRequest = {
  query?: string;
  limit?: number;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SpeciesSuggestionsRequest;
    const query = (body.query ?? "").trim();
    const limit = Number(body.limit ?? 20);
    const safeLimit = Number.isNaN(limit) ? 20 : Math.min(Math.max(limit, 1), 50);

    const suggestions = await getSpeciesSuggestions(query, safeLimit);
    return NextResponse.json({ suggestions });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load species suggestions"
      },
      { status: 500 }
    );
  }
}
