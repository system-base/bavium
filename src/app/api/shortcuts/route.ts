/* ==========================================================================
   API Route: /api/shortcuts
   Saved shortcut CRUD facade over Convex.
   ========================================================================== */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-middleware";
import {
    createSavedShortcutInConvex,
    hasConvexBackend,
    listSavedShortcutsPaginatedFromConvex,
} from "@/lib/convex-server";
import { consumeServerRateLimit } from "@/lib/server-rate-limit";
import { sanitizeErrorMessage } from "@/lib/error-sanitizer";
import { parseShortcutCreateBody } from "@/lib/shortcut-contract";

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

        const result = await listSavedShortcutsPaginatedFromConvex(
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
            { error: sanitizeErrorMessage(error, "Failed to list saved shortcuts.") },
            { status: 500 },
        );
    }
}

export async function POST(request: NextRequest) {
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
            bucket: "shortcut-create",
            key: auth.session.address,
            windowMs: 60_000,
            max: 12,
        });
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { error: `Too many save requests. Try again in ${rateLimit.retryAfterSeconds}s.` },
                { status: 429 },
            );
        }

        const body: unknown = await request.json();
        const parsed = parseShortcutCreateBody(body);
        if (!parsed.ok) {
            return NextResponse.json(
                { error: parsed.error },
                { status: 400 },
            );
        }

        const shortcutId = await createSavedShortcutInConvex({
            ownerAddress: auth.session.address,
            name: parsed.value.name,
            description: parsed.value.description,
            category: parsed.value.category,
            inputs: parsed.value.inputs,
            steps: parsed.value.steps,
            version: parsed.value.version ?? "1.0.0",
        });

        return NextResponse.json({ shortcutId }, { status: 201 });
    } catch (error) {
        return NextResponse.json(
            { error: sanitizeErrorMessage(error, "Failed to create shortcut.") },
            { status: 500 },
        );
    }
}
