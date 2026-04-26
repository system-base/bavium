/* ==========================================================================
   API Route: POST /api/shortcuts/run
   ─────────────────────────────────────────────────────────────────────────
   Executes a shortcut server-side with the authenticated wallet context.
   
   Flow:
   1. Validate request (blocks, walletAddress)
   2. Build a Shortcut object from builder blocks
   3. Inject wallet address into VariableContext
   4. Run executeShortcut()
   5. Pause when a prepared transaction needs wallet signature
   6. Return full step results to UI
   ========================================================================== */

import { NextRequest, NextResponse } from "next/server";
import { executeShortcut, ExecutionPaused } from "@/engine/executor";
import type { Shortcut, ShortcutInput, ShortcutStep, StepResult } from "@/engine/types";
import { ShortcutValidationError } from "@/lib/shortcut-validation";
import { SKILL_PALETTE } from "@/lib/constants";
import { requireAuth } from "@/lib/api-middleware";
import {
    createRunInConvex,
    finalizeRunInConvex,
    hasConvexBackend,
} from "@/lib/convex-server";
import type { Id, RunDefinitionSnapshot, RunStatus, RunStepStatus } from "@/lib/convex-server";
import {
    builderBlocksToShortcut,
    type BuilderBlockParam as BlockParam,
    type BuilderRunBlock as RunBlock,
} from "@/lib/builder-shortcut";
import { hydrateWalletExecutionContext } from "@/lib/wallet-context";
import { getNetworkByChainId, type NetworkId } from "@/lib/chain-config";
import { consumeServerRateLimit } from "@/lib/server-rate-limit";
import {
    createSubmittedTransactionOutput,
    isPreparedTransactionOutput,
    type PreparedTransactionOutput,
} from "@/lib/transaction-output";
import {
    isSocialSharePreparationData,
    serializeSocialSharePreparationData,
} from "@/lib/social-share";

interface RunRequest {
    blocks: RunBlock[];
    inputs?: ShortcutInput[];
    walletAddress?: string;
    networkId?: NetworkId;
    inputValues?: Record<string, unknown>;
    shortcutName?: string;
    persistRun?: boolean;
    persistMode?: "all" | "final";
    interactionResponses?: Record<string, {
        kind: "confirmation";
        approved: boolean;
    } | {
        kind: "input";
        value?: string;
        canceled?: boolean;
    } | {
        kind: "signature";
        txHash: string;
        explorerUrl?: string;
    }>;
}

const RUN_DEFINITION_SNAPSHOT_MAX_BYTES = 100_000;

// ---------------------------------------------------------------------------
// Type guards for request validation
// ---------------------------------------------------------------------------

function isBlockParam(value: unknown): value is BlockParam {
    return (
        typeof value === "object" && value !== null &&
        "key" in value && typeof value.key === "string" &&
        "value" in value && typeof value.value === "string"
    );
}

function isRunBlock(value: unknown): value is RunBlock {
    if (typeof value !== "object" || value === null) return false;
    if (!("id" in value) || typeof value.id !== "string") return false;
    if (!("skillId" in value) || typeof value.skillId !== "string") return false;
    if (!("params" in value) || !Array.isArray(value.params)) return false;
    for (const param of value.params) {
        if (!isBlockParam(param)) return false;
    }
    if ("thenBlocks" in value && value.thenBlocks !== undefined) {
        if (!Array.isArray(value.thenBlocks)) return false;
        for (const block of value.thenBlocks) {
            if (!isRunBlock(block)) return false;
        }
    }
    if ("elseBlocks" in value && value.elseBlocks !== undefined) {
        if (!Array.isArray(value.elseBlocks)) return false;
        for (const block of value.elseBlocks) {
            if (!isRunBlock(block)) return false;
        }
    }
    if ("repeatBlocks" in value && value.repeatBlocks !== undefined) {
        if (!Array.isArray(value.repeatBlocks)) return false;
        for (const block of value.repeatBlocks) {
            if (!isRunBlock(block)) return false;
        }
    }
    return true;
}

