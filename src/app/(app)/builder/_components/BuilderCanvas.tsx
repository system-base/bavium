"use client";

import { useMemo, type ReactNode } from "react";
import { Reorder, motion } from "framer-motion";
import {
    Plus,
    CheckCircle2,
    XCircle,
    Loader2,
    ChevronUp,
    ChevronDown,
    Trash2,
    ShieldCheck,
    Check,
    ExternalLink,
} from "lucide-react";
import {
    CATEGORY_META,
    SKILL_PALETTE,
    type SkillDefinition,
} from "@/lib/constants";
import type { ShortcutInput } from "@/engine/types";
import type { BuilderBlock as CanvasBlock } from "@/lib/builder-shortcut";
import { sanitizeErrorMessage, type BranchKey } from "../_lib/block-utils";
import { ParamViewRow, SkillParamEditor } from "./BuilderParamEditor";
import { SharePreparationCard } from "@/components/social/SharePreparationCard";
import type { SocialSharePreparationData } from "@/lib/social-share";
import { X402DiscoveryCard } from "@/components/x402/X402DiscoveryCard";
import type { X402DiscoverySummaryData } from "@/lib/x402-bazaar";

type BuilderTestStatus = "idle" | "running" | "success" | "error" | "signing" | "broadcasting";

interface BuilderStepTestResult {
    stepId: string;
    status: "success" | "error" | "skipped" | "pending" | "waiting_confirmation" | "waiting_input" | "waiting_signature";
    message?: string;
    detail?: string;
    txHash?: string;
    explorerUrl?: string;
    sharePreparation?: SocialSharePreparationData;
    x402Discovery?: X402DiscoverySummaryData;
}

interface BuilderCanvasProps {
    blocks: CanvasBlock[];
    flatBlocks: CanvasBlock[];
    editingBlockId: string | null;
    pendingBranchTarget: {
        parentId: string;
        branch: BranchKey;
    } | null;
    testResults: BuilderStepTestResult[];
    testStatus: BuilderTestStatus;
    testMessage: string | null;
    saveStatus: "idle" | "saving" | "saved" | "error";
    saveMessage: string | null;
    activeNetworkId?: string;
    shortcutInputs: ShortcutInput[];
    canvasRef: { current: HTMLDivElement | null };
    isDraggingRef: { current: boolean };
    onReorderBlocks: (blocks: CanvasBlock[]) => void;
    onSetEditingBlockId: (id: string | null) => void;
    onSetPendingBranchTarget: (target: { parentId: string; branch: BranchKey } | null) => void;
    onSetShowMobilePalette: (show: boolean) => void;
    onRemoveBlock: (id: string) => void;
    onMoveBlock: (id: string, direction: "up" | "down") => void;
    onUpdateBlockLabel: (id: string, label: string) => void;
    onToggleBlockConfirm: (id: string) => void;
    onUpdateBlockParam: (blockId: string, key: string, value: string) => void;
    onUpdateBlockOutputAs: (blockId: string, value: string) => void;
    onCreateShortcutInput: (draft: ShortcutInput) => string;
}

