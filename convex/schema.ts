import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
    automationActionValidator,
    automationStatusValidator,
    automationTriggerValidator,
    runSourceTypeValidator,
    runStatusValidator,
    runStepStatusValidator,
    runDefinitionSnapshotValidator,
    publishedShortcutStatusValidator,
    runInputValuesValidator,
    shortcutCategoryValidator,
    shortcutInputValidator,
    shortcutStepValidator,
    shortcutVisibilityValidator,
} from "./lib/validators";

export default defineSchema({
    siwe_nonces: defineTable({
        sessionKey: v.string(),
        nonce: v.string(),
        expiresAt: v.number(),
        consumedAt: v.optional(v.number()),
    })
        .index("by_sessionKey", ["sessionKey"])
        .index("by_expiresAt", ["expiresAt"]),

    rate_limits: defineTable({
        bucket: v.string(),
        key: v.string(),
        count: v.number(),
        resetAt: v.number(),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_bucket_key", ["bucket", "key"])
        .index("by_resetAt", ["resetAt"]),

    saved_shortcuts: defineTable({
        ownerAddress: v.string(),
        name: v.string(),
        description: v.optional(v.string()),
        category: shortcutCategoryValidator,
        inputs: v.array(shortcutInputValidator),
        steps: v.array(shortcutStepValidator),
        originShortcutId: v.optional(v.id("saved_shortcuts")),
        version: v.string(),
        visibility: v.optional(shortcutVisibilityValidator),
        slug: v.optional(v.string()),
        publicName: v.optional(v.string()),
        publicDescription: v.optional(v.string()),
        publicCategory: v.optional(shortcutCategoryValidator),
        publishedAt: v.optional(v.string()),
        publishVersion: v.optional(v.number()),
        remixCount: v.optional(v.number()),
        createdAt: v.string(),
        updatedAt: v.string(),
        archivedAt: v.optional(v.string()),
    })
        .index("by_ownerAddress", ["ownerAddress"])
        .index("by_ownerAddress_updatedAt", ["ownerAddress", "updatedAt"])
        .index("by_visibility_publishedAt", ["visibility", "publishedAt"])
        .index("by_slug", ["slug"])
        .index("by_originShortcutId", ["originShortcutId"]),

    shortcut_bookmarks: defineTable({
        ownerAddress: v.string(),
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
        createdAt: v.string(),
        updatedAt: v.string(),
    })
        .index("by_ownerAddress_createdAt", ["ownerAddress", "createdAt"])
        .index("by_ownerAddress_shortcutId", ["ownerAddress", "shortcutId"])
        .index("by_shortcutId", ["shortcutId"]),

    automations: defineTable({
        ownerAddress: v.string(),
        accountAddress: v.string(),
        networkId: v.optional(v.string()),
        name: v.string(),
        description: v.optional(v.string()),
        trigger: automationTriggerValidator,
        action: automationActionValidator,
        status: automationStatusValidator,
        maxExecutions: v.number(),
        executionCount: v.number(),
        targetShortcutId: v.id("saved_shortcuts"),
        lastEvaluatedAt: v.optional(v.string()),
        lastTriggeredAt: v.optional(v.string()),
        lastExecutedAt: v.optional(v.string()),
        lastError: v.optional(v.string()),
        lastRunId: v.optional(v.id("runs")),
        nextRunAt: v.optional(v.string()),
        createdAt: v.string(),
        updatedAt: v.string(),
    })
        .index("by_ownerAddress", ["ownerAddress"])
        .index("by_ownerAddress_status", ["ownerAddress", "status"])
        .index("by_ownerAddress_targetShortcutId_updatedAt", ["ownerAddress", "targetShortcutId", "updatedAt"])
        .index("by_targetShortcutId", ["targetShortcutId"])
        .index("by_status_triggerType", ["status", "trigger.type"])
        .index("by_status_triggerType_nextRunAt", ["status", "trigger.type", "nextRunAt"]),

    runs: defineTable({
        ownerAddress: v.string(),
        name: v.string(),
        sourceType: runSourceTypeValidator,
        sourceId: v.string(),
        shortcutId: v.optional(v.id("saved_shortcuts")),
        status: runStatusValidator,
        inputValues: runInputValuesValidator,
        definitionSnapshot: v.optional(runDefinitionSnapshotValidator),
        error: v.optional(v.string()),
        scheduledFunctionId: v.optional(v.string()),
        createdAt: v.string(),
        startedAt: v.string(),
        completedAt: v.optional(v.string()),
    })
        .index("by_ownerAddress", ["ownerAddress"])
        .index("by_ownerAddress_createdAt", ["ownerAddress", "createdAt"])
        .index("by_ownerAddress_sourceType_sourceId", ["ownerAddress", "sourceType", "sourceId"])
        .index("by_sourceType_sourceId", ["sourceType", "sourceId"])
        .index("by_sourceType_createdAt", ["sourceType", "createdAt"])
        .index("by_status", ["status"]),

    run_steps: defineTable({
        runId: v.id("runs"),
        stepId: v.string(),
        label: v.string(),
        status: runStepStatusValidator,
        outputSummary: v.optional(v.string()),
        error: v.optional(v.string()),
        startedAt: v.string(),
        completedAt: v.optional(v.string()),
        durationMs: v.optional(v.number()),
        sequence: v.number(),
    })
        .index("by_runId", ["runId"])
        .index("by_runId_sequence", ["runId", "sequence"]),
});
