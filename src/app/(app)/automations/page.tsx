"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAccount } from "wagmi";
import {
    Zap,
    Plus,
    Layers,
    Pause,
    Play,
    Trash2,
    ChevronRight,
    ChevronDown,
    CheckCircle2,
    XCircle,
    Clock,
    AlertTriangle,
    Loader2,
    X,
} from "lucide-react";
import { Button, Combobox } from "@/components/ui";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useActiveChain } from "@/hooks/useActiveChain";
import type { Automation, ExecutionLog, Trigger, Action } from "@/types/automation";
import { generateAutomation, getLLMConfig } from "@/lib/llm";
import { PRICE_TRIGGER_SYMBOLS } from "@/engine/price-feed";
import { TokenParamInput } from "@/app/(app)/builder/_components/TokenParamInput";
import type { ShortcutInput, ShortcutStep } from "@/engine/types";
import type { BlockCategory } from "@/lib/constants";
import {
    getShortcutAutomationCompatibility,
    type ShortcutAutomationCompatibility,
} from "@/lib/shortcut-validation";
import type { NetworkId } from "@/lib/chain-config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WizardStep = "trigger" | "confirm";

interface WizardState {
    name: string;
    targetShortcutId: string;
    triggerType: "price_below" | "price_above" | "scheduled";
    // Price trigger
    priceToken: string;
    priceUsd: string;
    // Scheduled trigger
    schedulePreset: string;
    // Limits
    maxExecutions: string;
}

interface SavedShortcutOption {
    _id: string;
    name: string;
    description?: string;
    category: BlockCategory;
    publicName?: string;
    publicDescription?: string;
    publicCategory?: BlockCategory;
    inputs?: ShortcutInput[];
    steps?: ShortcutStep[];
    updatedAt: string;
}

function shortcutDisplayName(shortcut: SavedShortcutOption): string {
    return shortcut.publicName?.trim() || shortcut.name;
}

const SCHEDULE_PRESETS: { label: string; cron: string }[] = [
    { label: "Every day at 09:00 UTC", cron: "0 9 * * *" },
    { label: "Every day at 00:00 UTC (midnight)", cron: "0 0 * * *" },
    { label: "Every Monday at 09:00 UTC", cron: "0 9 * * 1" },
    { label: "Every hour", cron: "0 * * * *" },
    { label: "Every 6 hours", cron: "0 */6 * * *" },
    { label: "Custom cron expression", cron: "custom" },
];

const DEFAULT_WIZARD: WizardState = {
    name: "",
    targetShortcutId: "",
    triggerType: "price_below",
    priceToken: "ETH",
    priceUsd: "",
    schedulePreset: "0 9 * * *",
    maxExecutions: "10",
};

const MIN_AI_AUTOMATION_PROMPT_WORDS = 3;

function hasEnoughAutomationPromptDetail(prompt: string): boolean {
    return prompt.trim().split(/\s+/).filter(Boolean).length >= MIN_AI_AUTOMATION_PROMPT_WORDS;
}

function formatAutomationAIError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();

    if (lower.includes("invalid automation response structure") || lower.includes("invalid automation json response")) {
        return "AI could not turn that into an automation. Describe the trigger and action, for example: Send 50 USDC if ETH drops below 2000.";
    }

    return error instanceof Error ? error.message : "Failed to generate an AI suggestion.";
}

function formatAutomationCompatibilityIssue(issue: string): string {
    return issue
        .replace(/^shortcut\.inputs:\s*/i, "")
        .replace(/^steps\[\d+\](?:\.[^:]+)?:\s*/i, "")
        .replace(/"/g, "")
        .trim();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function triggerSummary(trigger: Trigger): string {
    if (trigger.type === "price_below")
        return `When ${trigger.token} drops below $${trigger.priceUsd}`;
    if (trigger.type === "price_above")
        return `When ${trigger.token} rises above $${trigger.priceUsd}`;
    if (trigger.type === "scheduled")
        return trigger.cronDescription ?? `Cron: ${trigger.cron}`;
    return "";
}

function executionSummary(auto: Automation, linkedShortcutName?: string): string {
    return linkedShortcutName
        ? `Runs linked shortcut: ${linkedShortcutName}`
        : "Runs linked shortcut";
}

function summarizeSuggestedWorkflow(action: Action): string {
    if (action.type === "swap") {
        return `AI inferred a swap workflow: swap ${action.amount || "an amount"} ${action.fromToken} to ${action.toToken}.`;
    }

    if (action.type === "send") {
        return `AI inferred a send workflow: send ${action.amount || "an amount"} ${action.token} to ${action.to}.`;
    }

    return `AI inferred a notification workflow for ${action.channel === "email" ? "email" : "webhook"}.`;
}

function buildCompatibilityAction(linkedShortcutName?: string): Action {
    return {
        type: "notify",
        channel: "webhook",
        target: "linked-shortcut",
        message: linkedShortcutName
            ? `Compatibility placeholder for linked shortcut "${linkedShortcutName}".`
            : "Compatibility placeholder for linked shortcut execution.",
    };
}

function statusBadge(status: string) {
    const map: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
        active: { label: "Active", color: "text-status-success bg-status-success/10", icon: CheckCircle2 },
        paused: { label: "Paused", color: "text-fg-muted bg-tertiary", icon: Pause },
        completed: { label: "Completed", color: "text-brand-light bg-brand-subtle", icon: CheckCircle2 },
        error: { label: "Error", color: "text-status-error bg-status-error/10", icon: XCircle },
    };
    return map[status] ?? map.active;
}

function networkBadge(networkId?: string) {
    if (networkId === "base-mainnet") {
        return {
            label: "Base",
            className: "text-brand-light bg-brand-subtle",
        };
    }

    if (networkId === "base-sepolia") {
        return {
            label: "Base Sepolia",
            className: "text-status-warning bg-status-warning/10",
        };
    }

    return {
        label: "Network Required",
        className: "text-status-error bg-status-error/10",
    };
}

function logState(log: ExecutionLog): {
    label: string;
    className: string;
    icon: typeof CheckCircle2;
} {
    if (log.status === "awaiting_signature") {
        return {
            label: "Awaiting Signature",
            className: "bg-status-warning/8 text-status-warning",
            icon: Clock,
        };
    }

    if (log.success) {
        return {
            label: "Succeeded",
            className: "bg-status-success/5 text-status-success",
            icon: CheckCircle2,
        };
    }

    if (log.status === "canceled") {
        return {
            label: "Canceled",
            className: "bg-tertiary text-fg-muted",
            icon: XCircle,
        };
    }

    return {
        label: "Failed",
        className: "bg-status-error/5 text-status-error",
        icon: XCircle,
    };
}

function formatMetaDate(value?: string): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString("en-US");
}

