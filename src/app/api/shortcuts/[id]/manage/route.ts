import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-middleware";
import {
    getSavedShortcutManageDetailFromConvex,
    hasConvexBackend,
} from "@/lib/convex-server";
import type { Id } from "@/lib/convex-server";
import { consumeBestEffortRateLimit } from "@/lib/server-rate-limit";
import { sanitizeErrorMessage } from "@/lib/error-sanitizer";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
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
        bucket: "shortcut-manage-read",
        key: auth.session.address,
        windowMs: 60_000,
        max: 60,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            {
                error: `Too many shortcut management requests. Try again in ${rateLimit.retryAfterSeconds}s.`,
            },
            { status: 429 },
        );
    }

    try {
        const { id } = await params;
        const detail = await getSavedShortcutManageDetailFromConvex(
            auth.session.address,
            id as Id<"saved_shortcuts">,
        );

        if (!detail) {
            return NextResponse.json({ error: "Shortcut not found" }, { status: 404 });
        }

        return NextResponse.json({
            shortcut: detail.shortcut,
            publication: detail.publication,
            automations: detail.linkedAutomations.map((automation: typeof detail.linkedAutomations[number]) => ({
                id: String(automation._id),
                name: automation.name,
                description: automation.description ?? "",
                status: automation.status,
                targetShortcutId: automation.targetShortcutId,
                nextRunAt: automation.nextRunAt,
            })),
        });
    } catch (error) {
        return NextResponse.json(
            { error: sanitizeErrorMessage(error, "Failed to load shortcut management surface.") },
            { status: 500 },
        );
    }
}
