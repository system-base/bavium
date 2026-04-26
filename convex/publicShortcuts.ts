import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation } from "./_generated/server";
import { ensureOwnership, normalizeOwnerAddress } from "./lib/ownership";
import {
    buildBookmarkShortcutSnapshot,
    resolvePublicCategory,
    sanitizePublicSlug,
} from "./lib/publicShortcut";
import { assertServerAccess } from "./lib/serverAccess";
import {
    assertShortcutStepsDeeplyValid,
    shortcutPublicationValidator,
    publishedShortcutStatusValidator,
    shortcutCategoryValidator,
} from "./lib/validators";

const bookmarkSnapshotValidator = v.object({
    shortcutId: v.id("saved_shortcuts"),
    slug: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    category: shortcutCategoryValidator,
    creatorAddress: v.string(),
    stepsCount: v.number(),
    remixCount: v.number(),
    publishVersion: v.number(),
    publishedAt: v.string(),
    status: publishedShortcutStatusValidator,
    updatedAt: v.string(),
});

const bookmarkSnapshotSyncResultValidator = v.object({
    updated: v.number(),
    continueCursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
});

const archiveResultValidator = v.object({
    slug: v.string(),
    status: v.literal("archived"),
});

function buildBaseSlug(name: string, explicitSlug?: string): string {
    const candidate = sanitizePublicSlug(explicitSlug ?? name);
    if (candidate.length > 0) {
        return candidate;
    }
    return `shortcut-${Date.now().toString(36)}`;
}

async function resolveUniqueSlug(
    ctx: MutationCtx,
    baseSlug: string,
    currentId?: Id<"saved_shortcuts">,
): Promise<string> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        const candidate = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
        const matches = await ctx.db
            .query("saved_shortcuts")
            .withIndex("by_slug", (q) => q.eq("slug", candidate))
            .take(1);

        const existing = matches[0];
        if (!existing || existing._id === currentId) {
            return candidate;
        }
    }

    throw new Error("Unable to generate a unique share link.");
}

async function syncCanonicalShortcutPublicState(
    ctx: MutationCtx,
    shortcutId: Id<"saved_shortcuts">,
    payload: {
        visibility: "private" | "public";
        slug?: string;
        publicName?: string;
        publicDescription?: string;
        publicCategory?: Doc<"saved_shortcuts">["publicCategory"];
        publishedAt?: string;
        publishVersion?: number;
        remixCount?: number;
        updatedAt?: string;
    },
) {
    await ctx.db.patch("saved_shortcuts", shortcutId, {
        visibility: payload.visibility,
        slug: payload.slug,
        publicName: payload.publicName,
        publicDescription: payload.publicDescription,
        publicCategory: payload.publicCategory,
        publishedAt: payload.publishedAt,
        publishVersion: payload.publishVersion,
        remixCount: payload.remixCount,
        updatedAt: payload.updatedAt ?? new Date().toISOString(),
    });
}

async function syncBookmarkSnapshotsForShortcut(
    ctx: MutationCtx,
    shortcutId: Id<"saved_shortcuts">,
    snapshot: ReturnType<typeof buildBookmarkShortcutSnapshot>,
) {
    const result = await ctx.db
        .query("shortcut_bookmarks")
        .withIndex("by_shortcutId", (q) => q.eq("shortcutId", shortcutId))
        .paginate({ cursor: null, numItems: 100 });

    if (result.page.length === 0) return;

    await Promise.all(result.page.map((bookmark) =>
        ctx.db.patch("shortcut_bookmarks", bookmark._id, snapshot),
    ));

    if (!result.isDone && result.continueCursor) {
        await ctx.scheduler.runAfter(0, internal.publicShortcuts.syncBookmarkSnapshotsBatch, {
            shortcutId,
            snapshot,
            paginationOpts: {
                cursor: result.continueCursor,
                numItems: 100,
            },
        });
    }
}

export const syncBookmarkSnapshotsBatch = internalMutation({
    args: {
        shortcutId: v.id("saved_shortcuts"),
        snapshot: bookmarkSnapshotValidator,
        paginationOpts: paginationOptsValidator,
    },
    returns: bookmarkSnapshotSyncResultValidator,
    handler: async (ctx, args) => {
        const result = await ctx.db
            .query("shortcut_bookmarks")
            .withIndex("by_shortcutId", (q) => q.eq("shortcutId", args.shortcutId))
            .paginate(args.paginationOpts);

        await Promise.all(result.page.map((bookmark) =>
            ctx.db.patch("shortcut_bookmarks", bookmark._id, args.snapshot),
        ));

        if (!result.isDone && result.continueCursor) {
            await ctx.scheduler.runAfter(0, internal.publicShortcuts.syncBookmarkSnapshotsBatch, {
                shortcutId: args.shortcutId,
                snapshot: args.snapshot,
                paginationOpts: {
                    cursor: result.continueCursor,
                    numItems: args.paginationOpts.numItems,
                },
            });
        }

        return {
            updated: result.page.length,
            continueCursor: result.isDone ? null : result.continueCursor,
            isDone: result.isDone,
        };
    },
});

