import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ensureOwnership, normalizeOwnerAddress } from "./lib/ownership";
import { assertServerAccess } from "./lib/serverAccess";
import {
    automationActionValidator,
    automationDocValidator,
    automationStatusValidator,
    automationTriggerValidator,
    paginatedResultValidator,
} from "./lib/validators";

export const listMinePaginated = query({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        paginationOpts: paginationOptsValidator,
    },
    returns: paginatedResultValidator(automationDocValidator),
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const ownerAddress = normalizeOwnerAddress(args.ownerAddress);
        return await ctx.db
            .query("automations")
            .withIndex("by_ownerAddress", (q) => q.eq("ownerAddress", ownerAddress))
            .order("desc")
            .paginate(args.paginationOpts);
    },
});

export const listMineByTargetShortcut = query({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        shortcutId: v.id("saved_shortcuts"),
    },
    returns: v.array(automationDocValidator),
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const ownerAddress = normalizeOwnerAddress(args.ownerAddress);
        const shortcut = await ctx.db.get("saved_shortcuts", args.shortcutId);
        if (!shortcut) return [];
        ensureOwnership(shortcut.ownerAddress, ownerAddress);

        return await ctx.db
            .query("automations")
            .withIndex("by_ownerAddress_targetShortcutId_updatedAt", (q) =>
                q.eq("ownerAddress", ownerAddress).eq("targetShortcutId", args.shortcutId),
            )
            .order("desc")
            .take(50);
    },
});



export const listSchedulerCandidates = query({
    args: {
        serverSecret: v.string(),
        now: v.string(),
    },
    returns: v.array(automationDocValidator),
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);

        const scheduled = await ctx.db
            .query("automations")
            .withIndex("by_status_triggerType_nextRunAt", (q) =>
                q
                    .eq("status", "active")
                    .eq("trigger.type", "scheduled")
                    .lte("nextRunAt", args.now),
            )
            .take(200);

        const priceBelow = await ctx.db
            .query("automations")
            .withIndex("by_status_triggerType", (q) =>
                q
                    .eq("status", "active")
                    .eq("trigger.type", "price_below"),
            )
            .take(100);

        const priceAbove = await ctx.db
            .query("automations")
            .withIndex("by_status_triggerType", (q) =>
                q
                    .eq("status", "active")
                    .eq("trigger.type", "price_above"),
            )
            .take(100);

        return [...scheduled, ...priceBelow, ...priceAbove];
    },
});

export const getMine = query({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        automationId: v.id("automations"),
    },
    returns: v.union(automationDocValidator, v.null()),
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const automation = await ctx.db.get("automations", args.automationId);
        if (!automation) return null;
        ensureOwnership(automation.ownerAddress, args.ownerAddress);
        return automation;
    },
});

export const create = mutation({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        networkId: v.optional(v.union(v.literal("base-mainnet"), v.literal("base-sepolia"))),
        name: v.string(),
        description: v.optional(v.string()),
        trigger: automationTriggerValidator,
        action: automationActionValidator,
        targetShortcutId: v.id("saved_shortcuts"),
        status: v.optional(automationStatusValidator),
        maxExecutions: v.optional(v.number()),
        nextRunAt: v.optional(v.string()),
    },
    returns: v.id("automations"),
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const linkedShortcut = await ctx.db.get("saved_shortcuts", args.targetShortcutId);
        if (!linkedShortcut) throw new Error("Linked shortcut not found.");
        ensureOwnership(linkedShortcut.ownerAddress, args.ownerAddress);

        const now = new Date().toISOString();
        return await ctx.db.insert("automations", {
            ownerAddress: normalizeOwnerAddress(args.ownerAddress),
            accountAddress: normalizeOwnerAddress(args.ownerAddress),
            networkId: args.networkId,
            name: args.name,
            description: args.description,
            trigger: args.trigger,
            action: args.action,
            targetShortcutId: args.targetShortcutId,
            status: args.status ?? "active",
            maxExecutions: args.maxExecutions ?? 0,
            executionCount: 0,
            nextRunAt: args.nextRunAt,
            createdAt: now,
            updatedAt: now,
        });
    },
});

export const update = mutation({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        automationId: v.id("automations"),
        networkId: v.optional(v.union(v.literal("base-mainnet"), v.literal("base-sepolia"), v.null())),
        name: v.optional(v.string()),
        description: v.optional(v.string()),
        trigger: v.optional(automationTriggerValidator),
        action: v.optional(automationActionValidator),
        targetShortcutId: v.optional(v.id("saved_shortcuts")),
        status: v.optional(automationStatusValidator),
        maxExecutions: v.optional(v.number()),
        executionCount: v.optional(v.number()),
        lastEvaluatedAt: v.optional(v.string()),
        lastTriggeredAt: v.optional(v.string()),
        lastExecutedAt: v.optional(v.string()),
        lastError: v.optional(v.union(v.string(), v.null())),
        lastRunId: v.optional(v.union(v.id("runs"), v.null())),
        nextRunAt: v.optional(v.union(v.string(), v.null())),
    },
    returns: automationDocValidator,
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const automation = await ctx.db.get("automations", args.automationId);
        if (!automation) throw new Error("Automation not found.");
        ensureOwnership(automation.ownerAddress, args.ownerAddress);

        const nextRunAt = args.nextRunAt === null ? undefined : args.nextRunAt;
        const lastError = args.lastError === null ? undefined : args.lastError;
        const lastRunId = args.lastRunId === null ? undefined : args.lastRunId;
        const networkId = args.networkId === null ? undefined : args.networkId;

        await ctx.db.patch("automations", args.automationId, {
            ...(args.networkId !== undefined ? { networkId } : {}),
            ...(args.name !== undefined ? { name: args.name } : {}),
            ...(args.description !== undefined ? { description: args.description } : {}),
            ...(args.trigger !== undefined ? { trigger: args.trigger } : {}),
            ...(args.action !== undefined ? { action: args.action } : {}),
            ...(args.targetShortcutId !== undefined ? { targetShortcutId: args.targetShortcutId } : {}),
            ...(args.status !== undefined ? { status: args.status } : {}),
            ...(args.maxExecutions !== undefined ? { maxExecutions: args.maxExecutions } : {}),
            ...(args.executionCount !== undefined ? { executionCount: args.executionCount } : {}),
            ...(args.lastEvaluatedAt !== undefined ? { lastEvaluatedAt: args.lastEvaluatedAt } : {}),
            ...(args.lastTriggeredAt !== undefined ? { lastTriggeredAt: args.lastTriggeredAt } : {}),
            ...(args.lastExecutedAt !== undefined ? { lastExecutedAt: args.lastExecutedAt } : {}),
            ...(args.lastError !== undefined ? { lastError } : {}),
            ...(args.lastRunId !== undefined ? { lastRunId } : {}),
            ...(args.nextRunAt !== undefined ? { nextRunAt } : {}),
            updatedAt: new Date().toISOString(),
        });

        const updatedAutomation = await ctx.db.get("automations", args.automationId);
        if (!updatedAutomation) {
            throw new Error("Automation not found after update.");
        }

        return updatedAutomation;
    },
});

export const remove = mutation({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        automationId: v.id("automations"),
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const automation = await ctx.db.get("automations", args.automationId);
        if (!automation) return false;
        ensureOwnership(automation.ownerAddress, args.ownerAddress);
        await ctx.db.delete("automations", args.automationId);
        return true;
    },
});
