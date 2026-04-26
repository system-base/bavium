import type {
    FailureStrategy,
    Shortcut,
    ShortcutInput,
    ShortcutStep,
} from "@/engine/types";
import {
    type BlockCategory,
    SKILL_PALETTE,
} from "@/lib/constants";

export interface BuilderBlockParam {
    key: string;
    value: string;
}

export interface BuilderBlock {
    id: string;
    skillId: string;
    label: string;
    category: BlockCategory;
    params: BuilderBlockParam[];
    condition?: string;
    onFailure?: FailureStrategy;
    confirm?: boolean;
    outputAs?: string;
    thenBlocks?: BuilderBlock[];
    elseBlocks?: BuilderBlock[];
    repeatBlocks?: BuilderBlock[];
}

export interface BuilderRunBlock {
    id: string;
    skillId: string;
    params: BuilderBlockParam[];
    condition?: string;
    onFailure?: FailureStrategy;
    confirm?: boolean;
    outputAs?: string;
    thenBlocks?: BuilderRunBlock[];
    elseBlocks?: BuilderRunBlock[];
    repeatBlocks?: BuilderRunBlock[];
}

type BuilderSerializableBlock =
    Pick<
        BuilderBlock,
        | "id"
        | "skillId"
        | "params"
        | "condition"
        | "onFailure"
        | "confirm"
        | "outputAs"
    > & {
        thenBlocks?: BuilderSerializableBlock[];
        elseBlocks?: BuilderSerializableBlock[];
        repeatBlocks?: BuilderSerializableBlock[];
    };

function findSkillDef(skillId: string) {
    return SKILL_PALETTE.find((skill) => skill.id === skillId);
}

function requiresConfirmation(skillId: string): boolean {
    return findSkillDef(skillId)?.requiresConfirmation === true;
}

function visitBlocks<T extends {
    skillId: string;
    category?: BlockCategory;
    thenBlocks?: T[];
    elseBlocks?: T[];
    repeatBlocks?: T[];
}>(
    blocks: T[],
    visitor: (block: T, index: number) => void,
): void {
    let flatIndex = 0;

    function walk(items: T[]) {
        for (const item of items) {
            visitor(item, flatIndex);
            flatIndex += 1;

            if (item.thenBlocks?.length) {
                walk(item.thenBlocks);
            }
            if (item.elseBlocks?.length) {
                walk(item.elseBlocks);
            }
            if (item.repeatBlocks?.length) {
                walk(item.repeatBlocks);
            }
        }
    }

    walk(blocks);
}

export function inferShortcutCategoryFromBlocks<T extends {
    skillId: string;
    category?: BlockCategory;
    confirm?: boolean;
    thenBlocks?: T[];
    elseBlocks?: T[];
    repeatBlocks?: T[];
}>(
    blocks: T[],
): BlockCategory {
    if (blocks.length === 0) {
        return "logic";
    }

    const scores = new Map<BlockCategory, number>();
    const lastSeenIndex = new Map<BlockCategory, number>();
    let lastNonLogicCategory: BlockCategory | null = null;

    visitBlocks(blocks, (block, index) => {
        const resolvedCategory =
            block.category ??
            findSkillDef(block.skillId)?.category ??
            "logic";

        if (resolvedCategory === "logic") {
            return;
        }

        const skillDef = findSkillDef(block.skillId);
        let score = 1;

        if (skillDef?.tier === "core") {
            score += 0.5;
        }

        if (block.confirm || skillDef?.requiresConfirmation) {
            score += 3;
        }

        scores.set(resolvedCategory, (scores.get(resolvedCategory) ?? 0) + score);
        lastSeenIndex.set(resolvedCategory, index);
        lastNonLogicCategory = resolvedCategory;
    });

    if (scores.size === 0) {
        return (
            blocks[0]?.category ??
            findSkillDef(blocks[0]?.skillId ?? "")?.category ??
            "logic"
        );
    }

    if (lastNonLogicCategory) {
        scores.set(
            lastNonLogicCategory,
            (scores.get(lastNonLogicCategory) ?? 0) + 1.5,
        );
    }

    let bestCategory: BlockCategory = lastNonLogicCategory ?? "logic";
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestLastIndex = -1;

    for (const [category, score] of scores.entries()) {
        const categoryLastIndex = lastSeenIndex.get(category) ?? -1;
        if (
            score > bestScore ||
            (score === bestScore && categoryLastIndex > bestLastIndex)
        ) {
            bestCategory = category;
            bestScore = score;
            bestLastIndex = categoryLastIndex;
        }
    }

    return bestCategory;
}

function parseSkillId(skillId: string): { skill: string; action: string } {
    const dotIdx = skillId.lastIndexOf(".");
    return {
        skill: dotIdx > -1 ? skillId.slice(0, dotIdx) : skillId,
        action: dotIdx > -1 ? skillId.slice(dotIdx + 1) : "execute",
    };
}

function normalizeBuilderParamValue(
    skillId: string,
    key: string,
    value: string,
): unknown {
    const paramDef = findSkillDef(skillId)?.params.find((param) => param.key === key);
    if (paramDef?.type === "boolean") {
        if (value === "true") return true;
        if (value === "false") return false;
    }
    return value;
}