// ---------------------------------------------------------------------------
// Automation Card
// ---------------------------------------------------------------------------

function AutomationCard({
    auto,
    onPause,
    onResume,
    onDelete,
    onExpand,
    expanded,
    logs,
    linkedShortcutName,
    actionPending,
}: {
    auto: Automation;
    onPause: (id: string) => void;
    onResume: (id: string) => void;
    onDelete: (id: string) => void;
    onExpand: (id: string) => void;
    expanded: boolean;
    logs: ExecutionLog[];
    linkedShortcutName?: string;
    actionPending?: boolean;
}) {
    const badge = statusBadge(auto.status);
    const BadgeIcon = badge.icon;
    const netBadge = networkBadge(auto.networkId);
    const lastTriggered = formatMetaDate(auto.lastTriggeredAt);
    const lastExecuted = formatMetaDate(auto.lastExecutedAt);

    return (
        <div className="bg-secondary border border-border-subtle rounded-[var(--radius-lg)] overflow-hidden transition-all">
            {/* Card header */}
            <div
                className="flex items-start gap-3 p-4 cursor-pointer hover:bg-tertiary/50 transition-colors select-none"
                onClick={() => onExpand(auto.id)}
            >
                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-brand-subtle shrink-0 mt-0.5">
                    <Zap size={16} className="text-brand-light" />
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-semibold text-fg truncate">
                            {auto.name}
                        </h3>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full ${badge.color}`}>
                            <BadgeIcon size={10} />
                            {badge.label}
                        </span>
                        <span className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full ${netBadge.className}`}>
                            {netBadge.label}
                        </span>
                    </div>
                    <p className="text-sm text-fg-muted mt-0.5 truncate">
                        {triggerSummary(auto.trigger)}
                    </p>
                    <p className="text-sm text-fg-secondary mt-0.5 truncate">
                        → {executionSummary(auto, linkedShortcutName)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
                        <span>
                            Last Triggered: {lastTriggered ?? "Never"}
                        </span>
                        <span>
                            Last Executed: {lastExecuted ?? "Never"}
                        </span>
                        {auto.status === "active" && auto.trigger.type === "scheduled" && auto.nextRunAt && (
                            <span>
                                Next Run: {formatMetaDate(auto.nextRunAt) ?? "Calculating"}
                            </span>
                        )}
                        <span>Linked Shortcut: {linkedShortcutName ?? "Connected"}</span>
                    </div>
                </div>

                <div className="flex items-center gap-1 shrink-0 ml-2">
                    <div className="text-right mr-2 hidden sm:block">
                        <div className="text-xs text-fg-muted">Completed</div>
                        <div className="text-sm font-semibold text-fg">
                            {auto.executionCount}
                            {auto.maxExecutions > 0 && (
                                <span className="text-fg-muted font-normal">/{auto.maxExecutions}</span>
                            )}
                        </div>
                    </div>

                    {auto.status === "active" ? (
                        <button
                            type="button"
                            title="Pause"
                            disabled={actionPending}
                            className="flex items-center justify-center w-7 h-7 rounded text-fg-muted hover:text-status-warning hover:bg-status-warning/10 transition-colors"
                            onClick={(e) => { e.stopPropagation(); onPause(auto.id); }}
                        >
                            <Pause size={13} />
                        </button>
                    ) : auto.status === "paused" ? (
                        <button
                            type="button"
                            title="Resume"
                            disabled={actionPending}
                            className="flex items-center justify-center w-7 h-7 rounded text-fg-muted hover:text-status-success hover:bg-status-success/10 transition-colors"
                            onClick={(e) => { e.stopPropagation(); onResume(auto.id); }}
                        >
                            <Play size={13} />
                        </button>
                    ) : null}

                    <button
                        type="button"
                        title="Delete"
                        disabled={actionPending}
                        className="flex items-center justify-center w-7 h-7 rounded text-fg-muted hover:text-status-error hover:bg-status-error/10 transition-colors"
                        onClick={(e) => { e.stopPropagation(); onDelete(auto.id); }}
                    >
                        <Trash2 size={13} />
                    </button>

                    <ChevronDown
                        size={14}
                        className={`text-fg-muted transition-transform ${expanded ? "rotate-180" : ""}`}
                    />
                </div>
            </div>

            {/* Execution log expand */}
            {expanded && (
                <div className="border-t border-border-subtle px-4 py-3">
                    <div className="flex items-center gap-2 mb-3">
                        <Clock size={13} className="text-fg-muted" />
                        <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                            Recent Runs
                        </span>
                    </div>

                    {logs.length === 0 ? (
                        <p className="text-sm text-fg-muted italic">No runs yet</p>
                    ) : (
                        <div className="flex flex-col gap-1.5">
                            {logs.map((log) => {
                                const state = logState(log);
                                const Icon = state.icon;

                                return (
                                    <div
                                        key={log.id}
                                        className={`flex items-start gap-2 p-2 rounded-md text-sm ${state.className}`}
                                    >
                                        <Icon size={13} className="mt-0.5 shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-medium">
                                                    {state.label}
                                                </span>
                                                {log.priceAtCheck != null && (
                                                    <span className="text-fg-muted text-xs">
                                                        (${log.priceAtCheck.toLocaleString()})
                                                    </span>
                                                )}
                                                <span className="text-xs text-fg-muted ml-auto">
                                                    {new Date(log.executedAt).toLocaleString("en-US")}
                                                </span>
                                            </div>
                                            {log.error && (
                                                <p className="text-xs mt-0.5 text-status-error">{log.error}</p>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {auto.lastError && (
                        <div className="mt-3 flex items-start gap-2 p-2 rounded-md bg-status-error/5 text-status-error text-sm">
                            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                            <span>{auto.lastError}</span>
                        </div>
                    )}

                    {!auto.networkId && (
                        <div className="mt-3 flex items-start gap-2 p-2 rounded-md bg-status-warning/8 text-status-warning text-sm">
                            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                            <span>
                                This automation was created before network persistence. Recreate or update it on the correct Base network before running it again.
                            </span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Creation Wizard
// ---------------------------------------------------------------------------

function CreationWizard({
    connectedAddress,
    networkId,
    savedShortcuts,
    shortcutsLoading,
    onClose,
    onCreated,
}: {
    connectedAddress?: string;
    networkId: NetworkId;
    savedShortcuts: SavedShortcutOption[];
    shortcutsLoading: boolean;
    onClose: () => void;
    onCreated: () => void;
}) {
    const [step, setStep] = useState<WizardStep>("trigger");
    const [form, setForm] = useState<WizardState>(DEFAULT_WIZARD);
    const [customCron, setCustomCron] = useState("0 9 * * *");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [aiPrompt, setAiPrompt] = useState("");
    const [aiLoading, setAiLoading] = useState(false);
    const [aiError, setAiError] = useState<string | null>(null);
    const [aiWorkflowHint, setAiWorkflowHint] = useState<string | null>(null);

    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => { document.body.style.overflow = prev; };
    }, []);

    const upd = (key: keyof WizardState, val: string) =>
        setForm((prev) => ({ ...prev, [key]: val }));

    const selectedShortcut = useMemo(
        () => savedShortcuts.find((shortcut) => shortcut._id === form.targetShortcutId),
        [form.targetShortcutId, savedShortcuts],
    );
    const shortcutCompatibilityById = useMemo(() => {
        const walletAddress = connectedAddress ?? "0x0000000000000000000000000000000000000000";
        const inputValues = {
            walletAddress,
            "wallet.address": walletAddress,
            wallet: { address: walletAddress },
            automationId: "automation-preview",
            triggerType: form.triggerType,
        };

        return new Map<string, ShortcutAutomationCompatibility>(
            savedShortcuts.map((shortcut) => {
                if (!Array.isArray(shortcut.steps)) {
                    return [
                        shortcut._id,
                        {
                            compatible: false,
                            issues: ["Shortcut details were not loaded. Refresh and try again."],
                        },
                    ];
                }

                return [
                    shortcut._id,
                    getShortcutAutomationCompatibility(
                        {
                            steps: shortcut.steps,
                            inputs: Array.isArray(shortcut.inputs) ? shortcut.inputs : [],
                        },
                        inputValues,
                        networkId,
                    ),
                ];
            }),
        );
    }, [connectedAddress, form.triggerType, networkId, savedShortcuts]);
    const selectedShortcutCompatibility = selectedShortcut
        ? shortcutCompatibilityById.get(selectedShortcut._id)
        : undefined;
    const selectedShortcutIsCompatible = selectedShortcutCompatibility?.compatible ?? false;
    const shortcutOptions = useMemo(
        () => savedShortcuts.map((shortcut) => {
            const compatibility = shortcutCompatibilityById.get(shortcut._id);
            const issue = compatibility?.issues[0];

            return {
                label: shortcutDisplayName(shortcut),
                value: shortcut._id,
                group: shortcut.publicCategory ?? shortcut.category ?? "General",
                disabled: compatibility ? !compatibility.compatible : false,
                description: compatibility?.compatible
                    ? `${shortcut.steps?.length ?? 0} steps · automation-ready`
                    : issue
                        ? formatAutomationCompatibilityIssue(issue)
                        : undefined,
            };
        }),
        [savedShortcuts, shortcutCompatibilityById],
    );

    const getCron = () =>
        form.schedulePreset === "custom" ? customCron : form.schedulePreset;

    const getCronDescription = () => {
        const preset = SCHEDULE_PRESETS.find((p) => p.cron === form.schedulePreset);
        return preset?.label ?? "Custom cron";
    };

    function buildTrigger(): Trigger {
        if (form.triggerType === "scheduled") {
            return {
                type: "scheduled",
                cron: getCron(),
                cronDescription: getCronDescription(),
            };
        }
        return {
            type: form.triggerType,
            token: form.priceToken,
            priceUsd: parseFloat(form.priceUsd),
        };
    }

    const hasValidSchedule = getCron().trim().split(/\s+/).length === 5;
    const parsedPriceUsd = Number.parseFloat(form.priceUsd);
    const hasValidPriceTrigger = Number.isFinite(parsedPriceUsd) && parsedPriceUsd > 0;
    const canContinueToReview = Boolean(form.targetShortcutId)
        && selectedShortcutIsCompatible
        && (form.triggerType === "scheduled" ? hasValidSchedule : hasValidPriceTrigger);

    async function handleAIGenerate() {
        const prompt = aiPrompt.trim();
        if (!prompt) return;
        if (!hasEnoughAutomationPromptDetail(prompt)) {
            setAiError("Describe the trigger and action, for example: Send 50 USDC if ETH drops below 2000.");
            return;
        }

        const llmConfig = await getLLMConfig();
        if (!llmConfig) {
            setAiError("No AI provider configured. Add a provider and API key in Settings first.");
            return;
        }

        setAiLoading(true);
        setAiError(null);
        setAiWorkflowHint(null);

        try {
            const draft = await generateAutomation(llmConfig, prompt);

            setForm((prev) => {
                const next = { ...prev };
                if (draft.name) next.name = draft.name;
                if (typeof draft.maxExecutions === "number") {
                    next.maxExecutions = String(Math.max(0, Math.floor(draft.maxExecutions)));
                }

                const trigger = draft.trigger;
                if (trigger.type === "scheduled") {
                    next.triggerType = "scheduled";
                    next.schedulePreset = trigger.cron;
                    setCustomCron(trigger.cron);
                } else {
                    next.triggerType = trigger.type;
                    next.priceToken = String(trigger.token || "ETH").toUpperCase();
                    next.priceUsd = String(trigger.priceUsd ?? "");
                }

                return next;
            });
            setAiWorkflowHint(summarizeSuggestedWorkflow(draft.action));
        } catch (err) {
            setAiError(formatAutomationAIError(err));
        } finally {
            setAiLoading(false);
        }
    }

    async function handleCreate() {
        setLoading(true);
        setError(null);

        if (!form.targetShortcutId) {
            setError("Select a saved shortcut before creating an automation.");
            setLoading(false);
            return;
        }
        if (!selectedShortcutIsCompatible) {
            setError(
                selectedShortcutCompatibility?.issues[0]
                    ? formatAutomationCompatibilityIssue(selectedShortcutCompatibility.issues[0])
                    : "Select an automation-ready shortcut before creating an automation.",
            );
            setLoading(false);
            return;
        }

        try {
            const res = await fetch("/api/automations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: form.name || "New Automation",
                    trigger: buildTrigger(),
                    action: buildCompatibilityAction(selectedShortcut ? shortcutDisplayName(selectedShortcut) : undefined),
                    targetShortcutId: form.targetShortcutId,
                    maxExecutions: parseInt(form.maxExecutions) || 0,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error ?? "Failed to create automation.");
                return;
            }
            onCreated();
        } catch {
            setError("Could not connect to the server.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="flex w-full max-w-xl max-h-[calc(100dvh-2rem)] sm:max-h-[90vh] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border-strong bg-secondary shadow-2xl shadow-black/50 sm:shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
                    <div>
                        <h2 className="text-base font-semibold text-fg">Create Automation</h2>
                        <p className="text-sm text-fg-muted">
                            {step === "trigger" ? "Step 1/2 — Trigger & Shortcut" : "Step 2/2 — Review & Limits"}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex items-center justify-center w-8 h-8 rounded text-fg-muted hover:text-fg hover:bg-tertiary transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Steps indicator */}
                <div className="flex gap-1 px-5 pt-4">
                    {(["trigger", "confirm"] as WizardStep[]).map((s, i) => (
                        <div
                            key={s}
                            className={`h-1 flex-1 rounded-full transition-colors ${step === s ? "bg-brand" :
                                (["trigger", "confirm"].indexOf(step) > i) ? "bg-brand/40" :
                                    "bg-border-default"
                                }`}
                        />
                    ))}
                </div>

                {/* Body */}
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5" style={{ minHeight: 320 }}>
                    <div className="flex flex-col gap-4">
                        <div className="p-3 rounded-lg border border-border-subtle bg-tertiary/50">
                            <label className="block text-xs font-semibold text-fg-muted uppercase tracking-wider mb-2">
                                Suggest with AI
                            </label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    className="flex-1 px-3 py-2 text-sm bg-primary border border-border-subtle rounded-lg outline-none focus:border-brand text-fg placeholder:text-fg-muted transition-colors"
                                    placeholder="Example: Send 50 USDC if ETH drops below 2000"
                                    value={aiPrompt}
                                    onChange={(e) => {
                                        setAiPrompt(e.target.value);
                                        setAiError(null);
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && !e.shiftKey) {
                                            e.preventDefault();
                                            void handleAIGenerate();
                                        }
                                    }}
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => void handleAIGenerate()}
                                    disabled={aiLoading || !aiPrompt.trim()}
                                >
                                    {aiLoading ? (
                                        <>
                                            <Loader2 size={14} className="animate-spin" />
                                            Generating
                                        </>
                                    ) : (
                                        "Fill with AI"
                                    )}
                                </Button>
                            </div>
                            {aiError && (
                                <p className="mt-2 text-xs text-status-error">{aiError}</p>
                            )}
                            {!aiError && (
                                <p className="mt-2 text-xs text-fg-muted">
                                    AI fills the trigger and label. You still choose which saved shortcut runs.
                                </p>
                            )}
                            {aiWorkflowHint && (
                                <div className="mt-2 rounded-lg border border-brand/15 bg-brand-subtle px-3 py-2 text-xs text-fg-secondary">
                                    <strong className="text-fg">Workflow hint:</strong> {aiWorkflowHint} Build or choose a saved shortcut that matches this behavior.
                                </div>
                            )}
                        </div>

                    {/* ── Step 1: Trigger ── */}
                    {step === "trigger" && (
                        <>
                            <div>
                                <label className="block text-sm font-medium text-fg-secondary mb-1">
                                    Automation Name
                                </label>
                                <input
                                    type="text"
                                    className="w-full px-3 py-2 text-sm bg-primary border border-border-subtle rounded-lg outline-none focus:border-brand text-fg placeholder:text-fg-muted transition-colors"
                                    value={form.name}
                                    onChange={(e) => upd("name", e.target.value)}
                                    placeholder="Example: Alert when ETH drops"
                                    maxLength={80}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-fg-secondary mb-1">
                                    Linked Shortcut
                                </label>
                                <Combobox
                                    options={
                                        savedShortcuts.length === 0
                                            ? [{ label: "No saved shortcuts available", value: "", disabled: true }]
                                            : shortcutOptions
                                    }
                                    value={form.targetShortcutId || ""}
                                    onChange={(val) => upd("targetShortcutId", val)}
                                    placeholder={shortcutsLoading ? "Loading saved shortcuts..." : "Select a saved shortcut"}
                                    disabled={shortcutsLoading || savedShortcuts.length === 0}
                                    className="w-full"
                                />
                                <p className="mt-1.5 text-xs text-fg-muted">
                                    Required. New automations must link to a saved shortcut so execution history, publish state, and future runs all point to one canonical record.
                                </p>
                                <p className="mt-1 text-xs text-fg-muted">
                                    Automation-compatible shortcuts must be fully preconfigured. Avoid <strong className="text-fg">Asked at Start</strong> fields and mid-flow prompts like <strong className="text-fg">Ask Input</strong> or <strong className="text-fg">Choose Menu</strong>.
                                </p>
                                {selectedShortcut && (
                                    <div
                                        className={`mt-2 rounded-lg border px-3 py-2 text-xs ${
                                            selectedShortcutIsCompatible
                                                ? "border-status-success/20 bg-status-success/5 text-fg-secondary"
                                                : "border-status-warning/25 bg-status-warning/8 text-status-warning"
                                        }`}
                                    >
                                        <strong className={selectedShortcutIsCompatible ? "text-fg" : "text-status-warning"}>
                                            Selected workflow:
                                        </strong>{" "}
                                        {shortcutDisplayName(selectedShortcut)}
                                        <span className={selectedShortcutIsCompatible ? "text-fg-muted" : "text-status-warning/80"}>
                                            {" "}· {selectedShortcut.publicCategory ?? selectedShortcut.category} · Updated {formatMetaDate(selectedShortcut.updatedAt) ?? "recently"}
                                        </span>
                                        {!selectedShortcutIsCompatible && selectedShortcutCompatibility?.issues[0] && (
                                            <div className="mt-1.5">
                                                {formatAutomationCompatibilityIssue(selectedShortcutCompatibility.issues[0])}
                                            </div>
                                        )}
                                    </div>
                                )}
                                {!shortcutsLoading && savedShortcuts.length === 0 && (
                                    <p className="mt-1.5 text-xs text-status-warning">
                                        Save a shortcut from Builder first, then come back to create an automation.
                                    </p>
                                )}
                                <div className="mt-2 flex items-start gap-2 rounded-lg border border-brand/15 bg-brand-subtle px-3 py-2 text-xs text-fg-secondary">
                                    <Zap size={12} className="mt-0.5 shrink-0 text-brand-light" />
                                    <span>
                                        The linked shortcut is the workflow. This automation only decides <strong className="text-fg">when</strong> that shortcut runs.
                                    </span>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-fg-secondary mb-2">
                                    When should it trigger?
                                </label>
                                <div className="flex flex-col gap-2">
                                    {[
                                        { value: "price_below", label: "Price — when it drops below a target" },
                                        { value: "price_above", label: "Price — when it rises above a target" },
                                        { value: "scheduled", label: "Scheduled — at specific times" },
                                    ].map((opt) => (
                                        <label
                                            key={opt.value}
                                            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${form.triggerType === opt.value
                                                ? "border-brand bg-brand-subtle"
                                                : "border-border-subtle hover:border-border-default"
                                                }`}
                                        >
                                            <input
                                                type="radio"
                                                name="triggerType"
                                                value={opt.value}
                                                checked={form.triggerType === opt.value as WizardState["triggerType"]}
                                                onChange={() => upd("triggerType", opt.value as WizardState["triggerType"])}
                                                className="sr-only"
                                            />
                                            <span className="text-sm text-fg">{opt.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* Price trigger params */}
                            {(form.triggerType === "price_below" || form.triggerType === "price_above") && (
                                <div className="grid gap-3">
                                    <div>
                                        <label className="block text-xs font-medium text-fg-muted mb-1">Token</label>
                                        <TokenParamInput
                                            value={form.priceToken || ""}
                                            onChange={(val) => upd("priceToken", val)}
                                            networkId={networkId}
                                            allowedSymbols={PRICE_TRIGGER_SYMBOLS}
                                            allowCustomAddress={false}
                                            placeholder="Search Base token"
                                            emptyMessage="No supported price token matches on this Base network."
                                            hint="Price triggers use supported Base registry tokens only."
                                        />
                                        <p className="mt-1 text-[11px] text-fg-muted">
                                            Uses the current Base network token registry. Unknown contract addresses are not available for price triggers yet.
                                        </p>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-fg-muted mb-1">
                                            Price threshold (USD)
                                        </label>
                                        <input
                                            type="number"
                                            className="w-full px-3 py-2 text-sm bg-primary border border-border-subtle rounded-lg outline-none focus:border-brand text-fg placeholder:text-fg-muted transition-colors"
                                            value={form.priceUsd}
                                            onChange={(e) => upd("priceUsd", e.target.value)}
                                            placeholder="2000"
                                            min="0"
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Scheduled trigger params */}
                            {form.triggerType === "scheduled" && (
                                <div>
                                    <label className="block text-xs font-medium text-fg-muted mb-2">Schedule</label>
                                    <div className="flex flex-col gap-1.5">
                                        {SCHEDULE_PRESETS.map((p) => (
                                            <label
                                                key={p.cron}
                                                className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all text-sm ${form.schedulePreset === p.cron
                                                    ? "border-brand bg-brand-subtle text-fg"
                                                    : "border-border-subtle text-fg-secondary hover:border-border-default"
                                                    }`}
                                            >
                                                <input
                                                    type="radio"
                                                    name="schedulePreset"
                                                    value={p.cron}
                                                    checked={form.schedulePreset === p.cron}
                                                    onChange={() => upd("schedulePreset", p.cron)}
                                                    className="sr-only"
                                                />
                                                {p.label}
                                            </label>
                                        ))}
                                    </div>
                                    {form.schedulePreset === "custom" && (
                                        <input
                                            type="text"
                                            className="mt-2 w-full px-3 py-2 text-sm bg-primary border border-border-subtle rounded-lg outline-none focus:border-brand text-fg font-mono placeholder:text-fg-muted transition-colors"
                                            value={customCron}
                                            onChange={(e) => setCustomCron(e.target.value)}
                                            placeholder="0 9 * * *"
                                        />
                                    )}
                                    <p className="mt-1.5 text-xs text-fg-muted">
                                        Scheduled automations are checked every 5 minutes. When due, Bavium prepares a run for the linked workflow.
                                    </p>
                                </div>
                            )}
                        </>
                    )}

                    {/* ── Step 2: Confirm ── */}
                    {step === "confirm" && (
                        <div className="flex flex-col gap-4">
                            {/* Summary */}
                            <div className="flex flex-col gap-2">
                                <SummaryRow label="Name" value={form.name || "New Automation"} />
                                <SummaryRow label="Trigger" value={
                                    form.triggerType === "scheduled"
                                        ? getCronDescription()
                                        : `${form.priceToken} ${form.triggerType === "price_below" ? "<" : ">"} $${form.priceUsd}`
                                } />
                                <SummaryRow label="Runs" value={selectedShortcut ? shortcutDisplayName(selectedShortcut) : "Selected shortcut"} />
                                <SummaryRow label="Category" value={selectedShortcut?.publicCategory ?? selectedShortcut?.category ?? "Uncategorized"} />
                                <SummaryRow label="Wallet" value={
                                    connectedAddress
                                        ? `${connectedAddress.slice(0, 6)}…${connectedAddress.slice(-4)}`
                                        : "No wallet connected"
                                } />
                                <SummaryRow
                                    label="Max Runs"
                                    value={form.maxExecutions === "0" ? "Unlimited" : form.maxExecutions}
                                />
                            </div>

                            {/* Max executions */}
                            <div>
                                <label className="block text-sm font-medium text-fg-secondary mb-1">
                                    Maximum run count
                                </label>
                                <input
                                    type="number"
                                    min="0"
                                    className="w-full px-3 py-2 text-sm bg-primary border border-border-subtle rounded-lg outline-none focus:border-brand text-fg"
                                    value={form.maxExecutions}
                                    onChange={(e) => upd("maxExecutions", e.target.value)}
                                />
                                <p className="mt-1 text-xs text-fg-muted">
                                    0 = unlimited. Note: real onchain transactions may incur costs when enabled.
                                </p>
                            </div>

                            <div className="flex items-start gap-2 p-3 rounded-lg bg-status-warning/8 border border-status-warning/20 text-sm text-status-warning">
                                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                                <span>
                                    <strong>Execution note:</strong> This automation prepares a run for the linked workflow when the trigger fires.
                                    If that workflow includes an onchain write, you still approve the wallet action from Runs before it submits.
                                </span>
                            </div>

                            {error && (
                                <div className="flex items-start gap-2 p-3 rounded-lg bg-status-error/10 border border-status-error/20 text-sm text-status-error">
                                    <XCircle size={14} className="mt-0.5 shrink-0" />
                                    {error}
                                </div>
                            )}
                            {!selectedShortcutIsCompatible && selectedShortcutCompatibility?.issues[0] && (
                                <div className="flex items-start gap-2 p-3 rounded-lg bg-status-warning/8 border border-status-warning/20 text-sm text-status-warning">
                                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                                    {formatAutomationCompatibilityIssue(selectedShortcutCompatibility.issues[0])}
                                </div>
                            )}
                        </div>
                    )}
                    </div>
                </div>

                {/* Footer nav */}
                <div className="flex items-center justify-between px-5 py-4 border-t border-border-subtle">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            if (step === "trigger") onClose();
                            else setStep("trigger");
                        }}
                    >
                        {step === "trigger" ? "Cancel" : "Back"}
                    </Button>

                    {step !== "confirm" ? (
                        <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            onClick={() => setStep("confirm")}
                            disabled={!canContinueToReview}
                            title={
                                !form.targetShortcutId
                                    ? "Select a shortcut and complete the trigger first"
                                    : !selectedShortcutIsCompatible
                                        ? "Select an automation-ready shortcut"
                                        : !canContinueToReview
                                            ? "Complete the trigger first"
                                            : undefined
                            }
                        >
                            Next
                            <ChevronRight size={14} />
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            onClick={handleCreate}
                            disabled={loading || !connectedAddress || !form.targetShortcutId || !selectedShortcutIsCompatible || savedShortcuts.length === 0}
                        >
                            {loading ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                            {loading ? "Creating…" : "Create Automation"}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-start gap-3 py-1.5 border-b border-border-subtle last:border-0">
            <span className="text-sm text-fg-muted w-[100px] shrink-0">{label}</span>
            <span className="text-sm text-fg font-medium">{value}</span>
        </div>
    );
}

function AutomationDeleteDialog({
    automation,
    deleting,
    onCancel,
    onConfirm,
}: {
    automation: Automation | null;
    deleting: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    useEffect(() => {
        if (!automation) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !deleting) onCancel();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [deleting, onCancel, automation]);

    if (!automation) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <div className="absolute inset-0" onClick={() => !deleting && onCancel()} />
            <div className="relative z-10 w-full max-w-[480px] overflow-hidden rounded-xl border border-border-subtle bg-secondary shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                <div className="border-b border-border-subtle px-5 py-4">
                    <div className="text-[13px] font-semibold uppercase tracking-[0.14em] text-status-error">
                        Delete Automation
                    </div>
                    <h2 className="mt-1 text-lg font-semibold text-fg">
                        Delete this automation?
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-fg-secondary">
                        This permanently removes the automation trigger. The linked shortcut will not be deleted, but it will no longer run automatically.
                    </p>
                </div>
                <div className="px-5 py-4">
                    <div className="rounded-lg border border-border-subtle bg-primary/35 px-3 py-3">
                        <div className="break-words text-sm font-medium text-fg">
                            {automation.name}
                        </div>
                        <div className="mt-1 text-xs text-fg-muted">
                            {triggerSummary(automation.trigger)}
                        </div>
                    </div>
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-4">
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={deleting}
                        className="inline-flex h-9 items-center justify-center rounded-md border border-border-subtle bg-tertiary px-3 text-[13px] font-semibold text-fg-secondary hover:text-fg disabled:opacity-60 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={deleting}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-status-error/30 bg-status-error/10 px-3 text-[13px] font-semibold text-status-error hover:bg-status-error/15 disabled:opacity-60 transition-colors"
                    >
                        {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function AutomationsPage() {
    const { address } = useAccount();
    const { authState } = useAuthSession();
    const { networkId } = useActiveChain();
    const [automations, setAutomations] = useState<Automation[]>([]);
    const [logs, setLogs] = useState<Record<string, ExecutionLog[]>>({});
    const [savedShortcuts, setSavedShortcuts] = useState<SavedShortcutOption[]>([]);
    const [shortcutsLoading, setShortcutsLoading] = useState(false);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [showWizard, setShowWizard] = useState(false);
    const [accessState, setAccessState] = useState<"ready" | "unauthorized" | "unavailable" | "error">("ready");
    const [actionBusyId, setActionBusyId] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [loadingMore, setLoadingMore] = useState(false);
    const [deleteCandidate, setDeleteCandidate] = useState<Automation | null>(null);

    const shortcutNames = useMemo<Record<string, string>>(
        () => Object.fromEntries(savedShortcuts.map((shortcut) => [shortcut._id, shortcutDisplayName(shortcut)])),
        [savedShortcuts],
    );

    const fetchAutomations = useCallback(async (cursor?: string) => {
        if (authState !== "authenticated") {
            setAutomations([]);
            setNextCursor(null);
            setLoading(false);
            setAccessState("unauthorized");
            return;
        }

        if (!cursor) {
            setLoading(true);
        }
        try {
            const params = new URLSearchParams();
            params.set("limit", "20");
            if (cursor) params.set("cursor", cursor);

            const res = await fetch(`/api/automations?${params.toString()}`);
            if (res.status === 401) {
                setAutomations([]);
                setNextCursor(null);
                setAccessState("unauthorized");
                return;
            }
            if (res.status === 503) {
                setAutomations([]);
                setNextCursor(null);
                setAccessState("unavailable");
                return;
            }
            if (!res.ok) {
                if (!cursor) {
                    setAccessState("error");
                }
                return;
            }
            const data = await res.json() as {
                automations?: Automation[];
                continueCursor?: string;
                isDone?: boolean;
            };
            const nextAutomations = Array.isArray(data.automations) ? data.automations : [];

            setAccessState("ready");
            setNextCursor(data.isDone ? null : (data.continueCursor ?? null));
            if (cursor) {
                setAutomations((prev) => [...prev, ...nextAutomations]);
            } else {
                setAutomations(nextAutomations);
            }
        } catch {
            if (!cursor) {
                setAccessState("error");
            }
        } finally {
            if (!cursor) {
                setLoading(false);
            }
        }
    }, [authState]);

    useEffect(() => {
        if (authState === "loading") {
            return;
        }

        if (authState !== "authenticated") {
            setAutomations([]);
            setNextCursor(null);
            setLoading(false);
            setAccessState("unauthorized");
            return;
        }

        void fetchAutomations();
    }, [authState, fetchAutomations]);

    const handleLoadMore = useCallback(async () => {
        if (!nextCursor || loadingMore) return;
        setLoadingMore(true);
        await fetchAutomations(nextCursor);
        setLoadingMore(false);
    }, [fetchAutomations, loadingMore, nextCursor]);

    useEffect(() => {
        let cancelled = false;

        async function loadSavedShortcuts() {
            if (authState !== "authenticated") {
                setSavedShortcuts([]);
                setShortcutsLoading(false);
                return;
            }

            setShortcutsLoading(true);

            try {
                const res = await fetch("/api/shortcuts?limit=100", { credentials: "include" });
                if (!res.ok) return;

                const data = await res.json() as { shortcuts?: SavedShortcutOption[] };
                if (cancelled || !Array.isArray(data.shortcuts)) return;

                setSavedShortcuts(data.shortcuts);
            } catch {
                if (!cancelled) {
                    setSavedShortcuts([]);
                }
            } finally {
                if (!cancelled) {
                    setShortcutsLoading(false);
                }
            }
        }

        void loadSavedShortcuts();
        return () => {
            cancelled = true;
        };
    }, [authState]);

    // Fetch logs when expanding
    const handleExpand = useCallback(
        async (id: string) => {
            setExpandedId((prev) => (prev === id ? null : id));
            if (!logs[id]) {
                try {
                    const res = await fetch(`/api/automations/${id}`);
                    if (res.ok) {
                        const data = await res.json();
                        setLogs((prev) => ({ ...prev, [id]: data.logs ?? [] }));
                    }
                } catch { /* ignore */ }
            }
        },
        [logs],
    );

    const handlePause = async (id: string) => {
        setActionBusyId(id);
        setActionError(null);
        try {
            const res = await fetch(`/api/automations/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "paused" }),
            });
            const data = await res.json().catch(() => ({})) as { error?: string };
            if (!res.ok) {
                throw new Error(data.error ?? "Failed to pause automation.");
            }
            await fetchAutomations();
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Failed to pause automation.");
        } finally {
            setActionBusyId(null);
        }
    };

    const handleResume = async (id: string) => {
        setActionBusyId(id);
        setActionError(null);
        try {
            const res = await fetch(`/api/automations/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "active" }),
            });
            const data = await res.json().catch(() => ({})) as { error?: string };
            if (!res.ok) {
                throw new Error(data.error ?? "Failed to resume automation.");
            }
            await fetchAutomations();
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Failed to resume automation.");
        } finally {
            setActionBusyId(null);
        }
    };

    const handleDeleteClick = (id: string) => {
        const auto = automations.find((a) => a.id === id);
        if (auto) setDeleteCandidate(auto);
    };

    const confirmDelete = async () => {
        if (!deleteCandidate) return;
        const id = deleteCandidate.id;
        setActionBusyId(id);
        setActionError(null);
        try {
            const res = await fetch(`/api/automations/${id}`, { method: "DELETE" });
            const data = await res.json().catch(() => ({})) as { error?: string };
            if (!res.ok) {
                throw new Error(data.error ?? "Failed to delete automation.");
            }
            await fetchAutomations();
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Failed to delete automation.");
        } finally {
            setActionBusyId(null);
            setDeleteCandidate(null);
        }
    };

    return (
        <>
            {showWizard && (
                <CreationWizard
                    connectedAddress={address}
                    networkId={networkId}
                    savedShortcuts={savedShortcuts}
                    shortcutsLoading={shortcutsLoading}
                    onClose={() => setShowWizard(false)}
                    onCreated={() => {
                        setShowWizard(false);
                        void fetchAutomations();
                    }}
                />
            )}

            <div className="w-full max-w-5xl mx-auto pb-12 pt-2 flex flex-col gap-6">
                {/* Page header */}
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-6 gap-4">
                    <div className="flex-1">
                        <h1 className="text-[24px] font-bold tracking-tight text-fg mb-2">
                            Automations
                        </h1>
                        <p className="text-[15px] text-fg-secondary leading-relaxed max-w-[500px]">
                            Run saved shortcuts when price targets or schedules fire.
                        </p>
                    </div>

                    <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => setShowWizard(true)}
                        disabled={authState !== "authenticated"}
                        title={
                            authState === "connected_unauthenticated"
                                ? "Finish signing in first"
                                : authState !== "authenticated"
                                    ? "Connect your wallet first"
                                    : undefined
                        }
                    >
                        <Plus size={14} />
                        New
                    </Button>
                </div>

                {/* Wallet warning */}
                {authState === "disconnected" && (
                    <div className="flex items-center gap-3 p-4 bg-status-warning/8 border border-status-warning/20 rounded-lg text-sm text-status-warning">
                        <AlertTriangle size={16} className="shrink-0" />
                        <span>Connect your wallet to view and create automations.</span>
                    </div>
                )}

                {authState === "connected_unauthenticated" && (
                    <div className="flex items-center gap-3 p-4 bg-status-warning/8 border border-status-warning/20 rounded-lg text-sm text-status-warning">
                        <AlertTriangle size={16} className="shrink-0" />
                        <span>Finish signing in to view and create automations.</span>
                    </div>
                )}

                {actionError && (
                    <div className="flex items-center gap-3 p-4 bg-status-error/10 border border-status-error/20 rounded-lg text-sm text-status-error">
                        <XCircle size={16} className="shrink-0" />
                        <span>{actionError}</span>
                    </div>
                )}

                {/* Automations info */}
                <div className="grid grid-cols-3 gap-3 sm:gap-4">
                    {[
                        {
                            label: "Total",
                            value: `${automations.length}${nextCursor ? "+" : ""}`,
                            icon: Layers,
                            pulse: false,
                        },
                        {
                            label: "Active",
                            value: `${automations.filter((a) => a.status === "active").length}${nextCursor ? "+" : ""}`,
                            icon: Zap,
                            pulse: automations.some((a) => a.status === "active"),
                        },
                        {
                            label: "Completed",
                            value: `${automations.reduce((s, a) => s + a.executionCount, 0)}${nextCursor ? "+" : ""}`,
                            icon: CheckCircle2,
                            pulse: false,
                        },
                    ].map((stat) => {
                        const Icon = stat.icon;
                        return (
                            <div
                                key={stat.label}
                                className="group relative flex flex-col p-3.5 sm:p-5 rounded-[14px] sm:rounded-xl overflow-hidden border border-border-subtle hover:border-border-default hover:shadow-lg transition-all duration-300 bg-gradient-to-br from-white/[0.04] to-transparent"
                            >
                                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                                <div className="flex items-center justify-between mb-2 sm:mb-3 relative z-10">
                                    <h3 className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-fg-muted truncate">
                                        {stat.label}
                                    </h3>
                                    {stat.pulse ? (
                                        <div className="relative flex h-2 w-2 items-center justify-center shrink-0 ml-1">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-status-success/80 opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-status-success"></span>
                                        </div>
                                    ) : (
                                        <Icon size={14} className="text-fg-muted/40 transition-colors group-hover:text-fg-secondary shrink-0 ml-1 hidden sm:block" />
                                    )}
                                </div>
                                <div className="text-2xl sm:text-[32px] leading-none font-medium sm:font-light tracking-tight text-fg relative z-10">
                                    {stat.value}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* List */}
                {loading ? (
                    <div className="flex flex-col gap-3 mt-4">
                        <Skeleton className="w-full h-24 rounded-lg" />
                        <Skeleton className="w-full h-24 rounded-lg" />
                        <Skeleton className="w-full h-24 rounded-lg" />
                    </div>
                ) : accessState === "unavailable" ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <h3 className="text-xl font-medium tracking-tight text-fg mb-2">Backend unavailable</h3>
                        <p className="text-[15px] text-fg-muted max-w-sm leading-relaxed">
                            Automations are unavailable until the Convex backend is configured.
                        </p>
                    </div>
                ) : accessState === "error" ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <h3 className="text-xl font-medium tracking-tight text-fg mb-2">Failed to load automations</h3>
                        <p className="text-[15px] text-fg-muted max-w-sm leading-relaxed">
                            Something went wrong while loading your automation list.
                        </p>
                    </div>
                ) : accessState === "unauthorized" ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <h3 className="text-xl font-medium tracking-tight text-fg mb-2">Authentication required</h3>
                        <p className="text-[15px] text-fg-muted max-w-sm leading-relaxed">
                            Finish signing in with your wallet to view and manage automations.
                        </p>
                    </div>
                ) : automations.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-28 text-center">
                        <h3 className="text-2xl font-semibold tracking-tight text-fg mb-2">No automations yet</h3>
                        <p className="text-[15px] text-fg-muted mb-6 max-w-sm leading-relaxed">
                            Create triggers that run one of your saved shortcuts on a schedule or price condition.
                        </p>
                        {authState === "authenticated" && (
                            <Button
                                type="button"
                                variant="primary"
                                onClick={() => setShowWizard(true)}
                                className="px-6"
                            >
                                <Plus size={14} className="mr-1.5" />
                                Create Your First Automation
                            </Button>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {automations.map((auto) => (
                            <AutomationCard
                                key={auto.id}
                                auto={auto}
                                onPause={handlePause}
                                onResume={handleResume}
                                onDelete={handleDeleteClick}
                                onExpand={handleExpand}
                                expanded={expandedId === auto.id}
                                logs={logs[auto.id] ?? []}
                                linkedShortcutName={
                                    auto.targetShortcutId
                                        ? shortcutNames[auto.targetShortcutId]
                                        : undefined
                                }
                                actionPending={actionBusyId === auto.id}
                            />
                        ))}

                        {nextCursor && (
                            <div className="pt-2">
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    onClick={handleLoadMore}
                                    disabled={loadingMore}
                                >
                                    {loadingMore ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                                    {loadingMore ? "Loading…" : "Load More"}
                                </Button>
                            </div>
                        )}
                    </div>
                )}
            </div>
            <AutomationDeleteDialog
                automation={deleteCandidate}
                deleting={Boolean(deleteCandidate && actionBusyId === deleteCandidate.id)}
                onCancel={() => {
                    if (actionBusyId !== deleteCandidate?.id) setDeleteCandidate(null);
                }}
                onConfirm={() => void confirmDelete()}
            />
        </>
    );
}
