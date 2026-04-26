import { NextRequest, NextResponse } from "next/server";
import {
    archivePublishedShortcutInConvex,
    getPublishedShortcutBySlugFromConvex,
    hasConvexBackend,
} from "@/lib/convex-server";
import {
    consumeBestEffortRateLimit,
    getRequestClientKey,
} from "@/lib/server-rate-limit";
import { requireAuth } from "@/lib/api-middleware";
import { sanitizeErrorMessage, getHttpStatusFromError } from "@/lib/error-sanitizer";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ slug: string }> },
) {
    const rateLimit = consumeBestEffortRateLimit({
        bucket: "published-shortcut-detail-read",
        key: getRequestClientKey(request),
        windowMs: 60_000,
        max: 120,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            {
                error: `Too many shortcut detail requests. Try again in ${rateLimit.retryAfterSeconds}s.`,
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
        const { slug } = await params;
        const shortcut = await getPublishedShortcutBySlugFromConvex(slug);

        if (!shortcut) {
            const response = NextResponse.json(
                { error: "Public shortcut not found." },
                { status: 404 },
            );
            response.headers.set("Cache-Control", "public, s-maxage=15, stale-while-revalidate=60");
            return response;
        }

        const response = NextResponse.json({ shortcut });
        response.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
        return response;
    } catch (error) {
        return NextResponse.json(
            { error: sanitizeErrorMessage(error, "Failed to load public shortcut.") },
            { status: 500 },
        );
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ slug: string }> },
) {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    if (!hasConvexBackend()) {
        return NextResponse.json(
            { error: "Convex backend is not configured." },
            { status: 503 },
        );
    }

    const rateLimit = consumeBestEffortRateLimit({
        bucket: "published-shortcut-archive",
        key: getRequestClientKey(request),
        windowMs: 60_000,
        max: 20,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            {
                error: `Too many visibility changes. Try again in ${rateLimit.retryAfterSeconds}s.`,
            },
            { status: 429 },
        );
    }

    try {
        const { slug } = await params;
        await archivePublishedShortcutInConvex({
            ownerAddress: auth.session.address,
            slug,
        });

        return NextResponse.json({ archived: true });
    } catch (error) {
        return NextResponse.json(
            { error: sanitizeErrorMessage(error, "Failed to make shortcut private.") },
            { status: getHttpStatusFromError(error) },
        );
    }
}
