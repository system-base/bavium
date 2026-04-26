import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { normalizeOwnerAddress } from "./lib/ownership";
import { buildBookmarkShortcutSnapshot, sanitizePublicSlug } from "./lib/publicShortcut";
import { assertServerAccess } from "./lib/serverAccess";
import type { ShortcutCategory } from "./lib/validators";
import { paginatedResultValidator, shortcutCategoryValidator } from "./lib/validators";

const bookmarkedShortcutListItemValidator = v.object({
    _id: v.id("saved_shortcuts"),
    slug: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    category: shortcutCategoryValidator,
    creatorAddress: v.string(),
    steps: v.array(v.null()),
    remixCount: v.number(),
    publishVersion: v.number(),
    publishedAt: v.string(),
    updatedAt: v.string(),
    bookmarkedAt: v.string(),
});

const bookmarkStateValidator = v.object({
    exists: v.boolean(),
    bookmarked: v.boolean(),
});

const bookmarkMutationResultValidator = v.object({
    bookmarked: v.literal(true),
    bookmarkId: v.id("shortcut_bookmarks"),
    shortcutId: v.id("saved_shortcuts"),
});

function buildShortcutListItemFromSnapshot(bookmark: {
    shortcutId: Id<"saved_shortcuts">;
    slug: string;
    name: string;
    description?: string;
    category: ShortcutCategory;
    creatorAddress: string;
    stepsCount: number;
    remixCount: number;
    publishVersion: number;
    publishedAt: string;
    updatedAt: string;
    createdAt: string;
    status: string;
}): {
    _id: Id<"saved_shortcuts">;
    slug: string;
    name: string;
    description?: string;
    category: ShortcutCategory;
    creatorAddress: string;
    steps: null[];
    remixCount: number;
    publishVersion: number;
    publishedAt: string;
    updatedAt: string;
    bookmarkedAt: string;
} | null {
    if (bookmark.status !== "published") {
        return null;
    }

    return {
        _id: bookmark.shortcutId,
        slug: bookmark.slug,
        name: bookmark.name,
        description: bookmark.description,
        category: bookmark.category,
        creatorAddress: bookmark.creatorAddress,
        steps: Array.from({ length: bookmark.stepsCount }, () => null),
        remixCount: bookmark.remixCount,
        publishVersion: bookmark.publishVersion,
        publishedAt: bookmark.publishedAt,
        updatedAt: bookmark.updatedAt,
        bookmarkedAt: bookmark.createdAt,
    };
}

export const listMinePaginated = query({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        paginationOpts: paginationOptsValidator,
    },
    returns: paginatedResultValidator(bookmarkedShortcutListItemValidator),
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const ownerAddress = normalizeOwnerAddress(args.ownerAddress);
        const result = await ctx.db
            .query("shortcut_bookmarks")
            .withIndex("by_ownerAddress_createdAt", (q) => q.eq("ownerAddress", ownerAddress))
            .order("desc")
            .paginate(args.paginationOpts);

        const page = [];
        for (const bookmark of result.page) {
            const snapshotItem = buildShortcutListItemFromSnapshot(bookmark);
            if (snapshotItem) {
                page.push(snapshotItem);
            }
        }

        return {
            ...result,
            page,
        };
    },
});

export const getStateBySlug = query({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        slug: v.string(),
    },
    returns: bookmarkStateValidator,
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const ownerAddress = normalizeOwnerAddress(args.ownerAddress);
        const matches = await ctx.db
            .query("saved_shortcuts")
            .withIndex("by_slug", (q) => q.eq("slug", sanitizePublicSlug(args.slug)))
            .take(1);

        const shortcut = matches[0] ?? null;
        if (!shortcut || shortcut.visibility !== "public") {
            return {
                exists: false,
                bookmarked: false,
            };
        }

        const bookmarkMatches = await ctx.db
            .query("shortcut_bookmarks")
            .withIndex("by_ownerAddress_shortcutId", (q) =>
                q.eq("ownerAddress", ownerAddress).eq("shortcutId", shortcut._id))
            .take(1);

        return {
            exists: true,
            bookmarked: bookmarkMatches.length > 0,
        };
    },
});

export const add = mutation({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        slug: v.string(),
    },
    returns: bookmarkMutationResultValidator,
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

        const existing = await ctx.db
            .query("shortcut_bookmarks")
            .withIndex("by_ownerAddress_shortcutId", (q) =>
                q.eq("ownerAddress", ownerAddress).eq("shortcutId", shortcut._id))
            .take(1);

        if (existing[0]) {
            await ctx.db.patch(existing[0]._id, {
                ...buildBookmarkShortcutSnapshot(shortcut, "published"),
                updatedAt: new Date().toISOString(),
            });
            return {
                bookmarked: true as const,
                bookmarkId: existing[0]._id,
                shortcutId: shortcut._id,
            };
        }

        const now = new Date().toISOString();
        const bookmarkId = await ctx.db.insert("shortcut_bookmarks", {
            ownerAddress,
            ...buildBookmarkShortcutSnapshot(shortcut, "published"),
            createdAt: now,
            updatedAt: now,
        });

        return {
            bookmarked: true as const,
            bookmarkId,
            shortcutId: shortcut._id,
        };
    },
});

export const remove = mutation({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        slug: v.string(),
    },
    returns: v.object({
        removed: v.boolean(),
    }),
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const ownerAddress = normalizeOwnerAddress(args.ownerAddress);
        const matches = await ctx.db
            .query("saved_shortcuts")
            .withIndex("by_slug", (q) => q.eq("slug", sanitizePublicSlug(args.slug)))
            .take(1);

        const shortcut = matches[0] ?? null;
        if (!shortcut) {
            return { removed: false };
        }

        const bookmarkMatches = await ctx.db
            .query("shortcut_bookmarks")
            .withIndex("by_ownerAddress_shortcutId", (q) =>
                q.eq("ownerAddress", ownerAddress).eq("shortcutId", shortcut._id))
            .take(20);

        for (const bookmark of bookmarkMatches) {
            await ctx.db.delete(bookmark._id);
        }

        return { removed: bookmarkMatches.length > 0 };
    },
});
