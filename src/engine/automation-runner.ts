/* ==========================================================================
   Automation Runner — The core automation evaluation engine
   Called by the cron job to check all active automations.
   CDP-free: uses viem for reads and prepares wallet-approved writes.

   Execution Strategy:
   - CANONICAL (preferred): If `targetShortcutId` is set, the automation
     delegates to the shortcut engine (`executeShortcut`). This ensures
     builder, runs, and automations share a single source of truth.
   - LEGACY (deprecated): If no linked shortcut is present, the automation
     is moved into an explicit error state and must be recreated from the app.
   ========================================================================== */

import type { Action, Automation, ExecutionLog, Trigger } from "@/types/automation";
import {
    createRunInConvex,
    finalizeRunInConvex,
    getRunFromConvex,
    getSavedShortcutFromConvex,
    hasConvexBackend,
    listActiveAutomationsFromConvex,
    updateAutomationInConvex,
} from "@/lib/convex-server";
import type { Id, RunStatus, RunStepStatus } from "@/lib/convex-server";
import { executeShortcut } from "@/engine/executor";
import { getPrice } from "@/engine/price-feed";
import type { Shortcut, ShortcutStep, StepResult } from "@/engine/types";
import {
    type NetworkId,
} from "@/lib/chain-config";
import { computeNextScheduledRunAt } from "@/lib/automation-schedule";
import { hydrateWalletExecutionContext } from "@/lib/wallet-context";
import {
    ShortcutValidationError,
    validateShortcutForAutomation,
} from "@/lib/shortcut-validation";
import { isPreparedTransactionOutput } from "@/lib/transaction-output";
import {
    isSocialSharePreparationData,
    serializeSocialSharePreparationData,
} from "@/lib/social-share";

const PRICE_TRIGGER_COOLDOWN_MS = 60 * 60 * 1000;
const PENDING_RUN_STATUSES = new Set<RunStatus>(["queued", "running", "awaiting_signature"]);

// ---------------------------------------------------------------------------
// Condition Checker
// ---------------------------------------------------------------------------

interface ConditionResult {
    triggered: boolean;
    priceAtCheck?: number;
}

function isPriceTrigger(trigger: Trigger): boolean {
    return trigger.type === "price_below" || trigger.type === "price_above";
}

function isInPriceCooldown(automation: Automation, now: Date): boolean {
    if (!isPriceTrigger(automation.trigger) || !automation.lastTriggeredAt) return false;
    const lastTriggeredAt = Date.parse(automation.lastTriggeredAt);
    if (!Number.isFinite(lastTriggeredAt)) return false;
    return now.getTime() - lastTriggeredAt < PRICE_TRIGGER_COOLDOWN_MS;
}

async function hasPendingAutomationRun(automation: Automation): Promise<boolean> {
    if (!automation.lastRunId) return false;

    const existing = await getRunFromConvex(
        automation.accountAddress,
        automation.lastRunId as Id<"runs">,
    );
    const status = existing?.run?.status as RunStatus | undefined;
    return Boolean(status && PENDING_RUN_STATUSES.has(status));
}

function shouldMoveAutomationToError(error: string | undefined): boolean {
    if (!error) return false;
    return (
        error === "Linked shortcut could not be found." ||
        error.includes("not automation-compatible")
    );
}

async function checkCondition(trigger: Trigger): Promise<ConditionResult> {
    switch (trigger.type) {
        case "price_below": {
            const priceData = await getPrice(trigger.token);
            return {
                triggered: priceData.priceUsd < trigger.priceUsd,
                priceAtCheck: priceData.priceUsd,
            };
        }

        case "price_above": {
            const priceData = await getPrice(trigger.token);
            return {
                triggered: priceData.priceUsd > trigger.priceUsd,
                priceAtCheck: priceData.priceUsd,
            };
        }

        case "scheduled": {
            return { triggered: false };
        }

        default:
            return { triggered: false };
    }
}

interface SavedShortcutRecord {
    _id: string;
    name: string;
    description?: string;
    category: string;
    inputs?: unknown[];
    steps: unknown[];
    version?: string;
    createdAt?: string;
    updatedAt?: string;
}

function findShortcutStepById(
    steps: ShortcutStep[],
    stepId: string,
): ShortcutStep | undefined {
    for (const step of steps) {
        if (step.id === stepId) {
            return step;
        }
        if (step.thenSteps) {
            const match = findShortcutStepById(step.thenSteps, stepId);
            if (match) return match;
        }
        if (step.elseSteps) {
            const match = findShortcutStepById(step.elseSteps, stepId);
            if (match) return match;
        }
        if (step.repeatSteps) {
            const match = findShortcutStepById(step.repeatSteps, stepId);
            if (match) return match;
        }
    }
    return undefined;
}