function findSkillDef(skillId: string): SkillDefinition | undefined {
    return SKILL_PALETTE.find((skill) => skill.id === skillId);
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`;
}

function isRepeatSkill(skillId: string): boolean {
    return skillId === "logic.repeat" || skillId === "logic.repeat_each";
}

function formatControlFlowSummary(block: CanvasBlock): string | null {
    if (block.skillId === "logic.if_else") {
        const thenCount = block.thenBlocks?.length ?? 0;
        const elseCount = block.elseBlocks?.length ?? 0;
        return `Then: ${pluralize(thenCount, "step")} • Else: ${pluralize(elseCount, "step")}`;
    }

    if (isRepeatSkill(block.skillId)) {
        const repeatCount = block.repeatBlocks?.length ?? 0;
        return `Loop: ${pluralize(repeatCount, "step")}`;
    }

    return null;
}

function getBranchLabel(branch: BranchKey): string {
    switch (branch) {
        case "thenBlocks":
            return "Then";
        case "elseBlocks":
            return "Else";
        case "repeatBlocks":
            return "Repeat";
    }
}

function getBranchHint(parentBlock: CanvasBlock, branch: BranchKey): string {
    if (branch === "thenBlocks") {
        return "Runs when the condition matches.";
    }

    if (branch === "elseBlocks") {
        return "Runs when the condition does not match.";
    }

    return parentBlock.skillId === "logic.repeat_each"
        ? "Runs once for each item in the list."
        : "Runs once per loop iteration.";
}

function getBranchEmptyLabel(parentBlock: CanvasBlock, branch: BranchKey): string {
    if (branch === "repeatBlocks") {
        return parentBlock.skillId === "logic.repeat_each"
            ? "No actions in repeat-with-each yet."
            : "No actions in repeat yet.";
    }

    return `No actions in ${getBranchLabel(branch).toLowerCase()} yet.`;
}

function shouldHideDefaultReadOnlyParam(
    block: CanvasBlock,
    param: { key: string; value: string },
): boolean {
    if (block.skillId === "swap.uniswap_prepare_swap" || block.skillId === "swap.uniswap_quote") {
        if (param.key === "feeTier" && param.value === "auto") {
            return true;
        }

        if (param.key === "slippageBps" && param.value === "auto") {
            return true;
        }
    }

    return false;
}

function getConfirmationBadgeLabel(block: CanvasBlock): string {
    if (block.skillId === "swap.uniswap_prepare_swap") {
        return "May need approval";
    }

    return "Requires signature";
}

function getEditingConfirmationLabel(block: CanvasBlock, requiresConfirmation: boolean): string {
    if (requiresConfirmation) {
        if (block.skillId === "swap.uniswap_prepare_swap") {
            return "Wallet signature required. Approval only appears when token allowance is missing.";
        }

        return "Wallet signature required for this action";
    }

    return block.confirm ? "Confirmation on" : "Confirmation off";
}

function getControlFlowPreview(block: CanvasBlock): {
    sections: Array<{
        key: string;
        label: string;
        hint: string;
        children: CanvasBlock[];
        emptyLabel: string;
    }>;
    footerLabel: string;
} | null {
    if (block.skillId === "logic.if_else") {
        return {
            sections: [
                {
                    key: "then",
                    label: "Then",
                    hint: "Runs when the condition matches.",
                    children: block.thenBlocks ?? [],
                    emptyLabel: "No actions in then.",
                },
                {
                    key: "else",
                    label: "Else",
                    hint: "Runs when the condition does not match.",
                    children: block.elseBlocks ?? [],
                    emptyLabel: "No actions in else.",
                },
            ],
            footerLabel: "End If",
        };
    }

    if (isRepeatSkill(block.skillId)) {
        return {
            sections: [
                {
                    key: "repeat",
                    label: block.skillId === "logic.repeat_each" ? "Repeat With Each" : "Repeat",
                    hint: block.skillId === "logic.repeat_each"
                        ? "Runs once for each item in the list."
                        : "Runs once per loop iteration.",
                    children: block.repeatBlocks ?? [],
                    emptyLabel: block.skillId === "logic.repeat_each"
                        ? "No actions in repeat-with-each."
                        : "No actions in repeat.",
                },
            ],
            footerLabel: block.skillId === "logic.repeat_each" ? "End Repeat With Each" : "End Repeat",
        };
    }

    return null;
}

function formatBuilderTestSummary(
    testStatus: BuilderTestStatus,
    testResults: BuilderStepTestResult[],
    totalVisibleBlocks: number,
    testMessage: string | null,
): string {
    const runningCount = testResults.filter((result) => result.status !== "pending").length;
    const successCount = testResults.filter((result) => result.status === "success").length;
    const errorCount = testResults.filter((result) => result.status === "error").length;
    const skippedCount = testResults.filter((result) => result.status === "skipped").length;
    const waitingCount = testResults.filter((result) =>
        result.status === "waiting_confirmation"
        || result.status === "waiting_input"
        || result.status === "waiting_signature",
    ).length;

    if (testStatus === "running") {
        return waitingCount > 0
            ? `Waiting on ${pluralize(waitingCount, "interactive step")} before the run can continue`
            : `Running visible steps — ${runningCount}/${Math.max(testResults.length, totalVisibleBlocks)} complete`;
    }

    if (testStatus === "signing") {
        return "Waiting for wallet signature before the shortcut continues";
    }

    if (testStatus === "broadcasting") {
        return "Submitting the signed transaction and continuing the shortcut";
    }

    if (testStatus === "success") {
        const skippedSuffix = skippedCount > 0 ? `, ${pluralize(skippedCount, "step")} skipped` : "";
        return `Run complete — ${pluralize(successCount, "step")} passed${skippedSuffix}`;
    }

    return testMessage
        ?? `Run finished with issues — ${pluralize(errorCount, "step")} failed, ${pluralize(successCount, "step")} passed, ${pluralize(skippedCount, "step")} skipped`;
}

function isEditingDescendant(
    block: CanvasBlock,
    editingId: string | null,
): boolean {
    if (!editingId) return false;

    const branches: CanvasBlock[][] = [
        block.thenBlocks ?? [],
        block.elseBlocks ?? [],
        block.repeatBlocks ?? [],
    ];

    for (const branch of branches) {
        for (const child of branch) {
            if (child.id === editingId) return true;
            if (isEditingDescendant(child, editingId)) return true;
        }
    }

    return false;
}

function TopLevelReorderItem({
    block,
    children,
    onDragStart,
    onDragEnd,
    dragEnabled,
}: {
    block: CanvasBlock;
    children: ReactNode;
    onDragStart: () => void;
    onDragEnd: () => void;
    dragEnabled: boolean;
}) {
    return (
        <Reorder.Item
            as="div"
            value={block}
            dragListener={dragEnabled}
            className="w-full relative shrink-0"
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
                layout: { type: "spring", bounce: 0.15, duration: 0.6 },
                default: { type: "spring", stiffness: 500, damping: 30 },
            }}
            whileTap={dragEnabled ? { scale: 1.01, boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)" } : undefined}
            whileDrag={dragEnabled ? { scale: 1.02, zIndex: 50, boxShadow: "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)" } : undefined}
        >
            {children}
        </Reorder.Item>
    );
}

export function BuilderCanvas({
    blocks,
    flatBlocks,
    editingBlockId,
    pendingBranchTarget,
    testResults,
    testStatus,
    testMessage,
    saveStatus,
    saveMessage,
    activeNetworkId,
    shortcutInputs,
    canvasRef,
    isDraggingRef,
    onReorderBlocks,
    onSetEditingBlockId,
    onSetPendingBranchTarget,
    onSetShowMobilePalette,
    onRemoveBlock,
    onMoveBlock,
    onUpdateBlockLabel,
    onToggleBlockConfirm,
    onUpdateBlockParam,
    onUpdateBlockOutputAs,
    onCreateShortcutInput,
}: BuilderCanvasProps) {
    const stepResultById = useMemo(
        () => new Map(testResults.map((result) => [result.stepId, result])),
        [testResults],
    );
    const executedStepIds = useMemo(
        () => new Set(testResults.map((result) => result.stepId)),
        [testResults],
    );
    const flatIndexById = useMemo(
        () => new Map(flatBlocks.map((block, index) => [block.id, index])),
        [flatBlocks],
    );
    const latestSharePreparation = useMemo(() => {
        for (let index = testResults.length - 1; index >= 0; index -= 1) {
            const sharePreparation = testResults[index]?.sharePreparation;
            if (sharePreparation) {
                return sharePreparation;
            }
        }

        return null;
    }, [testResults]);
    const latestX402Discovery = useMemo(() => {
        for (let index = testResults.length - 1; index >= 0; index -= 1) {
            const x402Discovery = testResults[index]?.x402Discovery;
            if (x402Discovery) {
                return x402Discovery;
            }
        }

        return null;
    }, [testResults]);

    function renderBranchSection(
        parentBlock: CanvasBlock,
        branch: BranchKey,
        depth: number,
    ) {
        const children = parentBlock[branch] ?? [];
        const branchLabel = getBranchLabel(branch);
        const branchHint = getBranchHint(parentBlock, branch);
        const isTargeted =
            pendingBranchTarget?.parentId === parentBlock.id &&
            pendingBranchTarget.branch === branch;

        return (
            <div className="mt-3 rounded-xl border border-border-default bg-primary/40 p-3 shadow-[0_1px_4px_rgba(0,0,0,0.2)]">
                <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-secondary">
                            {branchLabel}
                        </div>
                        <p className="mt-1 text-xs text-fg-muted">
                            {branchHint}
                        </p>
                    </div>
                    <button
                        type="button"
                        className={`px-2 py-1 text-xs rounded-md border transition-colors ${isTargeted
                            ? "border-brand bg-brand-subtle text-brand-light"
                            : "border-border-subtle bg-tertiary text-fg-secondary hover:border-brand hover:text-brand-light"
                            }`}
                        onClick={(event) => {
                            event.stopPropagation();
                            onSetPendingBranchTarget({
                                parentId: parentBlock.id,
                                branch,
                            });
                            onSetShowMobilePalette(true);
                        }}
                    >
                        {isTargeted ? "Select action…" : `Add to ${branchLabel}`}
                    </button>
                </div>

                {children.length > 0 ? (
                    <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-secondary/45 p-3">
                        {children.map((child, childIndex) =>
                            renderBlockCard(child, childIndex, depth + 1, children.length),
                        )}
                    </div>
                ) : (
                    <div className="rounded-lg border border-dashed border-border-default bg-secondary/30 px-3 py-3 text-xs text-fg-muted">
                        {getBranchEmptyLabel(parentBlock, branch)}
                    </div>
                )}
            </div>
        );
    }

    function renderBranchPreview(
        parentBlock: CanvasBlock,
        depth: number,
    ) {
        const preview = getControlFlowPreview(parentBlock);
        if (!preview) return null;
        const branchBoxes = preview.sections;

        return (
            <div className="mt-3 flex flex-col gap-3" style={{ marginLeft: (depth + 1) * 12 }}>
                {branchBoxes.map((branchBox) => {
                    const branchHasResults = branchBox.children.some((child) =>
                        executedStepIds.has(child.id),
                    );
                    const otherBranchHasResults = branchBoxes
                        .filter((branchCandidate) => branchCandidate.key !== branchBox.key)
                        .some((branchCandidate) => branchCandidate.children.some((child) =>
                            executedStepIds.has(child.id),
                        ));
                    const isDimmed = testResults.length > 0
                        && !branchHasResults
                        && (otherBranchHasResults || branchBox.children.length === 0);
                    const isExecuted = testResults.length > 0 && branchHasResults;

                    return (
                        <div
                            key={branchBox.key}
                            className={`rounded-xl border p-3 transition-all ${isExecuted
                                ? "border-status-success/30 bg-status-success/5 shadow-[0_0_8px_rgba(16,185,129,0.08)]"
                                : isDimmed
                                    ? "border-border-subtle/50 bg-primary/20 opacity-50"
                                    : "border-border-default bg-primary/35 shadow-[0_1px_4px_rgba(0,0,0,0.18)]"
                                }`}
                        >
                            <div className="mb-3 flex items-center justify-between">
                                <div>
                                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-secondary">
                                        {branchBox.label}
                                    </div>
                                    <p className="mt-1 text-xs text-fg-muted">
                                        {branchBox.hint}
                                    </p>
                                </div>
                                {isExecuted && (
                                    <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-status-success/15 text-status-success">
                                        Executed
                                    </span>
                                )}
                                {isDimmed && (
                                    <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-tertiary text-fg-muted">
                                        Skipped
                                    </span>
                                )}
                            </div>

                            {branchBox.children.length > 0 ? (
                                <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-secondary/45 p-3">
                                    {branchBox.children.map((child, childIndex) =>
                                        renderBlockCard(child, childIndex, depth + 1, branchBox.children.length),
                                    )}
                                </div>
                            ) : (
                                <div className="rounded-lg border border-dashed border-border-default bg-secondary/25 px-3 py-3 text-xs text-fg-muted">
                                    {branchBox.emptyLabel}
                                </div>
                            )}
                        </div>
                    );
                })}

                <div className="rounded-xl border border-border-subtle bg-primary/35 px-3 py-2 text-sm font-semibold text-fg-secondary">
                    {preview.footerLabel}
                </div>
            </div>
        );
    }

    function renderBlockCard(
        block: CanvasBlock,
        index: number,
        depth = 0,
        siblingCount = blocks.length,
    ): ReactNode {
        const meta = CATEGORY_META[block.category];
        const isEditing = editingBlockId === block.id;
        const result = stepResultById.get(block.id);
        const skillDef = findSkillDef(block.skillId);
        const flatIndex = flatIndexById.get(block.id) ?? -1;
        const branchSummary = formatControlFlowSummary(block);
        const isTopLevelDraggable = depth === 0 && !isEditing;
        const requiresConfirmation = Boolean(skillDef?.requiresConfirmation);
        const showConfirmationControl = requiresConfirmation || block.confirm;

        return (
            <div key={block.id} className="w-full" style={{ marginLeft: depth === 0 ? 0 : depth * 12 }}>
                <motion.div
                    layout="position"
                    className={`group/block relative w-full p-4 sm:pr-5 bg-secondary border rounded-[var(--radius-lg)] animate-block-appear ${isEditing
                        ? "border-border-strong shadow-[0_2px_8px_rgba(0,0,0,0.35)] cursor-default transition-colors"
                        : `border-border-subtle hover:border-border-default hover:shadow-[0_2px_6px_rgba(0,0,0,0.3)] ${isTopLevelDraggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} transition-colors`
                        }`}
                    style={{
                        touchAction: isTopLevelDraggable ? "none" : "auto",
                        userSelect: isEditing ? "auto" : "none",
                        WebkitUserSelect: isEditing ? "auto" : "none",
                    }}
                    onClick={() => {
                        if (isDraggingRef.current) return;
                        onSetEditingBlockId(isEditing ? null : block.id);
                    }}
                >
                    <div
                        className={`flex items-center justify-between mb-2 ${isEditing ? "" : "hover:bg-black/5 dark:hover:bg-white/5 rounded-md -mx-2 px-2 py-1 transition-colors"}`}
                    >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span
                                className="flex items-center justify-center w-[22px] h-[22px] text-[13px] font-semibold rounded-full shrink-0"
                                style={
                                    result?.status === "success"
                                        ? { backgroundColor: "rgba(16,185,129,0.15)", color: "var(--color-status-success)" }
                                        : result?.status === "error"
                                            ? { backgroundColor: "rgba(239,68,68,0.15)", color: "var(--color-status-error)" }
                                            : result?.status === "waiting_confirmation"
                                                ? { backgroundColor: "rgba(251,146,60,0.15)", color: "#fb923c" }
                                                : result?.status === "waiting_signature"
                                                    ? { backgroundColor: "rgba(251,146,60,0.15)", color: "#fb923c" }
                                                : result?.status === "waiting_input"
                                                    ? { backgroundColor: "var(--color-brand-subtle)", color: "var(--color-brand-light)" }
                                            : result?.status === "pending"
                                                ? { backgroundColor: "var(--color-brand-subtle)", color: "var(--color-brand-light)" }
                                                : {
                                                    backgroundColor: `color-mix(in srgb, ${meta.cssColor} 14%, transparent)`,
                                                    color: meta.cssColor,
                                                }
                                }
                            >
                                {result?.status === "success" ? (
                                    <CheckCircle2 size={13} />
                                ) : result?.status === "error" ? (
                                    <XCircle size={13} />
                                ) : result?.status === "waiting_confirmation" ? (
                                    <ShieldCheck size={13} />
                                ) : result?.status === "waiting_signature" ? (
                                    <ShieldCheck size={13} />
                                ) : result?.status === "waiting_input" ? (
                                    <Loader2 size={13} className="animate-spin" />
                                ) : result?.status === "pending" ? (
                                    <Loader2 size={13} className="animate-spin" />
                                ) : (
                                    flatIndex >= 0 ? flatIndex + 1 : index + 1
                                )}
                            </span>

                            {isEditing ? (
                                <input
                                    type="text"
                                    className="flex-1 text-base font-semibold text-fg bg-transparent border-b border-border-default outline-none px-0 py-0.5 focus:border-border-strong transition-colors"
                                    value={block.label}
                                    onChange={(event) => onUpdateBlockLabel(block.id, event.target.value)}
                                    onClick={(event) => event.stopPropagation()}
                                />
                            ) : (
                                <span className="text-base font-semibold text-fg truncate">
                                    {block.label}
                                </span>
                            )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0 ml-2">
                            {(() => {
                                const isWrite = skillDef?.requiresConfirmation || block.confirm;
                                const isLogic = block.category === "logic";
                                const isRead = !isWrite && !isLogic;
                                if (isWrite) {
                                    return (
                                        <span className="text-[10px] font-semibold tracking-wider uppercase hidden sm:inline px-1.5 py-0.5 rounded bg-[rgba(251,146,60,0.12)] text-[#fb923c]">
                                            Write
                                        </span>
                                    );
                                }
                                if (isRead) {
                                    return (
                                        <span className="text-[10px] font-semibold tracking-wider uppercase hidden sm:inline px-1.5 py-0.5 rounded bg-[rgba(16,185,129,0.12)] text-[#10b981]">
                                            Read
                                        </span>
                                    );
                                }
                                return null;
                            })()}
                            <span
                                className="text-[11px] font-semibold tracking-wider uppercase hidden sm:inline px-1.5 py-0.5 rounded"
                                style={{
                                    color: meta.cssColor,
                                    backgroundColor: `color-mix(in srgb, ${meta.cssColor} 12%, transparent)`,
                                }}
                            >
                                {meta.label}
                            </span>

                            <button
                                type="button"
                                className="flex items-center justify-center w-5 h-5 rounded text-fg-muted hover:text-fg transition-colors disabled:opacity-40 disabled:hover:text-fg-muted"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onMoveBlock(block.id, "up");
                                }}
                                disabled={index === 0}
                                aria-label="Move up"
                            >
                                <ChevronUp size={12} />
                            </button>
                            <button
                                type="button"
                                className="flex items-center justify-center w-5 h-5 rounded text-fg-muted hover:text-fg transition-colors disabled:opacity-40 disabled:hover:text-fg-muted"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onMoveBlock(block.id, "down");
                                }}
                                disabled={index === siblingCount - 1}
                                aria-label="Move down"
                            >
                                <ChevronDown size={12} />
                            </button>

                            <button
                                type="button"
                                className="flex items-center justify-center w-5 h-5 rounded text-fg-muted hover:text-status-error transition-colors"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onRemoveBlock(block.id);
                                }}
                                aria-label={`Remove ${block.label}`}
                            >
                                <Trash2 size={12} />
                            </button>
                        </div>
                    </div>

                    {isEditing && skillDef && (
                        <p className="text-xs text-fg-muted mb-2 truncate">
                            {skillDef.description}
                        </p>
                    )}

                    {!isEditing && branchSummary && (
                        <div className="mb-2 inline-flex items-center gap-1 rounded-md border border-brand/20 bg-brand-subtle px-2 py-0.5 text-xs text-brand-light">
                            Branches: {branchSummary}
                        </div>
                    )}

                    {isEditing && skillDef && (
                        <div
                            className="mt-3 pt-3 border-t border-border-subtle"
                            onClick={(event) => event.stopPropagation()}
                        >
                            <SkillParamEditor
                                block={block}
                                onUpdateParam={(key, value) => onUpdateBlockParam(block.id, key, value)}
                                onUpdateOutputAs={(value) => onUpdateBlockOutputAs(block.id, value)}
                                allBlocks={blocks}
                                currentBlockId={block.id}
                                networkId={activeNetworkId}
                                shortcutInputs={shortcutInputs}
                                onCreateShortcutInput={onCreateShortcutInput}
                            />

                            {(block.skillId === "logic.if_else" || isRepeatSkill(block.skillId)) && (
                                <>
                                    {block.skillId === "logic.if_else" ? (
                                        <>
                                            {renderBranchSection(block, "thenBlocks", depth)}
                                            {renderBranchSection(block, "elseBlocks", depth)}
                                        </>
                                    ) : (
                                        renderBranchSection(block, "repeatBlocks", depth)
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {!isEditing && block.params.length > 0 && (
                        <div className="flex flex-col gap-1">
                            {block.params
                                .filter((param) => !shouldHideDefaultReadOnlyParam(block, param))
                                .filter((param) => param.value !== "")
                                .map((param) => (
                                    <ParamViewRow
                                        key={param.key}
                                        param={param}
                                        allBlocks={flatBlocks}
                                        shortcutInputs={shortcutInputs}
                                        paramLabel={skillDef?.params.find((paramDef) => paramDef.key === param.key)?.label}
                                    />
                                ))}
                        </div>
                    )}

                    {!isEditing && block.outputAs && (
                        <div className="mt-2 inline-flex items-center gap-1 rounded-md border border-brand/20 bg-brand-subtle px-2 py-0.5 text-xs text-brand-light">
                            Variable: {block.outputAs}
                        </div>
                    )}

                    {!isEditing && (block.skillId === "logic.if_else" || isRepeatSkill(block.skillId)) && (
                        renderBranchPreview(block, depth)
                    )}

                    {isEditing && (
                        <div
                            className="mt-3 flex items-center justify-between border-t border-border-subtle pt-2"
                            onClick={(event) => event.stopPropagation()}
                        >
                            {showConfirmationControl ? (
                                requiresConfirmation ? (
                                    <div className="inline-flex items-center gap-1 text-sm text-fg-secondary">
                                        <ShieldCheck size={12} />
                                        {getEditingConfirmationLabel(block, true)}
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        className={`flex items-center gap-1 text-sm transition-colors ${block.confirm
                                            ? "text-fg"
                                            : "text-fg-muted hover:text-fg"
                                            }`}
                                        onClick={() => onToggleBlockConfirm(block.id)}
                                    >
                                        <ShieldCheck size={12} />
                                        {getEditingConfirmationLabel(block, false)}
                                    </button>
                                )
                            ) : (
                                <div />
                            )}
                            <button
                                type="button"
                                className="flex items-center gap-1.5 px-3 py-1 text-sm font-medium text-brand-light bg-brand-subtle hover:bg-brand/20 rounded-md transition-colors"
                                onClick={() => {
                                    onSetEditingBlockId(null);
                                    if (pendingBranchTarget?.parentId === block.id) {
                                        onSetPendingBranchTarget(null);
                                    }
                                }}
                            >
                                <Check size={14} />
                                Done
                            </button>
                        </div>
                    )}

                    {!isEditing && showConfirmationControl && (
                        <div className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 text-sm font-semibold text-fg-secondary bg-tertiary border border-border-subtle rounded-md w-fit">
                            <ShieldCheck size={12} />
                            {getConfirmationBadgeLabel(block)}
                        </div>
                    )}

                    {result?.message && (
                        <div
                            className={`mt-2 px-2.5 py-1.5 text-sm rounded-md flex items-start gap-2 ${result.status === "success"
                                ? "text-status-success bg-status-success/10"
                                : result.status === "waiting_confirmation"
                                    ? "text-[#fb923c] bg-[rgba(251,146,60,0.10)]"
                                    : result.status === "waiting_signature"
                                        ? "text-[#fb923c] bg-[rgba(251,146,60,0.10)]"
                                    : result.status === "waiting_input"
                                        ? "text-brand-light bg-brand-subtle"
                                        : "text-status-error bg-status-error/10"
                                }`}
                        >
                            {result.status === "success" ? (
                                <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                            ) : result.status === "waiting_confirmation" ? (
                                <ShieldCheck size={14} className="shrink-0 mt-0.5" />
                            ) : result.status === "waiting_signature" ? (
                                <ShieldCheck size={14} className="shrink-0 mt-0.5" />
                            ) : result.status === "waiting_input" ? (
                                <Loader2 size={14} className="shrink-0 mt-0.5 animate-spin" />
                            ) : (
                                <XCircle size={14} className="shrink-0 mt-0.5" />
                            )}
                            <span className="min-w-0">
                                {result.message}
                                {result.detail && (
                                    <span className="mt-0.5 block text-xs text-current/80">
                                        {result.detail}
                                    </span>
                                )}
                                {result.txHash && (
                                    <span className="mt-0.5 block text-xs font-mono text-current/80 break-all">
                                        {result.txHash}
                                    </span>
                                )}
                                {result.explorerUrl && (
                                    <a
                                        href={result.explorerUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="mt-1 inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2 hover:opacity-80"
                                        onClick={(event) => event.stopPropagation()}
                                    >
                                        View on explorer
                                        <ExternalLink size={12} />
                                    </a>
                                )}
                                {result.sharePreparation && (
                                    <SharePreparationCard
                                        data={result.sharePreparation}
                                        tone={result.status === "success" ? "success" : "default"}
                                    />
                                )}
                                {result.x402Discovery && (
                                    <X402DiscoveryCard
                                        data={result.x402Discovery}
                                        tone={result.status === "success" ? "success" : "default"}
                                    />
                                )}
                            </span>
                        </div>
                    )}
                </motion.div>
            </div>
        );
    }

    return (
        <div
            ref={canvasRef}
            className="flex-1 flex flex-col items-center p-4 sm:p-8 overflow-y-auto bg-primary bg-[radial-gradient(circle,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:24px_24px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
            <div className="flex flex-col items-center w-full max-w-full sm:max-w-[640px]">
                <Reorder.Group values={blocks} onReorder={onReorderBlocks} axis="y" className="w-full m-0 p-0 flex flex-col list-none gap-5">
                    {blocks.map((block, index) => {
                        const isEditingSelfOrChild =
                            editingBlockId === block.id ||
                            isEditingDescendant(block, editingBlockId);

                        return (
                            <TopLevelReorderItem
                                key={block.id}
                                block={block}
                                dragEnabled={!isEditingSelfOrChild}
                                onDragStart={() => { isDraggingRef.current = true; }}
                                onDragEnd={() => {
                                    setTimeout(() => { isDraggingRef.current = false; }, 50);
                                }}
                            >
                                {renderBlockCard(block, index, 0, blocks.length)}
                            </TopLevelReorderItem>
                        );
                    })}
                </Reorder.Group>

                {blocks.length > 0 && (
                    <div className="flex flex-col items-center h-7">
                        <div className="w-[5px] h-[5px] rounded-full bg-border-strong shrink-0" />
                        <div className="w-px flex-1 bg-border-default" />
                        <div className="w-[5px] h-[5px] rounded-full bg-border-strong shrink-0" />
                    </div>
                )}

                <button
                    type="button"
                    className="w-full h-11 flex sm:hidden items-center justify-center gap-2 text-base font-semibold text-fg-muted border border-dashed border-border-default rounded-lg hover:border-brand hover:text-brand-light hover:bg-brand-subtle transition-all"
                    onClick={() => onSetShowMobilePalette(true)}
                >
                    <Plus size={16} />
                    Add a step
                </button>

                <div className="w-full h-11 hidden sm:flex items-center justify-center gap-2 text-base font-semibold text-fg-muted border border-dashed border-border-default rounded-lg">
                    <Plus size={16} />
                    Add blocks from the right panel.
                </div>

                {testStatus !== "idle" && (
                    <div
                        className={`w-full mt-4 p-3 rounded-lg border text-sm ${testStatus === "success"
                            ? "bg-status-success/10 border-status-success/20 text-status-success"
                            : testStatus === "error"
                                ? "bg-status-error/10 border-status-error/20 text-status-error"
                                : "bg-brand-subtle border-brand/15 text-brand-light"
                            }`}
                    >
                        {formatBuilderTestSummary(testStatus, testResults, blocks.length, testMessage)}
                    </div>
                )}

                {latestSharePreparation && testStatus !== "idle" && (
                    <div className="w-full mt-3">
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
                            Latest Share Output
                        </div>
                        <SharePreparationCard
                            data={latestSharePreparation}
                            tone={testStatus === "success" ? "success" : "default"}
                        />
                    </div>
                )}

                {latestX402Discovery && testStatus !== "idle" && (
                    <div className="w-full mt-3">
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
                            Latest x402 Discovery
                        </div>
                        <X402DiscoveryCard
                            data={latestX402Discovery}
                            tone={testStatus === "success" ? "success" : "default"}
                        />
                    </div>
                )}

                {saveMessage && saveStatus !== "idle" && (
                    <div
                        className={`w-full mt-3 p-3 rounded-lg border text-sm ${saveStatus === "saved"
                            ? "bg-status-success/10 border-status-success/20 text-status-success"
                            : saveStatus === "error"
                                ? "bg-status-error/10 border-status-error/20 text-status-error"
                                : "bg-brand-subtle border-brand/15 text-brand-light"
                            }`}
                    >
                        {saveStatus === "saving" ? "Saving shortcut…" : saveMessage}
                    </div>
                )}
            </div>
        </div>
    );
}
