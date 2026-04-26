import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-middleware";
import {
    bookmarkPublishedShortcutInConvex,
    getPublishedShortcutBookmarkStateFromConvex,
    hasConvexBackend,
    removePublishedShortcutBookmarkInConvex,
} from "@/lib/convex-server";
import { consumeServerRateLimit } from "@/lib/server-rate-limit";
import { sanitizeErrorMessage, getHttpStatusFromError } from "@/lib/error-sanitizer";

export async function GET(
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

    try {
        const { slug } = await params;
        const state = await getPublishedShortcutBookmarkStateFromConvex({
            ownerAddress: auth.session.address,
            slug,
        });

        return NextResponse.json(state);
    } catch (error) {
        return NextResponse.json(
            { error: sanitizeErrorMessage(error, "Failed to load bookmark state.") },
            { status: getHttpStatusFromError(error) },
        );
    }
}

export async function POST(
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

    try {
        const rateLimit = await consumeServerRateLimit({
            bucket: "published-shortcut-bookmark-add",
            key: auth.session.address,
            windowMs: 60_000,
            max: 30,
        });
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { error: `Too many bookmark requests. Try again in ${rateLimit.retryAfterSeconds}s.` },
                { status: 429 },
            );
        }

        const { slug } = await params;
        const result = await bookmarkPublishedShortcutInConvex({
            ownerAddress: auth.session.address,
            slug,
        });

        return NextResponse.json(result, { status: 201 });
    } catch (error) {
        return NextResponse.json(
            { error: sanitizeErrorMessage(error, "Failed to bookmark shortcut.") },
            { status: getHttpStatusFromError(error) },
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

    try {
        const rateLimit = await consumeServerRateLimit({
            bucket: "published-shortcut-bookmark-remove",
            key: auth.session.address,
            windowMs: 60_000,
            max: 30,
        });
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { error: `Too many bookmark removal requests. Try again in ${rateLimit.retryAfterSeconds}s.` },
                { status: 429 },
            );
        }

        const { slug } = await params;
        const result = await removePublishedShortcutBookmarkInConvex({
            ownerAddress: auth.session.address,
            slug,
        });

        return NextResponse.json(result);
    } catch (error) {
        return NextResponse.json(
            { error: sanitizeErrorMessage(error, "Failed to remove bookmark.") },
            { status: getHttpStatusFromError(error) },
        );
    }
}
