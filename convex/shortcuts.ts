import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ensureOwnership, normalizeOwnerAddress } from "./lib/ownership";
import {
    buildPublicShortcutSnapshot,
    hasPublicShortcutState,
    isPublicShortcutVisible,
    resolvePublicCategory,
    sanitizePublicSlug,
} from "./lib/publicShortcut";
import { assertServerAccess } from "./lib/serverAccess";
import {
    assertShortcutStepsDeeplyValid,
    automationDocValidator,
    paginatedResultValidator,
    publicShortcutSnapshotValidator,
    savedShortcutDocValidator,
    type ShortcutCategory,
    shortcutPublicationValidator,
    shortcutCategoryValidator,
    shortcutInputValidator,
    shortcutStepValidator,
    shortcutVisibilityValidator,
} from "./lib/validators";

const publicViewerOwnerContextValidator = v.object({
    sourceShortcutId: v.id("saved_shortcuts"),
    updatedAt: v.string(),
    linkedAutomations: v.number(),
    deleteLocked: v.boolean(),
    deleteBlockedByPublic: v.boolean(),
    deleteBlockedByAutomations: v.boolean(),
});

const publicViewerContextValidator = v.object({
    exists: v.boolean(),
    bookmarked: v.boolean(),
    ownerContext: v.union(publicViewerOwnerContextValidator, v.null()),
});

const shortcutManageDetailValidator = v.object({
    shortcut: savedShortcutDocValidator,
    publication: v.union(shortcutPublicationValidator, v.null()),
    linkedAutomations: v.array(automationDocValidator),
});

const shortcutDeleteResultValidator = v.union(
    v.object({
        deleted: v.literal(true),
    }),
    v.object({
        deleted: v.literal(false),
        reason: v.literal("linked_references"),
        linkedPublications: v.number(),
        linkedAutomations: v.number(),
    }),
);

type ShortcutPublicationResult = {
    slug: string;
    name: string;
    description?: string;
    category: ShortcutCategory;
    status: "published" | "archived";
    publishVersion: number;
};

export const listMinePaginated = query({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        paginationOpts: paginationOptsValidator,
    },
    returns: paginatedResultValidator(savedShortcutDocValidator),
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const ownerAddress = normalizeOwnerAddress(args.ownerAddress);
        return await ctx.db
            .query("saved_shortcuts")
            .withIndex("by_ownerAddress_updatedAt", (q) => q.eq("ownerAddress", ownerAddress))
            .order("desc")
            .paginate(args.paginationOpts);
    },
});

export const listPublicPaginated = query({
    args: {
        serverSecret: v.string(),
        paginationOpts: paginationOptsValidator,
    },
    returns: paginatedResultValidator(publicShortcutSnapshotValidator),
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const result = await ctx.db
            .query("saved_shortcuts")
            .withIndex("by_visibility_publishedAt", (q) => q.eq("visibility", "public"))
            .order("desc")
            .paginate(args.paginationOpts);

        return {
            ...result,
            page: result.page
                .map((shortcut) => buildPublicShortcutSnapshot(shortcut))
                .filter((shortcut) => shortcut !== null),
        };
    },
});

export const getPublicBySlug = query({
    args: {
        serverSecret: v.string(),
        slug: v.string(),
    },
    returns: v.union(publicShortcutSnapshotValidator, v.null()),
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const matches = await ctx.db
            .query("saved_shortcuts")
            .withIndex("by_slug", (q) => q.eq("slug", sanitizePublicSlug(args.slug)))
            .take(1);

        const shortcut = matches[0] ?? null;
        if (!shortcut || !isPublicShortcutVisible(shortcut)) {
            return null;
        }

        return buildPublicShortcutSnapshot(shortcut);
    },
});

export const getPublicViewerContext = query({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        slug: v.string(),
    },
    returns: publicViewerContextValidator,
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const ownerAddress = normalizeOwnerAddress(args.ownerAddress);
        const matches = await ctx.db
            .query("saved_shortcuts")
            .withIndex("by_slug", (q) => q.eq("slug", sanitizePublicSlug(args.slug)))
            .take(1);

        const shortcut = matches[0] ?? null;
        if (!shortcut || !isPublicShortcutVisible(shortcut)) {
            return {
                exists: false,
                bookmarked: false,
                ownerContext: null,
            };
        }

        const bookmarkMatches = await ctx.db
            .query("shortcut_bookmarks")
            .withIndex("by_ownerAddress_shortcutId", (q) =>
                q.eq("ownerAddress", ownerAddress).eq("shortcutId", shortcut._id))
            .take(1);

        if (normalizeOwnerAddress(shortcut.ownerAddress) !== ownerAddress) {
            return {
                exists: true,
                bookmarked: bookmarkMatches.length > 0,
                ownerContext: null,
            };
        }

        const linkedAutomations = await ctx.db
            .query("automations")
            .withIndex("by_ownerAddress_targetShortcutId_updatedAt", (q) =>
                q.eq("ownerAddress", ownerAddress).eq("targetShortcutId", shortcut._id),
            )
            .take(50);

        return {
            exists: true,
            bookmarked: bookmarkMatches.length > 0,
            ownerContext: {
                sourceShortcutId: shortcut._id,
                updatedAt: shortcut.updatedAt,
                linkedAutomations: linkedAutomations.length,
                deleteLocked: true,
                deleteBlockedByPublic: true,
                deleteBlockedByAutomations: linkedAutomations.length > 0,
            },
        };
    },
});

