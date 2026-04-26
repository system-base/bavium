import type { ShortcutInput } from "@/engine/types";
import type { BuilderBlock, BuilderBlockParam } from "@/lib/builder-shortcut";
import {
    SKILL_PALETTE,
    type BlockCategory,
    type SkillDefinition,
} from "@/lib/constants";
import { isBlockCategoryValue } from "@/lib/block-categories";

export const BUILDER_AI_CONTEXT_VERSION = 1;

const MAX_CONTEXT_BLOCKS = 80;
const MAX_CONTEXT_DEPTH = 6;
const MAX_CONTEXT_INPUTS = 24;

const INPUT_TYPES = new Set([
    "address",
    "amount",
    "text",
    "token",
    "boolean",
    "select",
    "number",
]);

export interface BuilderAIContextSnapshot {
    version: typeof BUILDER_AI_CONTEXT_VERSION;
    page: "builder";
    shortcutName: string;
    category: BlockCategory | null;
    blocks: BuilderBlock[];
    inputs: ShortcutInput[];
    updatedAt: string;
}

export interface BuilderAIContextDraft {
    shortcutName: string;
    category: BlockCategory | null;
    blocks: BuilderBlock[];
    inputs: ShortcutInput[];
}

interface BlockCounter {
    count: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, maxLength: number): string {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function findSkillDef(skillId: string): SkillDefinition | undefined {
    return SKILL_PALETTE.find((skill) => skill.id === skillId);
}

function sanitizeParams(
    value: unknown,
    skill: SkillDefinition,
): BuilderBlockParam[] {
    if (!Array.isArray(value)) return [];

    const allowedKeys = new Set(skill.params.map((param) => param.key));
    const params: BuilderBlockParam[] = [];

    for (const item of value) {
        if (!isRecord(item)) continue;
        const key = readString(item.key, 80);
        if (!key || !allowedKeys.has(key)) continue;

        params.push({
            key,
            value: readString(item.value, 500),
        });
    }

    return params;
}

function sanitizeBlocks(
    value: unknown,
    depth: number,
    counter: BlockCounter,
): BuilderBlock[] {
    if (!Array.isArray(value)) return [];
    if (depth > MAX_CONTEXT_DEPTH) return [];

    const blocks: BuilderBlock[] = [];

    for (const item of value) {
        if (counter.count >= MAX_CONTEXT_BLOCKS) break;
        const block = sanitizeBlock(item, depth, counter);
        if (block) blocks.push(block);
    }

    return blocks;
}

function sanitizeBlock(
    value: unknown,
    depth: number,
    counter: BlockCounter,
): BuilderBlock | null {
    if (!isRecord(value)) return null;

    const skillId = readString(value.skillId, 120);
    const skill = findSkillDef(skillId);
    if (!skill) return null;

    counter.count += 1;

    const block: BuilderBlock = {
        id: readString(value.id, 100) || `step-${counter.count}`,
        skillId,
        label: readString(value.label, 120) || skill.label,
        category: skill.category,
        params: sanitizeParams(value.params, skill),
        ...(typeof value.condition === "string" && value.condition.trim()
            ? { condition: value.condition.trim().slice(0, 1000) }
            : {}),
        ...(typeof value.onFailure === "string" && value.onFailure.trim()
            ? { onFailure: value.onFailure.trim() as BuilderBlock["onFailure"] }
            : {}),
        ...(typeof value.confirm === "boolean" ? { confirm: value.confirm } : {}),
        ...(typeof value.outputAs === "string" && value.outputAs.trim()
            ? { outputAs: value.outputAs.trim().slice(0, 80) }
            : {}),
    };

    const thenBlocks = sanitizeBlocks(value.thenBlocks, depth + 1, counter);
    const elseBlocks = sanitizeBlocks(value.elseBlocks, depth + 1, counter);
    const repeatBlocks = sanitizeBlocks(value.repeatBlocks, depth + 1, counter);

    return {
        ...block,
        ...(thenBlocks.length ? { thenBlocks } : {}),
        ...(elseBlocks.length ? { elseBlocks } : {}),
        ...(repeatBlocks.length ? { repeatBlocks } : {}),
    };
}

function sanitizeInputs(value: unknown): ShortcutInput[] {
    if (!Array.isArray(value)) return [];

    const inputs: ShortcutInput[] = [];
    const seen = new Set<string>();

    for (const item of value) {
        if (inputs.length >= MAX_CONTEXT_INPUTS) break;
        if (!isRecord(item)) continue;

        const id = readString(item.id, 80);
        if (!id || seen.has(id)) continue;

        const type = readString(item.type, 40);
        if (!INPUT_TYPES.has(type)) continue;

        seen.add(id);
        inputs.push({
            id,
            label: readString(item.label, 120) || id,
            type: type as ShortcutInput["type"],
            required: typeof item.required === "boolean" ? item.required : true,
            ...(typeof item.placeholder === "string" && item.placeholder.trim()
                ? { placeholder: item.placeholder.trim().slice(0, 160) }
                : {}),
            ...(typeof item.default === "string" && item.default.trim()
                ? { default: item.default.trim().slice(0, 160) }
                : {}),
        });
    }

    return inputs;
}

export function createBuilderAIContextSnapshot(
    draft: BuilderAIContextDraft,
): BuilderAIContextSnapshot {
    return {
        version: BUILDER_AI_CONTEXT_VERSION,
        page: "builder",
        shortcutName: draft.shortcutName.trim().slice(0, 120),
        category: draft.category,
        blocks: draft.blocks,
        inputs: draft.inputs,
        updatedAt: new Date().toISOString(),
    };
}

export function sanitizeBuilderAIContextSnapshot(
    value: unknown,
): BuilderAIContextSnapshot | null {
    if (!isRecord(value)) return null;
    if (value.version !== BUILDER_AI_CONTEXT_VERSION) return null;
    if (value.page !== "builder") return null;

    const category =
        typeof value.category === "string" && isBlockCategoryValue(value.category)
            ? value.category
            : null;
    const counter: BlockCounter = { count: 0 };
    const blocks = sanitizeBlocks(value.blocks, 0, counter);

    return {
        version: BUILDER_AI_CONTEXT_VERSION,
        page: "builder",
        shortcutName: readString(value.shortcutName, 120),
        category,
        blocks,
        inputs: sanitizeInputs(value.inputs),
        updatedAt: readString(value.updatedAt, 60) || new Date().toISOString(),
    };
}

function summarizeBlock(block: BuilderBlock): Record<string, unknown> {
    const [skill, action] = block.skillId.split(".");

    return {
        id: block.id,
        skill,
        action,
        label: block.label,
        params: Object.fromEntries(
            block.params.map((param) => [param.key, param.value]),
        ),
        ...(block.condition ? { condition: block.condition } : {}),
        ...(block.confirm ? { confirm: block.confirm } : {}),
        ...(block.outputAs ? { output: { as: block.outputAs } } : {}),
        ...(block.onFailure ? { onFailure: block.onFailure } : {}),
        ...(block.thenBlocks?.length
            ? { thenSteps: block.thenBlocks.map(summarizeBlock) }
            : {}),
        ...(block.elseBlocks?.length
            ? { elseSteps: block.elseBlocks.map(summarizeBlock) }
            : {}),
        ...(block.repeatBlocks?.length
            ? { repeatSteps: block.repeatBlocks.map(summarizeBlock) }
            : {}),
    };
}

export function summarizeBuilderAIContextForPrompt(
    context: BuilderAIContextSnapshot,
): Record<string, unknown> {
    return {
        name: context.shortcutName || "Untitled Shortcut",
        category: context.category,
        inputs: context.inputs.map((input) => ({
            id: input.id,
            label: input.label,
            type: input.type,
            required: input.required,
        })),
        steps: context.blocks.map(summarizeBlock),
    };
}
