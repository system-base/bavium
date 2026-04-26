import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-middleware";
import {
    getPublicationForSavedShortcutFromConvex,
    hasConvexBackend,
    publishShortcutInConvex,
    type Id,
} from "@/lib/convex-server";
import { isPublishableShortcutCategory } from "@/lib/block-categories";
import {
    consumeBestEffortRateLimit,
    consumeServerRateLimit,
} from "@/lib/server-rate-limit";
import { sanitizeErrorMessage, getHttpStatusFromError } from "@/lib/error-sanitizer";

interface PublishBody {
    slug?: string;
    name?: string;
    description?: string;
    category?: string;
}

function isPublishBody(value: unknown): value is PublishBody {
    if (value === undefined) return true;
    if (typeof value !== "object" || value === null) return false;
    if ("slug" in value && value.slug !== undefined && typeof value.slug !== "string") return false;
    if ("name" in value && value.name !== undefined && typeof value.name !== "string") return false;
    if ("description" in value && value.description !== undefined && typeof value.description !== "string") return false;
    if ("category" in value && value.category !== undefined && typeof value.category !== "string") return false;
    return true;
}

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
        bucket: "shortcut-publish-config-read",
        key: auth.session.address,
        windowMs: 60_000,
        max: 60,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            {
                error: `Too many publish config requests. Try again in ${rateLimit.retryAfterSeconds}s.`,
            },
            { status: 429 },
        );
    }

    try {
        const { id } = await params;
        const publication = await getPublicationForSavedShortcutFromConvex(
            auth.session.address,
            id as Id<"saved_shortcuts">,
        );

        return NextResponse.json({
            publication: publication
                ? {
                    slug: publication.slug,
                    name: publication.name,
                    description: publication.description,
                    category: publication.category,
                    status: publication.status,
                    publishVersion: publication.publishVersion,
                }
                : null,
        });
    } catch (error) {
        return NextResponse.json(
            { error: sanitizeErrorMessage(error, "Failed to load publish settings.") },
            { status: getHttpStatusFromError(error) },
        );
    }
}

export async function POST(
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
        const rateLimit = await consumeServerRateLimit({
            bucket: "shortcut-publish",
            key: auth.session.address,
            windowMs: 60_000,
            max: 6,
        });
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { error: `Too many share requests. Try again in ${rateLimit.retryAfterSeconds}s.` },
                { status: 429 },
            );
        }

        const rawBody: unknown = await request.json().catch(() => undefined);
        if (!isPublishBody(rawBody)) {
            return NextResponse.json(
                { error: "Invalid share request body." },
                { status: 400 },
            );
        }

        const slug = rawBody?.slug?.trim();
        if (slug && slug.length > 80) {
            return NextResponse.json(
                { error: "Link must be 80 characters or fewer." },
                { status: 400 },
            );
        }

        const name = rawBody?.name?.trim();
        if (name !== undefined && !name) {
            return NextResponse.json(
                { error: "Name is required." },
                { status: 400 },
            );
        }

        const description = rawBody?.description?.trim();
        const category = rawBody?.category?.trim().toLowerCase();
        if (category && !isPublishableShortcutCategory(category)) {
            return NextResponse.json(
                { error: "Invalid category." },
                { status: 400 },
            );
        }
        const normalizedCategory = category && isPublishableShortcutCategory(category)
            ? category
            : undefined;

        const { id } = await params;
        const shortcut = await publishShortcutInConvex({
            ownerAddress: auth.session.address,
            shortcutId: id as Id<"saved_shortcuts">,
            ...(slug ? { slug } : {}),
            ...(name ? { name } : {}),
            ...(description ? { description } : {}),
            ...(normalizedCategory ? { category: normalizedCategory } : {}),
        });

        return NextResponse.json({ shortcut }, { status: 201 });
    } catch (error) {
        return NextResponse.json(
            { error: sanitizeErrorMessage(error, "Failed to save sharing settings.") },
            { status: getHttpStatusFromError(error) },
        );
    }
}
