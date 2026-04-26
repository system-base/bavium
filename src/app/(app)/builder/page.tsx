"use client";

import { Button } from "@/components/ui";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useActiveChain } from "@/hooks/useActiveChain";
import { BuilderCanvas } from "./_components/BuilderCanvas";
import { BuilderPalette } from "./_components/BuilderPalette";

import { useState, useMemo, useCallback, useRef, useEffect, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSearchParams } from "next/navigation";
import { useAccount, useSwitchChain } from "wagmi";
import {
    getWalletClient,
    sendTransaction,
    switchChain as switchWalletChain,
    waitForTransactionReceipt,
} from "@wagmi/core";
import { parseEther } from "viem";
import type { Shortcut, ShortcutInput } from "@/engine/types";
import {
    Save,
    Play,
    Plus,
    Search,
    ShieldAlert,
    CheckCircle2,
    XCircle,
    Loader2,
    X,
    Pencil,
    RotateCcw,
    ChevronDown,
} from "lucide-react";
import {
    SKILL_PALETTE,
    CATEGORY_META,
    PUBLISHABLE_SHORTCUT_CATEGORIES,
    type BlockCategory,
    type SkillDefinition,
} from "@/lib/constants";
import { NETWORKS, getRegisteredTokens } from "@/lib/chain-config";
import { wagmiConfig } from "@/config/wagmi";
import { getConfiguredBuilderCodeDataSuffix } from "@/lib/base-attribution";
import { getTemplateById } from "@/lib/template-shortcuts";
import {
    isSocialSharePreparationData,
    serializeSocialSharePreparationData,
    type SocialSharePreparationData,
} from "@/lib/social-share";
import {
    isX402DiscoverySummaryData,
    type X402DiscoverySummaryData,
} from "@/lib/x402-bazaar";
import {
    builderBlocksToRunBlocks,
    builderBlocksToShortcut,
    inferShortcutCategoryFromBlocks,
    shortcutToBuilderBlocks,
    type BuilderBlock as CanvasBlock,
    type BuilderBlockParam as BlockParam,
} from "@/lib/builder-shortcut";
import {
    type BranchKey,
    countInputBindings,
    flattenBlocks,
    hasSameTopLevelBlockOrder,
    findBlockById,
    updateBlocksById,
    removeBlockById,
    moveBlockById,
    addBranchBlockById,
    replaceVariableReferences,
    sanitizeErrorMessage,
} from "./_lib/block-utils";
import { isPublishableShortcutCategory } from "@/lib/block-categories";
import { buildExplorerTransactionUrl, type PreparedTransactionOutput } from "@/lib/transaction-output";
import {
    BUILDER_AI_HANDOFF_EVENT,
    BUILDER_AI_HANDOFF_STORAGE_KEY,
    isBuilderAIHandoffV1,
    type BuilderAIHandoffV1,
} from "@/lib/builder-ai-handoff";
import { useBuilderAIContext } from "@/contexts/BuilderAIContext";

// ---------------------------------------------------------------------------
// Template → Builder blocks mapping
// When a user clicks "Open in Builder" from Shortcuts, we hydrate the canvas
// ---------------------------------------------------------------------------

type ShortcutSaveFailureCode =
    | "SIGN_IN_REQUIRED"
    | "BACKEND_UNAVAILABLE"
    | "INVALID_PAYLOAD"
    | "SECURITY_CHECK_FAILED"
    | "SAVE_FAILED"
    | "NETWORK_ERROR";

class ShortcutSaveError extends Error {
    readonly code: ShortcutSaveFailureCode;
    readonly status?: number;

    constructor(message: string, code: ShortcutSaveFailureCode, status?: number) {
        super(message);
        this.name = "ShortcutSaveError";
        this.code = code;
        this.status = status;
    }
}

function getShortcutSaveFailureCode(status: number): ShortcutSaveFailureCode {
    if (status === 401) return "SIGN_IN_REQUIRED";
    if (status === 403) return "SECURITY_CHECK_FAILED";
    if (status === 400) return "INVALID_PAYLOAD";
    if (status === 503) return "BACKEND_UNAVAILABLE";
    return "SAVE_FAILED";
}

function getShortcutSaveMessage(error: unknown): string {
    if (error instanceof ShortcutSaveError) {
        if (error.code === "SIGN_IN_REQUIRED") {
            return "Your sign-in session expired. Sign in again before saving this shortcut.";
        }
        if (error.code === "BACKEND_UNAVAILABLE") {
            return "Shortcut saving is unavailable until the backend is configured.";
        }
        if (error.code === "SECURITY_CHECK_FAILED") {
            return "Shortcut save was blocked by the security check. Refresh the page and try again.";
        }
        if (error.code === "INVALID_PAYLOAD") {
            return `Shortcut details are invalid: ${sanitizeErrorMessage(error.message)}`;
        }
        if (error.code === "NETWORK_ERROR") {
            return "Network error while saving this shortcut. Check your connection and try again.";
        }
        return sanitizeErrorMessage(error.message);
    }

    if (error instanceof Error) {
        if (
            error.message.includes("fetch failed") ||
            error.message.includes("NetworkError") ||
            error.message.includes("Failed to fetch")
        ) {
            return "Network error while saving this shortcut. Check your connection and try again.";
        }
        return sanitizeErrorMessage(error.message);
    }

    return "Shortcut save failed.";
}

type SupportedBuilderChainId = 8453 | 84532;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

function isBlockCategory(value: string): value is BlockCategory {
    return value in CATEGORY_META;
}

function isHexString(value: string): value is `0x${string}` {
    return value.startsWith("0x");
}

function groupByCategory(skills: SkillDefinition[]): Partial<Record<BlockCategory, SkillDefinition[]>> {
    const groups: Partial<Record<BlockCategory, SkillDefinition[]>> = {};
    for (const skill of skills) {
        if (!groups[skill.category]) groups[skill.category] = [];
        groups[skill.category]?.push(skill);
    }
    return groups;
}

/** Find a skill definition by its id */
function findSkillDef(skillId: string): SkillDefinition | undefined {
    return SKILL_PALETTE.find((s) => s.id === skillId);
}

// ---------------------------------------------------------------------------
// Error message sanitization — user-friendly messages
// ---------------------------------------------------------------------------

// sanitizeErrorMessage is now imported from _lib/block-utils


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TestStatus = "idle" | "running" | "success" | "error" | "signing" | "broadcasting";

interface StepTestResult {
    stepId: string;
    status: "success" | "error" | "skipped" | "pending" | "waiting_confirmation" | "waiting_input" | "waiting_signature";
    message?: string;
    detail?: string;
    outputSummary?: string;
    durationMs?: number;
    txHash?: string;
    explorerUrl?: string;
    sharePreparation?: SocialSharePreparationData;
    x402Discovery?: X402DiscoverySummaryData;
}

interface PendingTransaction {
    stepId: string;
    stepLabel: string;
    calls: Array<{ to: string; value: string; data: string }>;
    description: string;
    networkId: PreparedTransactionOutput["networkId"];
    explorerBaseUrl: string;
    summary: string;
    callCount: number;
    protocol?: string;
    action?: string;
}

interface PendingInteraction {
    kind: "confirmation" | "input" | "signature";
    stepId: string;
    skillId: string;
    resolvedParams?: Record<string, unknown>;
    prompt?: string;
    inputType?: string;
    defaultValue?: string;
    placeholder?: string;
    options?: Array<{ label: string; value: string }>;
    preparedTransaction?: PendingTransaction;
}

type RunInteractionResponse =
    | { kind: "confirmation"; approved: boolean }
    | { kind: "input"; value?: string; canceled?: boolean }
    | { kind: "signature"; txHash: string; explorerUrl?: string };

interface BuilderConfirmationDialogRequest {
    kind: "confirmation";
    title: string;
    message: string;
    details?: Array<{ label: string; value: string }>;
    confirmLabel?: string;
    cancelLabel?: string;
}

interface BuilderInputDialogRequest {
    kind: "input";
    title: string;
    message: string;
    description?: string;
    inputType?: string;
    placeholder?: string;
    defaultValue?: string;
    options?: Array<{ label: string; value: string }>;
    required?: boolean;
    confirmLabel?: string;
    cancelLabel?: string;
}

type BuilderDialogRequest = BuilderConfirmationDialogRequest | BuilderInputDialogRequest;

type BuilderDialogResponse =
    | { kind: "confirmation"; approved: boolean }
    | { kind: "input"; canceled: boolean; value?: string };

function extractStepOutputNarrative(output: unknown): { message?: string; detail?: string } {
    if (typeof output === "string") {
        return { message: output };
    }

    if (typeof output !== "object" || output === null) {
        return {};
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
        return { message: description, detail: summary };
    }

    return {
        message: description ?? summary ?? message,
    };
}

function extractStepOutputTransactionMeta(
    output: unknown,
): { txHash?: string; explorerUrl?: string } {
    if (typeof output !== "object" || output === null) {
        return {};
    }

    return {
        ...(
            "txHash" in output && typeof output.txHash === "string"
                ? { txHash: output.txHash }
                : {}
        ),
        ...(
            "explorerUrl" in output && typeof output.explorerUrl === "string"
                ? { explorerUrl: output.explorerUrl }
                : {}
        ),
    };
}

// ShortcutInput is imported from @/engine/types

// ---------------------------------------------------------------------------
// Initial blocks (demo shortcut)
// ---------------------------------------------------------------------------

function buildInitialParams(skillId: string): BlockParam[] {
    const def = findSkillDef(skillId);
    if (!def) return [];
    const defaultToken = getRegisteredTokens()[0]?.symbol ?? "ETH";
    return def.params.map((p) => {
        let value = p.defaultValue ?? "";
        // If no defaultValue, pick the first sensible value based on type
        if (!value) {
            if (p.type === "token") value = defaultToken;
            else if (p.type === "select") value = p.options?.[0]?.value ?? "";
            else if (p.type === "operator") value = "+";
            else if (p.type === "boolean") value = "false";
        }
        return { key: p.key, value };
    });
}

const INITIAL_BLOCKS: CanvasBlock[] = [];

function slugifyShortcutInputId(value: string): string {
    const normalized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

    return normalized || "input";
}

function buildUniqueShortcutInputId(
    proposedId: string,
    existingInputs: ShortcutInput[],
    currentInputId?: string,
): string {
    const baseId = slugifyShortcutInputId(proposedId);
    const existingIds = new Set(
        existingInputs
            .filter((input) => input.id !== currentInputId)
            .map((input) => input.id),
    );

    if (!existingIds.has(baseId)) {
        return baseId;
    }

    let counter = 2;
    let nextId = `${baseId}_${counter}`;
    while (existingIds.has(nextId)) {
        counter += 1;
        nextId = `${baseId}_${counter}`;
    }

    return nextId;
}

