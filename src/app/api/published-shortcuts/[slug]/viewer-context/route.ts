import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-middleware";
import {
    getPublishedShortcutViewerContextFromConvex,
    hasConvexBackend,
} from "@/lib/convex-server";
import { sanitizeErrorMessage } from "@/lib/error-sanitizer";

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
        const context = await getPublishedShortcutViewerContextFromConvex({
            ownerAddress: auth.session.address,
            slug,
        });

        return NextResponse.json(context);
    } catch (error) {
        return NextResponse.json(
            { error: sanitizeErrorMessage(error, "Failed to load viewer context.") },
            { status: 500 },
        );
    }
}
