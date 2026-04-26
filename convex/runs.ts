import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { ensureOwnership, normalizeOwnerAddress } from "./lib/ownership";
import { assertServerAccess } from "./lib/serverAccess";
import {
    paginatedResultValidator,
    runDocValidator,
    runDefinitionSnapshotValidator,
    runInputValuesValidator,
    runSourceTypeValidator,
    runStatusValidator,
    runStepDocValidator,
    runStepStatusValidator,
} from "./lib/validators";

const runStepResultInputValidator = v.object({
    stepId: v.string(),
    label: v.string(),
    status: runStepStatusValidator,
    outputSummary: v.optional(v.string()),
    error: v.optional(v.string()),
    startedAt: v.string(),
    completedAt: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    sequence: v.number(),
});

const runWithStepsValidator = v.object({
    run: runDocValidator,
    steps: v.array(runStepDocValidator),
});

export const listMinePaginated = query({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        paginationOpts: paginationOptsValidator,
    },
    returns: paginatedResultValidator(runDocValidator),
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const ownerAddress = normalizeOwnerAddress(args.ownerAddress);
        return await ctx.db
            .query("runs")
            .withIndex("by_ownerAddress_createdAt", (q) => q.eq("ownerAddress", ownerAddress))
            .order("desc")
            .paginate(args.paginationOpts);
    },
});

export const getMine = query({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        runId: v.id("runs"),
    },
    returns: v.union(runWithStepsValidator, v.null()),
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const run = await ctx.db.get("runs", args.runId);
        if (!run) return null;
        ensureOwnership(run.ownerAddress, args.ownerAddress);

        const steps = await ctx.db
            .query("run_steps")
            .withIndex("by_runId_sequence", (q) => q.eq("runId", args.runId))
            .take(500);

        return { run, steps };
    },
});

export const listBySource = query({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        sourceType: runSourceTypeValidator,
        sourceId: v.string(),
    },
    returns: v.array(runDocValidator),
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const ownerAddress = normalizeOwnerAddress(args.ownerAddress);
        return await ctx.db
            .query("runs")
            .withIndex("by_ownerAddress_sourceType_sourceId", (q) =>
                q.eq("ownerAddress", ownerAddress)
                 .eq("sourceType", args.sourceType)
                 .eq("sourceId", args.sourceId),
            )
            .order("desc")
            .take(20);
    },
});

export const create = mutation({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        name: v.string(),
        sourceType: runSourceTypeValidator,
        sourceId: v.string(),
        shortcutId: v.optional(v.id("saved_shortcuts")),
        inputValues: runInputValuesValidator,
        definitionSnapshot: v.optional(runDefinitionSnapshotValidator),
        status: v.optional(runStatusValidator),
    },
    returns: v.id("runs"),
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const now = new Date().toISOString();
        return await ctx.db.insert("runs", {
            ownerAddress: normalizeOwnerAddress(args.ownerAddress),
            name: args.name,
            sourceType: args.sourceType,
            sourceId: args.sourceId,
            shortcutId: args.shortcutId,
            status: args.status ?? "queued",
            inputValues: args.inputValues,
            ...(args.definitionSnapshot !== undefined
                ? { definitionSnapshot: args.definitionSnapshot }
                : {}),
            createdAt: now,
            startedAt: now,
        });
    },
});

export const removeMine = mutation({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        runId: v.id("runs"),
    },
    returns: v.object({ deleted: v.boolean() }),
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const run = await ctx.db.get(args.runId);
        if (!run) return { deleted: false };
        ensureOwnership(run.ownerAddress, args.ownerAddress);

        const steps = await ctx.db
            .query("run_steps")
            .withIndex("by_runId", (q) => q.eq("runId", args.runId))
            .take(500);

        for (const step of steps) {
            await ctx.db.delete(step._id);
        }

        await ctx.db.delete(args.runId);
        return { deleted: true };
    },
});

export const removeMineBatch = mutation({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        limit: v.optional(v.number()),
    },
    returns: v.object({
        deletedCount: v.number(),
        hasMore: v.boolean(),
    }),
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const ownerAddress = normalizeOwnerAddress(args.ownerAddress);
        const limit = Math.max(1, Math.min(50, Math.floor(args.limit ?? 25)));

        const runs = await ctx.db
            .query("runs")
            .withIndex("by_ownerAddress_createdAt", (q) => q.eq("ownerAddress", ownerAddress))
            .order("asc")
            .take(limit + 1);

        const runsToDelete = runs.slice(0, limit);

        for (const run of runsToDelete) {
            const steps = await ctx.db
                .query("run_steps")
                .withIndex("by_runId", (q) => q.eq("runId", run._id))
                .take(500);

            for (const step of steps) {
                await ctx.db.delete(step._id);
            }

            await ctx.db.delete(run._id);
        }

        return {
            deletedCount: runsToDelete.length,
            hasMore: runs.length > limit,
        };
    },
});

