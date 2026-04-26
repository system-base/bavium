"use client";

import { AlertTriangle, ArrowRight, Clock3, Layers, Loader2 } from "lucide-react";

export interface ShortcutDetailInput {
    id: string;
    label: string;
    type: string;
    required?: boolean;
    defaultValue?: string;
}

export interface ShortcutDetailWorkflowStep {
    id: string;
    label: string;
    skillLabel: string;
    color: string;
}

interface ShortcutInputsSectionProps {
    inputs: ShortcutDetailInput[];
}

interface ShortcutWorkflowSectionProps {
    steps: ShortcutDetailWorkflowStep[];
}

interface ShortcutOwnerOperationalSummaryProps {
    description: string;
    visibilityLabel: string;
    visibilityHint: string;
    linkedAutomationsCount: number;
    linkedAutomationsHint: string;
    deleteLabel: string;
    deleteHint: string;
    statusPillLabel: string;
    guidance: string;
    updatedAtLabel?: string | null;
    loading?: boolean;
}

export function ShortcutInputsSection({ inputs }: ShortcutInputsSectionProps) {
    if (inputs.length === 0) {
        return null;
    }

    return (
        <div className="mb-8">
            <h2 className="text-[13px] font-semibold tracking-wider uppercase text-fg-muted pb-2 mb-4 border-b border-border-subtle">
                Inputs — {inputs.length}
            </h2>
            <div className="flex flex-col gap-2">
                {inputs.map((input) => (
                    <div
                        key={input.id}
                        className="flex items-center gap-3 p-3 rounded-lg bg-secondary border border-border-subtle"
                    >
                        <div className="flex items-center justify-center w-7 h-7 rounded-md bg-tertiary text-fg-muted text-[11px] font-mono font-semibold shrink-0 uppercase">
                            {input.type.slice(0, 3)}
                        </div>
                        <div className="min-w-0 flex-1">
                            <span className="text-sm font-medium text-fg">{input.label}</span>
                            {input.required && (
                                <span className="ml-1.5 text-[11px] text-status-warning font-medium">Required</span>
                            )}
                        </div>
                        {input.defaultValue && (
                            <span className="text-[12px] text-fg-muted font-mono truncate max-w-[140px]">
                                {input.defaultValue}
                            </span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

export function ShortcutOwnerOperationalSummary({
    description,
    visibilityLabel,
    visibilityHint,
    linkedAutomationsCount,
    linkedAutomationsHint,
    deleteLabel,
    deleteHint,
    statusPillLabel,
    guidance,
    updatedAtLabel,
    loading = false,
}: ShortcutOwnerOperationalSummaryProps) {
    return (
        <div className="rounded-xl border border-border-subtle bg-secondary p-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <div className="text-sm font-medium text-fg mb-1">
                        Operational Status
                    </div>
                    <p className="text-sm text-fg-secondary leading-relaxed max-w-[520px]">
                        {description}
                    </p>
                </div>
                {loading && (
                    <div className="inline-flex items-center gap-2 text-sm text-fg-muted">
                        <Loader2 size={14} className="animate-spin" />
                        Loading status...
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                <div className="rounded-xl border border-border-subtle bg-primary p-3">
                    <div className="text-[12px] font-semibold tracking-wider uppercase text-fg-muted mb-1">
                        Visibility
                    </div>
                    <div className="text-sm font-medium text-fg">
                        {visibilityLabel}
                    </div>
                    <div className="text-[12px] text-fg-muted mt-1">
                        {visibilityHint}
                    </div>
                </div>

                <div className="rounded-xl border border-border-subtle bg-primary p-3">
                    <div className="text-[12px] font-semibold tracking-wider uppercase text-fg-muted mb-1">
                        Linked Automations
                    </div>
                    <div className="text-sm font-medium text-fg">
                        {linkedAutomationsCount}
                    </div>
                    <div className="text-[12px] text-fg-muted mt-1">
                        {linkedAutomationsHint}
                    </div>
                </div>

                <div className="rounded-xl border border-border-subtle bg-primary p-3">
                    <div className="text-[12px] font-semibold tracking-wider uppercase text-fg-muted mb-1">
                        Delete
                    </div>
                    <div className="text-sm font-medium text-fg">
                        {deleteLabel}
                    </div>
                    <div className="text-[12px] text-fg-muted mt-1">
                        {deleteHint}
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-4 flex-wrap text-[13px] text-fg-muted mt-4">
                {updatedAtLabel && (
                    <span className="inline-flex items-center gap-1.5">
                        <Clock3 size={13} />
                        {updatedAtLabel}
                    </span>
                )}
                <span className="inline-flex items-center h-7 px-3 rounded-full bg-tertiary text-[12px] font-medium text-fg-muted">
                    {statusPillLabel}
                </span>
            </div>

            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-border-subtle bg-tertiary/50 p-3 text-sm text-fg-muted">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>{guidance}</span>
            </div>
        </div>
    );
}

export function ShortcutWorkflowSection({ steps }: ShortcutWorkflowSectionProps) {
    return (
        <div className="mb-8">
            <h2 className="text-[13px] font-semibold tracking-wider uppercase text-fg-muted pb-2 mb-4 border-b border-border-subtle">
                Workflow — {steps.length} step{steps.length !== 1 ? "s" : ""}
            </h2>
            <div className="flex flex-col gap-2">
                {steps.map((step, index) => (
                    <div key={step.id} className="flex flex-col items-stretch">
                        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-secondary border border-border-subtle hover:border-border-default transition-colors">
                            <div
                                className="flex items-center justify-center w-7 h-7 rounded-full text-[12px] font-bold shrink-0"
                                style={{
                                    backgroundColor: `color-mix(in srgb, ${step.color} 14%, transparent)`,
                                    color: step.color,
                                }}
                            >
                                {index + 1}
                            </div>

                            <div className="min-w-0 flex-1 flex items-center gap-2">
                                <span className="text-sm font-medium text-fg truncate">
                                    {step.label}
                                </span>
                                <span
                                    className="text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0"
                                    style={{
                                        backgroundColor: `color-mix(in srgb, ${step.color} 10%, transparent)`,
                                        color: step.color,
                                    }}
                                >
                                    {step.skillLabel}
                                </span>
                            </div>

                            <ArrowRight size={12} className="text-fg-muted opacity-30 shrink-0" />
                        </div>

                        {index < steps.length - 1 && (
                            <div className="flex justify-center py-0.5">
                                <div
                                    className="w-[2px] h-3"
                                    style={{
                                        backgroundColor: `color-mix(in srgb, ${step.color} 12%, transparent)`,
                                        borderRadius: "1px",
                                    }}
                                />
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {steps.length === 0 && (
                <div className="flex items-start gap-2.5 p-3 mt-4 rounded-lg border border-border-subtle bg-tertiary/50 text-sm text-fg-muted">
                    <Layers size={14} className="mt-0.5 shrink-0" />
                    <span>No workflow steps found for this shortcut.</span>
                </div>
            )}
        </div>
    );
}
