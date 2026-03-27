import { NextResponse } from "next/server";
import { getTaxonomySuggestions } from "@/lib/phyleticPreview";

type SuggestionRequest = {
  rank?: string;
  query?: string;
  selectedTaxonomy?: Record<string, string[]>;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SuggestionRequest;
    const rank = (body.rank ?? "").trim();
    const query = (body.query ?? "").trim();

    if (!rank) {
      return NextResponse.json({ suggestions: [] });
    }

    const suggestions = await getTaxonomySuggestions({
      rank,
      query,
      limit: 20,
      selectedTaxonomy: body.selectedTaxonomy ?? {}
    });

    return NextResponse.json({ suggestions });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load taxonomy suggestions"
      },
      { status: 500 }
    );
  }
}