function isShortcutInput(value: unknown): value is ShortcutInput {
    if (typeof value !== "object" || value === null) return false;
    const record = value as Record<string, unknown>;
    return (
        typeof record.id === "string" &&
        typeof record.label === "string" &&
        typeof record.type === "string" &&
        typeof record.required === "boolean"
    );
}

function parseRunRequest(raw: unknown): RunRequest | null {
    if (typeof raw !== "object" || raw === null) return null;
    if (!("blocks" in raw) || !Array.isArray(raw.blocks)) return null;
    if (raw.blocks.length === 0) return null;

    for (const block of raw.blocks) {
        if (!isRunBlock(block)) return null;
    }

    const inputs =
        "inputs" in raw && Array.isArray(raw.inputs) && raw.inputs.every(isShortcutInput)
            ? raw.inputs as ShortcutInput[]
            : undefined;

    const walletAddress =
        "walletAddress" in raw && typeof raw.walletAddress === "string"
            ? raw.walletAddress
            : undefined;

    const networkId =
        "networkId" in raw &&
        (raw.networkId === "base-mainnet" || raw.networkId === "base-sepolia")
            ? raw.networkId
            : undefined;

    const inputValues =
        "inputValues" in raw && typeof raw.inputValues === "object" && raw.inputValues !== null
            ? (raw.inputValues as Record<string, unknown>)
            : undefined;

    const shortcutName =
        "shortcutName" in raw && typeof raw.shortcutName === "string"
            ? raw.shortcutName
            : undefined;
    const persistRun =
        "persistRun" in raw && raw.persistRun === true;
    const persistMode =
        "persistMode" in raw && (raw.persistMode === "all" || raw.persistMode === "final")
            ? raw.persistMode
            : undefined;
    let interactionResponses: RunRequest["interactionResponses"] | undefined;
    if (
        "interactionResponses" in raw &&
        typeof raw.interactionResponses === "object" &&
        raw.interactionResponses !== null
    ) {
        interactionResponses = {};

        for (const [stepId, response] of Object.entries(raw.interactionResponses as Record<string, unknown>)) {
            if (typeof response !== "object" || response === null) continue;

            if (
                "kind" in response &&
                response.kind === "confirmation" &&
                "approved" in response &&
                typeof response.approved === "boolean"
            ) {
                interactionResponses[stepId] = {
                    kind: "confirmation",
                    approved: response.approved,
                };
                continue;
            }

            if ("kind" in response && response.kind === "input") {
                const value =
                    "value" in response && typeof response.value === "string"
                        ? response.value
                        : undefined;
                const canceled =
                    "canceled" in response && response.canceled === true;
                interactionResponses[stepId] = {
                    kind: "input",
                    ...(value !== undefined ? { value } : {}),
                    ...(canceled ? { canceled: true } : {}),
                };
                continue;
            }

            if (
                "kind" in response &&
                response.kind === "signature" &&
                "txHash" in response &&
                typeof response.txHash === "string"
            ) {
                interactionResponses[stepId] = {
                    kind: "signature",
                    txHash: response.txHash,
                    ...(
                        "explorerUrl" in response && typeof response.explorerUrl === "string"
                            ? { explorerUrl: response.explorerUrl }
                            : {}
                    ),
                };
            }
        }
    }

    return {
        blocks: raw.blocks as RunBlock[],
        inputs,
        walletAddress,
        networkId,
        inputValues,
        shortcutName,
        persistRun,
        persistMode,
        interactionResponses,
    };
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

function buildRunDefinitionSnapshot(
    shortcut: Shortcut,
    networkId: NetworkId | undefined,
): RunDefinitionSnapshot | undefined {
    const snapshot: RunDefinitionSnapshot = {
        name: shortcut.name,
        description: shortcut.description,
        category: shortcut.category,
        inputs: shortcut.inputs,
        steps: shortcut.steps as RunDefinitionSnapshot["steps"],
        ...(networkId ? { networkId } : {}),
        capturedAt: new Date().toISOString(),
    };

    const byteLength = new TextEncoder().encode(JSON.stringify(snapshot)).length;
    if (byteLength > RUN_DEFINITION_SNAPSHOT_MAX_BYTES) {
        return undefined;
    }

    return snapshot;
}

const SKILL_LABEL_BY_ID = new Map(
    SKILL_PALETTE.map((skill) => [skill.id, skill.label]),
);

function getStepActionId(definition: ShortcutStep | undefined): string | undefined {
    return definition ? `${definition.skill}.${definition.action}` : undefined;
}

function getStepLabel(
    definition: ShortcutStep | undefined,
    fallback: string,
): string {
    const actionId = getStepActionId(definition);
    if (!actionId) return fallback;
    return SKILL_LABEL_BY_ID.get(actionId) ?? actionId;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
    let persistedRunId: string | null = null;
    let sessionAddress: string | null = null;
    let canPersistRun = false;

    try {
        const auth = requireAuth(request);
        if (auth instanceof NextResponse) return auth;
        sessionAddress = auth.session.address;
        const sessionNetworkId = getNetworkByChainId(auth.session.chainId)?.networkId;
        canPersistRun = hasConvexBackend();

        const rateLimit = await consumeServerRateLimit({
            bucket: "shortcut-run",
            key: auth.session.address,
            windowMs: 60_000,
            max: 20,
        });
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { error: `Too many test runs. Try again in ${rateLimit.retryAfterSeconds}s.` },
                { status: 429 },
            );
        }

        const body = parseRunRequest(await request.json());

        if (!body) {
            return NextResponse.json(
                { error: "Invalid request. Provide valid blocks with id, skillId, and params." },
                { status: 400 },
            );
        }

        const shortcut = builderBlocksToShortcut(body.blocks, {
            id: `run-${Date.now()}`,
            name: "Builder Shortcut",
            description: "",
            inputs: body.inputs ?? [],
        });
        if (body.shortcutName?.trim()) {
            shortcut.name = body.shortcutName.trim();
        }

        // Inject wallet address from the connected frontend wallet.
        // The engine promotes this into context.wallet.address.
        const inputValues: Record<string, unknown> = {
            ...(body.inputValues ?? {}),
        };
        const resolvedNetworkId = body.networkId ?? sessionNetworkId;

        if (body.walletAddress) {
            inputValues.walletAddress = body.walletAddress;
            Object.assign(
                inputValues,
                await hydrateWalletExecutionContext(body.walletAddress, resolvedNetworkId),
            );
        }

        // Run the shortcut
        const result = await executeShortcut(shortcut, inputValues, {
            onConfirmRequired: async (stepId, step, resolvedParams) => {
                const response = body.interactionResponses?.[stepId];
                if (response?.kind === "confirmation") {
                    return response.approved;
                }

                throw new ExecutionPaused({
                    kind: "confirmation",
                    stepId,
                    skillId: `${step.skill}.${step.action}`,
                    resolvedParams,
                });
            },
            onInputRequired: async (stepId, step, request) => {
                const response = body.interactionResponses?.[stepId];
                if (response?.kind === "input") {
                    if (response.canceled) {
                        throw new Error("User cancelled input");
                    }
                    return response.value ?? request.defaultValue ?? "";
                }

                throw new ExecutionPaused({
                    kind: "input",
                    stepId,
                    skillId: `${step.skill}.${step.action}`,
                    prompt: request.prompt,
                    inputType: request.inputType,
                    ...(request.defaultValue ? { defaultValue: request.defaultValue } : {}),
                    ...(request.placeholder ? { placeholder: request.placeholder } : {}),
                    ...(request.options ? { options: request.options } : {}),
                });
            },
            onSignatureRequired: async (stepId, step, preparedTransaction) => {
                const response = body.interactionResponses?.[stepId];
                if (response?.kind === "signature") {
                    const {
                        type: _type,
                        status: _status,
                        networkId: _preparedNetworkId,
                        explorerBaseUrl: _explorerBaseUrl,
                        requiresSignature: _requiresSignature,
                        calls: _calls,
                        description,
                        summary,
                        protocol,
                        action,
                        ...submittedExtras
                    } = preparedTransaction;

                    return createSubmittedTransactionOutput(
                        preparedTransaction.networkId,
                        response.txHash,
                        {
                            description,
                            summary,
                            ...(protocol ? { protocol } : {}),
                            ...(action ? { action } : {}),
                            ...(response.explorerUrl ? { explorerUrl: response.explorerUrl } : {}),
                            extras: submittedExtras,
                        },
                    );
                }

                throw new ExecutionPaused({
                    kind: "signature",
                    stepId,
                    skillId: `${step.skill}.${step.action}`,
                    preparedTransaction: {
                        stepId,
                        stepLabel: String(
                            preparedTransaction.summary
                            ?? preparedTransaction.description
                            ?? `${step.skill}.${step.action}`,
                        ),
                        calls: preparedTransaction.calls,
                        description: preparedTransaction.description,
                        networkId: preparedTransaction.networkId,
                        explorerBaseUrl: preparedTransaction.explorerBaseUrl,
                        summary: preparedTransaction.summary,
                        callCount: preparedTransaction.callCount,
                        ...(preparedTransaction.protocol ? { protocol: preparedTransaction.protocol } : {}),
                        ...(preparedTransaction.action ? { action: preparedTransaction.action } : {}),
                    },
                });
            },
        }, resolvedNetworkId);

        // Collect any prepared transactions from step outputs.
        // These are returned to the frontend for wagmi signing.
        const pendingTransactions: Array<{
            stepId: string;
            stepLabel: string;
            calls: Array<{ to: string; value: string; data: string }>;
            description: string;
            networkId: PreparedTransactionOutput["networkId"];
            explorerBaseUrl: string;
            summary: string;
            callCount: number;
            protocol?: PreparedTransactionOutput["protocol"];
            action?: PreparedTransactionOutput["action"];
        }> = [];

        for (const step of result.steps) {
            if (step.status === "success" && step.output && isPreparedTransactionOutput(step.output)) {
                pendingTransactions.push({
                    stepId: step.stepId,
                    stepLabel: String(step.output.summary ?? step.output.description ?? step.stepId),
                    calls: step.output.calls,
                    description: String(step.output.description ?? ""),
                    networkId: step.output.networkId,
                    explorerBaseUrl: step.output.explorerBaseUrl,
                    summary: String(step.output.summary ?? step.output.description ?? ""),
                    callCount: step.output.callCount,
                    ...(step.output.protocol ? { protocol: step.output.protocol } : {}),
                    ...(step.output.action ? { action: step.output.action } : {}),
                });
            }
        }

        const persistedStatus =
            result.status === "waiting_signature" || pendingTransactions.length > 0
                ? "awaiting_signature"
                : result.status === "waiting_confirmation" || result.status === "waiting_input"
                    ? "failed"
                : result.status === "success"
                    ? "succeeded"
                    : result.status === "aborted"
                        ? "canceled"
                        : "failed";

        const isIntermediateRun =
            Boolean(result.pendingInteraction)
            || result.status === "waiting_signature"
            || result.status === "waiting_confirmation"
            || result.status === "waiting_input"
            || pendingTransactions.length > 0;
        const shouldPersistRun =
            canPersistRun
            && body.persistRun === true
            && (body.persistMode !== "final" || !isIntermediateRun);
        if (shouldPersistRun) {
            const definitionSnapshot = buildRunDefinitionSnapshot(shortcut, resolvedNetworkId);
            persistedRunId = String(await createRunInConvex({
                ownerAddress: auth.session.address,
                name: shortcut.name,
                sourceType: "manual",
                sourceId: shortcut.id,
                inputValues,
                status: "running",
                ...(definitionSnapshot ? { definitionSnapshot } : {}),
            }));

            await finalizeRunInConvex({
                ownerAddress: auth.session.address,
                runId: persistedRunId as Id<"runs">,
                status: persistedStatus as RunStatus,
                ...(result.status !== "success"
                    ? {
                        error: result.steps.find((step) => step.status === "error")?.error
                            ?? "Execution failed",
                    }
                    : {}),
                completedAt: new Date().toISOString(),
                steps: result.steps.map((step, index) => (
                    serializeStep(step, findShortcutStepById(shortcut.steps, step.stepId), index)
                )),
            });
        }

        return NextResponse.json({
            runId: persistedRunId,
            status: result.status,
            steps: result.steps,
            totalDurationMs: result.totalDurationMs,
            pendingTransactions,
            requiresSigning: pendingTransactions.length > 0,
            pendingInteraction: result.pendingInteraction ?? null,
        });
    } catch (err) {
        console.error("[/api/shortcuts/run]", err);
        if (canPersistRun && persistedRunId && sessionAddress) {
            try {
                await finalizeRunInConvex({
                    ownerAddress: sessionAddress,
                    runId: persistedRunId as Id<"runs">,
                    status: "failed" as RunStatus,
                    error: err instanceof Error ? err.message : "Execution failed",
                    completedAt: new Date().toISOString(),
                    steps: [],
                });
            } catch {
                // Best-effort finalize; the original execution error remains primary.
            }
        }
        if (err instanceof ShortcutValidationError) {
            return NextResponse.json(
                {
                    error: "Shortcut validation failed",
                    issues: err.issues,
                    status: "error",
                },
                { status: 400 },
            );
        }
        return NextResponse.json(
            {
                error: err instanceof Error ? err.message : "Execution failed",
                status: "error",
            },
            { status: 500 },
        );
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
    const value = record[key];
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : undefined;
}

