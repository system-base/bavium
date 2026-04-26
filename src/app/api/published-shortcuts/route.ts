import { NextRequest, NextResponse } from "next/server";
import {
    hasConvexBackend,
    listPublishedShortcutsPaginatedFromConvex,
} from "@/lib/convex-server";
import {
    consumeBestEffortRateLimit,
    getRequestClientKey,
} from "@/lib/server-rate-limit";
import { sanitizeErrorMessage } from "@/lib/error-sanitizer";

export async function GET(request: NextRequest) {
    const rateLimit = consumeBestEffortRateLimit({
        bucket: "published-shortcuts-list-read",
        key: getRequestClientKey(request),
        windowMs: 60_000,
        max: 60,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            {
                error: `Too many gallery requests. Try again in ${rateLimit.retryAfterSeconds}s.`,
            },
            { status: 429 },
        );
    }

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

        const result = await listPublishedShortcutsPaginatedFromConvex({
            numItems: limit,
            cursor: cursor ?? null,
        });

        const response = NextResponse.json({
            shortcuts: result.page,
            continueCursor: result.continueCursor,
            isDone: result.isDone,
        });
        response.headers.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=300");
        return response;
    } catch (error) {
        return NextResponse.json(
            { error: sanitizeErrorMessage(error, "Failed to list published shortcuts.") },
            { status: 500 },
        );
    }
}