export const getMine = query({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        shortcutId: v.id("saved_shortcuts"),
    },
    returns: v.union(savedShortcutDocValidator, v.null()),
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const shortcut = await ctx.db.get("saved_shortcuts", args.shortcutId);
        if (!shortcut) return null;
        ensureOwnership(shortcut.ownerAddress, args.ownerAddress);
        return shortcut;
    },
});

export const getMineManageDetail = query({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        shortcutId: v.id("saved_shortcuts"),
    },
    returns: v.union(shortcutManageDetailValidator, v.null()),
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const ownerAddress = normalizeOwnerAddress(args.ownerAddress);
        const shortcut = await ctx.db.get("saved_shortcuts", args.shortcutId);
        if (!shortcut) return null;
        ensureOwnership(shortcut.ownerAddress, ownerAddress);

        const linkedAutomations = await ctx.db
            .query("automations")
            .withIndex("by_ownerAddress_targetShortcutId_updatedAt", (q) =>
                q.eq("ownerAddress", ownerAddress).eq("targetShortcutId", args.shortcutId),
            )
            .order("desc")
            .take(50);

        const publication: ShortcutPublicationResult | null = hasPublicShortcutState(shortcut)
            ? {
                slug: shortcut.slug ?? "",
                name: shortcut.publicName ?? shortcut.name,
                description: shortcut.publicDescription ?? shortcut.description,
                category: resolvePublicCategory(shortcut),
                status: shortcut.visibility === "public" ? "published" : "archived",
                publishVersion: shortcut.publishVersion ?? 0,
            }
            : null;

        return {
            shortcut,
            publication: publication && publication.slug
                ? publication
                : null,
            linkedAutomations,
        };
    },
});

export const getMineShareConfig = query({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        shortcutId: v.id("saved_shortcuts"),
    },
    returns: v.union(shortcutPublicationValidator, v.null()),
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const shortcut = await ctx.db.get("saved_shortcuts", args.shortcutId);
        if (!shortcut) return null;
        ensureOwnership(shortcut.ownerAddress, args.ownerAddress);

        if (!hasPublicShortcutState(shortcut)) {
            return null;
        }

        const status: "published" | "archived" =
            shortcut.visibility === "public" ? "published" : "archived";

        return {
            slug: shortcut.slug ?? "",
            name: shortcut.publicName ?? shortcut.name,
            description: shortcut.publicDescription ?? shortcut.description,
            category: resolvePublicCategory(shortcut),
            status,
            publishVersion: shortcut.publishVersion ?? 0,
        };
    },
});

export const create = mutation({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        name: v.string(),
        description: v.optional(v.string()),
        category: shortcutCategoryValidator,
        inputs: v.array(shortcutInputValidator),
        steps: v.array(shortcutStepValidator),
        version: v.optional(v.string()),
    },
    returns: v.id("saved_shortcuts"),
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        assertShortcutStepsDeeplyValid(args.steps);
        const now = new Date().toISOString();
        return await ctx.db.insert("saved_shortcuts", {
            ownerAddress: normalizeOwnerAddress(args.ownerAddress),
            name: args.name,
            description: args.description,
            category: args.category,
            inputs: args.inputs,
            steps: args.steps,
            version: args.version ?? "1.0.0",
            visibility: "private",
            publishVersion: 0,
            remixCount: 0,
            createdAt: now,
            updatedAt: now,
        });
    },
});

