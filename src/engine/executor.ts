/* ==========================================================================
   Engine — Executor
   Runs a parsed Shortcut step-by-step according to the resolved order.
   Handles: variable resolution, confirmation flow, retry, abort/continue.
   ========================================================================== */

import type {
    Shortcut,
    ShortcutStep,
    StepResult,
    RunResult,
    VariableContext,
    FailureStrategy,
    StructuredCondition,
} from "./types";
import { resolveExecutionOrder, buildStepMap } from "./resolver";
import {
    createVariableContext,
    setStepOutput,
    resolveParams,
    resolveTemplate,
} from "./variables";
import { evaluateCondition } from "./condition";
import { skillRegistry } from "@/skills/registry";
import { validateShortcutForExecution } from "@/lib/shortcut-validation";
import type { NetworkId } from "@/lib/chain-config";
import { MAX_REPEAT_ITERATIONS } from "@/lib/runtime-limits";
import {
    isPreparedTransactionOutput,
    type PreparedTransactionOutput,
    type SubmittedTransactionOutput,
} from "@/lib/transaction-output";

// Ensure built-in skills are registered
import "@/skills/logic";
import "@/skills/wallet";
import "@/skills/defi";
import "@/skills/nft";
import "@/skills/data";
import "@/skills/swap";
import "@/skills/bridge";
import "@/skills/tx";
import "@/skills/social";
import "@/skills/x402";

// ---------------------------------------------------------------------------
// Types for execution hooks (UI callbacks)
// ---------------------------------------------------------------------------

export interface ExecutionCallbacks {
    /** Called when a step starts */
    onStepStart?: (stepId: string, step: ShortcutStep) => void;
    /** Called when a step needs user confirmation. Return true to proceed, false to abort. */
    onConfirmRequired?: (
        stepId: string,
        step: ShortcutStep,
        resolvedParams: Record<string, unknown>,
    ) => Promise<boolean>;
    /** Called when a step needs a runtime input value from the user. */
    onInputRequired?: (
        stepId: string,
        step: ShortcutStep,
        request: {
            prompt: string;
            inputType: string;
            defaultValue?: string;
            placeholder?: string;
            options?: Array<{ label: string; value: string }>;
        },
    ) => Promise<unknown>;
    /** Called when a prepared transaction needs a wallet signature before execution can continue. */
    onSignatureRequired?: (
        stepId: string,
        step: ShortcutStep,
        preparedTransaction: PreparedTransactionOutput,
    ) => Promise<SubmittedTransactionOutput>;
    /** Called when a step completes (success or error) */
    onStepComplete?: (stepId: string, result: StepResult) => void;
    /** Called when a step is skipped (condition false) */
    onStepSkipped?: (stepId: string) => void;
}

export type PendingInteraction =
    | {
        kind: "confirmation";
        stepId: string;
        skillId: string;
        resolvedParams: Record<string, unknown>;
    }
    | {
        kind: "input";
        stepId: string;
        skillId: string;
        prompt: string;
        inputType: string;
        defaultValue?: string;
        placeholder?: string;
        options?: Array<{ label: string; value: string }>;
    }
    | {
        kind: "signature";
        stepId: string;
        skillId: string;
        preparedTransaction: {
            stepId: string;
            stepLabel: string;
            calls: PreparedTransactionOutput["calls"];
            description: string;
            networkId: PreparedTransactionOutput["networkId"];
            explorerBaseUrl: string;
            summary: string;
            callCount: number;
            protocol?: PreparedTransactionOutput["protocol"];
            action?: PreparedTransactionOutput["action"];
        };
    };

export class ExecutionPaused extends Error {
    interaction: PendingInteraction;

    constructor(interaction: PendingInteraction) {
        super(`Execution paused for ${interaction.kind}`);
        this.name = "ExecutionPaused";
        this.interaction = interaction;
    }
}

// ---------------------------------------------------------------------------
// Retry logic
// ---------------------------------------------------------------------------

