/* ==========================================================================
   Builder — Block Tree Utilities
   Pure helper functions for working with the builder block tree.
   No side effects, no state dependencies. Safe to extract.
   ========================================================================== */

import type {
    BuilderBlock as CanvasBlock,
} from "@/lib/builder-shortcut";
import type {
    ConditionExpression,
    ConditionGroup,
    StructuredCondition,
} from "@/engine/types";
export type BranchKey = "thenBlocks" | "elseBlocks" | "repeatBlocks";

export interface BlockPathSegment {
    blocks: CanvasBlock[];
    index: number;
}

export function flattenBlocks(blocks: CanvasBlock[]): CanvasBlock[] {
    const flat: CanvasBlock[] = [];

    function visit(items: CanvasBlock[]) {
        for (const item of items) {
            flat.push(item);
            if (item.thenBlocks?.length) visit(item.thenBlocks);
            if (item.elseBlocks?.length) visit(item.elseBlocks);
            if (item.repeatBlocks?.length) visit(item.repeatBlocks);
        }
    }

    visit(blocks);
    return flat;
}

export function findBlockById(blocks: CanvasBlock[], blockId: string): CanvasBlock | undefined {
    for (const block of blocks) {
        if (block.id === blockId) {
            return block;
        }
        if (block.thenBlocks) {
            const match = findBlockById(block.thenBlocks, blockId);
            if (match) return match;
        }
        if (block.elseBlocks) {
            const match = findBlockById(block.elseBlocks, blockId);
            if (match) return match;
        }
        if (block.repeatBlocks) {
            const match = findBlockById(block.repeatBlocks, blockId);
            if (match) return match;
        }
    }
    return undefined;
}

export function findBlockPath(
    blocks: CanvasBlock[],
    blockId: string,
    path: BlockPathSegment[] = [],
): BlockPathSegment[] | null {
    for (let index = 0; index < blocks.length; index++) {
        const block = blocks[index];
        const nextPath = [...path, { blocks, index }];
        if (block.id === blockId) {
            return nextPath;
        }
        if (block.thenBlocks) {
            const match = findBlockPath(block.thenBlocks, blockId, nextPath);
            if (match) return match;
        }
        if (block.elseBlocks) {
            const match = findBlockPath(block.elseBlocks, blockId, nextPath);
            if (match) return match;
        }
        if (block.repeatBlocks) {
            const match = findBlockPath(block.repeatBlocks, blockId, nextPath);
            if (match) return match;
        }
    }
    return null;
}

export function getAccessiblePriorBlocks(
    blocks: CanvasBlock[],
    currentBlockId: string,
): CanvasBlock[] {
    const path = findBlockPath(blocks, currentBlockId);
    if (!path) return [];

    const accessible: CanvasBlock[] = [];
    for (const segment of path) {
        for (let index = 0; index < segment.index; index++) {
            accessible.push(segment.blocks[index]);
        }
    }
    return accessible;
}

export function updateBlocksById(
    blocks: CanvasBlock[],
    blockId: string,
    updater: (block: CanvasBlock) => CanvasBlock,
): CanvasBlock[] {
    return blocks.map((block) => {
        if (block.id === blockId) {
            return updater(block);
        }

        return {
            ...block,
            ...(block.thenBlocks
                ? { thenBlocks: updateBlocksById(block.thenBlocks, blockId, updater) }
                : {}),
            ...(block.elseBlocks
                ? { elseBlocks: updateBlocksById(block.elseBlocks, blockId, updater) }
                : {}),
            ...(block.repeatBlocks
                ? { repeatBlocks: updateBlocksById(block.repeatBlocks, blockId, updater) }
                : {}),
        };
    });
}

export function removeBlockById(blocks: CanvasBlock[], blockId: string): CanvasBlock[] {
    return blocks
        .filter((block) => block.id !== blockId)
        .map((block) => ({
            ...block,
            ...(block.thenBlocks
                ? { thenBlocks: removeBlockById(block.thenBlocks, blockId) }
                : {}),
            ...(block.elseBlocks
                ? { elseBlocks: removeBlockById(block.elseBlocks, blockId) }
                : {}),
            ...(block.repeatBlocks
                ? { repeatBlocks: removeBlockById(block.repeatBlocks, blockId) }
                : {}),
        }));
}