export const update = mutation({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        shortcutId: v.id("saved_shortcuts"),
        name: v.optional(v.string()),
        description: v.optional(v.string()),
        category: v.optional(shortcutCategoryValidator),
        inputs: v.optional(v.array(shortcutInputValidator)),
        steps: v.optional(v.array(shortcutStepValidator)),
        archivedAt: v.optional(v.union(v.string(), v.null())),
        visibility: v.optional(shortcutVisibilityValidator),
        slug: v.optional(v.union(v.string(), v.null())),
        publicName: v.optional(v.union(v.string(), v.null())),
        publicDescription: v.optional(v.union(v.string(), v.null())),
        publicCategory: v.optional(v.union(shortcutCategoryValidator, v.null())),
        publishedAt: v.optional(v.union(v.string(), v.null())),
        publishVersion: v.optional(v.union(v.number(), v.null())),
        remixCount: v.optional(v.union(v.number(), v.null())),
        originShortcutId: v.optional(v.union(v.id("saved_shortcuts"), v.null())),
    },
    returns: savedShortcutDocValidator,
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        if (args.steps !== undefined) {
            assertShortcutStepsDeeplyValid(args.steps);
        }
        const shortcut = await ctx.db.get("saved_shortcuts", args.shortcutId);
        if (!shortcut) throw new Error("Shortcut not found.");
        ensureOwnership(shortcut.ownerAddress, args.ownerAddress);

        const archivedAt = args.archivedAt === null ? undefined : args.archivedAt;
        const slug = args.slug === null ? undefined : args.slug;
        const publicName = args.publicName === null ? undefined : args.publicName;
        const publicDescription = args.publicDescription === null ? undefined : args.publicDescription;
        const publicCategory = args.publicCategory === null ? undefined : args.publicCategory;
        const publishedAt = args.publishedAt === null ? undefined : args.publishedAt;
        const publishVersion = args.publishVersion === null ? undefined : args.publishVersion;
        const remixCount = args.remixCount === null ? undefined : args.remixCount;
        const originShortcutId = args.originShortcutId === null ? undefined : args.originShortcutId;
        const shouldSyncPublicName =
            args.publicName === undefined &&
            args.name !== undefined &&
            shortcut.publicName !== undefined &&
            shortcut.publicName === shortcut.name;
        const shouldSyncPublicDescription =
            args.publicDescription === undefined &&
            args.description !== undefined &&
            shortcut.publicDescription !== undefined &&
            shortcut.publicDescription === shortcut.description;
        const shouldSyncPublicCategory =
            args.publicCategory === undefined &&
            args.category !== undefined &&
            shortcut.publicCategory !== undefined &&
            shortcut.publicCategory === shortcut.category;

        await ctx.db.patch("saved_shortcuts", args.shortcutId, {
            ...(args.name !== undefined ? { name: args.name } : {}),
            ...(args.description !== undefined ? { description: args.description } : {}),
            ...(args.category !== undefined ? { category: args.category } : {}),
            ...(args.inputs !== undefined ? { inputs: args.inputs } : {}),
            ...(args.steps !== undefined ? { steps: args.steps } : {}),
            ...(args.archivedAt !== undefined ? { archivedAt } : {}),
            ...(args.visibility !== undefined ? { visibility: args.visibility } : {}),
            ...(args.slug !== undefined ? { slug } : {}),
            ...(args.publicName !== undefined ? { publicName } : shouldSyncPublicName ? { publicName: args.name } : {}),
            ...(args.publicDescription !== undefined
                ? { publicDescription }
                : shouldSyncPublicDescription
                    ? { publicDescription: args.description }
                    : {}),
            ...(args.publicCategory !== undefined
                ? { publicCategory }
                : shouldSyncPublicCategory
                    ? { publicCategory: args.category }
                    : {}),
            ...(args.publishedAt !== undefined ? { publishedAt } : {}),
            ...(args.publishVersion !== undefined ? { publishVersion } : {}),
            ...(args.remixCount !== undefined ? { remixCount } : {}),
            ...(args.originShortcutId !== undefined ? { originShortcutId } : {}),
            updatedAt: new Date().toISOString(),
        });

        const updatedShortcut = await ctx.db.get("saved_shortcuts", args.shortcutId);
        if (!updatedShortcut) {
            throw new Error("Shortcut not found after update.");
        }

        return updatedShortcut;
    },
});

export const remove = mutation({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        shortcutId: v.id("saved_shortcuts"),
    },
    returns: shortcutDeleteResultValidator,
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const shortcut = await ctx.db.get("saved_shortcuts", args.shortcutId);
        if (!shortcut) throw new Error("Shortcut not found.");
        ensureOwnership(shortcut.ownerAddress, args.ownerAddress);

        const linkedAutomations = await ctx.db
            .query("automations")
            .withIndex("by_targetShortcutId", (q) => q.eq("targetShortcutId", args.shortcutId))
            .take(50);

        const linkedPublications = shortcut.visibility === "public" ? 1 : 0;

        if (linkedPublications > 0 || linkedAutomations.length > 0) {
            return {
                deleted: false as const,
                reason: "linked_references" as const,
                linkedPublications,
                linkedAutomations: linkedAutomations.length,
            };
        }

        await ctx.db.delete("saved_shortcuts", args.shortcutId);
        return { deleted: true as const };
    },
});