function shortenAddress(address: string): string {
    return /^0x[a-fA-F0-9]{40}$/.test(address)
        ? `${address.slice(0, 6)}...${address.slice(-4)}`
        : address;
}

function shortenHash(value: string): string {
    return /^0x[a-fA-F0-9]{16,}$/.test(value)
        ? `${value.slice(0, 10)}...${value.slice(-6)}`
        : value;
}

function compactJsonSummary(output: unknown): string | undefined {
    try {
        const text = JSON.stringify(output);
        return text.length > 240 ? `${text.slice(0, 237)}...` : text;
    } catch {
        return undefined;
    }
}

function summarizeBalances(value: unknown): string | undefined {
    if (!isRecord(value)) return undefined;

    const entries = Object.entries(value)
        .filter(([, balance]) => (
            typeof balance === "string" || typeof balance === "number"
        ))
        .slice(0, 5);

    if (entries.length === 0) return undefined;
    return entries
        .map(([symbol, balance]) => `${symbol}: ${String(balance)}`)
        .join(", ");
}

function summarizeWalletDetails(output: Record<string, unknown>): string | undefined {
    const address = readString(output, "address");
    const network = readString(output, "network") ?? readString(output, "networkId");
    const latestBlock = readString(output, "latestBlock");
    const balances = summarizeBalances(output.balances);

    const parts: string[] = [];
    if (address) parts.push(`Wallet ${shortenAddress(address)}`);
    if (network) parts.push(`on ${network}`);
    if (balances) parts.push(`balances ${balances}`);
    if (latestBlock) parts.push(`latest block ${latestBlock}`);

    return parts.length > 0 ? parts.join(" - ") : undefined;
}