function normalizeShortcutInput(
    input: ShortcutInput,
    existingInputs: ShortcutInput[],
    currentInputId?: string,
): ShortcutInput {
    const nextId = buildUniqueShortcutInputId(
        input.id || input.label || "input",
        existingInputs,
        currentInputId,
    );
    const nextLabel = input.label.trim() || humanizeShortcutInputLabel(nextId);
    const baseInput: ShortcutInput = {
        id: nextId,
        label: nextLabel,
        type: input.type,
        required: input.required,
        ...(input.placeholder?.trim() ? { placeholder: input.placeholder.trim() } : {}),
    };

    if (input.type === "select") {
        const options = (input.constraints?.options ?? [])
            .map((option) => ({
                label: option.label.trim(),
                value: option.value.trim() || option.label.trim(),
            }))
            .filter((option) => option.label.length > 0 && option.value.length > 0);

        return {
            ...baseInput,
            ...(input.default?.trim() ? { default: input.default.trim() } : {}),
            ...(options.length > 0 ? { constraints: { options } } : {}),
        };
    }

    if (input.type === "boolean") {
        return {
            ...baseInput,
            ...((input.default === "true" || input.default === "false") ? { default: input.default } : {}),
        };
    }

    return {
        ...baseInput,
        ...(input.default?.trim() ? { default: input.default.trim() } : {}),
    };
}

