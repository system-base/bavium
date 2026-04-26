import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-middleware";
import {
    hasConvexBackend,
    remixPublishedShortcutInConvex,
} from "@/lib/convex-server";
import { consumeServerRateLimit } from "@/lib/server-rate-limit";
import { sanitizeErrorMessage, getHttpStatusFromError } from "@/lib/error-sanitizer";

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
            bucket: "published-shortcut-remix",
            key: auth.session.address,
            windowMs: 60_000,
            max: 12,
        });
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { error: `Too many add requests. Try again in ${rateLimit.retryAfterSeconds}s.` },
                { status: 429 },
            );
        }

        const { slug } = await params;
        const result = await remixPublishedShortcutInConvex({
            ownerAddress: auth.session.address,
            slug,
        });

        return NextResponse.json(result, { status: 201 });
    } catch (error) {
        return NextResponse.json(
            { error: sanitizeErrorMessage(error, "Failed to add shortcut.") },
            { status: getHttpStatusFromError(error) },
        );
    }
}
