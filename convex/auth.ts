import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { assertServerAccess } from "./lib/serverAccess";
import { siweNonceDocValidator } from "./lib/validators";

const rateLimitResultValidator = v.object({
    allowed: v.boolean(),
    retryAfterSeconds: v.number(),
});

function normalizeSessionKey(sessionKey: string): string {
    return sessionKey.trim().toLowerCase();
}

function normalizeRateLimitSegment(value: string): string {
    return value.trim().toLowerCase();
}

export const storeNonce = mutation({
    args: {
        serverSecret: v.string(),
        sessionKey: v.string(),
        nonce: v.string(),
        expiresAt: v.number(),
    },
    returns: v.id("siwe_nonces"),
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const sessionKey = normalizeSessionKey(args.sessionKey);
        const existing = await ctx.db
            .query("siwe_nonces")
            .withIndex("by_sessionKey", (q) => q.eq("sessionKey", sessionKey))
            .unique();

        if (existing) {
            await ctx.db.delete("siwe_nonces", existing._id);
        }

        return await ctx.db.insert("siwe_nonces", {
            sessionKey,
            nonce: args.nonce,
            expiresAt: args.expiresAt,
        });
    },
});

export const consumeNonce = mutation({
    args: {
        serverSecret: v.string(),
        sessionKey: v.string(),
        nonce: v.string(),
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const now = Date.now();
        const sessionKey = normalizeSessionKey(args.sessionKey);
        const existing = await ctx.db
            .query("siwe_nonces")
            .withIndex("by_sessionKey", (q) => q.eq("sessionKey", sessionKey))
            .unique();

        if (!existing) return false;
        if (existing.consumedAt) return false;
        if (now > existing.expiresAt) {
            await ctx.db.delete("siwe_nonces", existing._id);
            return false;
        }
        if (existing.nonce !== args.nonce) return false;

        await ctx.db.patch("siwe_nonces", existing._id, {
            consumedAt: now,
        });
        return true;
    },
});

export const getNonceState = query({
    args: {
        serverSecret: v.string(),
        sessionKey: v.string(),
    },
    returns: v.union(siweNonceDocValidator, v.null()),
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const sessionKey = normalizeSessionKey(args.sessionKey);
        return await ctx.db
            .query("siwe_nonces")
            .withIndex("by_sessionKey", (q) => q.eq("sessionKey", sessionKey))
            .unique();
    },
});

export const consumeRateLimit = mutation({
    args: {
        serverSecret: v.string(),
        bucket: v.string(),
        key: v.string(),
        windowMs: v.number(),
        max: v.number(),
    },
    returns: rateLimitResultValidator,
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const now = Date.now();
        const bucket = normalizeRateLimitSegment(args.bucket);
        const key = normalizeRateLimitSegment(args.key);
        const existing = await ctx.db
            .query("rate_limits")
            .withIndex("by_bucket_key", (q) => q.eq("bucket", bucket).eq("key", key))
            // This exact index should collapse to a tiny duplicate set; keep the
            // read bounded so rate limiting itself does not become an unbounded scan.
            .take(10);

        const active = existing.filter((entry) => entry.resetAt > now);
        const primary = (active.length > 0 ? active : existing).reduce<typeof existing[number] | null>(
            (latest, entry) => {
                if (!latest) return entry;
                return entry.updatedAt > latest.updatedAt ? entry : latest;
            },
            null,
        );

        for (const entry of existing) {
            if (entry._id !== primary?._id) {
                await ctx.db.delete("rate_limits", entry._id);
            }
        }

        if (!primary || active.length === 0) {
            const resetAt = now + args.windowMs;

            if (primary) {
                await ctx.db.patch("rate_limits", primary._id, {
                    count: 1,
                    resetAt,
                    updatedAt: now,
                });
            } else {
                await ctx.db.insert("rate_limits", {
                    bucket,
                    key,
                    count: 1,
                    resetAt,
                    createdAt: now,
                    updatedAt: now,
                });
            }

            return {
                allowed: true,
                retryAfterSeconds: Math.max(1, Math.ceil(args.windowMs / 1000)),
            };
        }

        const nextCount = active.reduce((total, entry) => total + entry.count, 0) + 1;
        const resetAt = active.reduce(
            (latestResetAt, entry) => Math.max(latestResetAt, entry.resetAt),
            primary.resetAt,
        );

        await ctx.db.patch("rate_limits", primary._id, {
            count: nextCount,
            resetAt,
            updatedAt: now,
        });

        return {
            allowed: nextCount <= args.max,
            retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
        };
    },
});

export const cleanupExpiredNonces = internalMutation({
    args: {},
    returns: v.number(),
    handler: async (ctx) => {
        const now = Date.now();
        const expired = await ctx.db
            .query("siwe_nonces")
            .withIndex("by_expiresAt", (q) => q.lte("expiresAt", now))
            .take(500);

        for (const doc of expired) {
            await ctx.db.delete("siwe_nonces", doc._id);
        }

        return expired.length;
    },
});

export const cleanupExpiredRateLimits = internalMutation({
    args: {},
    returns: v.number(),
    handler: async (ctx) => {
        const now = Date.now();
        const expired = await ctx.db
            .query("rate_limits")
            .withIndex("by_resetAt", (q) => q.lte("resetAt", now))
            .take(500);

        for (const doc of expired) {
            await ctx.db.delete("rate_limits", doc._id);
        }

        return expired.length;
    },
});
