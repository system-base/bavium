"use client";

import { useState, useCallback, useEffect } from "react";
import { CheckCircle2, XCircle, Loader2, Clock, Layers, ChevronRight, ArrowLeft, RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuthSession } from "@/hooks/useAuthSession";
import { Skeleton } from "@/components/ui/Skeleton";
import type { ShortcutInput, ShortcutStep } from "@/engine/types";
import type { BlockCategory } from "@/lib/constants";
import { shortcutToBuilderBlocks } from "@/lib/builder-shortcut";
import {
    createBuilderDraftHandoff,
    writeBuilderDraftHandoff,
} from "@/lib/builder-ai-handoff";
import { SharePreparationCard } from "@/components/social/SharePreparationCard";
import { X402DiscoveryCard } from "@/components/x402/X402DiscoveryCard";
import {
    parseSocialSharePreparationSummary,
    type SocialSharePreparationData,
} from "@/lib/social-share";
import {
    parseX402DiscoverySummary,
    type X402DiscoverySummaryData,
} from "@/lib/x402-bazaar";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RunStep {
    id: string;
    label: string;
    status: "success" | "error" | "pending";
    message?: string;
    durationMs?: number;
}

interface RunRecord {
    id: string;
    name: string;
    status: "success" | "error" | "running";
    steps: RunStep[];
    duration: string;
    time: string;
    definitionSnapshot?: RunDefinitionSnapshot;
}

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

interface StatusDisplay {
    icon: typeof CheckCircle2;
    bg: string;
    text: string;
}

const STATUS_CONFIG: Record<RunRecord["status"], StatusDisplay> = {
    success: { icon: CheckCircle2, bg: "bg-status-success/10 border-status-success/20", text: "text-status-success" },
    error: { icon: XCircle, bg: "bg-status-error/10 border-status-error/20", text: "text-status-error" },
    running: { icon: Loader2, bg: "bg-brand/10 border-brand/20", text: "text-brand-light" },
};

const STEP_DOT_COLOR: Record<RunStep["status"], string> = {
    success: "bg-status-success",
    error: "bg-status-error",
    pending: "bg-border-strong",
};

const STEP_STATUS_STYLE: Record<RunStep["status"], { bg: string; text: string }> = {
    success: { bg: "bg-status-success/10 border border-status-success/20", text: "text-status-success" },
    error: { bg: "bg-status-error/10 border border-status-error/20", text: "text-status-error" },
    pending: { bg: "bg-tertiary border border-border-subtle", text: "text-fg-muted" },
};

interface ApiRun {
    _id: string;
    name: string;
    status: string;
    startedAt: string;
    completedAt?: string;
    definitionSnapshot?: RunDefinitionSnapshot;
}

interface ApiRunStep {
    _id: string;
    stepId: string;
    label: string;
    status: string;
    outputSummary?: string;
    error?: string;
    durationMs?: number;
}

interface RunDefinitionSnapshot {
    name: string;
    description?: string;
    category: BlockCategory;
    inputs: ShortcutInput[];
    steps: ShortcutStep[];
    networkId?: string;
    capturedAt: string;
}

function formatRelativeTime(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function formatDuration(startedAt: string, completedAt?: string): string {
    if (!completedAt) return "in progress";
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    if (durationMs < 1000) return `${durationMs}ms`;
    return `${(durationMs / 1000).toFixed(1)}s`;
}

function mapRunStatus(status: string): RunRecord["status"] {
    if (status === "succeeded") return "success";
    if (status === "failed" || status === "canceled") return "error";
    return "running";
}

function mapStepStatus(status: string): RunStep["status"] {
    if (status === "success" || status === "succeeded") return "success";
    if (status === "error" || status === "failed" || status === "canceled") return "error";
    return "pending";
}

function mapRunRecord(run: ApiRun, steps: ApiRunStep[] = []): RunRecord {
    return {
        id: run._id,
        name: run.name,
        status: mapRunStatus(run.status),
        steps: steps.map((step) => ({
            id: step._id || step.stepId,
            label: step.label,
            status: mapStepStatus(step.status),
            message: step.error ?? step.outputSummary,
            durationMs: step.durationMs,
        })),
        duration: formatDuration(run.startedAt, run.completedAt),
        time: formatRelativeTime(run.startedAt),
        definitionSnapshot: run.definitionSnapshot,
    };
}

function parseJsonSummary(value: string): unknown | null {
    const trimmed = value.trim();
    if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
        return null;
    }

    try {
        return JSON.parse(trimmed);
    } catch {
        return null;
    }
}