export const publish = mutation({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        shortcutId: v.id("saved_shortcuts"),
        slug: v.optional(v.string()),
        name: v.optional(v.string()),
        description: v.optional(v.string()),
        category: v.optional(shortcutCategoryValidator),
        status: v.optional(publishedShortcutStatusValidator),
    },
    returns: shortcutPublicationValidator,
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const ownerAddress = normalizeOwnerAddress(args.ownerAddress);
        const shortcut = await ctx.db.get("saved_shortcuts", args.shortcutId);
        if (!shortcut) {
            throw new Error("Shortcut not found.");
        }
        ensureOwnership(shortcut.ownerAddress, ownerAddress);
        assertShortcutStepsDeeplyValid(shortcut.steps);

        const resolvedName = (args.name?.trim() || shortcut.publicName?.trim() || shortcut.name.trim());
        if (!resolvedName) {
            throw new Error("Name is required.");
        }

        const resolvedDescription = args.description !== undefined
            ? (args.description.trim() || undefined)
            : shortcut.publicDescription ?? shortcut.description;
        const resolvedCategory = args.category ?? resolvePublicCategory(shortcut);
        const nextStatus: "published" | "archived" = args.status ?? "published";
        const nextVisibility = nextStatus === "published" ? "public" : "private";
        const slug = await resolveUniqueSlug(
            ctx,
            buildBaseSlug(resolvedName, args.slug ?? shortcut.slug),
            shortcut._id,
        );
        const now = new Date().toISOString();
        const publishedAt = shortcut.publishedAt ?? now;
        const nextPublishVersion = (shortcut.publishVersion ?? 0) + 1;

        await syncCanonicalShortcutPublicState(ctx, shortcut._id, {
            visibility: nextVisibility,
            slug,
            publicName: resolvedName,
            publicDescription: resolvedDescription,
            publicCategory: resolvedCategory,
            publishedAt,
            publishVersion: nextPublishVersion,
            remixCount: shortcut.remixCount ?? 0,
            updatedAt: now,
        });

        const updatedShortcut = await ctx.db.get("saved_shortcuts", shortcut._id);
        if (!updatedShortcut) {
            throw new Error("Shortcut not found after update.");
        }

        await syncBookmarkSnapshotsForShortcut(
            ctx,
            updatedShortcut._id,
            buildBookmarkShortcutSnapshot(
                updatedShortcut,
                nextVisibility === "public" ? "published" : "archived",
            ),
        );

        return {
            slug,
            name: resolvedName,
            description: resolvedDescription,
            category: resolvedCategory,
            status: nextStatus,
            publishVersion: nextPublishVersion,
        };
    },
});

export const archive = mutation({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        slug: v.string(),
    },
    returns: archiveResultValidator,
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const ownerAddress = normalizeOwnerAddress(args.ownerAddress);
        const matches = await ctx.db
            .query("saved_shortcuts")
            .withIndex("by_slug", (q) => q.eq("slug", sanitizePublicSlug(args.slug)))
            .take(1);

        const shortcut = matches[0] ?? null;
        if (!shortcut) {
            throw new Error("Public shortcut not found.");
        }

        ensureOwnership(shortcut.ownerAddress, ownerAddress);

        if (shortcut.visibility === "private") {
            return {
                slug: shortcut.slug ?? "",
                status: "archived" as const,
            };
        }

        await syncCanonicalShortcutPublicState(ctx, shortcut._id, {
            visibility: "private",
            slug: shortcut.slug,
            publicName: shortcut.publicName ?? shortcut.name,
            publicDescription: shortcut.publicDescription ?? shortcut.description,
            publicCategory: resolvePublicCategory(shortcut),
            publishedAt: shortcut.publishedAt ?? shortcut.updatedAt,
            publishVersion: shortcut.publishVersion ?? 0,
            remixCount: shortcut.remixCount ?? 0,
        });

        const updatedShortcut = await ctx.db.get("saved_shortcuts", shortcut._id);
        if (updatedShortcut) {
            await syncBookmarkSnapshotsForShortcut(
                ctx,
                updatedShortcut._id,
                buildBookmarkShortcutSnapshot(updatedShortcut, "archived"),
            );
        }

        return {
            slug: shortcut.slug ?? "",
            status: "archived" as const,
        };
    },
});

export const remix = mutation({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        slug: v.string(),
    },
    returns: v.object({
        shortcutId: v.id("saved_shortcuts"),
    }),
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const ownerAddress = normalizeOwnerAddress(args.ownerAddress);
        const matches = await ctx.db
            .query("saved_shortcuts")
            .withIndex("by_slug", (q) => q.eq("slug", sanitizePublicSlug(args.slug)))
            .take(1);

        const shortcut = matches[0] ?? null;
        if (!shortcut || shortcut.visibility !== "public") {
            throw new Error("Public shortcut not found.");
        }

        assertShortcutStepsDeeplyValid(shortcut.steps);

        const now = new Date().toISOString();
        const shortcutId = await ctx.db.insert("saved_shortcuts", {
            ownerAddress,
            name: shortcut.publicName ?? shortcut.name,
            description: shortcut.publicDescription ?? shortcut.description,
            category: resolvePublicCategory(shortcut),
            inputs: shortcut.inputs,
            steps: shortcut.steps,
            originShortcutId: shortcut._id,
            version: shortcut.version,
            visibility: "private",
            publishVersion: 0,
            remixCount: 0,
            createdAt: now,
            updatedAt: now,
        });

        await ctx.db.patch("saved_shortcuts", shortcut._id, {
            remixCount: (shortcut.remixCount ?? 0) + 1,
            updatedAt: now,
        });

        const updatedSourceShortcut = await ctx.db.get("saved_shortcuts", shortcut._id);
        if (updatedSourceShortcut) {
            await syncBookmarkSnapshotsForShortcut(
                ctx,
                updatedSourceShortcut._id,
                buildBookmarkShortcutSnapshot(updatedSourceShortcut, "published"),
            );
        }

        return {
            shortcutId,
        };
    },
});