function summarizeBridgeRoutes(output: Record<string, unknown>): string | undefined {
    const returnedCount =
        readNumber(output, "returnedCount")
        ?? (Array.isArray(output.routes) ? output.routes.length : undefined);
    const originChainId = readNumber(output, "originChainId");
    const destinationChainId = readNumber(output, "destinationChainId");

    let summary = `Across returned ${returnedCount ?? 0} route${returnedCount === 1 ? "" : "s"}`;
    if (originChainId !== undefined) summary += ` from chain ${originChainId}`;
    if (destinationChainId !== undefined) summary += ` to chain ${destinationChainId}`;

    const firstRoute = Array.isArray(output.routes) && isRecord(output.routes[0])
        ? output.routes[0]
        : undefined;
    if (firstRoute) {
        const originSymbol = readString(firstRoute, "originTokenSymbol");
        const destinationSymbol = readString(firstRoute, "destinationTokenSymbol");
        const firstDestination = readNumber(firstRoute, "destinationChainId");
        const tokenPair = originSymbol && destinationSymbol
            ? `${originSymbol} -> ${destinationSymbol}`
            : undefined;
        summary += tokenPair
            ? `. First route: ${tokenPair}${firstDestination !== undefined ? ` to chain ${firstDestination}` : ""}.`
            : ".";
    } else {
        summary += ".";
    }

    return summary;
}