export const finalize = mutation({
    args: {
        serverSecret: v.string(),
        ownerAddress: v.string(),
        runId: v.id("runs"),
        status: runStatusValidator,
        error: v.optional(v.string()),
        completedAt: v.optional(v.string()),
        steps: v.array(runStepResultInputValidator),
    },
    returns: runDocValidator,
    handler: async (ctx, args) => {
        assertServerAccess(args.serverSecret);
        const run = await ctx.db.get("runs", args.runId);
        if (!run) throw new Error("Run not found.");
        ensureOwnership(run.ownerAddress, args.ownerAddress);

        // Patch-based step reconciliation:
        // - Existing steps matching by stepId are patched in-place
        // - New steps are inserted
        // - Orphaned steps (not in the new payload) are deleted
        const existingSteps = await ctx.db
            .query("run_steps")
            .withIndex("by_runId", (q) => q.eq("runId", args.runId))
            .take(500);

        const existingByStepId = new Map(
            existingSteps.map((step) => [step.stepId, step]),
        );
        const incomingStepIds = new Set(args.steps.map((step) => step.stepId));

        // Delete orphaned steps that are no longer in the payload
        for (const existing of existingSteps) {
            if (!incomingStepIds.has(existing.stepId)) {
                await ctx.db.delete("run_steps", existing._id);
            }
        }

        // Upsert incoming steps: patch if exists, insert if new
        for (const step of args.steps) {
            const existing = existingByStepId.get(step.stepId);
            if (existing) {
                await ctx.db.patch("run_steps", existing._id, {
                    label: step.label,
                    status: step.status,
                    outputSummary: step.outputSummary,
                    error: step.error,
                    startedAt: step.startedAt,
                    completedAt: step.completedAt,
                    durationMs: step.durationMs,
                    sequence: step.sequence,
                });
            } else {
                await ctx.db.insert("run_steps", {
                    runId: args.runId,
                    stepId: step.stepId,
                    label: step.label,
                    status: step.status,
                    outputSummary: step.outputSummary,
                    error: step.error,
                    startedAt: step.startedAt,
                    completedAt: step.completedAt,
                    durationMs: step.durationMs,
                    sequence: step.sequence,
                });
            }
        }

        await ctx.db.patch("runs", args.runId, {
            status: args.status,
            ...(args.error !== undefined ? { error: args.error } : {}),
            ...(args.completedAt !== undefined ? { completedAt: args.completedAt } : {}),
        });

        const updatedRun = await ctx.db.get("runs", args.runId);
        if (!updatedRun) {
            throw new Error("Run not found after finalize.");
        }

        return updatedRun;
    },
});

export const appendStep = internalMutation({
    args: {
        runId: v.id("runs"),
        stepId: v.string(),
        label: v.string(),
        status: runStepStatusValidator,
        sequence: v.number(),
        outputSummary: v.optional(v.string()),
        error: v.optional(v.string()),
        startedAt: v.string(),
        completedAt: v.optional(v.string()),
        durationMs: v.optional(v.number()),
    },
    returns: v.id("run_steps"),
    handler: async (ctx, args) => {
        return await ctx.db.insert("run_steps", args);
    },
});

export const updateStatus = internalMutation({
    args: {
        runId: v.id("runs"),
        status: runStatusValidator,
        error: v.optional(v.string()),
        completedAt: v.optional(v.string()),
        scheduledFunctionId: v.optional(v.string()),
    },
    returns: runDocValidator,
    handler: async (ctx, args) => {
        await ctx.db.patch("runs", args.runId, {
            status: args.status,
            ...(args.error !== undefined ? { error: args.error } : {}),
            ...(args.completedAt !== undefined ? { completedAt: args.completedAt } : {}),
            ...(args.scheduledFunctionId !== undefined
                ? { scheduledFunctionId: args.scheduledFunctionId }
                : {}),
        });

        const updatedRun = await ctx.db.get("runs", args.runId);
        if (!updatedRun) {
            throw new Error("Run not found after status update.");
        }

        return updatedRun;
    },
});

// Retention: cleanup manual test runs older than 30 days.
// Capped at 25 per call to stay within Convex transaction limits.
export const cleanupOldRuns = internalMutation({
    args: {},
    returns: v.object({
        deletedCount: v.number(),
    }),
    handler: async (ctx) => {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const oldRuns = await ctx.db
            .query("runs")
            .withIndex("by_sourceType_createdAt", (q) =>
                q.eq("sourceType", "manual").lt("createdAt", thirtyDaysAgo),
            )
            .order("asc")
            .take(25);

        let deletedCount = 0;
        for (const run of oldRuns) {
            // Delete associated run_steps first
            const steps = await ctx.db
                .query("run_steps")
                .withIndex("by_runId", (q) => q.eq("runId", run._id))
                .take(500);
            for (const step of steps) {
                await ctx.db.delete("run_steps", step._id);
            }
            await ctx.db.delete("runs", run._id);
            deletedCount++;
        }
        return { deletedCount };
    },
});