export function moveBlockById(
    blocks: CanvasBlock[],
    blockId: string,
    direction: "up" | "down",
): CanvasBlock[] {
    const index = blocks.findIndex((block) => block.id === blockId);
    if (index >= 0) {
        const targetIndex = direction === "up" ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= blocks.length) {
            return blocks;
        }

        const next = [...blocks];
        [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
        return next;
    }

    let changed = false;
    const nextBlocks = blocks.map((block) => {
        const nextThenBlocks = block.thenBlocks
            ? moveBlockById(block.thenBlocks, blockId, direction)
            : block.thenBlocks;
        const nextElseBlocks = block.elseBlocks
            ? moveBlockById(block.elseBlocks, blockId, direction)
            : block.elseBlocks;
        const nextRepeatBlocks = block.repeatBlocks
            ? moveBlockById(block.repeatBlocks, blockId, direction)
            : block.repeatBlocks;

        if (
            nextThenBlocks !== block.thenBlocks ||
            nextElseBlocks !== block.elseBlocks ||
            nextRepeatBlocks !== block.repeatBlocks
        ) {
            changed = true;
            return {
                ...block,
                ...(block.thenBlocks ? { thenBlocks: nextThenBlocks } : {}),
                ...(block.elseBlocks ? { elseBlocks: nextElseBlocks } : {}),
                ...(block.repeatBlocks ? { repeatBlocks: nextRepeatBlocks } : {}),
            };
        }

        return block;
    });

    return changed ? nextBlocks : blocks;
}

export function moveTopLevelBlockRelative(
    blocks: CanvasBlock[],
    draggedBlockId: string,
    targetBlockId: string,
    position: "before" | "after",
): CanvasBlock[] {
    const sourceIndex = blocks.findIndex((block) => block.id === draggedBlockId);
    const targetIndex = blocks.findIndex((block) => block.id === targetBlockId);

    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
        return blocks;
    }

    const next = [...blocks];
    const [dragged] = next.splice(sourceIndex, 1);
    const adjustedTargetIndex = next.findIndex((block) => block.id === targetBlockId);

    if (adjustedTargetIndex < 0) {
        return blocks;
    }

    const insertionIndex = position === "before" ? adjustedTargetIndex : adjustedTargetIndex + 1;
    next.splice(insertionIndex, 0, dragged);
    return next;
}

export function hasSameTopLevelBlockOrder(
    left: CanvasBlock[],
    right: CanvasBlock[],
): boolean {
    if (left.length !== right.length) return false;

    for (let index = 0; index < left.length; index++) {
        if (left[index]?.id !== right[index]?.id) {
            return false;
        }
    }

    return true;
}

export function addBranchBlockById(
    blocks: CanvasBlock[],
    parentId: string,
    branch: BranchKey,
    child: CanvasBlock,
): CanvasBlock[] {
    return blocks.map((block) => {
        if (block.id === parentId) {
            const current = block[branch] ?? [];
            return {
                ...block,
                [branch]: [...current, child],
            };
        }

        return {
            ...block,
            ...(block.thenBlocks
                ? { thenBlocks: addBranchBlockById(block.thenBlocks, parentId, branch, child) }
                : {}),
            ...(block.elseBlocks
                ? { elseBlocks: addBranchBlockById(block.elseBlocks, parentId, branch, child) }
                : {}),
            ...(block.repeatBlocks
                ? { repeatBlocks: addBranchBlockById(block.repeatBlocks, parentId, branch, child) }
                : {}),
        };
    });
}

export function buildInputTemplate(inputId: string): string {
    return `{{input.${inputId}}}`;
}

export function extractInputBinding(value: string): string | null {
    const match = value.match(/^\{\{input\.([^}]+)\}\}$/);
    return match ? match[1] : null;
}

