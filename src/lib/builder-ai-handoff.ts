import type { ShortcutInput } from "@/engine/types";
import { SKILL_PALETTE, type BlockCategory } from "@/lib/constants";
import type { BuilderBlock } from "@/lib/builder-shortcut";

export const BUILDER_AI_HANDOFF_STORAGE_KEY = "builder:ai-handoff:v1";
export const BUILDER_AI_HANDOFF_EVENT = "bavium:builder-ai-handoff";

type StepParamValue = string | number | boolean | null;
const MAX_HANDOFF_STEP_DEPTH = 8;
const MAX_HANDOFF_STEPS = 80;

interface HandoffStepCounter {
    count: number;
}

export interface ShortcutDraftStep {
    id?: string;
    skill: string;
    action: string;
    dependsOn?: string[];
    params: Record<string, StepParamValue>;
    confirm?: boolean;
    outputAs?: string;
    output?: { as?: string };
    onFailure?: BuilderBlock["onFailure"];
    condition?: string | Record<string, unknown>;
    thenSteps?: ShortcutDraftStep[];
    elseSteps?: ShortcutDraftStep[];
    repeatSteps?: ShortcutDraftStep[];
}

export interface ShortcutDraftOutput {
    success: boolean;
    name: string;
    stepCount: number;
    steps: ShortcutDraftStep[];
    message: string;
    inputs?: ShortcutInput[];
    category?: BlockCategory;
}

export interface BuilderAIHandoffV1 {
    version: 1;
    source: "ai-chat" | "run-restore";
    createdAt: string;
    draft: {
        shortcutName: string;
        blocks: BuilderBlock[];
        inputs: ShortcutInput[];
        shortcutCategoryOverride: BlockCategory | null;
    };
}

export type BuilderAIHandoffDraft = BuilderAIHandoffV1["draft"];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isShortcutDraftOutput(value: unknown): value is ShortcutDraftOutput {
    if (!isRecord(value)) return false;
    if (typeof value.success !== "boolean") return false;
    if (typeof value.name !== "string") return false;
    if (typeof value.stepCount !== "number") return false;
    if (typeof value.message !== "string") return false;
    if (!Array.isArray(value.steps)) return false;

    return value.steps.every((step) => (
        isRecord(step) &&
        typeof step.skill === "string" &&
        typeof step.action === "string" &&
        isRecord(step.params)
    ));
}

function readOutputAs(step: ShortcutDraftStep): string | undefined {
    if (typeof step.outputAs === "string" && step.outputAs.trim()) {
        return step.outputAs.trim();
    }

    if (typeof step.output?.as === "string" && step.output.as.trim()) {
        return step.output.as.trim();
    }

    return undefined;
}

function serializeCondition(condition: ShortcutDraftStep["condition"]): string | undefined {
    if (typeof condition === "string" && condition.trim()) {
        return condition.trim();
    }

    if (isRecord(condition)) {
        try {
            return JSON.stringify(condition);
        } catch {
            return undefined;
        }
    }

    return undefined;
}

function shortcutDraftStepsToBuilderBlocks(
    steps: ShortcutDraftStep[],
    idPrefix = "step",
    depth = 0,
    counter: HandoffStepCounter = { count: 0 },
): BuilderBlock[] {
    if (depth > MAX_HANDOFF_STEP_DEPTH) return [];

    const blocks: BuilderBlock[] = [];

    for (const [index, step] of steps.entries()) {
        if (counter.count >= MAX_HANDOFF_STEPS) break;
        counter.count += 1;

        const fallbackId = `${idPrefix}-${index + 1}`;
        const skillId = `${step.skill}.${step.action}`;
        const def = SKILL_PALETTE.find((skill) => skill.id === skillId);
        const outputAs = readOutputAs(step);
        const condition = serializeCondition(step.condition);

        blocks.push({
            id: typeof step.id === "string" && step.id.trim()
                ? step.id.trim()
                : fallbackId,
            skillId,
            label: def?.label ?? skillId,
            category: def?.category ?? "logic",
            params: Object.entries(step.params ?? {}).map(([key, value]) => ({
                key,
                value: value == null ? "" : String(value),
            })),
            confirm: step.confirm ?? def?.requiresConfirmation ?? false,
            ...(outputAs ? { outputAs } : {}),
            ...(step.onFailure ? { onFailure: step.onFailure } : {}),
            ...(condition ? { condition } : {}),
            ...(step.thenSteps?.length
                ? { thenBlocks: shortcutDraftStepsToBuilderBlocks(step.thenSteps, `${fallbackId}-then`, depth + 1, counter) }
                : {}),
            ...(step.elseSteps?.length
                ? { elseBlocks: shortcutDraftStepsToBuilderBlocks(step.elseSteps, `${fallbackId}-else`, depth + 1, counter) }
                : {}),
            ...(step.repeatSteps?.length
                ? { repeatBlocks: shortcutDraftStepsToBuilderBlocks(step.repeatSteps, `${fallbackId}-repeat`, depth + 1, counter) }
                : {}),
        });
    }

    return blocks;
}

export function createBuilderAIHandoff(data: ShortcutDraftOutput): BuilderAIHandoffV1 {
    return {
        version: 1,
        source: "ai-chat",
        createdAt: new Date().toISOString(),
        draft: {
            shortcutName: data.name,
            blocks: shortcutDraftStepsToBuilderBlocks(data.steps),
            inputs: Array.isArray(data.inputs) ? data.inputs : [],
            shortcutCategoryOverride: data.category ?? null,
        },
    };
}

export function createBuilderDraftHandoff(
    draft: BuilderAIHandoffDraft,
    source: BuilderAIHandoffV1["source"],
): BuilderAIHandoffV1 {
    return {
        version: 1,
        source,
        createdAt: new Date().toISOString(),
        draft,
    };
}

export function isBuilderAIHandoffV1(value: unknown): value is BuilderAIHandoffV1 {
    if (!isRecord(value)) return false;
    if (
        value.version !== 1 ||
        (value.source !== "ai-chat" && value.source !== "run-restore")
    ) {
        return false;
    }
    if (typeof value.createdAt !== "string") return false;
    if (!isRecord(value.draft)) return false;

    return (
        typeof value.draft.shortcutName === "string" &&
        Array.isArray(value.draft.blocks) &&
        Array.isArray(value.draft.inputs) &&
        (
            value.draft.shortcutCategoryOverride === null ||
            typeof value.draft.shortcutCategoryOverride === "string"
        )
    );
}

export function writeBuilderAIHandoff(data: ShortcutDraftOutput): boolean {
    return writeBuilderDraftHandoff(createBuilderAIHandoff(data));
}

export function writeBuilderDraftHandoff(handoff: BuilderAIHandoffV1): boolean {
    if (typeof window === "undefined") return false;

    try {
        window.sessionStorage.setItem(
            BUILDER_AI_HANDOFF_STORAGE_KEY,
            JSON.stringify(handoff),
        );
        window.dispatchEvent(new CustomEvent(BUILDER_AI_HANDOFF_EVENT));
        return true;
    } catch {
        return false;
    }
}