function humanizeShortcutInputLabel(id: string): string {
    return id
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function sanitizeShortcutInputs(inputs: ShortcutInput[] | undefined): ShortcutInput[] {
    if (!Array.isArray(inputs)) return [];

    const normalized: ShortcutInput[] = [];
    for (const input of inputs) {
        normalized.push(normalizeShortcutInput(input, normalized));
    }
    return normalized;
}

const BUILDER_DRAFT_STORAGE_KEY = "builder:draft:v1";
const LEGACY_BUILDER_NAME_STORAGE_KEY = "builder:name";
const LEGACY_BUILDER_BLOCKS_STORAGE_KEY = "builder:blocks";
const LEGACY_BUILDER_INPUTS_STORAGE_KEY = "builder:inputs";

interface BuilderDraftV1 {
    shortcutName: string;
    blocks: CanvasBlock[];
    inputs?: ShortcutInput[];
    shortcutCategoryOverride?: BlockCategory | null;
}

function readSessionStorageValue(key: string): string | null {
    try {
        return sessionStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeSessionStorageValue(key: string, value: string): void {
    try {
        sessionStorage.setItem(key, value);
    } catch {
        // Storage may be unavailable or full; ignore to keep Builder usable.
    }
}

function removeSessionStorageValue(key: string): void {
    try {
        sessionStorage.removeItem(key);
    } catch {
        // Ignore storage cleanup failures.
    }
}

function isCanvasBlockArray(value: unknown): value is CanvasBlock[] {
    return Array.isArray(value);
}

function isBuilderDraftV1(value: unknown): value is BuilderDraftV1 {
    if (typeof value !== "object" || value === null) return false;

    const record = value as Record<string, unknown>;
    return (
        typeof record.shortcutName === "string" &&
        isCanvasBlockArray(record.blocks) &&
        (record.inputs === undefined || Array.isArray(record.inputs)) &&
        (
            record.shortcutCategoryOverride === undefined ||
            record.shortcutCategoryOverride === null ||
            typeof record.shortcutCategoryOverride === "string"
        )
    );
}

function readBuilderDraft(): BuilderDraftV1 | null {
    const raw = readSessionStorageValue(BUILDER_DRAFT_STORAGE_KEY);
    if (!raw) return null;

    try {
        const parsed: unknown = JSON.parse(raw);
        if (!isBuilderDraftV1(parsed)) return null;

        return {
            shortcutName: parsed.shortcutName,
            blocks: parsed.blocks,
            inputs: sanitizeShortcutInputs(parsed.inputs),
            shortcutCategoryOverride:
                typeof parsed.shortcutCategoryOverride === "string" &&
                isPublishableShortcutCategory(parsed.shortcutCategoryOverride)
                    ? parsed.shortcutCategoryOverride
                    : null,
        };
    } catch {
        return null;
    }
}

function writeBuilderDraft(draft: BuilderDraftV1): void {
    writeSessionStorageValue(BUILDER_DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

function readBuilderAIHandoff(): BuilderAIHandoffV1 | null {
    const raw = readSessionStorageValue(BUILDER_AI_HANDOFF_STORAGE_KEY);
    if (!raw) return null;

    try {
        const parsed: unknown = JSON.parse(raw);
        return isBuilderAIHandoffV1(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function clearBuilderAIHandoff(): void {
    removeSessionStorageValue(BUILDER_AI_HANDOFF_STORAGE_KEY);
}

function clearLegacyBuilderDraft(): void {
    removeSessionStorageValue(LEGACY_BUILDER_NAME_STORAGE_KEY);
    removeSessionStorageValue(LEGACY_BUILDER_BLOCKS_STORAGE_KEY);
    removeSessionStorageValue(LEGACY_BUILDER_INPUTS_STORAGE_KEY);
}

function clearBuilderDraft(): void {
    removeSessionStorageValue(BUILDER_DRAFT_STORAGE_KEY);
    clearLegacyBuilderDraft();
}

type BuilderHandoffApplyMode = "replace" | "append";

function hasMeaningfulBuilderDraft(draft: BuilderDraftV1): boolean {
    return (
        draft.shortcutName.trim().length > 0 ||
        draft.blocks.length > 0 ||
        (draft.inputs?.length ?? 0) > 0 ||
        Boolean(draft.shortcutCategoryOverride)
    );
}

function collectBlockIds(items: CanvasBlock[], ids = new Set<string>()): Set<string> {
    for (const block of items) {
        ids.add(block.id);
        if (block.thenBlocks) collectBlockIds(block.thenBlocks, ids);
        if (block.elseBlocks) collectBlockIds(block.elseBlocks, ids);
        if (block.repeatBlocks) collectBlockIds(block.repeatBlocks, ids);
    }
    return ids;
}

function allocateUniqueBlockId(baseId: string, takenIds: Set<string>): string {
    const safeBase = baseId.trim() || "ai-step";
    if (!takenIds.has(safeBase)) {
        takenIds.add(safeBase);
        return safeBase;
    }

    let counter = 2;
    let candidate = `${safeBase}-ai`;
    while (takenIds.has(candidate)) {
        candidate = `${safeBase}-ai-${counter}`;
        counter += 1;
    }
    takenIds.add(candidate);
    return candidate;
}

function cloneBlocksWithUniqueIds(
    incomingBlocks: CanvasBlock[],
    existingBlocks: CanvasBlock[],
): CanvasBlock[] {
    const takenIds = collectBlockIds(existingBlocks);
    const idMap = new Map<string, string>();

    function clone(items: CanvasBlock[]): CanvasBlock[] {
        return items.map((block) => {
            const nextId = allocateUniqueBlockId(block.id, takenIds);
            idMap.set(block.id, nextId);

            return {
                ...block,
                id: nextId,
                params: block.params.map((param) => ({ ...param })),
                ...(block.thenBlocks ? { thenBlocks: clone(block.thenBlocks) } : {}),
                ...(block.elseBlocks ? { elseBlocks: clone(block.elseBlocks) } : {}),
                ...(block.repeatBlocks ? { repeatBlocks: clone(block.repeatBlocks) } : {}),
            };
        });
    }

    let nextBlocks = clone(incomingBlocks);
    for (const [previousId, nextId] of idMap.entries()) {
        if (previousId !== nextId) {
            nextBlocks = replaceVariableReferences(nextBlocks, previousId, nextId);
        }
    }

    return nextBlocks;
}

function prepareAppendHandoffDraft(
    existingDraft: BuilderDraftV1,
    incomingDraft: BuilderDraftV1,
): BuilderDraftV1 {
    let nextIncomingBlocks = cloneBlocksWithUniqueIds(
        incomingDraft.blocks.length > 0 ? incomingDraft.blocks : INITIAL_BLOCKS,
        existingDraft.blocks,
    );

    const existingInputs = sanitizeShortcutInputs(existingDraft.inputs);
    const appendedInputs: ShortcutInput[] = [];
    for (const input of sanitizeShortcutInputs(incomingDraft.inputs)) {
        const nextInput = normalizeShortcutInput(input, [
            ...existingInputs,
            ...appendedInputs,
        ]);
        if (nextInput.id !== input.id) {
            nextIncomingBlocks = replaceVariableReferences(
                nextIncomingBlocks,
                `input.${input.id}`,
                `input.${nextInput.id}`,
            );
        }
        appendedInputs.push(nextInput);
    }

    return {
        shortcutName: existingDraft.shortcutName.trim()
            ? existingDraft.shortcutName
            : incomingDraft.shortcutName,
        blocks: [...existingDraft.blocks, ...nextIncomingBlocks],
        inputs: [...existingInputs, ...appendedInputs],
        shortcutCategoryOverride:
            existingDraft.shortcutCategoryOverride ??
            incomingDraft.shortcutCategoryOverride ??
            null,
    };
}

function readLegacyBuilderInputs(): ShortcutInput[] {
    const raw = readSessionStorageValue(LEGACY_BUILDER_INPUTS_STORAGE_KEY);
    if (!raw) return [];

    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        return parsed.filter((item): item is ShortcutInput => {
            if (typeof item !== "object" || item === null) return false;
            const record = item as Record<string, unknown>;
            return (
                typeof record.id === "string" &&
                typeof record.label === "string" &&
                typeof record.type === "string" &&
                typeof record.required === "boolean"
            );
        });
    } catch {
        return [];
    }
}

function readLegacyBuilderDraft(): {
    draft: BuilderDraftV1 | null;
    usedLegacyInputs: boolean;
} {
    const shortcutName = readSessionStorageValue(LEGACY_BUILDER_NAME_STORAGE_KEY) ?? "";
    const legacyDraftInputs = readLegacyBuilderInputs();
    const rawBlocks = readSessionStorageValue(LEGACY_BUILDER_BLOCKS_STORAGE_KEY);

    if (!rawBlocks) {
        return {
            draft: shortcutName ? { shortcutName, blocks: INITIAL_BLOCKS } : null,
            usedLegacyInputs: false,
        };
    }

    try {
        const parsed: unknown = JSON.parse(rawBlocks);
        if (!isCanvasBlockArray(parsed)) {
            return {
                draft: shortcutName ? { shortcutName, blocks: INITIAL_BLOCKS } : null,
                usedLegacyInputs: false,
            };
        }

        return {
            draft: {
                shortcutName,
                blocks: parsed,
                inputs: legacyDraftInputs,
            },
            usedLegacyInputs: legacyDraftInputs.length > 0,
        };
    } catch {
        return {
            draft: shortcutName ? { shortcutName, blocks: INITIAL_BLOCKS } : null,
            usedLegacyInputs: false,
        };
    }
}

// ---------------------------------------------------------------------------
// API Execution — calls /api/shortcuts/run (real on-chain or read ops)
// ---------------------------------------------------------------------------

interface RunApiResult {
    runId: string | null;
    steps: StepTestResult[];
    pendingTransactions: PendingTransaction[];
    requiresSigning: boolean;
    status: string;
    pendingInteraction?: PendingInteraction | null;
}

type HydratableShortcut = Pick<Shortcut, "name" | "category" | "inputs" | "steps">;

function deriveShortcutCategoryOverride(
    shortcutCategory: string,
    blocks: CanvasBlock[],
): BlockCategory | null {
    if (!isPublishableShortcutCategory(shortcutCategory)) {
        return null;
    }

    const inferredCategory = inferShortcutCategoryFromBlocks(blocks);
    return shortcutCategory === inferredCategory ? null : shortcutCategory;
}

function stringifyPromptValue(value: unknown): string {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function buildShortcutInputDialogRequest(input: ShortcutInput): BuilderInputDialogRequest {
    return {
        kind: "input",
        title: input.label,
        message: "Provide a value before the shortcut starts.",
        ...(input.placeholder?.trim() ? { description: input.placeholder.trim() } : {}),
        inputType: input.type,
        placeholder: input.placeholder,
        defaultValue: input.default,
        options: input.type === "select" ? input.constraints?.options : undefined,
        required: input.required,
        confirmLabel: "Continue",
        cancelLabel: "Cancel",
    };
}

function buildConfirmationDialogRequest(
    interaction: PendingInteraction,
    blocks: CanvasBlock[],
): BuilderConfirmationDialogRequest {
    const block = findBlockById(blocks, interaction.stepId);
    const details = Object.entries(interaction.resolvedParams ?? {})
        .filter(([, value]) => stringifyPromptValue(value).trim().length > 0)
        .slice(0, 8)
        .map(([label, value]) => ({
            label,
            value: stringifyPromptValue(value),
        }));

    return {
        kind: "confirmation",
        title: block?.label ?? interaction.stepId,
        message: "Approve this step before the shortcut continues.",
        ...(details.length > 0 ? { details } : {}),
        confirmLabel: "Approve",
        cancelLabel: "Cancel",
    };
}

function buildInteractionInputDialogRequest(
    interaction: PendingInteraction,
    blocks: CanvasBlock[],
): BuilderInputDialogRequest {
    const block = findBlockById(blocks, interaction.stepId);

    return {
        kind: "input",
        title: block?.label ?? interaction.stepId,
        message: interaction.prompt?.trim() || "Enter a value",
        ...(interaction.placeholder?.trim() ? { description: interaction.placeholder.trim() } : {}),
        inputType: interaction.inputType,
        placeholder: interaction.placeholder,
        defaultValue: interaction.defaultValue,
        options: interaction.options,
        required: true,
        confirmLabel: "Continue",
        cancelLabel: "Cancel",
    };
}

function BuilderInteractionDialog({
    request,
    onResolve,
    onCancel,
}: {
    request: BuilderDialogRequest | null;
    onResolve: (response: BuilderDialogResponse) => void;
    onCancel: () => void;
}) {
    const [draftValue, setDraftValue] = useState("");
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!request) return;
        setError(null);
        setDraftValue(
            request.kind === "input"
                ? request.defaultValue ?? ""
                : "",
        );
    }, [request]);

    useEffect(() => {
        if (!request) return;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onCancel();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [onCancel, request]);

    if (!request) {
        return null;
    }

    const isInputDialog = request.kind === "input";
    const inputRequest = request.kind === "input" ? request : null;
    const supportsChoiceButtons = Boolean(inputRequest && (inputRequest.inputType === "select" || inputRequest.inputType === "boolean"));
    const normalizedValue = draftValue.trim();

    function resolveInput() {
        if (!inputRequest) return;

        if (inputRequest.inputType === "select") {
            if (!draftValue) {
                setError("Choose one option to continue.");
                return;
            }
            onResolve({ kind: "input", canceled: false, value: draftValue });
            return;
        }

        if (inputRequest.inputType === "boolean") {
            if (!draftValue) {
                setError("Choose true or false to continue.");
                return;
            }
            onResolve({ kind: "input", canceled: false, value: draftValue });
            return;
        }

        if (inputRequest.required && normalizedValue.length === 0) {
            setError("This value is required.");
            return;
        }

        onResolve({
            kind: "input",
            canceled: false,
            value: normalizedValue,
        });
    }

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            >
                <div
                    className="absolute inset-0"
                    onClick={onCancel}
                />
                <motion.div
                    initial={{ opacity: 0, y: 12, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.98 }}
                    transition={{ duration: 0.16 }}
                    className="relative z-10 w-full max-w-[520px] overflow-hidden rounded-2xl border border-border-subtle bg-secondary shadow-2xl"
                >
                    <div className="border-b border-border-subtle px-5 py-4">
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <div className="text-[13px] font-semibold tracking-wider uppercase text-fg-muted">
                                    {isInputDialog ? "Shortcut Input" : "Approval Required"}
                                </div>
                                <h2 className="mt-1 text-lg font-semibold text-fg">
                                    {request.title}
                                </h2>
                                <p className="mt-2 text-sm leading-relaxed text-fg-secondary">
                                    {request.message}
                                </p>
                                {inputRequest?.description ? (
                                    <p className="mt-2 text-xs leading-relaxed text-fg-muted">
                                        {inputRequest.description}
                                    </p>
                                ) : null}
                            </div>
                            <button
                                type="button"
                                onClick={onCancel}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-tertiary hover:text-fg"
                                aria-label="Close dialog"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>

                    <div className="px-5 py-4">
                        {request.kind === "confirmation" && request.details?.length ? (
                            <div className="rounded-xl border border-border-subtle bg-primary/35 p-3">
                                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
                                    Resolved Values
                                </div>
                                <div className="flex flex-col gap-2">
                                    {request.details.map((detail) => (
                                        <div key={`${detail.label}-${detail.value}`} className="flex items-start justify-between gap-3 text-sm">
                                            <span className="text-fg-muted">{detail.label}</span>
                                            <span className="max-w-[60%] break-words text-right text-fg">{detail.value}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        {inputRequest && supportsChoiceButtons && inputRequest.inputType === "select" && inputRequest.options?.length ? (
                            <div className="flex flex-col gap-2">
                                {inputRequest.options.map((option) => {
                                    const isActive = draftValue === option.value;
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => {
                                                setDraftValue(option.value);
                                                setError(null);
                                            }}
                                            className={`flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left text-sm transition-colors ${
                                                isActive
                                                    ? "border-brand bg-brand-subtle text-brand-light"
                                                    : "border-border-subtle bg-primary/35 text-fg hover:border-border-default hover:bg-tertiary"
                                            }`}
                                        >
                                            <span>{option.label}</span>
                                            {isActive ? <CheckCircle2 size={16} /> : null}
                                        </button>
                                    );
                                })}
                            </div>
                        ) : null}

                        {inputRequest && supportsChoiceButtons && inputRequest.inputType === "boolean" ? (
                            <div className="grid grid-cols-2 gap-2">
                                {[
                                    { label: "True", value: "true" },
                                    { label: "False", value: "false" },
                                ].map((option) => {
                                    const isActive = draftValue === option.value;
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => {
                                                setDraftValue(option.value);
                                                setError(null);
                                            }}
                                            className={`rounded-xl border px-3 py-3 text-sm font-medium transition-colors ${
                                                isActive
                                                    ? "border-brand bg-brand-subtle text-brand-light"
                                                    : "border-border-subtle bg-primary/35 text-fg hover:border-border-default hover:bg-tertiary"
                                            }`}
                                        >
                                            {option.label}
                                        </button>
                                    );
                                })}
                            </div>
                        ) : null}

                        {inputRequest && !supportsChoiceButtons ? (
                            <div className="flex flex-col gap-2">
                                <input
                                    type="text"
                                    inputMode={
                                        inputRequest.inputType === "amount" || inputRequest.inputType === "number"
                                            ? "decimal"
                                            : "text"
                                    }
                                    value={draftValue}
                                    onChange={(event) => {
                                        setDraftValue(event.target.value);
                                        if (error) setError(null);
                                    }}
                                    placeholder={inputRequest.placeholder ?? ""}
                                    spellCheck={inputRequest.inputType !== "address"}
                                    className="h-11 w-full rounded-xl border border-border-subtle bg-primary/35 px-3 text-sm text-fg outline-none transition-colors placeholder:text-fg-muted focus:border-brand focus:bg-secondary"
                                />
                                {inputRequest.inputType ? (
                                    <p className="text-[11px] text-fg-muted">
                                        Input type: {inputRequest.inputType}
                                    </p>
                                ) : null}
                            </div>
                        ) : null}

                        {error ? (
                            <div className="mt-3 rounded-xl border border-status-error/20 bg-status-error/10 px-3 py-2 text-sm text-status-error">
                                {error}
                            </div>
                        ) : null}
                    </div>

                    <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-4">
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={onCancel}
                        >
                            {request.cancelLabel ?? "Cancel"}
                        </Button>
                        <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            onClick={() => {
                                if (request.kind === "confirmation") {
                                    onResolve({ kind: "confirmation", approved: true });
                                    return;
                                }
                                resolveInput();
                            }}
                        >
                            {request.confirmLabel ?? (request.kind === "confirmation" ? "Approve" : "Continue")}
                        </Button>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}

function BuilderHandoffDialog({
    handoff,
    existingBlockCount,
    onChoose,
}: {
    handoff: BuilderAIHandoffV1 | null;
    existingBlockCount: number;
    onChoose: (mode: BuilderHandoffApplyMode | "cancel") => void;
}) {
    useEffect(() => {
        if (!handoff) return;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onChoose("cancel");
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [handoff, onChoose]);

    if (!handoff) return null;

    const isRunRestore = handoff.source === "run-restore";
    const incomingBlockCount = handoff.draft.blocks.length;
    const title = isRunRestore ? "Restore run snapshot?" : "Open AI draft in Builder?";
    const message = isRunRestore
        ? "You already have a Builder draft. Choose how to handle the run snapshot before changing the canvas."
        : "You already have a Builder draft. Choose how to handle the AI draft before changing the canvas.";

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            >
                <div
                    className="absolute inset-0"
                    onClick={() => onChoose("cancel")}
                />
                <motion.div
                    initial={{ opacity: 0, y: 12, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.98 }}
                    transition={{ duration: 0.16 }}
                    className="relative z-10 w-full max-w-[560px] overflow-hidden rounded-2xl border border-border-subtle bg-secondary shadow-2xl"
                >
                    <div className="border-b border-border-subtle px-5 py-4">
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <div className="text-[13px] font-semibold tracking-wider uppercase text-fg-muted">
                                    Builder Draft
                                </div>
                                <h2 className="mt-1 text-lg font-semibold text-fg">
                                    {title}
                                </h2>
                                <p className="mt-2 text-sm leading-relaxed text-fg-secondary">
                                    {message}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => onChoose("cancel")}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-tertiary hover:text-fg"
                                aria-label="Close dialog"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>

                    <div className="px-5 py-4">
                        <div className="rounded-xl border border-border-subtle bg-primary/35 p-3">
                            <div className="flex items-start justify-between gap-3 text-sm">
                                <span className="text-fg-muted">Current draft</span>
                                <span className="text-right text-fg">
                                    {existingBlockCount} block{existingBlockCount === 1 ? "" : "s"}
                                </span>
                            </div>
                            <div className="mt-2 flex items-start justify-between gap-3 text-sm">
                                <span className="text-fg-muted">
                                    {isRunRestore ? "Run snapshot" : "Incoming draft"}
                                </span>
                                <span className="text-right text-fg">
                                    {incomingBlockCount} block{incomingBlockCount === 1 ? "" : "s"}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col-reverse gap-2 border-t border-border-subtle px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => onChoose("cancel")}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => onChoose("append")}
                        >
                            Append steps
                        </Button>
                        <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            onClick={() => onChoose("replace")}
                        >
                            Replace draft
                        </Button>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}

async function collectShortcutInputValues(
    inputs: ShortcutInput[],
    requestInputDialog: (request: BuilderInputDialogRequest) => Promise<{ canceled: boolean; value?: string }>,
): Promise<Record<string, unknown> | null> {
    if (inputs.length === 0) {
        return {};
    }

    const values: Record<string, unknown> = {};

    for (const input of inputs) {
        const response = await requestInputDialog(buildShortcutInputDialogRequest(input));
        if (response.canceled) {
            return null;
        }

        const rawValue = response.value ?? "";
        const trimmed = rawValue.trim();

        if (!trimmed) {
            if (!input.required) {
                if (input.default !== undefined) {
                    values[input.id] = input.default;
                }
                continue;
            }
            return null;
        }

        values[input.id] = trimmed;
    }

    return values;
}

async function callRunApi(
    blocks: CanvasBlock[],
    inputs: ShortcutInput[],
    shortcutName: string,
    walletAddress: string | undefined,
    networkId: string | undefined,
    inputValues: Record<string, unknown>,
    onStepUpdate: (results: StepTestResult[]) => void,
    requestConfirmationDialog: (request: BuilderConfirmationDialogRequest) => Promise<boolean>,
    requestInputDialog: (request: BuilderInputDialogRequest) => Promise<{ canceled: boolean; value?: string }>,
    signPreparedTransaction: (transaction: PendingTransaction) => Promise<{ txHash: string; explorerUrl?: string }>,
): Promise<RunApiResult> {
    const pending: StepTestResult[] = blocks.map((b) => ({
        stepId: b.id,
        status: "pending" as const,
    }));
    onStepUpdate([...pending]);

    const interactionResponses: Record<string, RunInteractionResponse> = {};

    for (let attempt = 0; attempt < 20; attempt++) {
        const body = {
            blocks: builderBlocksToRunBlocks(blocks),
            inputs,
            walletAddress,
            networkId,
            shortcutName,
            inputValues,
            persistRun: true,
            persistMode: "final",
            interactionResponses,
        };

        const res = await fetch("/api/shortcuts/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(body),
        });

        if (res.status === 401) {
            throw new Error("SIGN_IN_REQUIRED");
        }

        if (res.status === 503) {
            throw new Error("BACKEND_UNAVAILABLE");
        }

        const data = await res.json();

        if (!res.ok) {
            throw new Error(
                typeof data.error === "string"
                    ? data.error
                    : "Failed to run shortcut",
            );
        }

        const steps: StepTestResult[] = (data.steps ?? []).map(
            (s: { stepId: string; status: string; error?: string; output?: unknown; durationMs?: number }) => {
                const narrative = extractStepOutputNarrative(s.output);
                const txMeta = extractStepOutputTransactionMeta(s.output);
                const friendlyError = s.error ? sanitizeErrorMessage(s.error) : undefined;
                const status: StepTestResult["status"] =
                    s.status === "success"
                        ? "success"
                        : s.status === "skipped"
                            ? "skipped"
                            : s.status === "waiting_confirmation"
                                ? "waiting_confirmation"
                                : s.status === "waiting_input"
                                    ? "waiting_input"
                                    : s.status === "waiting_signature"
                                        ? "waiting_signature"
                                        : "error";
                return {
                    stepId: s.stepId,
                    status,
                    message: s.error
                        ? friendlyError
                        : status === "waiting_confirmation"
                            ? "Awaiting approval"
                            : status === "waiting_input"
                                ? "Awaiting input"
                                : status === "waiting_signature"
                                    ? "Awaiting wallet signature"
                                : narrative.message,
                    detail:
                        s.error
                            ? friendlyError !== s.error
                                ? s.error
                                : undefined
                            : status === "waiting_confirmation" || status === "waiting_input" || status === "waiting_signature"
                                ? undefined
                            : narrative.detail,
                    ...(isSocialSharePreparationData(s.output)
                        ? {
                            outputSummary: serializeSocialSharePreparationData(s.output),
                            sharePreparation: s.output,
                        }
                        : {}),
                    ...(isX402DiscoverySummaryData(s.output)
                        ? {
                            outputSummary: JSON.stringify(s.output),
                            x402Discovery: s.output,
                        }
                        : {}),
                    durationMs: s.durationMs,
                    ...txMeta,
                };
            },
        );

        onStepUpdate(steps);

        const pendingInteraction = data.pendingInteraction as PendingInteraction | null | undefined;
        if (!pendingInteraction) {
            return {
                runId: data.runId,
                steps,
                pendingTransactions: data.pendingTransactions ?? [],
                requiresSigning: data.requiresSigning ?? false,
                status: data.status ?? "error",
                pendingInteraction: null,
            };
        }

        if (pendingInteraction.kind === "confirmation") {
            const approved = await requestConfirmationDialog(
                buildConfirmationDialogRequest(pendingInteraction, blocks),
            );
            interactionResponses[pendingInteraction.stepId] = {
                kind: "confirmation",
                approved,
            };
            continue;
        }

        if (pendingInteraction.kind === "signature") {
            const preparedTransaction = pendingInteraction.preparedTransaction;
            if (!preparedTransaction) {
                throw new Error("Missing prepared transaction details for signature step.");
            }

            try {
                const signature = await signPreparedTransaction(preparedTransaction);
                interactionResponses[pendingInteraction.stepId] = {
                    kind: "signature",
                    txHash: signature.txHash,
                    ...(signature.explorerUrl ? { explorerUrl: signature.explorerUrl } : {}),
                };
                continue;
            } catch (error) {
                const rawMessage = error instanceof Error ? error.message : "Transaction signing failed.";
                const message = sanitizeErrorMessage(rawMessage);
                onStepUpdate(
                    steps.map((step) =>
                        step.stepId === pendingInteraction.stepId
                            ? {
                                ...step,
                                status: "error" as const,
                                message,
                                detail: message !== rawMessage ? rawMessage : undefined,
                            }
                            : step,
                    ),
                );
                throw error instanceof Error ? error : new Error(message);
            }
        }

        let capturedInput: RunInteractionResponse;

        const response = await requestInputDialog(
            buildInteractionInputDialogRequest(pendingInteraction, blocks),
        );
        capturedInput = response.canceled
            ? { kind: "input", canceled: true }
            : { kind: "input", value: response.value ?? "" };

        interactionResponses[pendingInteraction.stepId] = capturedInput;
    }

    throw new Error("Too many interactive prompts were required for this run.");
}

async function reconcileRun(
    runId: string,
    status: "succeeded" | "failed",
    results: StepTestResult[],
    blocks: CanvasBlock[],
): Promise<void> {
    const res = await fetch(`/api/runs/${runId}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
            status,
            ...(status === "failed"
                ? {
                    error: results.find((result) => result.status === "error")?.message
                        ?? "Transaction signing failed",
                }
                : {}),
            completedAt: new Date().toISOString(),
            steps: results.map((result, index) => ({
                stepId: result.stepId,
                label: findBlockById(blocks, result.stepId)?.label ?? result.stepId,
                status:
                    result.status === "success"
                        ? "success"
                        : result.status === "error"
                            ? "error"
                            : "pending",
                outputSummary: result.outputSummary ?? result.message,
                ...(result.status === "error" ? { error: result.message } : {}),
                startedAt: new Date().toISOString(),
                completedAt: new Date().toISOString(),
                durationMs: result.durationMs,
                sequence: index,
            })),
        }),
    });

    if (!res.ok) {
        throw new Error("Failed to reconcile run");
    }
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Custom Component for Category Selection
// ---------------------------------------------------------------------------

function BuilderCategoryDropdown({
    value,
    inferredCategory,
    onChange,
}: {
    value: BlockCategory | null;
    inferredCategory: BlockCategory;
    onChange: (val: BlockCategory | null) => void;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isOpen]);

    const resolvedCategory = value ?? inferredCategory;
    const meta = CATEGORY_META[resolvedCategory];

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="group flex items-center gap-1.5 h-6 px-2.5 rounded-md border border-border-subtle bg-primary/55 text-[11px] font-semibold tracking-wider uppercase transition-all hover:border-brand hover:bg-brand/5 outline-none focus-visible:outline-none"
                data-focus-managed="true"
                style={{
                    color: meta.cssColor,
                    backgroundColor: `color-mix(in srgb, ${meta.cssColor} ${isOpen ? "15%" : "8%"}, transparent)`,
                    borderColor: isOpen ? meta.cssColor : undefined,
                }}
                title={
                    value ? "Shortcut category selected manually" : "Shortcut category inferred from the overall flow"
                }
            >
                {meta.label}
                <ChevronDown
                    className={`w-3.5 h-3.5 opacity-60 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                />
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 4, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 4, scale: 0.98 }}
                        transition={{ duration: 0.15, ease: "easeOut" }}
                        className="absolute top-full left-0 sm:right-0 sm:left-auto mt-2 w-52 rounded-xl border border-border-subtle bg-primary shadow-2xl overflow-hidden z-[100] backdrop-blur-xl"
                    >
                        <div className="flex flex-col py-1">
                            <button
                                type="button"
                                className="flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors hover:bg-tertiary disabled:opacity-50"
                                onClick={() => {
                                    onChange(null);
                                    setIsOpen(false);
                                }}
                            >
                                <span className="flex-1 text-fg whitespace-nowrap">
                                    Auto{" "}
                                    <span className="opacity-50 text-[11px] uppercase">
                                        ({CATEGORY_META[inferredCategory].label})
                                    </span>
                                </span>
                                {value === null && <CheckCircle2 className="w-4 h-4 text-brand shrink-0" />}
                            </button>

                            <div className="h-px bg-border-subtle my-1 w-full" />

                            {PUBLISHABLE_SHORTCUT_CATEGORIES.map((category) => {
                                const isSelected = value === category;
                                const catMeta = CATEGORY_META[category];
                                return (
                                    <button
                                        key={category}
                                        type="button"
                                        className={`flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors hover:bg-tertiary ${
                                            isSelected ? "bg-tertiary" : ""
                                        }`}
                                        onClick={() => {
                                            onChange(category);
                                            setIsOpen(false);
                                        }}
                                    >
                                        <span
                                            className="w-2 h-2 rounded-full shrink-0"
                                            style={{ backgroundColor: catMeta.cssColor }}
                                        />
                                        <span className="flex-1 text-fg">{catMeta.label}</span>
                                        {isSelected && <CheckCircle2 className="w-4 h-4 text-brand shrink-0" />}
                                    </button>
                                );
                            })}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

function BuilderPageInner() {
    const searchParams = useSearchParams();
    const { publishBuilderContext, clearBuilderContext } = useBuilderAIContext();
    const templateId = searchParams.get("template");
    const savedShortcutId = searchParams.get("shortcut");
    const publishedSlug = searchParams.get("public") ?? searchParams.get("published");

    // Shortcut source for status chip: template | saved | published | draft
    type ShortcutSource = "template" | "saved" | "published" | "draft";
    const [shortcutSource, setShortcutSource] = useState<ShortcutSource>(
        templateId ? "template" : savedShortcutId ? "saved" : publishedSlug ? "published" : "draft",
    );

    // SSR-safe state: always start with empty defaults, hydrate on mount
    const [shortcutName, setShortcutName] = useState("");
    const [shortcutInputs, setShortcutInputs] = useState<ShortcutInput[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const [blocks, setBlocks] = useState<CanvasBlock[]>(INITIAL_BLOCKS);
    const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
    const [pendingBranchTarget, setPendingBranchTarget] = useState<{
        parentId: string;
        branch: BranchKey;
    } | null>(null);
    const [showMobilePalette, setShowMobilePalette] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [builderNotice, setBuilderNotice] = useState<string | null>(null);
    const [interactionDialog, setInteractionDialog] = useState<BuilderDialogRequest | null>(null);
    const [pendingHandoff, setPendingHandoff] = useState<BuilderAIHandoffV1 | null>(null);
    // Track whether we're editing an existing saved shortcut (prevents duplicate save)
    const [currentShortcutId, setCurrentShortcutId] = useState<string | null>(savedShortcutId);
    const [shortcutCategoryOverride, setShortcutCategoryOverride] = useState<BlockCategory | null>(null);
    const interactionDialogResolverRef = useRef<((response: BuilderDialogResponse) => void) | null>(null);
    const currentBuilderDraftRef = useRef<BuilderDraftV1>({
        shortcutName: "",
        blocks: INITIAL_BLOCKS,
        inputs: [],
        shortcutCategoryOverride: null,
    });
    currentBuilderDraftRef.current = {
        shortcutName,
        blocks,
        inputs: shortcutInputs,
        shortcutCategoryOverride,
    };
    const inferredShortcutCategory = useMemo(
        () => inferShortcutCategoryFromBlocks(blocks),
        [blocks],
    );
    const resolvedShortcutCategory = shortcutCategoryOverride ?? inferredShortcutCategory;

    const hydrateSavedShortcut = useCallback(async (shortcutId: string) => {
        const res = await fetch(`/api/shortcuts/${shortcutId}`, {
            credentials: "include",
        });

        if (res.status === 401) {
            throw new Error("SIGN_IN_REQUIRED");
        }

        if (res.status === 503) {
            throw new Error("BACKEND_UNAVAILABLE");
        }

        if (!res.ok) {
            throw new Error("Failed to load saved shortcut");
        }

        const data = await res.json() as { shortcut?: HydratableShortcut };

        const shortcut = data.shortcut;
        if (!shortcut) {
            throw new Error("Saved shortcut not found");
        }

        const nextBlocks = shortcutToBuilderBlocks({
            category: isBlockCategory(shortcut.category) ? shortcut.category : "logic",
            steps: shortcut.steps,
        });
        const sanitizedInputs = sanitizeShortcutInputs(shortcut.inputs);

        setShortcutName(shortcut.name);
        setShortcutInputs(sanitizedInputs);
        setBlocks(nextBlocks.length > 0 ? nextBlocks : INITIAL_BLOCKS);
        setShortcutCategoryOverride(
            deriveShortcutCategoryOverride(shortcut.category, nextBlocks),
        );
    }, []);

    const hydratePublishedShortcut = useCallback(async (slug: string) => {
        const res = await fetch(`/api/published-shortcuts/${encodeURIComponent(slug)}`);

        if (!res.ok) {
            throw new Error("Failed to load public shortcut");
        }

        const data = await res.json() as { shortcut?: HydratableShortcut };

        const shortcut = data.shortcut;
        if (!shortcut) {
            throw new Error("Public shortcut not found");
        }

        const nextBlocks = shortcutToBuilderBlocks({
            category: isBlockCategory(shortcut.category) ? shortcut.category : "logic",
            steps: shortcut.steps,
        });

        setShortcutName(shortcut.name);
        setShortcutInputs(sanitizeShortcutInputs(shortcut.inputs));
        setBlocks(nextBlocks.length > 0 ? nextBlocks : INITIAL_BLOCKS);
        setShortcutCategoryOverride(
            deriveShortcutCategoryOverride(shortcut.category, nextBlocks),
        );
        setShortcutSource("published");
    }, []);

    const applyAIHandoff = useCallback((
        handoff: BuilderAIHandoffV1,
        mode: BuilderHandoffApplyMode = "replace",
    ) => {
        const draft = handoff.draft;
        const sanitizedDraft: BuilderDraftV1 = {
            shortcutName: draft.shortcutName,
            blocks: draft.blocks.length > 0 ? draft.blocks : INITIAL_BLOCKS,
            inputs: sanitizeShortcutInputs(draft.inputs),
            shortcutCategoryOverride:
                draft.shortcutCategoryOverride &&
                isPublishableShortcutCategory(draft.shortcutCategoryOverride)
                    ? draft.shortcutCategoryOverride
                    : null,
        };
        const nextDraft = mode === "append"
            ? prepareAppendHandoffDraft(currentBuilderDraftRef.current, sanitizedDraft)
            : sanitizedDraft;
        const nextInputs = sanitizeShortcutInputs(nextDraft.inputs);
        const nextBlocks = nextDraft.blocks.length > 0 ? nextDraft.blocks : INITIAL_BLOCKS;
        const nextCategory =
            nextDraft.shortcutCategoryOverride &&
            isPublishableShortcutCategory(nextDraft.shortcutCategoryOverride)
                ? nextDraft.shortcutCategoryOverride
                : null;

        setShortcutName(nextDraft.shortcutName);
        setShortcutInputs(nextInputs);
        setBlocks(nextBlocks);
        setShortcutCategoryOverride(nextCategory);
        setShortcutSource("draft");
        setCurrentShortcutId(null);
        setEditingBlockId(null);
        setPendingBranchTarget(null);
        setTestStatus("idle");
        setTestResults([]);
        setBuilderNotice(
            handoff.source === "run-restore"
                ? mode === "append"
                    ? "Run snapshot appended in Builder. Review the steps, then save when ready."
                    : "Run snapshot restored in Builder. Review the steps, then save when ready."
                : mode === "append"
                    ? "AI draft appended in Builder. Review the steps, then save when ready."
                    : "AI draft loaded in Builder. Review the steps, then save when ready.",
        );
        writeBuilderDraft({
            shortcutName: nextDraft.shortcutName,
            blocks: nextBlocks,
            inputs: nextInputs,
            shortcutCategoryOverride: nextCategory,
        });
        clearBuilderAIHandoff();
    }, []);

    const loadBuilderDraftState = useCallback((draft: BuilderDraftV1) => {
        setShortcutName(draft.shortcutName);
        setShortcutInputs(sanitizeShortcutInputs(draft.inputs));
        setBlocks(draft.blocks.length > 0 ? draft.blocks : INITIAL_BLOCKS);
        setShortcutCategoryOverride(draft.shortcutCategoryOverride ?? null);
        setShortcutSource("draft");
    }, []);

    const queueOrApplyAIHandoff = useCallback((handoff: BuilderAIHandoffV1) => {
        if (hasMeaningfulBuilderDraft(currentBuilderDraftRef.current)) {
            setPendingHandoff(handoff);
            setBuilderNotice(
                handoff.source === "run-restore"
                    ? "Run snapshot is ready. Choose whether to replace or append it."
                    : "AI draft is ready. Choose whether to replace or append it.",
            );
            return;
        }

        applyAIHandoff(handoff, "replace");
    }, [applyAIHandoff]);

    // Hydrate from sessionStorage or template AFTER mount (avoids hydration mismatch)
    useEffect(() => {
        let cancelled = false;

        async function hydrate() {
            if (savedShortcutId) {
                try {
                    await hydrateSavedShortcut(savedShortcutId);
                } catch (error) {
                    if (!cancelled) {
                        setBuilderNotice(
                            error instanceof Error && error.message === "SIGN_IN_REQUIRED"
                                ? "Finish signing in to open this saved shortcut."
                                : error instanceof Error && error.message === "BACKEND_UNAVAILABLE"
                                    ? "Saved shortcuts are unavailable until the backend is configured."
                                    : "This saved shortcut could not be loaded. Your local draft was restored instead.",
                        );
                    }
                }
                if (!cancelled) {
                    setMounted(true);
                }
                return;
            }

            if (templateId) {
                const tmpl = getTemplateById(templateId);
                if (tmpl) {
                    setShortcutName(tmpl.name);
                    setShortcutInputs([]);
                    setBlocks(tmpl.blocks);
                    setShortcutCategoryOverride(null);
                    setShortcutSource("template");
                    if (!cancelled) setMounted(true);
                    return;
                }
            }

            if (publishedSlug) {
                try {
                    await hydratePublishedShortcut(publishedSlug);
                } catch {
                    if (!cancelled) {
                        setBuilderNotice("This public shortcut could not be loaded.");
                    }
                }
                if (!cancelled) {
                    setMounted(true);
                }
                return;
            }

            const aiHandoff = readBuilderAIHandoff();
            const savedDraft = readBuilderDraft();
            if (aiHandoff && savedDraft && hasMeaningfulBuilderDraft(savedDraft)) {
                loadBuilderDraftState(savedDraft);
                setPendingHandoff(aiHandoff);
                setBuilderNotice(
                    aiHandoff.source === "run-restore"
                        ? "Run snapshot is ready. Choose whether to replace or append it."
                        : "AI draft is ready. Choose whether to replace or append it.",
                );
                if (!cancelled) setMounted(true);
                return;
            }

            if (aiHandoff && !savedDraft) {
                const legacyDraft = readLegacyBuilderDraft();
                if (legacyDraft.draft && hasMeaningfulBuilderDraft(legacyDraft.draft)) {
                    loadBuilderDraftState(legacyDraft.draft);
                    writeBuilderDraft(legacyDraft.draft);
                    clearLegacyBuilderDraft();
                    setPendingHandoff(aiHandoff);
                    setBuilderNotice(
                        aiHandoff.source === "run-restore"
                            ? "Run snapshot is ready. Choose whether to replace or append it."
                            : "AI draft is ready. Choose whether to replace or append it.",
                    );
                    if (!cancelled) setMounted(true);
                    return;
                }
            }

            if (aiHandoff) {
                applyAIHandoff(aiHandoff, "replace");
                if (!cancelled) setMounted(true);
                return;
            }

            if (savedDraft) {
                loadBuilderDraftState(savedDraft);
                if (!cancelled) setMounted(true);
                return;
            }

            const legacyDraft = readLegacyBuilderDraft();
            if (legacyDraft.draft) {
                setShortcutName(legacyDraft.draft.shortcutName);
                setShortcutInputs(legacyDraft.draft.inputs ?? []);
                setBlocks(legacyDraft.draft.blocks.length > 0 ? legacyDraft.draft.blocks : INITIAL_BLOCKS);
                setShortcutCategoryOverride(null);
                writeBuilderDraft(legacyDraft.draft);
                clearLegacyBuilderDraft();

                if (legacyDraft.usedLegacyInputs) {
                    setBuilderNotice("Your local draft contained legacy shortcut inputs. They were preserved and will continue to be asked at run start wherever a field still references them.");
                }
            } else {
                setShortcutInputs([]);
                removeSessionStorageValue(LEGACY_BUILDER_INPUTS_STORAGE_KEY);
            }

            if (!cancelled) setMounted(true);
        }

        void hydrate();

        return () => {
            cancelled = true;
        };
    }, [applyAIHandoff, hydrateSavedShortcut, hydratePublishedShortcut, loadBuilderDraftState, savedShortcutId, templateId, publishedSlug]);

    useEffect(() => {
        if (!mounted) return;

        function handleAIHandoff() {
            const handoff = readBuilderAIHandoff();
            if (handoff) {
                queueOrApplyAIHandoff(handoff);
            }
        }

        window.addEventListener(BUILDER_AI_HANDOFF_EVENT, handleAIHandoff);
        return () => {
            window.removeEventListener(BUILDER_AI_HANDOFF_EVENT, handleAIHandoff);
        };
    }, [mounted, queueOrApplyAIHandoff]);

    // Persist the minimal Builder draft after hydration completes.
    useEffect(() => {
        if (!mounted) return;

        const persistedShortcutInputs = shortcutInputs.filter((input) =>
            countInputBindings(blocks, input.id) > 0,
        );

        writeBuilderDraft({
            shortcutName,
            blocks,
            inputs: persistedShortcutInputs,
            shortcutCategoryOverride,
        });
    }, [blocks, mounted, shortcutCategoryOverride, shortcutInputs, shortcutName]);

    // Wallet — inject connected address into execution context
    const { address: walletAddress, isConnected, chain: connectedChain } = useAccount();
    const { authState, refreshSession } = useAuthSession();
    const { networkId: activeNetworkId, label: activeNetworkLabel, isUnsupportedChain } = useActiveChain();
    const { switchChainAsync, isPending: isSwitchingNetwork, variables: switchChainVariables } = useSwitchChain();
    const activeChainId = NETWORKS[activeNetworkId].chain.id;

    // Run / TX state
    const [testStatus, setTestStatus] = useState<TestStatus>("idle");
    const [testResults, setTestResults] = useState<StepTestResult[]>([]);
    const [testMessage, setTestMessage] = useState<string | null>(null);

    // Save state
    const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
    const [saveMessage, setSaveMessage] = useState<string | null>(null);

    // Skills panel resize
    const [skillsWidth, setSkillsWidth] = useState(240);
    const isResizing = useRef(false);
    const isDraggingRef = useRef(false);

    const handleResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isResizing.current = true;

        const startX = e.clientX;
        const startWidth = skillsWidth;

        function onMouseMove(ev: MouseEvent) {
            if (!isResizing.current) return;
            const delta = startX - ev.clientX;
            const next = Math.min(400, Math.max(200, startWidth + delta));
            setSkillsWidth(next);
        }

        function onMouseUp() {
            isResizing.current = false;
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        }

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    }, [skillsWidth]);

    const canvasRef = useRef<HTMLDivElement>(null);

    // ---- Skill filtering ----
    const filteredSkills = useMemo(() => {
        if (!searchQuery.trim()) return SKILL_PALETTE;
        const q = searchQuery.toLowerCase();
        return SKILL_PALETTE.filter(
            (s) =>
                s.label.toLowerCase().includes(q) ||
                s.description.toLowerCase().includes(q),
        );
    }, [searchQuery]);

    const grouped = useMemo(
        () => groupByCategory(filteredSkills),
        [filteredSkills],
    );
    const flatBlocks = useMemo(() => flattenBlocks(blocks), [blocks]);
    const activeShortcutInputs = useMemo(
        () => shortcutInputs.filter((input) => countInputBindings(blocks, input.id) > 0),
        [blocks, shortcutInputs],
    );

    useEffect(() => {
        if (!mounted) return;

        publishBuilderContext({
            shortcutName,
            category: resolvedShortcutCategory,
            blocks,
            inputs: activeShortcutInputs,
        });
    }, [
        activeShortcutInputs,
        blocks,
        mounted,
        publishBuilderContext,
        resolvedShortcutCategory,
        shortcutName,
    ]);

    useEffect(() => {
        return () => {
            clearBuilderContext();
        };
    }, [clearBuilderContext]);

    // ---- Actions ----
    const toggleCategory = useCallback((cat: string) => {
        setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(cat)) next.delete(cat);
            else next.add(cat);
            return next;
        });
    }, []);

    const addBlock = useCallback((skill: SkillDefinition) => {
        const params = buildInitialParams(skill.id);
        const newBlock: CanvasBlock = {
            id: `step-${Date.now()}`,
            skillId: skill.id,
            label: skill.label,
            category: skill.category,
            params,
            confirm: skill.requiresConfirmation,
            ...(skill.id === "logic.if_else"
                ? { thenBlocks: [], elseBlocks: [] }
                : skill.id === "logic.repeat" || skill.id === "logic.repeat_each"
                    ? { repeatBlocks: [] }
                : {}),
        };
        if (pendingBranchTarget) {
            setBlocks((prev) =>
                addBranchBlockById(
                    prev,
                    pendingBranchTarget.parentId,
                    pendingBranchTarget.branch,
                    newBlock,
                ),
            );
            setPendingBranchTarget(null);
        } else {
            setBlocks((prev) => [...prev, newBlock]);
        }
        setEditingBlockId(newBlock.id);
        setShowMobilePalette(false);

        setTimeout(() => {
            canvasRef.current?.scrollTo({
                top: canvasRef.current.scrollHeight,
                behavior: "smooth",
            });
        }, 100);
    }, [pendingBranchTarget]);

    const removeBlock = useCallback((id: string) => {
        setBlocks((prev) => removeBlockById(prev, id));
        setEditingBlockId((prev) => (prev === id ? null : prev));
        setTestResults([]);
    }, []);

    const moveBlock = useCallback((id: string, direction: "up" | "down") => {
        setBlocks((prev) => moveBlockById(prev, id, direction));
        setTestResults([]);
    }, []);

    const updateBlockLabel = useCallback((id: string, label: string) => {
        setBlocks((prev) =>
            updateBlocksById(prev, id, (block) => ({ ...block, label })),
        );
    }, []);

    const toggleBlockConfirm = useCallback((id: string) => {
        setBlocks((prev) =>
            updateBlocksById(prev, id, (block) => {
                const skill = findSkillDef(block.skillId);
                if (skill?.requiresConfirmation) {
                    return { ...block, confirm: true };
                }

                return {
                    ...block,
                    confirm: !block.confirm,
                };
            }),
        );
    }, []);

    /** Update a specific param by key */
    const updateBlockParam = useCallback(
        (blockId: string, key: string, value: string) => {
            setBlocks((prev) =>
                updateBlocksById(prev, blockId, (block) => {
                    const exists = block.params.findIndex((p) => p.key === key);
                    if (exists >= 0) {
                        const params = [...block.params];
                        params[exists] = { key, value };
                        return { ...block, params };
                    }
                    return { ...block, params: [...block.params, { key, value }] };
                }),
            );
        },
        [],
    );

    const updateBlockOutputAs = useCallback((blockId: string, value: string) => {
        setBlocks((prev) => {
            const existing = findBlockById(prev, blockId);
            const previousRoot = existing?.outputAs?.trim();
            const nextRoot = value.trim() || undefined;

            let nextBlocks = updateBlocksById(prev, blockId, (block) => ({
                ...block,
                outputAs: nextRoot,
            }));

            if (previousRoot && previousRoot !== nextRoot) {
                nextBlocks = replaceVariableReferences(
                    nextBlocks,
                    previousRoot,
                    nextRoot ?? blockId,
                );
            }

            return nextBlocks;
        });
    }, []);

    const handleReorderBlocks = useCallback((nextBlocks: CanvasBlock[]) => {
        if (hasSameTopLevelBlockOrder(blocks, nextBlocks)) {
            return;
        }

        setBlocks(nextBlocks);
        setTestResults([]);
    }, [blocks]);

    const createShortcutInput = useCallback((draft: ShortcutInput) => {
        setTestResults([]);
        const nextInput = normalizeShortcutInput(draft, activeShortcutInputs);
        setShortcutInputs((prev) => [
            ...prev.filter((input) => input.id !== nextInput.id),
            nextInput,
        ]);
        return `{{input.${nextInput.id}}}`;
    }, [activeShortcutInputs]);

    const presentInteractionDialog = useCallback((request: BuilderDialogRequest) => {
        return new Promise<BuilderDialogResponse>((resolve) => {
            interactionDialogResolverRef.current = resolve;
            setInteractionDialog(request);
        });
    }, []);

    const requestConfirmationDialog = useCallback(async (request: BuilderConfirmationDialogRequest) => {
        const response = await presentInteractionDialog(request);
        return response.kind === "confirmation" ? response.approved : false;
    }, [presentInteractionDialog]);

    const requestInputDialog = useCallback(async (request: BuilderInputDialogRequest) => {
        const response = await presentInteractionDialog(request);
        if (response.kind !== "input") {
            return { canceled: true } as const;
        }
        return response;
    }, [presentInteractionDialog]);

    const resolveInteractionDialog = useCallback((response: BuilderDialogResponse) => {
        interactionDialogResolverRef.current?.(response);
        interactionDialogResolverRef.current = null;
        setInteractionDialog(null);
    }, []);

    const cancelInteractionDialog = useCallback(() => {
        if (!interactionDialog) return;
        resolveInteractionDialog(
            interactionDialog.kind === "confirmation"
                ? { kind: "confirmation", approved: false }
                : { kind: "input", canceled: true },
        );
    }, [interactionDialog, resolveInteractionDialog]);

    const resolveHandoffDialog = useCallback((mode: BuilderHandoffApplyMode | "cancel") => {
        const handoff = pendingHandoff;
        setPendingHandoff(null);

        if (!handoff || mode === "cancel") {
            clearBuilderAIHandoff();
            setBuilderNotice(null);
            return;
        }

        applyAIHandoff(handoff, mode);
    }, [applyAIHandoff, pendingHandoff]);

    // ---- Run ----
    const executeTest = useCallback(async (finalInputValues: Record<string, unknown>) => {
        setTestStatus("running");
        setTestResults([]);
        setTestMessage(null);

        try {
            const { steps } = await callRunApi(
                blocks,
                activeShortcutInputs,
                shortcutName || "Untitled Shortcut",
                walletAddress,
                activeNetworkId,
                finalInputValues,
                (updated) => setTestResults(updated),
                requestConfirmationDialog,
                requestInputDialog,
                async (transaction) => {
                    if (!isConnected) {
                        throw new Error("Connect your wallet before signing this transaction.");
                    }
                    if (!walletAddress) {
                        throw new Error("Wallet address is unavailable. Reconnect your wallet and try again.");
                    }

                    setTestStatus("signing");

                    const targetChainId = NETWORKS[transaction.networkId].chain.id as SupportedBuilderChainId;
                    if (connectedChain?.id !== targetChainId) {
                        await switchWalletChain(wagmiConfig, {
                            chainId: targetChainId,
                        });
                    }

                    await getWalletClient(wagmiConfig, {
                        account: walletAddress,
                        chainId: targetChainId,
                    });

                    const normalizedCalls = transaction.calls.map((call) => {
                        const toAddr: `0x${string}` = isHexString(call.to) ? call.to : `0x${call.to}`;
                        const callData: `0x${string}` = isHexString(call.data) ? call.data : `0x${call.data}`;

                        return {
                            to: toAddr,
                            data: callData,
                            ...(call.value ? { value: BigInt(call.value) } : {}),
                        };
                    });

                    const submitSingleCall = async (call: typeof normalizedCalls[number]) => {
                        const dataSuffix = getConfiguredBuilderCodeDataSuffix();
                        const txHash = await sendTransaction(wagmiConfig, {
                            account: walletAddress,
                            chainId: targetChainId,
                            to: call.to,
                            value: call.value ?? parseEther("0"),
                            data: call.data,
                            ...(dataSuffix ? { dataSuffix } : {}),
                        });

                        setTestStatus("broadcasting");

                        await waitForTransactionReceipt(wagmiConfig, {
                            chainId: targetChainId,
                            hash: txHash,
                            timeout: 180_000,
                        });

                        return txHash;
                    };

                    if (normalizedCalls.length === 1) {
                        const txHash = await submitSingleCall(normalizedCalls[0]);

                        return {
                            txHash,
                            explorerUrl: buildExplorerTransactionUrl(transaction.networkId, txHash),
                        };
                    }

                    let lastTxHash: `0x${string}` | null = null;
                    for (const call of normalizedCalls) {
                        setTestStatus("signing");
                        lastTxHash = await submitSingleCall(call);
                    }

                    if (!lastTxHash) {
                        throw new Error("Prepared transaction did not produce a transaction hash.");
                    }

                    return {
                        txHash: lastTxHash,
                        explorerUrl: buildExplorerTransactionUrl(transaction.networkId, lastTxHash),
                    };
                },
            );

            const hasErrors = steps.some((r) => r.status === "error");
            setTestStatus(hasErrors ? "error" : "success");
        } catch (err) {
            console.error("Execution failed:", err);
            setTestStatus("error");
            setTestMessage(
                err instanceof Error && err.message === "SIGN_IN_REQUIRED"
                    ? "Finish signing in before testing this shortcut."
                    : err instanceof Error && err.message === "BACKEND_UNAVAILABLE"
                        ? "Shortcut testing is unavailable until the backend is configured."
                        : err instanceof Error
                            ? sanitizeErrorMessage(err.message)
                            : "Shortcut test failed.",
            );
        }
    }, [activeNetworkId, activeShortcutInputs, blocks, connectedChain?.id, isConnected, requestConfirmationDialog, requestInputDialog, shortcutName, walletAddress]);

    const handleTest = useCallback(async () => {
        if (blocks.length === 0) return;
        if (authState !== "authenticated") {
            setTestStatus("error");
            setTestMessage(
                authState === "connected_unauthenticated"
                    ? "Finish signing in before testing this shortcut."
                    : "Connect your wallet and sign in before testing this shortcut.",
            );
            return;
        }

        const collectedInputs = await collectShortcutInputValues(activeShortcutInputs, requestInputDialog);
        if (collectedInputs === null) {
            setTestStatus("idle");
            setTestMessage("Test run cancelled before execution started.");
            return;
        }

        await executeTest(collectedInputs);
    }, [activeShortcutInputs, authState, blocks.length, executeTest, requestInputDialog]);

    // ---- Save ----
    const handleSave = useCallback(async () => {
        if (blocks.length === 0) return;
        if (authState !== "authenticated") {
            setSaveStatus("error");
            setSaveMessage(
                authState === "connected_unauthenticated"
                    ? "Finish signing in before saving this shortcut."
                    : "Connect your wallet and sign in before saving this shortcut.",
            );
            setTimeout(() => setSaveStatus("idle"), 3000);
            return;
        }
        setSaveStatus("saving");
        setSaveMessage(null);

        try {
            const session = await refreshSession();
            if (!session.authenticated) {
                throw new ShortcutSaveError(
                    session.reason === "wallet_mismatch"
                        ? "Connected wallet changed. Sign in again before saving."
                        : session.error ?? "Session is not active.",
                    "SIGN_IN_REQUIRED",
                    401,
                );
            }

            const shortcut = builderBlocksToShortcut(blocks, {
                name: shortcutName || "Untitled Shortcut",
                description: "",
                category: resolvedShortcutCategory,
                inputs: activeShortcutInputs,
            });

            shortcut.steps = shortcut.steps.map((step, idx) => ({
                ...step,
                ...(idx > 0 ? { dependsOn: [blocks[idx - 1].id] } : {}),
            }));

            const isUpdate = !!currentShortcutId;
            const url = isUpdate
                ? `/api/shortcuts/${currentShortcutId}`
                : "/api/shortcuts";
            const method = isUpdate ? "PATCH" : "POST";

            const res = await fetch(url, {
                method,
                headers: {
                    "content-type": "application/json",
                },
                credentials: "include",
                body: JSON.stringify({
                    ...shortcut,
                    networkId: activeNetworkId,
                }),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                const message =
                    typeof data.error === "string"
                        ? data.error
                        : "Failed to save shortcut";
                throw new ShortcutSaveError(
                    message,
                    getShortcutSaveFailureCode(res.status),
                    res.status,
                );
            }

            // After first save, track the ID so subsequent saves update instead of creating duplicates
            if (!isUpdate) {
                const data = await res.json().catch(() => ({}));
                if (data.shortcutId) {
                    setCurrentShortcutId(data.shortcutId);
                }
            }

            setSaveStatus("saved");
            setSaveMessage(null);
            setShortcutSource("saved");
            setTimeout(() => setSaveStatus("idle"), 2500);
        } catch (error) {
            const saveError =
                error instanceof ShortcutSaveError
                    ? error
                    : error instanceof Error && (error as { cause?: unknown }).cause instanceof ShortcutSaveError
                        ? (error as { cause: ShortcutSaveError }).cause
                        : error instanceof Error && (
                            error.message.includes("fetch failed") ||
                            error.message.includes("NetworkError") ||
                            error.message.includes("Failed to fetch")
                        )
                            ? new ShortcutSaveError(error.message, "NETWORK_ERROR")
                            : error;

            if (saveError instanceof ShortcutSaveError && saveError.status === 401) {
                void refreshSession();
            }

            console.error("[builder/save] Failed to save shortcut", {
                code: saveError instanceof ShortcutSaveError ? saveError.code : "UNKNOWN",
                status: saveError instanceof ShortcutSaveError ? saveError.status : undefined,
                message: saveError instanceof Error ? saveError.message : "Unknown error",
            });
            setSaveStatus("error");
            setSaveMessage(getShortcutSaveMessage(saveError));
            setTimeout(() => setSaveStatus("idle"), 3000);
        }
    }, [activeNetworkId, activeShortcutInputs, authState, blocks, currentShortcutId, refreshSession, resolvedShortcutCategory, shortcutName]);

    // ---- Render ----
    return (
        <div
            className="flex -m-4 sm:-m-6 lg:-m-8"
            style={{ height: "calc(100dvh - var(--height-header))" }}
        >
            {/* Left column: toolbar + canvas */}
            <div className="relative flex-1 flex flex-col overflow-hidden">
                {/* Toolbar — flush top, borders right/bottom */}
                <div className="flex items-center gap-2 h-[48px] px-3 sm:h-[60px] sm:px-6 sm:gap-3 bg-secondary border-b border-border-subtle shrink-0">
                    <div className="relative group inline-grid items-center rounded-lg transition-all hover:bg-tertiary focus-within:bg-tertiary min-w-0 max-w-none sm:-ml-3 sm:min-w-[200px] sm:max-w-[40vw]">
                        {/* Hidden span mirrors the text, forcing the wrapper to expand dynamically to perfectly align the icon */}
                        <span
                            className="invisible whitespace-pre col-start-1 row-start-1 px-3 py-1.5 text-[16px] sm:text-[22px] font-bold tracking-tight pr-10 overflow-hidden"
                            aria-hidden="true"
                        >
                            {shortcutName || "Untitled Shortcut..."}
                        </span>
                        <input
                            type="text"
                            className="col-start-1 row-start-1 bg-transparent border-none appearance-none w-full text-[16px] sm:text-[22px] font-bold tracking-tight text-fg placeholder:text-fg-muted px-3 py-1.5 outline-none pr-10 focus:ring-0 focus:outline-none focus:shadow-none focus-visible:outline-none"
                            style={{ boxShadow: "none" }}
                            placeholder="Untitled Shortcut..."
                            value={shortcutName}
                            onChange={(e) => setShortcutName(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                            spellCheck={false}
                        />
                        <div className="absolute right-3 opacity-0 group-hover:opacity-100 transition-opacity flex items-center pointer-events-none text-fg-muted">
                            <Pencil size={18} />
                        </div>
                    </div>
                    {/* Status chip + category */}
                    {mounted && (
                        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                            <span
                                className={`hidden sm:inline-flex items-center h-6 px-2.5 text-[12px] font-semibold tracking-wider uppercase rounded-md ${
                                    shortcutSource === "saved"
                                        ? "bg-status-success/10 text-status-success"
                                        : shortcutSource === "published"
                                            ? "bg-brand-subtle text-brand"
                                            : shortcutSource === "template"
                                                ? "bg-tertiary text-fg-muted"
                                                : "bg-tertiary text-fg-muted"
                                }`}
                            >
                                {shortcutSource === "saved"
                                    ? "Saved"
                                    : shortcutSource === "published"
                                        ? "Public"
                                        : shortcutSource === "template"
                                            ? "Template"
                                            : "Draft"}
                            </span>
                            <BuilderCategoryDropdown
                                value={shortcutCategoryOverride}
                                inferredCategory={inferredShortcutCategory}
                                onChange={(val) => setShortcutCategoryOverride(val)}
                            />
                        </div>
                    )}
                    <div className="flex items-center gap-1 sm:gap-2 shrink-0 ml-auto">

                        {/* Reset button — restores to original state */}
                        <Button
                            type="button"
                            variant="ghost"
                            size="md"
                            className="hidden sm:inline-flex"
                            onClick={() => {
                                // Restore to template or empty
                                if (templateId) {
                                    const tmpl = getTemplateById(templateId);
                                    if (tmpl) {
                                        setBlocks(tmpl.blocks);
                                        setShortcutName(tmpl.name);
                                    } else {
                                        setBlocks(INITIAL_BLOCKS);
                                        setShortcutName("");
                                    }
                                } else {
                                    setBlocks(INITIAL_BLOCKS);
                                    setShortcutName("");
                                }
                                setShortcutInputs([]);
                                setShortcutCategoryOverride(null);
                                setEditingBlockId(null);
                                setPendingBranchTarget(null);
                                setTestStatus("idle");
                                setTestResults([]);
                                clearBuilderDraft();
                            }}
                            title="Reset to original"
                        >
                            <RotateCcw size={16} />
                        </Button>

                        {/* Run button */}
                        <Button
                            type="button"
                            variant={testStatus === "success" ? "success" : testStatus === "error" ? "danger" : "ghost"}
                            size="sm"
                            className={`${testStatus === "running" ? "text-brand-light bg-brand-subtle" : ""} min-w-0 sm:size-md`}
                            onClick={handleTest}
                            disabled={!mounted || testStatus === "running" || blocks.length === 0 || authState !== "authenticated"}
                            title={
                                authState === "connected_unauthenticated"
                                    ? "Finish signing in before running"
                                    : authState !== "authenticated"
                                        ? "Connect your wallet first"
                                        : undefined
                            }
                        >
                            {testStatus === "running" ? (
                                <Loader2 size={16} className="animate-spin" />
                            ) : testStatus === "success" ? (
                                <CheckCircle2 size={16} />
                            ) : testStatus === "error" ? (
                                <XCircle size={16} />
                            ) : (
                                <Play size={16} />
                            )}
                            <span className="hidden sm:inline">
                                {testStatus === "running"
                                    ? "Running\u2026"
                                    : testStatus === "success"
                                        ? "Done"
                                        : testStatus === "error"
                                            ? "Errors"
                                            : "Run"}
                            </span>
                        </Button>

                        {/* Save button */}
                        <Button
                            type="button"
                            variant={
                                saveStatus === "saved"
                                    ? "success"
                                    : saveStatus === "error"
                                        ? "danger"
                                        : "primary"
                            }
                            size="sm"
                            className="min-w-0 sm:size-md"
                            onClick={handleSave}
                            disabled={!mounted || blocks.length === 0 || saveStatus === "saving" || authState !== "authenticated"}
                            title={
                                authState === "connected_unauthenticated"
                                    ? "Finish signing in before saving"
                                    : authState !== "authenticated"
                                        ? "Connect your wallet first"
                                        : undefined
                            }
                        >
                            {saveStatus === "saving" ? (
                                <Loader2 size={16} className="animate-spin" />
                            ) : saveStatus === "saved" ? (
                                <CheckCircle2 size={16} />
                            ) : saveStatus === "error" ? (
                                <XCircle size={16} />
                            ) : (
                                <Save size={16} />
                            )}
                            <span className="hidden sm:inline">
                                {saveStatus === "saving"
                                    ? "Saving…"
                                    : saveStatus === "saved"
                                        ? "Saved!"
                                        : saveStatus === "error"
                                            ? "Save Failed"
                                            : "Save"}
                            </span>
                        </Button>
                    </div>
                </div>

                {authState !== "authenticated" && (
                    <div className="mx-5 sm:mx-6 mt-4 rounded-lg border border-status-warning/20 bg-status-warning/8 px-4 py-3 text-sm text-status-warning">
                        {authState === "connected_unauthenticated"
                            ? "Finish signing in from the header before testing or saving shortcuts."
                            : "Connect your wallet, then sign in from the header before testing or saving shortcuts."}
                    </div>
                )}

                {builderNotice && (
                    <div className="mx-5 sm:mx-6 mt-4 rounded-lg border border-border-default bg-secondary px-4 py-3 text-sm text-fg-secondary">
                        {builderNotice}
                    </div>
                )}

                <BuilderInteractionDialog
                    request={interactionDialog}
                    onResolve={resolveInteractionDialog}
                    onCancel={cancelInteractionDialog}
                />
                <BuilderHandoffDialog
                    handoff={pendingHandoff}
                    existingBlockCount={blocks.length}
                    onChoose={resolveHandoffDialog}
                />

                {isUnsupportedChain && (
                    <div className="mx-5 sm:mx-6 mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                        <div className="flex items-start gap-2">
                            <ShieldAlert size={16} className="shrink-0 text-amber-400 mt-0.5" />
                            <div className="min-w-0">
                                <p>
                                    Your wallet is on an unsupported network. Switch explicitly to{" "}
                                    <strong>{activeNetworkLabel}</strong> to use the Builder.
                                </p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {(["base-sepolia", "base-mainnet"] as const).map((networkId) => {
                                        const targetChainId = NETWORKS[networkId].chain.id;
                                        const isSwitching = isSwitchingNetwork && switchChainVariables?.chainId === targetChainId;

                                        return (
                                            <Button
                                                key={networkId}
                                                type="button"
                                                variant={networkId === activeNetworkId ? "primary" : "ghost"}
                                                size="sm"
                                                disabled={isSwitching}
                                                onClick={() => void switchChainAsync({ chainId: targetChainId })}
                                            >
                                                {isSwitching ? "Switching…" : `Use ${NETWORKS[networkId].label}`}
                                            </Button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <AnimatePresence>
                    {pendingBranchTarget && (
                        <motion.div
                            initial={{ opacity: 0, y: -10, height: 0 }}
                            animate={{ opacity: 1, y: 0, height: "auto" }}
                            exit={{ opacity: 0, y: -10, height: 0 }}
                            className="mx-5 sm:mx-6 mt-4 rounded-lg border border-brand/20 bg-brand-subtle px-4 py-3 text-sm text-brand-light overflow-hidden"
                        >
                            Adding next selected block to {pendingBranchTarget.branch === "thenBlocks"
                                ? "Then"
                                : pendingBranchTarget.branch === "elseBlocks"
                                    ? "Else"
                                    : "Repeat"} branch.
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Mobile FAB — floating "Add" button at bottom-center, only visible on mobile when palette is closed */}
                {!showMobilePalette && (
                    <button
                        type="button"
                        className="sm:hidden fixed bottom-6 left-1/2 -translate-x-1/2 z-20 w-12 h-12 flex items-center justify-center rounded-full bg-brand text-white shadow-lg hover:bg-brand-light active:scale-95 transition-all"
                        onClick={() => setShowMobilePalette(true)}
                        aria-label="Add skill"
                        data-focus-managed="true"
                    >
                        <Plus size={22} />
                    </button>
                )}

                {/* Mobile palette overlay — full screen with search */}
                <AnimatePresence>
                    {showMobilePalette && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="sm:hidden absolute inset-0 z-30"
                        >
                            <motion.aside
                                initial={{ y: "100%" }}
                                animate={{ y: 0 }}
                                exit={{ y: "100%" }}
                                transition={{ type: "spring", damping: 25, stiffness: 200 }}
                                className="w-full h-full bg-secondary flex flex-col overflow-hidden"
                            >
                                <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
                                    <span className="text-[13px] font-semibold tracking-wider uppercase text-fg-muted">
                                        Add Skill
                                    </span>
                                    <Button
                                        variant="icon"
                                        size="icon"
                                        onClick={() => setShowMobilePalette(false)}
                                    >
                                        <X size={16} />
                                    </Button>
                                </div>
                                <div className="px-3 py-2 border-b border-border-subtle">
                                    <input
                                        type="text"
                                        placeholder="Search blocks"
                                        className="w-full h-9 px-3 text-[14px] bg-tertiary border border-border-subtle rounded-lg text-fg placeholder:text-fg-muted/50 focus:outline-none focus:border-brand/40 transition-colors"
                                        data-focus-managed="true"
                                        onChange={(e) => {
                                            const q = e.target.value.toLowerCase().trim();
                                            const cats = document.querySelectorAll<HTMLElement>("[data-palette-category]");
                                            const skills = document.querySelectorAll<HTMLElement>("[data-palette-skill]");
                                            if (!q) {
                                                cats.forEach(el => el.style.display = "");
                                                skills.forEach(el => el.style.display = "");
                                                return;
                                            }
                                            skills.forEach(el => {
                                                const match = (el.textContent?.toLowerCase() ?? "").includes(q);
                                                el.style.display = match ? "" : "none";
                                            });
                                            cats.forEach(el => {
                                                const visible = el.querySelectorAll<HTMLElement>("[data-palette-skill]:not([style*='display: none'])");
                                                el.style.display = visible.length > 0 ? "" : "none";
                                            });
                                        }}
                                    />
                                </div>
                                <div className="flex-1 overflow-y-auto p-2">
                                    <BuilderPalette
                                        groupedSkills={grouped}
                                        collapsed={collapsed}
                                        onToggleCategory={toggleCategory}
                                        onAddSkill={addBlock}
                                    />
                                </div>
                            </motion.aside>
                        </motion.div>
                    )}
                </AnimatePresence>

                <BuilderCanvas
                    blocks={blocks}
                    flatBlocks={flatBlocks}
                    editingBlockId={editingBlockId}
                    pendingBranchTarget={pendingBranchTarget}
                    testResults={testResults}
                    testStatus={testStatus}
                    testMessage={testMessage}
                    saveStatus={saveStatus}
                    saveMessage={saveMessage}
                    activeNetworkId={activeNetworkId}
                    shortcutInputs={activeShortcutInputs}
                    canvasRef={canvasRef}
                    isDraggingRef={isDraggingRef}
                    onReorderBlocks={handleReorderBlocks}
                    onSetEditingBlockId={setEditingBlockId}
                    onSetPendingBranchTarget={setPendingBranchTarget}
                    onSetShowMobilePalette={setShowMobilePalette}
                    onRemoveBlock={removeBlock}
                    onMoveBlock={moveBlock}
                    onUpdateBlockLabel={updateBlockLabel}
                    onToggleBlockConfirm={toggleBlockConfirm}
                    onUpdateBlockParam={updateBlockParam}
                    onUpdateBlockOutputAs={updateBlockOutputAs}
                    onCreateShortcutInput={createShortcutInput}
                />
            </div>

            {/* Resize handle */}
            <div
                className="hidden sm:flex items-center justify-center w-1.5 cursor-col-resize bg-secondary border-l border-border-subtle hover:bg-border-default active:bg-brand/30 transition-colors shrink-0"
                onMouseDown={handleResizeStart}
            >
                <div className="w-px h-8 bg-fg-muted/30 rounded-full" />
            </div>

            {/* Desktop Palette — RIGHT side, flush like left sidebar */}
            <aside
                className="hidden sm:flex flex-col shrink-0 bg-secondary overflow-hidden"
                style={{ width: skillsWidth - 6 }} // -6px for the resize handle width
            >
                {/* Right toolbar/search matches h-[60px] */}
                <div className="h-[60px] flex items-center px-4 shrink-0 border-b border-border-subtle">
                    <div className="relative w-full">
                        <Search
                            size={14}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none"
                        />
                        <input
                            type="text"
                            className="w-full h-8 pl-8 pr-3 text-[13px] bg-tertiary border border-border-subtle rounded-md outline-none placeholder:text-fg-muted focus:border-border-strong transition-colors"
                            placeholder="Search blocks..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            style={{ boxShadow: "none" }}
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-4">
                    <span className="block mb-3 text-[11px] font-bold tracking-widest uppercase text-fg-muted">
                        Available Blocks
                    </span>
                    <BuilderPalette
                        groupedSkills={grouped}
                        collapsed={collapsed}
                        onToggleCategory={toggleCategory}
                        onAddSkill={addBlock}
                    />
                </div>
            </aside>
        </div>
    );
}

export default function BuilderPage() {
    return (
        <Suspense
            fallback={(
                <div className="flex min-h-[60vh] items-center justify-center">
                    <div className="rounded-2xl border border-border-default bg-secondary px-5 py-4 text-sm text-fg-secondary shadow-card">
                        Loading builder...
                    </div>
                </div>
            )}
        >
            <BuilderPageInner />
        </Suspense>
    );
}