export function clearInputBindings(
    blocks: CanvasBlock[],
    inputId: string,
): CanvasBlock[] {
    const template = buildInputTemplate(inputId);

    return blocks.map((block) => ({
        ...block,
        params: block.params.map((param) =>
            param.value === template
                ? { ...param, value: "" }
                : param,
        ),
        ...(block.thenBlocks ? { thenBlocks: clearInputBindings(block.thenBlocks, inputId) } : {}),
        ...(block.elseBlocks ? { elseBlocks: clearInputBindings(block.elseBlocks, inputId) } : {}),
        ...(block.repeatBlocks ? { repeatBlocks: clearInputBindings(block.repeatBlocks, inputId) } : {}),
    }));
}

export function countInputBindings(
    blocks: CanvasBlock[],
    inputId: string,
): number {
    const template = buildInputTemplate(inputId);
    let count = 0;

    function visit(items: CanvasBlock[]) {
        for (const block of items) {
            count += block.params.filter((param) => param.value === template).length;
            if (block.thenBlocks) visit(block.thenBlocks);
            if (block.elseBlocks) visit(block.elseBlocks);
            if (block.repeatBlocks) visit(block.repeatBlocks);
        }
    }

    visit(blocks);
    return count;
}

function replaceTemplateRefRoot(
    value: string,
    previousRoot: string,
    nextRoot: string,
): string {
    return value.replace(/\{\{([^}]+)\}\}/g, (match, rawExpr: string) => {
        const expr = rawExpr.trim();
        if (expr === previousRoot) {
            return `{{${nextRoot}}}`;
        }
        if (expr.startsWith(`${previousRoot}.`)) {
            return `{{${nextRoot}${expr.slice(previousRoot.length)}}}`;
        }
        return match;
    });
}

function replaceInputRefRoot(
    value: string,
    previousRoot: string,
    nextRoot: string,
): string {
    if (value === previousRoot) {
        return nextRoot;
    }
    if (value.startsWith(`${previousRoot}.`)) {
        return `${nextRoot}${value.slice(previousRoot.length)}`;
    }
    return value;
}

function isConditionExpression(value: unknown): value is ConditionExpression {
    if (typeof value !== "object" || value === null) return false;
    const record = value as Record<string, unknown>;
    return typeof record["inputRef"] === "string" && typeof record["operator"] === "string";
}

function isConditionGroup(value: unknown): value is ConditionGroup {
    if (typeof value !== "object" || value === null) return false;
    const record = value as Record<string, unknown>;
    return (record["mode"] === "all" || record["mode"] === "any") && Array.isArray(record["conditions"]);
}

function replaceConditionRefs(
    condition: StructuredCondition,
    previousRoot: string,
    nextRoot: string,
): StructuredCondition {
    if (isConditionGroup(condition)) {
        return {
            ...condition,
            conditions: condition.conditions.map((item) =>
                replaceConditionRefs(item, previousRoot, nextRoot),
            ),
        };
    }

    return {
        ...condition,
        inputRef: replaceInputRefRoot(condition.inputRef, previousRoot, nextRoot),
        compareValue: replaceTemplateRefRoot(condition.compareValue, previousRoot, nextRoot),
    };
}

function replaceStructuredConditionString(
    value: string,
    previousRoot: string,
    nextRoot: string,
): string {
    try {
        const parsed: unknown = JSON.parse(value);
        if (isConditionExpression(parsed) || isConditionGroup(parsed)) {
            return JSON.stringify(replaceConditionRefs(parsed, previousRoot, nextRoot));
        }
    } catch {
        return value;
    }

    return value;
}

export function replaceVariableReferences(
    blocks: CanvasBlock[],
    previousRoot: string,
    nextRoot: string,
): CanvasBlock[] {
    return blocks.map((block) => ({
        ...block,
        params: block.params.map((param) => ({
            ...param,
            value: replaceTemplateRefRoot(param.value, previousRoot, nextRoot),
        })),
        ...(block.condition
            ? { condition: replaceStructuredConditionString(block.condition, previousRoot, nextRoot) }
            : {}),
        ...(block.thenBlocks
            ? { thenBlocks: replaceVariableReferences(block.thenBlocks, previousRoot, nextRoot) }
            : {}),
        ...(block.elseBlocks
            ? { elseBlocks: replaceVariableReferences(block.elseBlocks, previousRoot, nextRoot) }
            : {}),
        ...(block.repeatBlocks
            ? { repeatBlocks: replaceVariableReferences(block.repeatBlocks, previousRoot, nextRoot) }
            : {}),
    }));
}

