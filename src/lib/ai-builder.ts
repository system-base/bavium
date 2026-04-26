import type { BuilderBlock } from "@/lib/builder-shortcut";
import type { GeneratedShortcut } from "@/lib/llm";
import { SKILL_PALETTE } from "@/lib/constants";

export type AIBuilderBlock = BuilderBlock;

function findSkillDef(skillId: string) {
    return SKILL_PALETTE.find((s) => s.id === skillId);
}

function mapGeneratedStepsToBuilderBlocks(
    steps: GeneratedShortcut["steps"],
): AIBuilderBlock[] {
    const blocks: AIBuilderBlock[] = [];
    const unsupported: string[] = [];

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const skillId = `${step.skill}.${step.action}`;
        const def = findSkillDef(skillId);
        if (!def) {
            unsupported.push(`${step.id || `step-${i + 1}`}: ${skillId}`);
            continue;
        }

        const params = Object.entries(step.params ?? {}).map(([key, value]) => ({
            key,
            value: value == null ? "" : String(value),
        }));

        blocks.push({
            id: step.id || `step-${i + 1}`,
            skillId,
            label: def.label,
            category: def.category,
            params,
            ...(typeof step.confirm === "boolean"
                ? { confirm: step.confirm }
                : { confirm: def.requiresConfirmation }),
            ...(step.output?.as ? { outputAs: step.output.as } : {}),
            ...(step.onFailure ? { onFailure: step.onFailure } : {}),
            ...(step.condition
                ? {
                    condition:
                        typeof step.condition === "string"
                            ? step.condition
                            : JSON.stringify(step.condition),
                }
                : {}),
            ...(step.thenSteps?.length
                ? { thenBlocks: mapGeneratedStepsToBuilderBlocks(step.thenSteps) }
                : {}),
            ...(step.elseSteps?.length
                ? { elseBlocks: mapGeneratedStepsToBuilderBlocks(step.elseSteps) }
                : {}),
            ...(step.repeatSteps?.length
                ? { repeatBlocks: mapGeneratedStepsToBuilderBlocks(step.repeatSteps) }
                : {}),
        });
    }

    if (unsupported.length > 0) {
        throw new Error(
            `Unsupported steps in AI output: ${unsupported.join(", ")}`,
        );
    }

    return blocks;
}

export function generatedShortcutToBuilderBlocks(
    shortcut: GeneratedShortcut,
): AIBuilderBlock[] {
    return mapGeneratedStepsToBuilderBlocks(shortcut.steps);
}
