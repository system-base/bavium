/* ==========================================================================
   API Route: /api/shortcuts/[id]
   Single saved shortcut operations facade over Convex.
   ========================================================================== */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-middleware";
import {
    getSavedShortcutFromConvex,
    hasConvexBackend,
    updateSavedShortcutInConvex,
    deleteSavedShortcutFromConvex,
} from "@/lib/convex-server";
import type { Id } from "@/lib/convex-server";
import { consumeServerRateLimit } from "@/lib/server-rate-limit";
import { sanitizeErrorMessage } from "@/lib/error-sanitizer";
import { parseShortcutPatchBody } from "@/lib/shortcut-contract";

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

    try {
        const { id } = await params;
        const shortcut = await getSavedShortcutFromConvex(auth.session.address, id as Id<"saved_shortcuts">);
        if (!shortcut) {
            return NextResponse.json({ error: "Shortcut not found" }, { status: 404 });
        }
        return NextResponse.json({ shortcut });
    } catch (error) {
        return NextResponse.json(
            { error: sanitizeErrorMessage(error, "Failed to load shortcut.") },
            { status: 500 },
        );
    }
}

export async function PATCH(
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

    try {
        const { id } = await params;
        const rateLimit = await consumeServerRateLimit({
            bucket: "shortcut-update",
            key: auth.session.address,
            windowMs: 60_000,
            max: 20,
        });
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { error: `Too many update requests. Try again in ${rateLimit.retryAfterSeconds}s.` },
                { status: 429 },
            );
        }

        const parsed = parseShortcutPatchBody(await request.json());
        if (!parsed.ok) {
            return NextResponse.json(
                { error: parsed.error },
                { status: 400 },
            );
        }

        const shortcut = await updateSavedShortcutInConvex(auth.session.address, id as Id<"saved_shortcuts">, {
            ...(parsed.value.name !== undefined ? { name: parsed.value.name } : {}),
            ...(parsed.value.description !== undefined ? { description: parsed.value.description || "" } : {}),
            ...(parsed.value.category !== undefined ? { category: parsed.value.category } : {}),
            ...(parsed.value.inputs !== undefined ? { inputs: parsed.value.inputs } : {}),
            ...(parsed.value.steps !== undefined ? { steps: parsed.value.steps } : {}),
            ...(parsed.value.archivedAt !== undefined ? { archivedAt: parsed.value.archivedAt } : {}),
        });

        return NextResponse.json({ shortcut });
    } catch (error) {
        return NextResponse.json(
            { error: sanitizeErrorMessage(error, "Failed to update shortcut.") },
            { status: 500 },
        );
    }
}

export async function DELETE(
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

    try {
        const { id } = await params;
        const rateLimit = await consumeServerRateLimit({
            bucket: "shortcut-delete",
            key: auth.session.address,
            windowMs: 60_000,
            max: 5,
        });
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { error: `Too many delete requests. Try again in ${rateLimit.retryAfterSeconds}s.` },
                { status: 429 },
            );
        }

        const result = await deleteSavedShortcutFromConvex(auth.session.address, id as Id<"saved_shortcuts">) as {
            deleted: boolean;
            reason?: string;
            linkedPublications?: number;
            linkedAutomations?: number;
        };

        if (!result.deleted && result.reason === "linked_references") {
            const linkedPublications = result.linkedPublications ?? 0;
            const linkedAutomations = result.linkedAutomations ?? 0;
            const errorParts: string[] = [];

            if (linkedPublications > 0) {
                errorParts.push(
                    `${linkedPublications} published shortcut${linkedPublications !== 1 ? "s" : ""}`,
                );
            }
            if (linkedAutomations > 0) {
                errorParts.push(
                    `${linkedAutomations} linked automation${linkedAutomations !== 1 ? "s" : ""}`,
                );
            }

            return NextResponse.json(
                {
                    error: `This shortcut is still linked to ${errorParts.join(" and ")}. Remove those links first.`,
                    linkedPublications,
                    linkedAutomations,
                },
                { status: 409 },
            );
        }

        return NextResponse.json({ deleted: true });
    } catch (error) {
        return NextResponse.json(
            { error: sanitizeErrorMessage(error, "Failed to delete shortcut.") },
            { status: 500 },
        );
    }
}