function formatJsonPrimitive(value: unknown): string {
    if (value == null) return "null";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
    if (typeof value === "object") return "Object";
    return String(value);
}

function findLatestSharePreparation(steps: RunStep[]): SocialSharePreparationData | null {
    for (let index = steps.length - 1; index >= 0; index -= 1) {
        const message = steps[index]?.message;
        if (!message) continue;

        const sharePreparation = parseSocialSharePreparationSummary(message);
        if (sharePreparation) {
            return sharePreparation;
        }
    }

    return null;
}

function findLatestX402Discovery(steps: RunStep[]): X402DiscoverySummaryData | null {
    for (let index = steps.length - 1; index >= 0; index -= 1) {
        const message = steps[index]?.message;
        if (!message) continue;

        const x402Discovery = parseX402DiscoverySummary(message);
        if (x402Discovery) {
            return x402Discovery;
        }
    }

    return null;
}

function RunStepMessage({
    message,
    status,
}: {
    message: string;
    status: RunStep["status"];
}) {
    const sharePreparation = parseSocialSharePreparationSummary(message);
    const x402Discovery = parseX402DiscoverySummary(message);
    const parsed = parseJsonSummary(message);
    const statusTextClass = status === "success"
        ? "text-fg-secondary"
        : status === "error"
            ? "text-status-error"
            : "text-fg-muted";

    if (sharePreparation) {
        return (
            <SharePreparationCard
                data={sharePreparation}
                tone={status === "success" ? "success" : "default"}
            />
        );
    }

    if (x402Discovery) {
        return (
            <X402DiscoveryCard
                data={x402Discovery}
                tone={status === "success" ? "success" : "default"}
            />
        );
    }

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const entries = Object.entries(parsed as Record<string, unknown>).slice(0, 6);
        return (
            <div className="mt-2">
                <div className="grid gap-2 sm:grid-cols-2">
                    {entries.map(([key, value]) => (
                        <div
                            key={key}
                            className="rounded-lg border border-border-subtle bg-primary/35 px-3 py-2"
                        >
                            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-muted">
                                {key}
                            </div>
                            <div className="mt-1 break-words text-[13px] text-fg-secondary">
                                {formatJsonPrimitive(value)}
                            </div>
                        </div>
                    ))}
                </div>
                <details className="mt-3">
                    <summary className="cursor-pointer text-[12px] font-medium text-fg-muted hover:text-fg-secondary">
                        Recorded output
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-border-subtle bg-primary/45 p-3 text-[12px] leading-relaxed text-fg-secondary">
                        {JSON.stringify(parsed, null, 2)}
                    </pre>
                </details>
            </div>
        );
    }

    if (parsed && Array.isArray(parsed)) {
        return (
            <div className="mt-2">
                <p className={`text-[14px] leading-relaxed ${statusTextClass}`}>
                    Recorded {parsed.length} item{parsed.length === 1 ? "" : "s"}.
                </p>
                <details className="mt-2">
                    <summary className="cursor-pointer text-[12px] font-medium text-fg-muted hover:text-fg-secondary">
                        Recorded output
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-border-subtle bg-primary/45 p-3 text-[12px] leading-relaxed text-fg-secondary">
                        {JSON.stringify(parsed, null, 2)}
                    </pre>
                </details>
            </div>
        );
    }

    const isLong = message.length > 220;
    return (
        <div className="mt-1">
            <p className={`text-[14px] leading-relaxed ${statusTextClass}`}>
                {isLong ? `${message.slice(0, 220)}...` : message}
            </p>
            {isLong && (
                <details className="mt-2">
                    <summary className="cursor-pointer text-[12px] font-medium text-fg-muted hover:text-fg-secondary">
                        Full message
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-border-subtle bg-primary/45 p-3 text-[13px] leading-relaxed text-fg-secondary">
                        {message}
                    </p>
                </details>
            )}
        </div>
    );
}