function summarizeBridgeQuote(output: Record<string, unknown>): string | undefined {
    const requestedAmount = readString(output, "requestedAmount");
    const inputToken = readString(output, "inputTokenSymbol");
    const outputToken = readString(output, "outputTokenSymbol");
    const destinationChainId = readNumber(output, "destinationChainId");
    const feePct = readString(output, "totalRelayFeePct");
    const expectedFillTimeSec = readNumber(output, "expectedFillTimeSec");

    if (!requestedAmount && !inputToken && !outputToken && destinationChainId === undefined) {
        return undefined;
    }

    const tokenText = inputToken && outputToken
        ? `${inputToken} -> ${outputToken}`
        : inputToken ?? outputToken ?? "bridge";
    let summary = `Across quote for ${requestedAmount ? `${requestedAmount} ` : ""}${tokenText}`;
    if (destinationChainId !== undefined) summary += ` to chain ${destinationChainId}`;
    if (feePct) summary += `, relay fee ${feePct}`;
    if (expectedFillTimeSec !== undefined) summary += `, expected fill ${expectedFillTimeSec}s`;
    return `${summary}.`;
}

function summarizeBridgeStatus(output: Record<string, unknown>): string | undefined {
    const status = readString(output, "status");
    if (!status) return undefined;

    const originChainId = readNumber(output, "originChainId");
    const destinationChainId = readNumber(output, "destinationChainId");
    const fillTxnRef = readString(output, "fillTxnRef");

    let summary = `Across transfer status: ${status}`;
    if (originChainId !== undefined && destinationChainId !== undefined) {
        summary += ` (${originChainId} -> ${destinationChainId})`;
    }
    if (fillTxnRef) summary += `, fill ${shortenHash(fillTxnRef)}`;
    return `${summary}.`;
}

