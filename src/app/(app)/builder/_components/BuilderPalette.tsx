"use client";

import { ChevronDown } from "lucide-react";
import {
    CATEGORY_META,
    CATEGORY_ICONS,
    type BlockCategory,
    type SkillDefinition,
} from "@/lib/constants";

function isBlockCategory(value: string): value is BlockCategory {
    return value in CATEGORY_META;
}

function getLogicPaletteSections(skills: SkillDefinition[]) {
    const controlFlowIds = new Set([
        "logic.if_else",
        "logic.repeat",
        "logic.repeat_each",
        "logic.wait",
        "logic.stop",
    ]);
    const promptIds = new Set([
        "logic.ask_input",
        "logic.choose_menu",
    ]);
    const variableIds = new Set([
        "logic.get_variable",
    ]);

    return [
        {
            title: "Control Flow",
            skills: skills.filter((skill) => controlFlowIds.has(skill.id)),
        },
        {
            title: "Prompts",
            skills: skills.filter((skill) => promptIds.has(skill.id)),
        },
        {
            title: "Variables",
            skills: skills.filter((skill) => variableIds.has(skill.id)),
        },
        {
            title: "Utilities",
            skills: skills.filter(
                (skill) =>
                    !controlFlowIds.has(skill.id) &&
                    !promptIds.has(skill.id) &&
                    !variableIds.has(skill.id),
            ),
        },
    ].filter((section) => section.skills.length > 0);
}

function renderSkillButton(
    skill: SkillDefinition,
    Icon: typeof ChevronDown,
    onAddSkill: (skill: SkillDefinition) => void,
) {
    return (
        <button
            key={skill.id}
            type="button"
            data-palette-skill
            className="flex items-center gap-3 h-9 px-3 text-[14px] font-medium text-fg-secondary rounded-md hover:bg-tertiary hover:text-fg transition-colors select-none"
            title={skill.description}
            onClick={() => onAddSkill(skill)}
        >
            <span className="flex items-center justify-center w-[18px] h-[18px] shrink-0 opacity-50">
                <Icon size={14} />
            </span>
            <span className="flex-1 text-left truncate">
                {skill.label}
            </span>
        </button>
    );
}

export function BuilderPalette({
    groupedSkills,
    collapsed,
    onToggleCategory,
    onAddSkill,
}: {
    groupedSkills: Partial<Record<BlockCategory, SkillDefinition[]>>;
    collapsed: Set<string>;
    onToggleCategory: (category: string) => void;
    onAddSkill: (skill: SkillDefinition) => void;
}) {
    return Object.entries(groupedSkills).map(([cat, skills]) => {
        if (!isBlockCategory(cat) || !skills) return null;
        const meta = CATEGORY_META[cat];
        const Icon = CATEGORY_ICONS[cat];
        const isCollapsed = collapsed.has(cat);

        return (
            <div key={cat} className="mb-3" data-palette-category>
                <button
                    type="button"
                    className="flex items-center justify-between w-full px-3 py-2 text-[13px] font-semibold tracking-widest uppercase text-fg-muted rounded-md hover:bg-tertiary transition-colors select-none"
                    onClick={() => onToggleCategory(cat)}
                >
                    <span className="flex items-center gap-2">
                        <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: meta.cssColor }}
                        />
                        {meta.label}
                    </span>
                    <ChevronDown
                        size={12}
                        className={`opacity-35 transition-transform duration-150 ${isCollapsed ? "-rotate-90" : ""}`}
                    />
                </button>

                {!isCollapsed && (
                    <div className="mt-1 flex flex-col">
                        {(cat === "logic"
                            ? getLogicPaletteSections(skills).map((section) => (
                                <div key={section.title} className="mb-2 last:mb-0">
                                    <div className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-fg-muted">
                                        {section.title}
                                    </div>
                                    {section.skills.map((skill) => (
                                        renderSkillButton(skill, Icon, onAddSkill)
                                    ))}
                                </div>
                            ))
                            : skills.map((skill) => renderSkillButton(skill, Icon, onAddSkill)))}
                    </div>
                )}
            </div>
        );
    });
}