function stringifyCondition(
    condition: ShortcutStep["condition"],
): string | undefined {
    if (condition === undefined) return undefined;
    return typeof condition === "string"
        ? condition
        : JSON.stringify(condition);
}

export function builderBlockToShortcutStep(
    block: BuilderSerializableBlock,
): ShortcutStep {
    const { skill, action } = parseSkillId(block.skillId);
    const params: Record<string, unknown> = {};

    for (const param of block.params) {
        params[param.key] = normalizeBuilderParamValue(block.skillId, param.key, param.value);
    }

    return {
        id: block.id,
        skill,
        action,
        params,
        ...(block.condition ? { condition: block.condition } : {}),
        ...(block.onFailure ? { onFailure: block.onFailure } : {}),
        ...(block.confirm || requiresConfirmation(block.skillId) ? { confirm: true } : {}),
        ...(block.outputAs ? { output: { as: block.outputAs } } : {}),
        ...(block.thenBlocks
            ? { thenSteps: block.thenBlocks.map((child) => builderBlockToShortcutStep(child)) }
            : {}),
        ...(block.elseBlocks
            ? { elseSteps: block.elseBlocks.map((child) => builderBlockToShortcutStep(child)) }
            : {}),
        ...(block.repeatBlocks
            ? { repeatSteps: block.repeatBlocks.map((child) => builderBlockToShortcutStep(child)) }
            : {}),
    };
}

export function builderBlocksToShortcut(
    blocks: BuilderSerializableBlock[],
    options: {
        id?: string;
        name?: string;
        description?: string;
        category?: BlockCategory;
        inputs?: ShortcutInput[];
        version?: string;
    } = {},
): Shortcut {
    const now = new Date().toISOString();
    const resolvedCategory = options.category ?? inferShortcutCategoryFromBlocks(blocks);

    return {
        id: options.id ?? `shortcut-${Date.now()}`,
        name: options.name ?? "Builder Shortcut",
        description: options.description ?? "",
        version: options.version ?? "1.0.0",
        author: "",
        icon: "",
        color: "",
        category: resolvedCategory,
        tags: [],
        inputs: options.inputs ?? [],
        steps: blocks.map((block) => builderBlockToShortcutStep(block)),
        createdAt: now,
        updatedAt: now,
    };
}

export function builderBlocksToRunBlocks(
    blocks: BuilderBlock[],
): BuilderRunBlock[] {
    return blocks.map((block) => ({
        id: block.id,
        skillId: block.skillId,
        params: block.params,
        ...(block.condition ? { condition: block.condition } : {}),
        ...(block.onFailure ? { onFailure: block.onFailure } : {}),
        ...(block.confirm || requiresConfirmation(block.skillId) ? { confirm: true } : {}),
        ...(block.outputAs ? { outputAs: block.outputAs } : {}),
        ...(block.thenBlocks ? { thenBlocks: builderBlocksToRunBlocks(block.thenBlocks) } : {}),
        ...(block.elseBlocks ? { elseBlocks: builderBlocksToRunBlocks(block.elseBlocks) } : {}),
        ...(block.repeatBlocks ? { repeatBlocks: builderBlocksToRunBlocks(block.repeatBlocks) } : {}),
    }));
}

export function shortcutStepToBuilderBlock(
    step: ShortcutStep,
    index: number,
    shortcutCategory: BlockCategory,
): BuilderBlock {
    const skillId = `${step.skill}.${step.action}`;
    const skillDef = findSkillDef(skillId);
    const category = skillDef?.category ?? shortcutCategory;

    return {
        id: step.id || `step-${index + 1}`,
        skillId,
        label: skillDef?.label ?? skillId,
        category,
        params: Object.entries(step.params ?? {}).map(([key, value]) => ({
            key,
            value: typeof value === "string" ? value : JSON.stringify(value),
        })),
        ...(step.confirm || skillDef?.requiresConfirmation ? { confirm: true } : {}),
        ...(step.onFailure ? { onFailure: step.onFailure } : {}),
        ...(step.output?.as ? { outputAs: step.output.as } : {}),
        ...(step.condition !== undefined
            ? { condition: stringifyCondition(step.condition) }
            : {}),
        ...(step.thenSteps
            ? { thenBlocks: step.thenSteps.map((child, childIndex) => shortcutStepToBuilderBlock(child, childIndex, category)) }
            : {}),
        ...(step.elseSteps
            ? { elseBlocks: step.elseSteps.map((child, childIndex) => shortcutStepToBuilderBlock(child, childIndex, category)) }
            : {}),
        ...(step.repeatSteps
            ? { repeatBlocks: step.repeatSteps.map((child, childIndex) => shortcutStepToBuilderBlock(child, childIndex, category)) }
            : {}),
    };
}

export function shortcutToBuilderBlocks(shortcut: Pick<Shortcut, "category" | "steps">): BuilderBlock[] {
    return shortcut.steps.map((step, index) =>
        shortcutStepToBuilderBlock(step, index, shortcut.category),
    );
}
