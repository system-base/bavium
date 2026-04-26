"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Hammer, CheckCircle2, XCircle, ChevronRight, AlertCircle } from "lucide-react";
import { SKILL_PALETTE } from "@/lib/constants";
import {
    writeBuilderAIHandoff,
    type ShortcutDraftOutput,
} from "@/lib/builder-ai-handoff";

function findSkillLabel(skill: string, action: string): string {
    const id = `${skill}.${action}`;
    const def = SKILL_PALETTE.find((s) => s.id === id);
    return def?.label ?? id;
}

export function ShortcutPreview({ data }: { data: ShortcutDraftOutput }) {
    const router = useRouter();
    const [openError, setOpenError] = useState<string | null>(null);

    const handleOpenInBuilder = useCallback(() => {
        setOpenError(null);
        const wroteHandoff = writeBuilderAIHandoff(data);
        if (!wroteHandoff) {
            setOpenError(
                "Draft could not be handed off to Builder. Try again, or clear the chat if browser storage is full.",
            );
            return;
        }
        router.push("/builder");
    }, [data, router]);

    if (!data.success) {
        return (
            <div className="my-2 rounded-xl border border-status-error/20 bg-status-error/5 p-4">
                <div className="flex items-center gap-2 mb-2">
                    <XCircle size={16} className="text-status-error" />
                    <span className="text-sm font-medium text-status-error">
                        Generation Failed
                    </span>
                </div>
                <p className="text-xs text-fg-secondary">{data.message}</p>
            </div>
        );
    }

    return (
        <div className="my-2 rounded-xl border border-brand-light/20 bg-brand-subtle/30 overflow-hidden">
            <div className="px-4 pt-3 pb-2">
                <div className="flex items-center gap-2 mb-1">
                    <CheckCircle2 size={16} className="text-status-success" />
                    <span className="text-sm font-semibold text-fg">
                        {data.name}
                    </span>
                </div>
                <p className="text-xs text-fg-secondary mb-2">
                    {data.stepCount} step{data.stepCount !== 1 ? "s" : ""}
                </p>

                <div className="flex flex-col gap-1">
                    {data.steps.map((step, i) => (
                        <div
                            key={i}
                            className="flex items-center gap-2 text-xs text-fg-secondary"
                        >
                            <span className="w-4 h-4 flex items-center justify-center rounded bg-tertiary text-[10px] font-bold text-fg-muted shrink-0">
                                {i + 1}
                            </span>
                            <span className="truncate">
                                {findSkillLabel(step.skill, step.action)}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            <button
                type="button"
                onClick={handleOpenInBuilder}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-fg text-primary text-sm font-semibold hover:opacity-90 transition-opacity"
            >
                <Hammer size={14} />
                Open in Builder
                <ChevronRight size={14} />
            </button>
            {openError && (
                <div className="border-t border-status-error/20 bg-status-error/5 px-4 py-2 text-xs text-status-error">
                    {openError}
                </div>
            )}
        </div>
    );
}

export function ShortcutDraftErrorCard({
    message = "The AI did not return a valid Builder draft. Try again with a simpler request.",
}: {
    message?: string;
}) {
    return (
        <div className="my-2 rounded-xl border border-status-error/20 bg-status-error/5 p-4">
            <div className="mb-2 flex items-center gap-2">
                <AlertCircle size={16} className="text-status-error" />
                <span className="text-sm font-medium text-status-error">
                    Draft could not be loaded
                </span>
            </div>
            <p className="text-xs text-fg-secondary">{message}</p>
        </div>
    );
}