function parseRetryCount(strategy: FailureStrategy | undefined): number {
    if (!strategy) return 0;
    const match = strategy.match(/^retry\((\d+)\)$/);
    return match ? parseInt(match[1], 10) : 0;
}

// ---------------------------------------------------------------------------
// Step-list executor (reusable for top-level and nested branch steps)
// ---------------------------------------------------------------------------

interface StepListResult {
    stepResults: StepResult[];
    status: "ok" | "error" | "aborted" | "waiting_confirmation" | "waiting_input" | "waiting_signature";
    pendingInteraction?: PendingInteraction;
}

function parseInteractionOptions(value: unknown): Array<{ label: string; value: string }> {
    if (typeof value !== "string") return [];

    return value
        .split(/\r?\n|,/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .map((entry) => ({
            label: entry,
            value: entry,
        }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface RepeatDescriptor {
    mode: "count" | "each";
    totalIterations: number;
    count?: number;
    items?: unknown[];
    summary?: string;
}

function isRepeatAction(step: ShortcutStep): boolean {
    return step.skill === "logic" && (step.action === "repeat" || step.action === "repeat_each");
}

function extractRepeatDescriptor(output: unknown): RepeatDescriptor | null {
    if (!isRecord(output)) return null;

    const mode = output.mode === "each" ? "each" : output.mode === "count" ? "count" : null;
    if (!mode) return null;

    const totalIterations =
        typeof output.totalIterations === "number" && Number.isFinite(output.totalIterations)
            ? output.totalIterations
            : typeof output.count === "number" && Number.isFinite(output.count)
                ? output.count
                : mode === "each" && Array.isArray(output.items)
                    ? output.items.length
                    : 0;

    if (totalIterations < 1 || totalIterations > MAX_REPEAT_ITERATIONS) return null;

    return {
        mode,
        totalIterations,
        ...(typeof output.count === "number" ? { count: output.count } : {}),
        ...(Array.isArray(output.items) ? { items: output.items } : {}),
        ...(typeof output.summary === "string" ? { summary: output.summary } : {}),
    };
}

function setResolvedStepOutput(
    ctx: VariableContext,
    step: ShortcutStep,
    output: unknown,
): void {
    if (step.output?.as) {
        setStepOutput(ctx, step.output.as, output);
    }
    setStepOutput(ctx, step.id, output);
}

function buildRepeatIterationOutput(
    baseOutput: unknown,
    descriptor: RepeatDescriptor,
    index: number,
): Record<string, unknown> {
    const currentItem = descriptor.items?.[index];
    const iteration = index + 1;
    const totalIterations = descriptor.totalIterations;

    return {
        ...(isRecord(baseOutput) ? baseOutput : {}),
        mode: descriptor.mode,
        count: descriptor.count ?? totalIterations,
        totalIterations,
        currentIndex: index,
        iteration,
        isFirst: index === 0,
        isLast: iteration === totalIterations,
        ...(descriptor.items ? { items: descriptor.items } : {}),
        ...(currentItem !== undefined ? { currentItem } : {}),
        summary: descriptor.mode === "each"
            ? `Iteration ${iteration} of ${totalIterations}`
            : `Repeat iteration ${iteration} of ${totalIterations}`,
    };
}

function buildRepeatFinalOutput(
    baseOutput: unknown,
    descriptor: RepeatDescriptor,
): Record<string, unknown> {
    const totalIterations = descriptor.totalIterations;
    const lastIndex = totalIterations - 1;
    const lastItem = descriptor.items?.[lastIndex];

    return {
        ...(isRecord(baseOutput) ? baseOutput : {}),
        mode: descriptor.mode,
        count: descriptor.count ?? totalIterations,
        totalIterations,
        completedIterations: totalIterations,
        ...(descriptor.items ? { items: descriptor.items } : {}),
        ...(lastItem !== undefined ? { lastItem } : {}),
        summary: descriptor.mode === "each"
            ? `Completed ${totalIterations} repeat-with-each iteration${totalIterations === 1 ? "" : "s"}`
            : `Completed ${totalIterations} repeat iteration${totalIterations === 1 ? "" : "s"}`,
    };
}

/**
 * Execute a list of steps sequentially.
 * Used for both the top-level step list and nested branch steps.
 */
async function executeStepList(
    steps: ShortcutStep[],
    ctx: VariableContext,
    callbacks: ExecutionCallbacks,
): Promise<StepListResult> {
    const order = resolveExecutionOrder(steps);
    const stepMap = buildStepMap(steps);
    const stepResults: StepResult[] = [];
    let listStatus: StepListResult["status"] = "ok";

    for (const stepId of order) {
        const step = stepMap.get(stepId);
        if (!step) continue;

        const stepStartedAt = new Date().toISOString();
        const stepStartTime = performance.now();

        // ---- Condition check (legacy string or structured) ----
        if (step.condition) {
            const shouldRun = evaluateStepCondition(step.condition, ctx);
            if (!shouldRun) {
                callbacks.onStepSkipped?.(stepId);
                stepResults.push({
                    stepId,
                    status: "skipped",
                    durationMs: 0,
                    startedAt: stepStartedAt,
                    completedAt: new Date().toISOString(),
                });
                continue;
            }
        }

        // ---- Resolve params ----
        const resolvedParams = resolveParams(step.params, ctx);

        // ---- Notify step start ----
        callbacks.onStepStart?.(stepId, step);

        // ---- Runtime input gate ----
        if (
            step.skill === "logic" &&
            (step.action === "ask_input" || step.action === "choose_menu")
        ) {
            if (!callbacks.onInputRequired) {
                const result: StepResult = {
                    stepId,
                    status: "error",
                    error: "Interactive input is required for this step, but no input callback is available.",
                    durationMs: performance.now() - stepStartTime,
                    startedAt: stepStartedAt,
                    completedAt: new Date().toISOString(),
                };
                stepResults.push(result);
                callbacks.onStepComplete?.(stepId, result);
                listStatus = "error";
                break;
            }

            const options = step.action === "choose_menu"
                ? parseInteractionOptions(resolvedParams.options)
                : undefined;

            if (step.action === "choose_menu" && (!options || options.length === 0)) {
                const result: StepResult = {
                    stepId,
                    status: "error",
                    error: "Choose Menu requires at least one option.",
                    durationMs: performance.now() - stepStartTime,
                    startedAt: stepStartedAt,
                    completedAt: new Date().toISOString(),
                };
                stepResults.push(result);
                callbacks.onStepComplete?.(stepId, result);
                listStatus = "error";
                break;
            }

            const request = {
                prompt: String(
                    resolvedParams.prompt
                    ?? (step.action === "choose_menu" ? "Choose an option" : "Enter a value"),
                ),
                inputType: String(
                    resolvedParams.inputType
                    ?? (step.action === "choose_menu" ? "select" : "text"),
                ),
                defaultValue:
                    resolvedParams.defaultValue === undefined
                        ? undefined
                        : String(resolvedParams.defaultValue),
                placeholder:
                    resolvedParams.placeholder === undefined
                        ? undefined
                        : String(resolvedParams.placeholder),
                ...(options ? { options } : {}),
            };

            const waitingResult: StepResult = {
                stepId,
                status: "waiting_input",
                durationMs: 0,
                startedAt: stepStartedAt,
            };
            callbacks.onStepComplete?.(stepId, waitingResult);

            try {
                resolvedParams.value = await callbacks.onInputRequired(
                    stepId,
                    step,
                    request,
                );
            } catch (err) {
                if (err instanceof ExecutionPaused && err.interaction.kind === "input") {
                    stepResults.push(waitingResult);
                    return {
                        stepResults,
                        status: "waiting_input",
                        pendingInteraction: err.interaction,
                    };
                }

                const result: StepResult = {
                    stepId,
                    status: "error",
                    error: err instanceof Error ? err.message : String(err),
                    durationMs: performance.now() - stepStartTime,
                    startedAt: stepStartedAt,
                    completedAt: new Date().toISOString(),
                };
                stepResults.push(result);
                callbacks.onStepComplete?.(stepId, result);
                listStatus = "error";
                break;
            }
        }

        // ---- Confirmation gate ----
        if (step.confirm) {
            if (!callbacks.onConfirmRequired) {
                const result: StepResult = {
                    stepId,
                    status: "error",
                    error: "Approval is required for this step, but no confirmation callback is available.",
                    durationMs: performance.now() - stepStartTime,
                    startedAt: stepStartedAt,
                    completedAt: new Date().toISOString(),
                };
                stepResults.push(result);
                callbacks.onStepComplete?.(stepId, result);
                listStatus = "error";
                break;
            }

            const waitingResult: StepResult = {
                stepId,
                status: "waiting_confirmation",
                durationMs: 0,
                startedAt: stepStartedAt,
            };
            callbacks.onStepComplete?.(stepId, waitingResult);

            try {
                const confirmed = await callbacks.onConfirmRequired(
                    stepId,
                    step,
                    resolvedParams,
                );

                if (!confirmed) {
                    stepResults.push({
                        stepId,
                        status: "error",
                        error: "User rejected confirmation",
                        durationMs: performance.now() - stepStartTime,
                        startedAt: stepStartedAt,
                        completedAt: new Date().toISOString(),
                    });
                    listStatus = "aborted";
                    break;
                }
            } catch (err) {
                if (err instanceof ExecutionPaused && err.interaction.kind === "confirmation") {
                    stepResults.push(waitingResult);
                    return {
                        stepResults,
                        status: "waiting_confirmation",
                        pendingInteraction: err.interaction,
                    };
                }

                const result: StepResult = {
                    stepId,
                    status: "error",
                    error: err instanceof Error ? err.message : String(err),
                    durationMs: performance.now() - stepStartTime,
                    startedAt: stepStartedAt,
                    completedAt: new Date().toISOString(),
                };
                stepResults.push(result);
                callbacks.onStepComplete?.(stepId, result);
                listStatus = "error";
                break;
            }
        }

        // ---- Execute with retry ----
        const maxRetries = parseRetryCount(step.onFailure);
        let lastResult: StepResult | null = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const skill = skillRegistry.getOrThrow(step.skill);
                const skillResult = await skill.execute(
                    step.action,
                    resolvedParams,
                    ctx,
                );

                if (skillResult.success) {
                    let finalOutput = skillResult.data;

                    if (
                        finalOutput !== undefined &&
                        isPreparedTransactionOutput(finalOutput) &&
                        callbacks.onSignatureRequired
                    ) {
                        const waitingResult: StepResult = {
                            stepId,
                            status: "waiting_signature",
                            durationMs: 0,
                            startedAt: stepStartedAt,
                        };
                        callbacks.onStepComplete?.(stepId, waitingResult);

                        try {
                            finalOutput = await callbacks.onSignatureRequired(
                                stepId,
                                step,
                                finalOutput,
                            );
                        } catch (err) {
                            if (err instanceof ExecutionPaused && err.interaction.kind === "signature") {
                                stepResults.push(waitingResult);
                                return {
                                    stepResults,
                                    status: "waiting_signature",
                                    pendingInteraction: err.interaction,
                                };
                            }

                            throw err;
                        }
                    }

                    // Store output in variable context
                    if (finalOutput !== undefined) {
                        setResolvedStepOutput(ctx, step, finalOutput);
                    }

                    lastResult = {
                        stepId,
                        status: "success",
                        output: finalOutput,
                        durationMs: performance.now() - stepStartTime,
                        startedAt: stepStartedAt,
                        completedAt: new Date().toISOString(),
                    };
                    break; // Success — exit retry loop
                } else {
                    lastResult = {
                        stepId,
                        status: "error",
                        error: skillResult.error ?? skillResult.message ?? "Unknown error",
                        durationMs: performance.now() - stepStartTime,
                        startedAt: stepStartedAt,
                        completedAt: new Date().toISOString(),
                    };
                    if (attempt < maxRetries) continue;
                }
            } catch (err) {
                lastResult = {
                    stepId,
                    status: "error",
                    error: err instanceof Error ? err.message : String(err),
                    durationMs: performance.now() - stepStartTime,
                    startedAt: stepStartedAt,
                    completedAt: new Date().toISOString(),
                };
                if (attempt < maxRetries) continue;
            }
        }

        if (lastResult) {
            let nestedStepResults: StepResult[] = [];

            if (
                lastResult.status === "success" &&
                isRepeatAction(step) &&
                (step.repeatSteps?.length ?? 0) > 0
            ) {
                const descriptor = extractRepeatDescriptor(lastResult.output);

                if (!descriptor) {
                    lastResult = {
                        stepId,
                        status: "error",
                        error: "Repeat step did not produce a valid loop descriptor.",
                        durationMs: performance.now() - stepStartTime,
                        startedAt: stepStartedAt,
                        completedAt: new Date().toISOString(),
                    };
                } else {
                    for (let iterationIndex = 0; iterationIndex < descriptor.totalIterations; iterationIndex += 1) {
                        const iterationOutput = buildRepeatIterationOutput(
                            lastResult.output,
                            descriptor,
                            iterationIndex,
                        );
                        setResolvedStepOutput(ctx, step, iterationOutput);

                        const repeatResult = await executeStepList(
                            step.repeatSteps ?? [],
                            ctx,
                            callbacks,
                        );
                        nestedStepResults.push(...repeatResult.stepResults);

                        if (
                            repeatResult.status === "waiting_confirmation" ||
                            repeatResult.status === "waiting_input" ||
                            repeatResult.status === "waiting_signature"
                        ) {
                            stepResults.push(lastResult);
                            callbacks.onStepComplete?.(stepId, lastResult);
                            stepResults.push(...nestedStepResults);
                            return {
                                stepResults,
                                status: repeatResult.status,
                                pendingInteraction: repeatResult.pendingInteraction,
                            };
                        }

                        if (repeatResult.status === "aborted") {
                            lastResult = {
                                ...lastResult,
                                output: buildRepeatFinalOutput(lastResult.output, descriptor),
                                completedAt: new Date().toISOString(),
                            };
                            setResolvedStepOutput(ctx, step, lastResult.output);
                            listStatus = "aborted";
                            break;
                        }

                        if (repeatResult.status === "error") {
                            listStatus = "error";
                            break;
                        }
                    }

                    if (lastResult.status === "success") {
                        lastResult = {
                            ...lastResult,
                            output: buildRepeatFinalOutput(lastResult.output, descriptor),
                            completedAt: new Date().toISOString(),
                        };
                        setResolvedStepOutput(ctx, step, lastResult.output);
                    }
                }
            }

            stepResults.push(lastResult);
            callbacks.onStepComplete?.(stepId, lastResult);
            if (nestedStepResults.length > 0) {
                stepResults.push(...nestedStepResults);
            }

            if (isRepeatAction(step) && (listStatus === "error" || listStatus === "aborted")) {
                break;
            }

            if (
                lastResult.status === "success" &&
                step.skill === "logic" &&
                step.action === "stop"
            ) {
                listStatus = "aborted";
                break;
            }

            // ---- Handle failure strategy ----
            if (lastResult.status === "error") {
                const strategy = step.onFailure ?? "abort";

                if (strategy === "abort") {
                    listStatus = "error";
                    break;
                }
                // "continue" and retry(exhausted) — keep going
            }
        }

        // ---- If/Else branch routing ----
        if (
            step.skill === "logic" &&
            step.action === "if_else" &&
            lastResult?.status === "success" &&
            (step.thenSteps || step.elseSteps)
        ) {
            const branchData = lastResult.output;
            const branch = extractBranch(branchData);
            const branchSteps = branch === "then"
                ? (step.thenSteps ?? [])
                : (step.elseSteps ?? []);

            if (branchSteps.length > 0) {
                const branchResult = await executeStepList(
                    branchSteps,
                    ctx,
                    callbacks,
                );
                stepResults.push(...branchResult.stepResults);

                if (
                    branchResult.status === "waiting_confirmation" ||
                    branchResult.status === "waiting_input" ||
                    branchResult.status === "waiting_signature"
                ) {
                    return {
                        stepResults,
                        status: branchResult.status,
                        pendingInteraction: branchResult.pendingInteraction,
                    };
                }

                if (branchResult.status === "aborted") {
                    listStatus = "aborted";
                    break;
                }
                if (branchResult.status === "error") {
                    listStatus = "error";
                    break;
                }
            }
        }
    }

    return { stepResults, status: listStatus };
}

/**
 * Extract the branch name ("then" | "else") from if_else skill output.
 */
function extractBranch(output: unknown): "then" | "else" {
    if (
        typeof output === "object" &&
        output !== null &&
        "branch" in output
    ) {
        const record: Record<string, unknown> = output;
        if (record["branch"] === "else") return "else";
    }
    return "then";
}

/**
 * Evaluate a step condition (legacy string or structured condition object).
 */
function evaluateStepCondition(
    condition: string | StructuredCondition,
    ctx: VariableContext,
): boolean {
    if (typeof condition === "string") {
        // Resolve templates in the condition string first
        const resolved = resolveTemplate(condition, ctx);
        const resolvedStr = resolved === undefined || resolved === null
            ? ""
            : String(resolved);
        const isTruthy =
            resolvedStr !== "false" &&
            resolvedStr !== "" &&
            resolvedStr !== "0" &&
            resolved !== false &&
            resolved !== null &&
            resolved !== undefined;
        return isTruthy;
    }
    // Structured condition
    return evaluateCondition(condition, ctx);
}

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

/**
 * Execute a shortcut with the provided input values.
 *
 * @param shortcut     — Parsed and validated shortcut
 * @param inputValues  — User-provided input values (keyed by input.id)
 * @param callbacks    — Optional UI hooks for step lifecycle
 * @returns RunResult  — Complete execution result
 */
export async function executeShortcut(
    shortcut: Shortcut,
    inputValues: Record<string, unknown> = {},
    callbacks: ExecutionCallbacks = {},
    networkId?: NetworkId,
): Promise<RunResult> {
    validateShortcutForExecution(shortcut, inputValues, networkId);

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = new Date().toISOString();
    const ctx = createVariableContext(inputValues, networkId);

    const { stepResults, status: listStatus, pendingInteraction } = await executeStepList(
        shortcut.steps,
        ctx,
        callbacks,
    );

    // ---- Determine overall status ----
    let overallStatus: RunResult["status"];
    if (listStatus === "aborted") {
        overallStatus = "aborted";
    } else if (listStatus === "waiting_confirmation") {
        overallStatus = "waiting_confirmation";
    } else if (listStatus === "waiting_input") {
        overallStatus = "waiting_input";
    } else if (listStatus === "waiting_signature") {
        overallStatus = "waiting_signature";
    } else if (listStatus === "error") {
        overallStatus = "error";
    } else {
        const hasErrors = stepResults.some((r) => r.status === "error");
        overallStatus = hasErrors ? "error" : "success";
    }

    const totalDurationMs = stepResults.reduce(
        (sum, r) => sum + r.durationMs,
        0,
    );

    return {
        runId,
        shortcutId: shortcut.id,
        status: overallStatus,
        inputValues,
        steps: stepResults,
        ...(pendingInteraction ? { pendingInteraction } : {}),
        totalDurationMs,
        startedAt,
        completedAt: new Date().toISOString(),
    };
}