export function replaceInputBindings(
    blocks: CanvasBlock[],
    inputDefaults: Record<string, string>,
): CanvasBlock[] {
    return blocks.map((block) => ({
        ...block,
        params: block.params.map((param) => {
            const inputId = extractInputBinding(param.value);
            if (!inputId) return param;
            return {
                ...param,
                value: inputDefaults[inputId] ?? "",
            };
        }),
        ...(block.thenBlocks
            ? { thenBlocks: replaceInputBindings(block.thenBlocks, inputDefaults) }
            : {}),
        ...(block.elseBlocks
            ? { elseBlocks: replaceInputBindings(block.elseBlocks, inputDefaults) }
            : {}),
        ...(block.repeatBlocks
            ? { repeatBlocks: replaceInputBindings(block.repeatBlocks, inputDefaults) }
            : {}),
    }));
}

// ---------------------------------------------------------------------------
// Error message sanitization — user-friendly messages
// ---------------------------------------------------------------------------

export function sanitizeErrorMessage(raw: string): string {
    const lower = raw.toLowerCase();

    if (lower.includes("not enough eth to cover swap gas")) {
        return raw.split("\n")[0].trim();
    }

    if (lower.includes("swap transaction simulation failed")) {
        return "Swap simulation failed — review the full error details below.";
    }

    if (lower.includes("gas estimation failed")) {
        if (lower.includes("84532") || lower.includes("base sepolia")) {
            return "Gas estimation failed on Base Sepolia — the route quoted successfully, but this testnet swap is not executable right now.";
        }
        return "Gas estimation failed — review the full error details below.";
    }

    if (lower.includes("user denied") || lower.includes("user rejected") || lower.includes("rejected the request")) {
        return "Transaction cancelled — you declined the request in your wallet.";
    }

    if (lower.includes("insufficient funds") || lower.includes("insufficient balance")) {
        return "Insufficient balance — your wallet doesn't have enough funds for this transaction.";
    }

    if (lower.includes("no uniswap v3 pool was found")) {
        return "No supported Uniswap v3 pool was found for this pair on the selected Base network.";
    }

    if (lower.includes("quoteexactinputsingle") || lower.includes("no quoted liquidity was available")) {
        return "Swap quote failed — this pair doesn't currently have a usable Uniswap v3 route on the selected Base network.";
    }

    if (lower.includes("batching support from the connected wallet")) {
        return "This action needs a wallet that supports batched Base calls.";
    }

    if (lower.includes("execution reverted") || lower.includes("revert")) {
        return "Transaction failed — the smart contract rejected this operation.";
    }

    if (lower.includes("gas") && (lower.includes("estimate") || lower.includes("exceed"))) {
        if (lower.includes("84532") || lower.includes("base sepolia")) {
            return "Gas estimation failed on Base Sepolia — the route quoted successfully, but this testnet swap is not executable right now.";
        }
        return "Gas estimation failed — the transaction may fail on-chain.";
    }

    if (lower.includes("network") || lower.includes("timeout") || lower.includes("disconnected") || lower.includes("fetch")) {
        return "Connection error — please check your network and try again.";
    }

    if (lower.includes("nonce")) {
        return "Transaction conflict — please wait for pending transactions to complete.";
    }

    if (lower.includes("chain") && (lower.includes("mismatch") || lower.includes("wrong"))) {
        return "Wrong network — please switch your wallet to Base or Base Sepolia.";
    }

    if (lower.includes("wallet not connected") || lower.includes("not connected")) {
        return "Wallet not connected — please connect your wallet first.";
    }

    const clean = raw.split("\n")[0].split("Details:")[0].trim();
    if (clean.length > 120) {
        return clean.slice(0, 117) + "…";
    }
    return clean || "An unexpected error occurred.";
}