function summarizeStepOutput(output: unknown): string | undefined {
    if (output == null) return undefined;
    if (typeof output === "string") return output;
    if (isPreparedTransactionOutput(output)) {
        return String(output.summary ?? output.description ?? "Prepared transaction");
    }
    if (typeof output === "object" && output !== null) {
        if (isSocialSharePreparationData(output)) {
            return serializeSocialSharePreparationData(output);
        }

        const description =
            "description" in output && typeof output.description === "string" && output.description.trim()
                ? output.description.trim()
                : undefined;
        const summary =
            "summary" in output && typeof output.summary === "string" && output.summary.trim()
                ? output.summary.trim()
                : undefined;
        const message =
            "message" in output && typeof output.message === "string" && output.message.trim()
                ? output.message.trim()
                : undefined;

        if (description && summary && description !== summary) {
            return `${description} — ${summary}`;
        }
        if (summary) return summary;
        if (description) return description;
        if (message) return message;
    }
    try {
        return JSON.stringify(output);
    } catch {
        return undefined;
    }
}

function serializeStep(step: StepResult, definition: ShortcutStep | undefined, index: number) {
    return {
        stepId: step.stepId,
        label: definition
            ? `${definition.skill}.${definition.action}`
            : step.stepId,
        status: step.status,
        outputSummary: summarizeStepOutput(step.output),
        error: step.error,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
        durationMs: step.durationMs,
        sequence: index,
    };
}

function buildShortcutFromSavedRecord(record: SavedShortcutRecord): Shortcut {
    const now = new Date().toISOString();
    return {
        id: String(record._id),
        name: record.name,
        description: record.description ?? "",
        version: record.version ?? "1.0.0",
        author: "",
        icon: "",
        color: "",
        category: record.category as Shortcut["category"],
        tags: [],
        inputs: Array.isArray(record.inputs) ? record.inputs as Shortcut["inputs"] : [],
        steps: record.steps as ShortcutStep[],
        createdAt: record.createdAt ?? now,
        updatedAt: record.updatedAt ?? now,
    };
}

// ---------------------------------------------------------------------------
// Main runner — called by cron
// ---------------------------------------------------------------------------

export interface RunnerResult {
    totalChecked: number;
    totalTriggered: number;
    totalExecuted: number;
    totalErrors: number;
    logs: ExecutionLog[];
}

async function executeLinkedShortcut(
    automation: Automation,
    condition: ConditionResult,
    walletContext: Record<string, unknown>,
    networkId?: NetworkId,
): Promise<{
    finalizedStatus: "awaiting_signature" | "succeeded" | "failed" | "canceled";
    error?: string;
    stepWrites: Array<{
        stepId: string;
        label: string;
        status: string;
        outputSummary?: string;
        error?: string;
        startedAt: string;
        completedAt?: string;
        durationMs?: number;
        sequence: number;
    }>;
    logResult?: Record<string, unknown>;
}> {
    const savedShortcut = await getSavedShortcutFromConvex(
        automation.accountAddress,
        automation.targetShortcutId as Id<"saved_shortcuts">,
    ) as SavedShortcutRecord | null;

    if (!savedShortcut) {
        return {
            finalizedStatus: "failed",
            error: "Linked shortcut could not be found.",
            stepWrites: [],
        };
    }

    const shortcut = buildShortcutFromSavedRecord(savedShortcut);
    const inputValues: Record<string, unknown> = {
        ...walletContext,
        walletAddress: automation.accountAddress,
        automationId: automation.id,
        triggerType: automation.trigger.type,
        ...(condition.priceAtCheck != null ? { priceAtCheck: condition.priceAtCheck } : {}),
    };

    try {
        validateShortcutForAutomation(shortcut, inputValues, networkId);
    } catch (error) {
        return {
            finalizedStatus: "failed",
            error:
                error instanceof ShortcutValidationError
                    ? error.issues[0] ?? "Linked shortcut is not automation-compatible."
                    : error instanceof Error
                        ? error.message
                        : "Linked shortcut is not automation-compatible.",
            stepWrites: [],
        };
    }

    const result = await executeShortcut(shortcut, inputValues, {}, networkId);
    const pendingTransactions = result.steps.filter(
        (step) => step.status === "success" && isPreparedTransactionOutput(step.output),
    );

    const finalizedStatus =
        pendingTransactions.length > 0
            ? "awaiting_signature"
            : result.status === "success"
                ? "succeeded"
                : result.status === "aborted"
                    ? "canceled"
                    : "failed";

    return {
        finalizedStatus,
        error: finalizedStatus === "failed" || finalizedStatus === "canceled"
            ? result.steps.find((step) => step.status === "error")?.error ?? "Shortcut execution failed"
            : undefined,
        stepWrites: result.steps.map((step, index) => (
            serializeStep(step, findShortcutStepById(shortcut.steps, step.stepId), index)
        )),
        logResult: {
            shortcutId: automation.targetShortcutId,
            status: finalizedStatus,
            pendingTransactions: pendingTransactions.length,
        },
    };
}