function RunDeleteDialog({
    run,
    deleting,
    onCancel,
    onConfirm,
}: {
    run: RunRecord | null;
    deleting: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    useEffect(() => {
        if (!run) return;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !deleting) {
                onCancel();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [deleting, onCancel, run]);

    if (!run) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <div
                className="absolute inset-0"
                onClick={() => {
                    if (!deleting) onCancel();
                }}
            />
            <div className="relative z-10 w-full max-w-[480px] overflow-hidden rounded-xl border border-border-subtle bg-secondary shadow-2xl">
                <div className="border-b border-border-subtle px-5 py-4">
                    <div className="text-[13px] font-semibold uppercase tracking-[0.14em] text-status-error">
                        Delete Run
                    </div>
                    <h2 className="mt-1 text-lg font-semibold text-fg">
                        Delete this run?
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-fg-secondary">
                        This removes the run history and its recorded step logs. Your saved shortcut is not deleted.
                    </p>
                </div>
                <div className="px-5 py-4">
                    <div className="rounded-lg border border-border-subtle bg-primary/35 px-3 py-3">
                        <div className="break-words text-sm font-medium text-fg">
                            {run.name}
                        </div>
                        <div className="mt-1 text-xs text-fg-muted">
                            {run.time} · {run.duration}
                        </div>
                    </div>
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-4">
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={deleting}
                        className="inline-flex h-9 items-center justify-center rounded-md border border-border-subtle bg-tertiary px-3 text-[13px] font-semibold text-fg-secondary hover:text-fg disabled:opacity-60"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={deleting}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-status-error/30 bg-status-error/10 px-3 text-[13px] font-semibold text-status-error hover:bg-status-error/15 disabled:opacity-60"
                    >
                        {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
}

function RunDeleteAllDialog({
    open,
    deleting,
    onCancel,
    onConfirm,
}: {
    open: boolean;
    deleting: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
            <div className="w-full max-w-md overflow-hidden rounded-xl border border-border-subtle bg-secondary shadow-xl">
                <div className="border-b border-border-subtle px-5 py-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-status-error">
                        Delete All Runs
                    </div>
                    <h2 className="mt-1 text-lg font-semibold text-fg">
                        Delete all recorded runs?
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-fg-secondary">
                        This removes all run history and recorded step logs for your connected wallet. Saved shortcuts and automations are not deleted.
                    </p>
                </div>
                <div className="px-5 py-4">
                    <div className="rounded-lg border border-border-subtle bg-primary/35 px-3 py-3 text-sm text-fg-secondary">
                        Use this when your run history is cluttered and you want a clean slate before new tests or demos.
                    </div>
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-4">
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={deleting}
                        className="inline-flex h-9 items-center justify-center rounded-md border border-border-subtle bg-tertiary px-3 text-[13px] font-semibold text-fg-secondary hover:text-fg disabled:opacity-60"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={deleting}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-status-error/30 bg-status-error/10 px-3 text-[13px] font-semibold text-status-error hover:bg-status-error/15 disabled:opacity-60"
                    >
                        {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        Delete All
                    </button>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RunsPage() {
    const router = useRouter();
    const { authState } = useAuthSession();
    const [runs, setRuns] = useState<RunRecord[]>([]);
    const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadState, setLoadState] = useState<"idle" | "unauthorized" | "unavailable" | "error">("idle");
    const [selectedRun, setSelectedRun] = useState<RunRecord | null>(null);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [loadingMore, setLoadingMore] = useState(false);
    const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
    const [deleteCandidate, setDeleteCandidate] = useState<RunRecord | null>(null);
    const [deleteAllOpen, setDeleteAllOpen] = useState(false);
    const [deletingAllRuns, setDeletingAllRuns] = useState(false);
    const [runActionMessage, setRunActionMessage] = useState<string | null>(null);

    const loadRuns = useCallback(async (cursor?: string) => {
        if (authState !== "authenticated") {
            setRuns([]);
            setNextCursor(null);
            setLoading(false);
            setLoadState("unauthorized");
            return;
        }

        try {
            const params = new URLSearchParams();
            params.set("limit", "20");
            if (cursor) params.set("cursor", cursor);

            const res = await fetch(`/api/runs?${params.toString()}`, { credentials: "include" });
            if (res.status === 401) {
                setRuns([]);
                setLoadState("unauthorized");
                return;
            }

            if (res.status === 503) {
                setRuns([]);
                setLoadState("unavailable");
                return;
            }

            if (!res.ok) {
                throw new Error("Failed to load runs");
            }

            const data = await res.json() as {
                runs?: ApiRun[];
                continueCursor?: string;
                isDone?: boolean;
            };
            const newRuns = (data.runs ?? []).map((run) => mapRunRecord(run));

            if (cursor) {
                setRuns((prev) => [...prev, ...newRuns]);
            } else {
                setRuns(newRuns);
            }

            setNextCursor(data.isDone ? null : (data.continueCursor ?? null));
            setLoadState("idle");
        } catch {
            if (!cursor) setLoadState("error");
        } finally {
            setLoading(false);
        }
    }, [authState]);

    useEffect(() => {
        if (authState === "loading") {
            return;
        }

        if (authState !== "authenticated") {
            setRuns([]);
            setNextCursor(null);
            setLoading(false);
            setLoadState("unauthorized");
            return;
        }

        void loadRuns();
    }, [authState, loadRuns]);

    const handleLoadMore = useCallback(async () => {
        if (!nextCursor || loadingMore) return;
        setLoadingMore(true);
        await loadRuns(nextCursor);
        setLoadingMore(false);
    }, [nextCursor, loadingMore, loadRuns]);

    const handleRunClick = useCallback(async (id: string) => {
        setRunActionMessage(null);
        setSelectedRunId((prev) => (prev === id ? null : id));
        if (selectedRunId === id) {
            setSelectedRun(null);
            return;
        }

        try {
            const res = await fetch(`/api/runs/${id}`, { credentials: "include" });
            if (!res.ok) {
                throw new Error("Failed to load run detail");
            }
            const data = await res.json() as {
                run: ApiRun;
                steps: ApiRunStep[];
            };
            setSelectedRun(mapRunRecord(data.run, data.steps));
        } catch {
            setSelectedRun(null);
        }
    }, [selectedRunId]);

    const handleRestoreRun = useCallback((run: RunRecord) => {
        const snapshot = run.definitionSnapshot;
        if (!snapshot) {
            setRunActionMessage("This run does not include a restorable Builder snapshot.");
            return;
        }

        const blocks = shortcutToBuilderBlocks({
            category: snapshot.category,
            steps: snapshot.steps,
        });

        const handoff = createBuilderDraftHandoff(
            {
                shortcutName: snapshot.name,
                blocks,
                inputs: snapshot.inputs,
                shortcutCategoryOverride: snapshot.category,
            },
            "run-restore",
        );

        writeBuilderDraftHandoff(handoff);
        router.push("/builder");
    }, [router]);

    const requestDeleteRun = useCallback((run: RunRecord) => {
        setRunActionMessage(null);
        setDeleteCandidate(run);
    }, []);

    const confirmDeleteRun = useCallback(async () => {
        const run = deleteCandidate;
        if (!run) return;
        setDeletingRunId(run.id);
        setRunActionMessage(null);

        try {
            const res = await fetch(`/api/runs/${run.id}`, {
                method: "DELETE",
                credentials: "include",
            });

            if (!res.ok) {
                throw new Error("Failed to delete run");
            }

            setRuns((prev) => prev.filter((item) => item.id !== run.id));
            setSelectedRunId(null);
            setSelectedRun(null);
            setRunActionMessage("Run deleted.");
        } catch {
            setRunActionMessage("Run could not be deleted. Try again.");
        } finally {
            setDeletingRunId(null);
            setDeleteCandidate(null);
        }
    }, [deleteCandidate]);

    const confirmDeleteAllRuns = useCallback(async () => {
        setDeletingAllRuns(true);
        setRunActionMessage(null);

        try {
            const res = await fetch("/api/runs", {
                method: "DELETE",
                credentials: "include",
            });

            if (!res.ok) {
                throw new Error("Failed to delete runs");
            }

            const data = await res.json() as { deletedCount?: number };
            setRuns([]);
            setSelectedRunId(null);
            setSelectedRun(null);
            setNextCursor(null);
            setDeleteAllOpen(false);
            setRunActionMessage(
                data.deletedCount && data.deletedCount > 0
                    ? `Deleted ${data.deletedCount} run${data.deletedCount === 1 ? "" : "s"}.`
                    : "Run history cleared.",
            );
        } catch {
            setRunActionMessage("Runs could not be deleted. Try again.");
        } finally {
            setDeletingAllRuns(false);
        }
    }, []);

    // Detail view
    if (selectedRun) {
        const cfg = STATUS_CONFIG[selectedRun.status];
        const StatusIcon = cfg.icon;
        const latestSharePreparation = findLatestSharePreparation(selectedRun.steps);
        const latestX402Discovery = findLatestX402Discovery(selectedRun.steps);

        return (
            <>
            <div className="w-full max-w-5xl mx-auto pb-12 pt-2 animate-fade-in">
                {/* Back button */}
                <button
                    type="button"
                    className="inline-flex items-center gap-2 h-8 px-3 rounded-md text-[13px] font-medium text-fg-secondary hover:text-fg hover:bg-secondary border border-transparent hover:border-border-default transition-all mb-6"
                    onClick={() => {
                        setSelectedRunId(null);
                        setSelectedRun(null);
                    }}
                >
                    <ArrowLeft size={14} />
                    Back to Runs
                </button>

                {/* Header Card */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 bg-secondary border border-border-subtle rounded-xl p-6 mb-6">
                    <div className={`flex items-center justify-center w-12 h-12 rounded-full shrink-0 border ${cfg.bg} ${cfg.text}`}>
                        <StatusIcon size={24} className={selectedRun.status === "running" ? "animate-spin" : ""} />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-[20px] font-semibold tracking-tight text-fg mb-1">
                            {selectedRun.name}
                        </h1>
                        <div className="flex items-center gap-3 text-[14px] text-fg-muted">
                            <span className="flex items-center gap-1.5"><Clock size={14} /> {selectedRun.time}</span>
                            <span className="w-1 h-1 rounded-full bg-border-strong" />
                            <span>{selectedRun.duration}</span>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                        {selectedRun.definitionSnapshot ? (
                            <button
                                type="button"
                                onClick={() => handleRestoreRun(selectedRun)}
                                className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-brand text-primary text-[13px] font-semibold hover:opacity-90 transition-opacity"
                            >
                                <RotateCcw size={14} />
                                Restore in Builder
                            </button>
                        ) : (
                            <span className="inline-flex items-center h-9 px-3 rounded-md bg-tertiary border border-border-subtle text-[12px] text-fg-muted">
                                Restore unavailable
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={() => requestDeleteRun(selectedRun)}
                            disabled={deletingRunId === selectedRun.id}
                            className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-status-error/30 bg-status-error/10 text-[13px] font-semibold text-status-error hover:bg-status-error/15 disabled:opacity-60 transition-colors"
                        >
                            {deletingRunId === selectedRun.id ? (
                                <Loader2 size={14} className="animate-spin" />
                            ) : (
                                <Trash2 size={14} />
                            )}
                            Delete
                        </button>
                    </div>
                </div>

                {runActionMessage && (
                    <div className="mb-6 rounded-lg border border-border-subtle bg-secondary px-4 py-3 text-[14px] text-fg-secondary">
                        {runActionMessage}
                    </div>
                )}

                {latestSharePreparation && (
                    <div className="mb-6">
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
                            Latest Share Output
                        </div>
                        <SharePreparationCard
                            data={latestSharePreparation}
                            tone={selectedRun.status === "success" ? "success" : "default"}
                        />
                    </div>
                )}

                {latestX402Discovery && (
                    <div className="mb-6">
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
                            Latest x402 Discovery
                        </div>
                        <X402DiscoveryCard
                            data={latestX402Discovery}
                            tone={selectedRun.status === "success" ? "success" : "default"}
                        />
                    </div>
                )}

                {/* Step list Timeline */}
                <div className="flex flex-col gap-3">
                    {selectedRun.steps.length === 0 ? (
                        <div className="p-5 bg-secondary border border-border-subtle border-dashed rounded-xl text-[14px] text-fg-muted">
                            No step details were recorded for this run.
                        </div>
                    ) : selectedRun.steps.map((step, i) => {
                        const stepStyle = STEP_STATUS_STYLE[step.status];
                        return (
                            <div
                                key={step.id}
                                className="flex items-start gap-3 p-4 bg-secondary border border-border-subtle shadow-sm rounded-xl transition-all"
                            >
                                <div
                                    className={`flex items-center justify-center w-7 h-7 rounded-full shrink-0 mt-0.5 ${stepStyle.bg} ${stepStyle.text}`}
                                >
                                    {step.status === "success" ? (
                                        <CheckCircle2 size={14} />
                                    ) : step.status === "error" ? (
                                        <XCircle size={14} />
                                    ) : (
                                        <span className="text-[12px] font-semibold">{i + 1}</span>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-3 mb-1">
                                        <span className="text-[15px] font-semibold text-fg">
                                            {step.label}
                                        </span>
                                        {step.durationMs != null && (
                                            <span className="inline-flex items-center h-6 px-2.5 rounded-md bg-tertiary border border-border-subtle text-[12px] font-medium text-fg-muted shrink-0">
                                                {step.durationMs}ms
                                            </span>
                                        )}
                                    </div>
                                    {step.message && (
                                        <RunStepMessage
                                            message={step.message}
                                            status={step.status}
                                        />
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
            <RunDeleteDialog
                run={deleteCandidate}
                deleting={Boolean(deleteCandidate && deletingRunId === deleteCandidate.id)}
                onCancel={() => {
                    if (!deletingRunId) setDeleteCandidate(null);
                }}
                onConfirm={() => void confirmDeleteRun()}
            />
            </>
        );
    }

    return (
        <div className="w-full max-w-5xl mx-auto pb-12 animate-fade-in">
            <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-[24px] font-bold tracking-tight text-fg mb-2">
                        Execution Runs
                    </h1>
                    <p className="text-[15px] text-fg-secondary leading-relaxed max-w-[500px]">
                        Detailed execution history for your shortcuts. Click any run to review its step-by-step logs and performance.
                    </p>
                </div>
                {runs.length > 0 && loadState === "idle" && (
                    <button
                        type="button"
                        onClick={() => {
                            setRunActionMessage(null);
                            setDeleteAllOpen(true);
                        }}
                        disabled={deletingAllRuns}
                        className="inline-flex h-9 items-center justify-center gap-2 self-start rounded-md border border-status-error/25 bg-status-error/10 px-3 text-[13px] font-semibold text-status-error transition-colors hover:bg-status-error/15 disabled:opacity-60 sm:self-auto"
                    >
                        {deletingAllRuns ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            <Trash2 size={14} />
                        )}
                        Delete All
                    </button>
                )}
            </div>

            {runActionMessage && (
                <div className="mb-5 rounded-lg border border-border-subtle bg-secondary px-4 py-3 text-[14px] text-fg-secondary">
                    {runActionMessage}
                </div>
            )}

            {loading ? (
                <div className="flex flex-col gap-3">
                    <Skeleton className="w-full h-20 rounded-xl" />
                    <Skeleton className="w-full h-20 rounded-xl" />
                    <Skeleton className="w-full h-20 rounded-xl" />
                    <Skeleton className="w-full h-20 rounded-xl" />
                </div>
            ) : loadState === "unauthorized" ? (
                <div className="flex flex-col items-center justify-center py-20 bg-secondary border border-border-subtle border-dashed rounded-xl text-center">
                    <XCircle size={40} className="text-fg-muted mb-4 opacity-70" />
                    <p className="text-[15px] text-fg font-medium">
                        {authState === "connected_unauthenticated"
                            ? "Finish signing in to view your runs."
                            : "Connect your wallet to view your runs."}
                    </p>
                    <p className="text-[14px] text-fg-muted mt-1 max-w-[320px]">
                        {authState === "connected_unauthenticated"
                            ? "Your wallet is connected, but your session is not active yet. Sign the login message, then try again."
                            : "Run history is only available for your connected account."}
                    </p>
                </div>
            ) : loadState === "unavailable" ? (
                <div className="flex flex-col items-center justify-center py-20 bg-secondary border border-border-subtle border-dashed rounded-xl text-center">
                    <XCircle size={40} className="text-status-warning mb-4 opacity-80" />
                    <p className="text-[15px] text-status-warning font-medium">
                        Convex backend is not configured.
                    </p>
                    <p className="text-[14px] text-fg-muted mt-1 max-w-[320px]">
                        Run history is unavailable until the backend connection is configured.
                    </p>
                </div>
            ) : loadState === "error" ? (
                <div className="flex flex-col items-center justify-center py-20 bg-secondary border border-border-subtle border-dashed rounded-xl text-center">
                    <XCircle size={40} className="text-status-error mb-4 opacity-80" />
                    <p className="text-[15px] text-status-error font-medium">
                        Failed to load runs.
                    </p>
                </div>
            ) : runs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 bg-secondary border border-border-subtle border-dashed rounded-xl text-center">
                    <Clock size={40} className="text-fg-muted mb-4 opacity-50" />
                    <p className="text-[15px] text-fg-muted font-medium">
                        No runs recorded yet.
                    </p>
                    <p className="text-[14px] text-fg-muted mt-1 max-w-[300px]">
                        Run a workflow in the Builder to see its execution results here.
                    </p>
                </div>
            ) : (
                <>
                <div className="flex flex-col gap-3">
                    {runs.map((run) => {
                        const cfg = STATUS_CONFIG[run.status];
                        const StatusIcon = cfg.icon;
                        return (
                            <div
                                key={run.id}
                                className="group flex flex-col gap-3 bg-secondary border border-border-subtle rounded-xl p-4 transition-all hover:border-border-default hover:shadow-md sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-4"
                            >
                                <button
                                    type="button"
                                    className="flex min-w-0 flex-1 items-center gap-4 text-left"
                                    onClick={() => handleRunClick(run.id)}
                                >
                                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${cfg.bg} ${cfg.text} group-hover:scale-105 transition-transform`}>
                                        <StatusIcon size={18} className={run.status === "running" ? "animate-spin" : ""} />
                                    </div>

                                    <div className="flex min-w-0 flex-1 flex-col">
                                        <div className="mb-1 truncate text-[16px] font-semibold text-fg">
                                            {run.name}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-3 text-[13px] text-fg-muted">
                                            <span className="flex items-center gap-1.5 font-medium">
                                                <Layers size={14} className="opacity-70" />
                                                Open details
                                            </span>
                                            <span className="flex items-center gap-1.5">
                                                <Clock size={14} className="opacity-70" />
                                                {run.time}
                                            </span>
                                            <span className="hidden sm:inline-block">
                                                {run.duration}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full bg-tertiary text-fg-muted transition-colors group-hover:bg-fg group-hover:text-primary sm:flex">
                                        <ChevronRight size={16} />
                                    </div>
                                </button>

                                <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border-subtle pt-3 sm:ml-2 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                                    {run.definitionSnapshot ? (
                                        <button
                                            type="button"
                                            onClick={() => handleRestoreRun(run)}
                                            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand px-2.5 text-[12px] font-semibold text-primary transition-opacity hover:opacity-90"
                                        >
                                            <RotateCcw size={13} />
                                            Restore
                                        </button>
                                    ) : (
                                        <span className="inline-flex h-8 items-center rounded-md border border-border-subtle bg-tertiary px-2.5 text-[12px] text-fg-muted">
                                            No snapshot
                                        </span>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => requestDeleteRun(run)}
                                        disabled={deletingRunId === run.id}
                                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-status-error/25 bg-status-error/10 px-2.5 text-[12px] font-semibold text-status-error transition-colors hover:bg-status-error/15 disabled:opacity-60"
                                    >
                                        {deletingRunId === run.id ? (
                                            <Loader2 size={13} className="animate-spin" />
                                        ) : (
                                            <Trash2 size={13} />
                                        )}
                                        Delete
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {nextCursor && (
                    <div className="flex justify-center mt-6">
                        <button
                            type="button"
                            className="px-5 py-2 text-sm font-medium text-fg-secondary bg-tertiary hover:bg-elevated border border-border-subtle hover:border-border-default rounded-lg transition-colors"
                            onClick={handleLoadMore}
                            disabled={loadingMore}
                        >
                            {loadingMore ? "Loading…" : "Load more"}
                        </button>
                    </div>
                )}
                </>
            )}
            <RunDeleteDialog
                run={deleteCandidate}
                deleting={Boolean(deleteCandidate && deletingRunId === deleteCandidate.id)}
                onCancel={() => {
                    if (!deletingRunId) setDeleteCandidate(null);
                }}
                onConfirm={() => void confirmDeleteRun()}
            />
            <RunDeleteAllDialog
                open={deleteAllOpen}
                deleting={deletingAllRuns}
                onCancel={() => {
                    if (!deletingAllRuns) setDeleteAllOpen(false);
                }}
                onConfirm={() => void confirmDeleteAllRuns()}
            />
        </div>
    );
}
