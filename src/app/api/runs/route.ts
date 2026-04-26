/* ==========================================================================
   API Route: /api/runs
   Run history facade over Convex — with cursor-based pagination.
   ========================================================================== */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-middleware";
import {
    deleteRunBatchFromConvex,
    hasConvexBackend,
    listRunsPaginatedFromConvex,
} from "@/lib/convex-server";
import { sanitizeErrorMessage } from "@/lib/error-sanitizer";

export async function GET(request: NextRequest) {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    if (!hasConvexBackend()) {
        return NextResponse.json(
            { error: "Convex backend is not configured." },
            { status: 503 },
        );
    }

    try {
        const { searchParams } = new URL(request.url);
        const cursor = searchParams.get("cursor") ?? undefined;
        const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10) || 20, 100);

        const result = await listRunsPaginatedFromConvex(
            auth.session.address,
            { numItems: limit, cursor: cursor ?? null },
        );

        return NextResponse.json({
            runs: result.page,
            continueCursor: result.continueCursor,
            isDone: result.isDone,
        });
    } catch (error) {
        return NextResponse.json(
            { error: sanitizeErrorMessage(error, "Failed to load runs.") },
            { status: 500 },
        );
    }
}

export async function DELETE(request: NextRequest) {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    if (!hasConvexBackend()) {
        return NextResponse.json(
            { error: "Convex backend is not configured." },
            { status: 503 },
        );
    }

    try {
        let deletedCount = 0;
        let hasMore = true;

        while (hasMore) {
            const result = await deleteRunBatchFromConvex(auth.session.address, 25);
            deletedCount += result.deletedCount;
            hasMore = result.hasMore && result.deletedCount > 0;
        }

        return NextResponse.json({
            deleted: true,
            deletedCount,
        });
    } catch (error) {
        return NextResponse.json(
            { error: sanitizeErrorMessage(error, "Failed to delete runs.") },
            { status: 500 },
        );
    }
}
