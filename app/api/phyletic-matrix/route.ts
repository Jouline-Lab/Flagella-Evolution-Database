import { NextResponse } from "next/server";
import {
  type CountFilterState,
  queryPhyleticMatrix
} from "@/lib/phyleticPreview";

type QueryRequest = {
  visibleColumns?: string[];
  taxonomyFilters?: Record<string, string[]>;
  countFilters?: Record<string, CountFilterState>;
  requiredCountColumns?: string[];
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as QueryRequest;
    const visibleColumns = Array.isArray(body.visibleColumns)
      ? body.visibleColumns
      : [];

    if (visibleColumns.length === 0) {
      return NextResponse.json({
        rows: [],
        totalRows: 0,
        matchedRows: 0
      });
    }

    const result = await queryPhyleticMatrix({
      visibleColumns,
      taxonomyFilters: body.taxonomyFilters ?? {},
      countFilters: body.countFilters ?? {},
      requiredCountColumns: body.requiredCountColumns ?? []
    });

    return NextResponse.json({
      rows: result.rows,
      totalRows: result.totalRows,
      matchedRows: result.matchedRows
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to query table"
      },
      { status: 500 }
    );
  }
}
