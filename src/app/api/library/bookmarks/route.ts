import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-middleware";
import {
    hasConvexBackend,
    listBookmarkedPublishedShortcutsPaginatedFromConvex,
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
        const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10) || 20, 50);

        const result = await listBookmarkedPublishedShortcutsPaginatedFromConvex(
            auth.session.address,
            { numItems: limit, cursor: cursor ?? null },
        );

        return NextResponse.json({
            shortcuts: result.page,
            continueCursor: result.continueCursor,
            isDone: result.isDone,
        });
    } catch (error) {
        return NextResponse.json(
            { error: sanitizeErrorMessage(error, "Failed to load bookmark library.") },
            { status: 500 },
        );
    }
}