/**
 * Check all active automations, evaluate conditions, and execute actions.
 * Called by the cron endpoint (every 5 minutes).
 */
export async function runAutomationCheck(): Promise<RunnerResult> {
    if (!hasConvexBackend()) {
        throw new Error("Convex backend is not configured.");
    }

    const automationDocs = await listActiveAutomationsFromConvex();
    const automations: Automation[] = automationDocs.map((automation: {
        _id: string;
        name: string;
        description?: string;
        accountAddress: string;
        networkId?: string;
        trigger: unknown;
        action: unknown;
        targetShortcutId: string;
        status: string;
        maxExecutions: number;
        executionCount: number;
        createdAt: string;
        nextRunAt?: string;
        lastTriggeredAt?: string;
        lastExecutedAt?: string;
        lastError?: string;
        lastRunId?: string;
    }) => ({
        id: String(automation._id),
        name: automation.name,
        description: automation.description ?? "",
        accountAddress: automation.accountAddress,
        networkId: automation.networkId as NetworkId | undefined,
        trigger: automation.trigger as Trigger,
        action: automation.action as Action,
        targetShortcutId: automation.targetShortcutId,
        status: automation.status as Automation["status"],
        maxExecutions: automation.maxExecutions,
        executionCount: automation.executionCount,
        createdAt: automation.createdAt,
        nextRunAt: automation.nextRunAt,
        lastTriggeredAt: automation.lastTriggeredAt,
        lastExecutedAt: automation.lastExecutedAt,
        lastError: automation.lastError,
        lastRunId: automation.lastRunId,
    }));

    const result: RunnerResult = {
        totalChecked: automations.length,
        totalTriggered: 0,
        totalExecuted: 0,
        totalErrors: 0,
        logs: [],
    };

    for (const automation of automations) {
        let scheduledNextRunAt: string | undefined;
        try {
            if (!automation.networkId) {
                const migrationError =
                    "Automation needs a network selection before it can run. Open it again from the app and recreate or update it on the correct Base network.";

                result.totalErrors++;
                result.logs.push({
                    id: `missing-network-${automation.id}-${Date.now()}`,
                    automationId: automation.id,
                    triggered: false,
                    success: false,
                    error: migrationError,
                    executedAt: new Date().toISOString(),
                });

                await updateAutomationInConvex(
                    automation.accountAddress,
                    automation.id as Id<"automations">,
                    {
                        status: "error",
                        lastError: migrationError,
                    },
                );
                continue;
            }

            let condition: ConditionResult;
            if (automation.trigger.type === "scheduled") {
                const now = new Date();
                const nowIso = now.toISOString();
                const dueRunAt =
                    automation.nextRunAt ??
                    computeNextScheduledRunAt(automation.trigger.cron, now, { inclusive: true });

                if (!dueRunAt) {
                    throw new Error("Could not compute next scheduled run for automation.");
                }

                if (!automation.nextRunAt && dueRunAt > nowIso) {
                    await updateAutomationInConvex(
                        automation.accountAddress,
                        automation.id as Id<"automations">,
                        {
                            nextRunAt: dueRunAt,
                            lastError: null,
                        },
                    );
                    continue;
                }

                const followingRunAt = computeNextScheduledRunAt(automation.trigger.cron, now);
                if (!followingRunAt) {
                    throw new Error("Could not compute the following scheduled run after execution.");
                }
                scheduledNextRunAt = followingRunAt;

                condition = { triggered: true };
            } else {
                if (isInPriceCooldown(automation, new Date())) {
                    continue;
                }
                condition = await checkCondition(automation.trigger);
            }

            if (!condition.triggered) {
                continue;
            }

            if (await hasPendingAutomationRun(automation)) {
                const pendingMessage =
                    "Previous automation run is still waiting for wallet approval. Open Runs to complete or cancel it before this automation triggers again.";
                await updateAutomationInConvex(automation.accountAddress, automation.id as Id<"automations">, {
                    ...(scheduledNextRunAt ? { nextRunAt: scheduledNextRunAt } : {}),
                    lastError: pendingMessage,
                });
                continue;
            }

            result.totalTriggered++;

            const automationNetworkId = automation.networkId;
            const walletContext = await hydrateWalletExecutionContext(
                automation.accountAddress,
                automationNetworkId,
            );

            const runId = await createRunInConvex({
                ownerAddress: automation.accountAddress,
                name: automation.name,
                sourceType: "automation" as const,
                sourceId: automation.id,
                shortcutId: automation.targetShortcutId as Id<"saved_shortcuts">,
                inputValues: {
                    ...walletContext,
                    automationId: automation.id,
                    triggerType: automation.trigger.type,
                    ...(condition.priceAtCheck != null ? { priceAtCheck: condition.priceAtCheck } : {}),
                },
                status: "running" as const,
            });

            const executionResult = await executeLinkedShortcut(
                automation,
                condition,
                walletContext,
                automationNetworkId,
            );

            const executedAt = new Date().toISOString();

            await finalizeRunInConvex({
                ownerAddress: automation.accountAddress,
                runId: String(runId) as Id<"runs">,
                status: executionResult.finalizedStatus as RunStatus,
                ...(executionResult.error ? { error: executionResult.error } : {}),
                completedAt: executedAt,
                steps: executionResult.stepWrites.map((step) => ({
                    ...step,
                    status: step.status as RunStepStatus,
                    startedAt: step.startedAt || executedAt,
                    completedAt: step.completedAt ?? executedAt,
                })),
            });

            const log: ExecutionLog = {
                id: String(runId),
                automationId: automation.id,
                triggered: true,
                success: executionResult.finalizedStatus === "succeeded",
                result: executionResult.logResult,
                error: executionResult.error,
                priceAtCheck: condition.priceAtCheck,
                executedAt,
            };
            result.logs.push(log);

            if (executionResult.finalizedStatus === "succeeded") {
                result.totalExecuted++;

                // Update automation state
                const newCount = automation.executionCount + 1;
                const updates: Partial<Automation> = {
                    executionCount: newCount,
                    lastExecutedAt: new Date().toISOString(),
                };

                // Check if max executions reached
                if (automation.maxExecutions > 0 && newCount >= automation.maxExecutions) {
                    updates.status = "completed";
                }

                await updateAutomationInConvex(automation.accountAddress, automation.id as Id<"automations">, {
                    executionCount: updates.executionCount,
                    lastExecutedAt: updates.lastExecutedAt,
                    lastTriggeredAt: executedAt,
                    ...(scheduledNextRunAt ? { nextRunAt: scheduledNextRunAt } : {}),
                    ...(updates.status ? { status: updates.status } : {}),
                    lastError: null,
                    lastRunId: String(runId) as Id<"runs">,
                });
            } else if (executionResult.finalizedStatus === "awaiting_signature") {
                await updateAutomationInConvex(automation.accountAddress, automation.id as Id<"automations">, {
                    lastTriggeredAt: executedAt,
                    ...(scheduledNextRunAt ? { nextRunAt: scheduledNextRunAt } : {}),
                    lastError: null,
                    lastRunId: String(runId) as Id<"runs">,
                });
            } else {
                result.totalErrors++;
                const shouldErrorAutomation = shouldMoveAutomationToError(executionResult.error);
                await updateAutomationInConvex(automation.accountAddress, automation.id as Id<"automations">, {
                    lastTriggeredAt: executedAt,
                    ...(scheduledNextRunAt ? { nextRunAt: scheduledNextRunAt } : {}),
                    lastError: executionResult.error ?? "Automation action failed",
                    lastRunId: String(runId) as Id<"runs">,
                    ...(shouldErrorAutomation ? { status: "error" as const } : {}),
                });
            }
        } catch (err) {
            result.totalErrors++;
            const log: ExecutionLog = {
                id: `error-${automation.id}-${Date.now()}`,
                automationId: automation.id,
                triggered: false,
                success: false,
                error: err instanceof Error ? err.message : String(err),
                executedAt: new Date().toISOString(),
            };
            result.logs.push(log);
            await updateAutomationInConvex(automation.accountAddress, automation.id as Id<"automations">, {
                ...(scheduledNextRunAt ? { nextRunAt: scheduledNextRunAt } : {}),
                lastError: log.error ?? "Automation check failed",
            });
        }
    }

    return result;
}