function summarizeKnownSkillOutput(
    actionId: string | undefined,
    output: Record<string, unknown>,
): string | undefined {
    if (isSocialSharePreparationData(output)) {
        return serializeSocialSharePreparationData(output);
    }

    switch (actionId) {
        case "wallet.details":
            return summarizeWalletDetails(output);
        case "bridge.list_routes":
            return summarizeBridgeRoutes(output);
        case "bridge.get_quote":
            return summarizeBridgeQuote(output);
        case "bridge.track_transfer":
            return summarizeBridgeStatus(output);
        default:
            return undefined;
    }
}

function summarizeStepOutput(
    output: unknown,
    definition: ShortcutStep | undefined,
): string | undefined {
    if (output == null) return undefined;
    if (typeof output === "string") return output;
    if (isPreparedTransactionOutput(output)) {
        return String(output.summary ?? output.description ?? "Prepared transaction");
    }
    if (isRecord(output)) {
        if (isSocialSharePreparationData(output)) {
            return serializeSocialSharePreparationData(output);
        }

        const knownSummary = summarizeKnownSkillOutput(getStepActionId(definition), output);
        if (knownSummary) return knownSummary;

        const description =
            typeof output.description === "string" && output.description.trim()
                ? output.description.trim()
                : undefined;
        const summary =
            typeof output.summary === "string" && output.summary.trim()
                ? output.summary.trim()
                : undefined;
        const message =
            typeof output.message === "string" && output.message.trim()
                ? output.message.trim()
                : undefined;

        if (description && summary && description !== summary) {
            return `${description} - ${summary}`;
        }
        if (summary) return summary;
        if (description) return description;
        if (message) return message;
    }
    return compactJsonSummary(output);
}

function serializeStep(step: StepResult, definition: ShortcutStep | undefined, index: number) {
    return {
        stepId: step.stepId,
        label: getStepLabel(definition, step.stepId),
        status: step.status as RunStepStatus,
        outputSummary: summarizeStepOutput(step.output, definition),
        error: step.error,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
        durationMs: step.durationMs,
        sequence: index,
    };
}
