"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
    AlertTriangle,
    ArrowLeft,
    CheckCircle2,
    Clock3,
    ExternalLink,
    Globe,
    Layers,
    Loader2,
    Pencil,
    Trash2,
    Zap,
} from "lucide-react";
import PublishShortcutDialog from "@/components/gallery/PublishShortcutDialog";
import {
    ShortcutInputsSection,
    ShortcutOwnerOperationalSummary,
    ShortcutWorkflowSection,
} from "@/components/gallery/ShortcutDetailSections";
import { BaviumLogo } from "@/components/ui/BaviumLogo";
import { useAuthSession } from "@/hooks/useAuthSession";
import { isBlockCategoryValue } from "@/lib/block-categories";
import type { BlockCategory } from "@/lib/constants";
import { CATEGORY_ICONS, CATEGORY_META } from "@/lib/constants";

interface SavedShortcutDetail {
    _id: string;
    name: string;
    description?: string;
    category: string;
    version: string;
    createdAt: string;
    updatedAt: string;
    inputs: Array<{
        id: string;
        label: string;
        type: string;
        required?: boolean;
        defaultValue?: string;
    }>;
    steps: Array<{
        id: string;
        skill: string;
        action: string;
        label?: string;
        params?: Record<string, unknown>;
    }>;
}

interface PublicationSnapshot {
    slug: string;
    name: string;
    description?: string;
    category: string;
    status: "published" | "archived";
    publishVersion: number;
}

interface AutomationSummary {
    id: string;
    name: string;
    description?: string;
    status: "active" | "paused" | "completed" | "error" | string;
    targetShortcutId: string;
    nextRunAt?: string;
}

type PageStatus = "loading" | "ready" | "unauthorized" | "not_found" | "unavailable" | "error";
type RelationStatus = "idle" | "loading" | "ready" | "error";

const SKILL_COLORS: Record<string, string> = {
    wallet: "var(--color-block-wallet)",
    swap: "var(--color-block-swap)",
    bridge: "var(--color-block-bridge)",
    defi: "var(--color-block-defi)",
    nft: "var(--color-block-nft)",
    social: "var(--color-block-social)",
    data: "var(--color-block-data)",
    x402: "var(--color-block-x402)",
    logic: "var(--color-block-logic)",
};

function stepLabel(step: { skill: string; action: string; label?: string }): string {
    if (step.label) return step.label;
    return step.action
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

function skillDisplayName(skill: string): string {
    return skill.charAt(0).toUpperCase() + skill.slice(1);
}

function getSkillColor(skill: string): string {
    return SKILL_COLORS[skill] ?? "var(--color-fg-muted)";
}

function formatMetaDate(value: string): string {
    return new Date(value).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

function formatDateTime(value: string): string {
    return new Date(value).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

function automationStatusClass(status: string): string {
    if (status === "active") return "bg-status-success/10 text-status-success";
    if (status === "paused") return "bg-status-warning/10 text-status-warning";
    if (status === "error") return "bg-status-error/10 text-status-error";
    return "bg-tertiary text-fg-muted";
}

export default function SavedShortcutDetailPage() {
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { authState } = useAuthSession();
    const shortcutId = typeof params.id === "string" ? params.id : "";

    const [status, setStatus] = useState<PageStatus>("loading");
    const [shortcut, setShortcut] = useState<SavedShortcutDetail | null>(null);
    const [publicationStatus, setPublicationStatus] = useState<RelationStatus>("idle");
    const [publication, setPublication] = useState<PublicationSnapshot | null>(null);
    const [publicationError, setPublicationError] = useState<string | null>(null);
    const [automationsStatus, setAutomationsStatus] = useState<RelationStatus>("idle");
    const [linkedAutomations, setLinkedAutomations] = useState<AutomationSummary[]>([]);
    const [automationsError, setAutomationsError] = useState<string | null>(null);
    const [deleteState, setDeleteState] = useState<"idle" | "confirm" | "deleting">("idle");
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false);
    const deleteSectionRef = useRef<HTMLDivElement | null>(null);

    const loadManageSurface = useCallback(async () => {
        const response = await fetch(`/api/shortcuts/${shortcutId}/manage`, {
            credentials: "include",
        });

        if (response.status === 401) {
            return { kind: "unauthorized" as const };
        }
        if (response.status === 404) {
            return { kind: "not_found" as const };
        }
        if (response.status === 503) {
            return { kind: "unavailable" as const };
        }
        if (!response.ok) {
            throw new Error("Failed to load shortcut management surface.");
        }

        const data = await response.json() as {
            shortcut?: SavedShortcutDetail;
            publication?: PublicationSnapshot | null;
            automations?: AutomationSummary[];
        };
        if (!data.shortcut) {
            return { kind: "not_found" as const };
        }

        return {
            kind: "ready" as const,
            shortcut: data.shortcut,
            publication: data.publication ?? null,
            automations: Array.isArray(data.automations) ? data.automations : [],
        };
    }, [shortcutId]);

    useEffect(() => {
        if (!shortcutId) {
            setStatus("not_found");
            setShortcut(null);
            setPublication(null);
            setLinkedAutomations([]);
            return;
        }

        if (authState === "loading") {
            setStatus("loading");
            return;
        }

        if (authState !== "authenticated") {
            setStatus("unauthorized");
            setShortcut(null);
            setPublication(null);
            setLinkedAutomations([]);
            setPublicationStatus("idle");
            setAutomationsStatus("idle");
            return;
        }

        let cancelled = false;

        async function hydrate() {
            setStatus("loading");
            setPublicationStatus("loading");
            setAutomationsStatus("loading");
            setDeleteError(null);
            setPublicationError(null);
            setAutomationsError(null);

            try {
                const result = await loadManageSurface();
                if (cancelled) return;

                if (result.kind === "ready") {
                    setShortcut(result.shortcut);
                    setPublication(result.publication);
                    setLinkedAutomations(result.automations);
                    setPublicationStatus("ready");
                    setAutomationsStatus("ready");
                    setStatus("ready");
                    return;
                }

                setShortcut(null);
                setPublication(null);
                setLinkedAutomations([]);
                setPublicationStatus("idle");
                setAutomationsStatus("idle");
                setStatus(result.kind);
            } catch {
                if (cancelled) return;
                setShortcut(null);
                setPublication(null);
                setLinkedAutomations([]);
                setPublicationStatus("idle");
                setAutomationsStatus("idle");
                setStatus("error");
            }
        }

        void hydrate();

        return () => {
            cancelled = true;
        };
    }, [authState, loadManageSurface, shortcutId]);

    const executionCategory = useMemo<BlockCategory>(() => {
        if (shortcut && isBlockCategoryValue(shortcut.category)) {
            return shortcut.category;
        }
        return "logic";
    }, [shortcut]);
    const publicCategory = useMemo<BlockCategory | null>(() => {
        if (publication && isBlockCategoryValue(publication.category)) {
            return publication.category;
        }
        return null;
    }, [publication]);
    const meta = CATEGORY_META[executionCategory];
    const CategoryIcon = CATEGORY_ICONS[executionCategory];
    const hasPublishedPublication = publication?.status === "published";
    const hasAutomationBlockers = linkedAutomations.length > 0;
    const hasKnownDeleteBlockers = hasPublishedPublication || hasAutomationBlockers;
    const displayName = publication?.name.trim() || shortcut?.name || "Untitled Shortcut";
    const displayDescription = publication?.description?.trim()
        || shortcut?.description?.trim()
        || "Manage this shortcut, its public details, linked automations, and delete guardrails here.";
    const visibilityLabel = hasPublishedPublication ? "Public" : "Private";
    const workflowSteps = (shortcut?.steps ?? []).map((step) => ({
        id: step.id,
        label: stepLabel(step),
        skillLabel: skillDisplayName(step.skill),
        color: getSkillColor(step.skill),
    }));
    const showMadePrivateNotice = searchParams.get("notice") === "made_private";
    const focusDeleteSection = searchParams.get("focus") === "delete";
    const isOperationalSummaryLoading = publicationStatus === "loading" || automationsStatus === "loading";
    const operationalVisibilityHint = hasPublishedPublication
        ? "Live in the gallery"
        : publication
            ? "Previously shared, private now"
            : "Only visible to you";
    const operationalLinkedAutomationsHint = hasAutomationBlockers
        ? "Still pointing at this shortcut"
        : "No active shortcut links";
    const operationalDeleteLabel = hasKnownDeleteBlockers ? "Locked" : "Available";
    const operationalDeleteHint = hasPublishedPublication
        ? hasAutomationBlockers
            ? "Requires private state and automation cleanup"
            : "Requires private state first"
        : hasAutomationBlockers
            ? "Requires automation cleanup first"
            : "Ready once you confirm";
    const operationalStatusPill = hasPublishedPublication
        ? "Make Private before Delete"
        : hasAutomationBlockers
            ? "Open Automations before Delete"
            : "Delete Ready";
    const operationalGuidance = hasPublishedPublication && hasAutomationBlockers
        ? `To fully delete this shortcut, first make it private, then update or remove ${linkedAutomations.length} linked automation${linkedAutomations.length !== 1 ? "s" : ""} from Automations.`
        : hasPublishedPublication
            ? "To fully delete this shortcut, make it private from its public page first."
            : hasAutomationBlockers
                ? `To fully delete this shortcut, update or remove ${linkedAutomations.length} linked automation${linkedAutomations.length !== 1 ? "s" : ""} from Automations first.`
                : "No current public visibility or automation blockers.";

    const handleDelete = async () => {
        if (!shortcut) return;

        if (deleteState === "idle") {
            setDeleteError(null);
            setDeleteState("confirm");
            return;
        }

        if (deleteState !== "confirm") {
            return;
        }

        setDeleteState("deleting");
        setDeleteError(null);

        try {
            const response = await fetch(`/api/shortcuts/${shortcut._id}`, {
                method: "DELETE",
                credentials: "include",
            });

            const data = await response.json().catch(() => ({})) as { error?: string };
            if (!response.ok) {
                throw new Error(data.error || "Failed to delete shortcut.");
            }

            router.push("/shortcuts?surface=my_shortcuts");
        } catch (error) {
            setDeleteError(
                error instanceof Error
                    ? error.message
                    : "Failed to delete shortcut.",
            );
            setDeleteState("idle");
        }
    };

    const handleCancelDelete = () => {
        setDeleteError(null);
        setDeleteState("idle");
    };

    const handlePublished = (nextPublication: PublicationSnapshot) => {
        setPublication(nextPublication);
        setPublicationStatus("ready");
        setPublicationError(null);
    };

    useEffect(() => {
        if (!focusDeleteSection) return;

        const frame = window.requestAnimationFrame(() => {
            deleteSectionRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "start",
            });
        });

        return () => {
            window.cancelAnimationFrame(frame);
        };
    }, [focusDeleteSection]);

    if (status === "loading") {
        return (
            <div className="max-w-[1080px] mx-auto py-8">
                <div className="flex items-center gap-2 text-sm text-fg-muted">
                    <Loader2 size={15} className="animate-spin" />
                    Loading saved shortcut...
                </div>
            </div>
        );
    }

    if (status === "unauthorized") {
        return (
            <div className="max-w-[1080px] mx-auto py-8">
                    <Link
                        href="/shortcuts?surface=my_shortcuts"
                        className="inline-flex items-center gap-2 text-sm text-fg-muted hover:text-fg no-underline mb-5"
                    >
                        <ArrowLeft size={14} />
                        Back to All Shortcuts
                    </Link>
                    <div className="rounded-2xl border border-border-subtle bg-secondary p-6">
                    <h1 className="text-xl font-semibold text-fg mb-2">Sign in to manage this shortcut</h1>
                    <p className="text-sm text-fg-secondary leading-relaxed">
                        Saved shortcut management is private to the owning wallet. Finish signing in, then reopen this page.
                    </p>
                </div>
            </div>
        );
    }

    if (status === "not_found") {
        return (
            <div className="max-w-[1080px] mx-auto py-8">
                    <Link
                        href="/shortcuts?surface=my_shortcuts"
                        className="inline-flex items-center gap-2 text-sm text-fg-muted hover:text-fg no-underline mb-5"
                    >
                        <ArrowLeft size={14} />
                        Back to All Shortcuts
                    </Link>
                <div className="rounded-2xl border border-border-subtle bg-secondary p-6">
                    <h1 className="text-xl font-semibold text-fg mb-2">Saved shortcut not found</h1>
                    <p className="text-sm text-fg-secondary leading-relaxed">
                        This saved shortcut could not be loaded for the current wallet session.
                    </p>
                </div>
            </div>
        );
    }

    if (status === "unavailable") {
        return (
            <div className="max-w-[1080px] mx-auto py-8">
                    <Link
                        href="/shortcuts?surface=my_shortcuts"
                        className="inline-flex items-center gap-2 text-sm text-fg-muted hover:text-fg no-underline mb-5"
                    >
                        <ArrowLeft size={14} />
                        Back to All Shortcuts
                    </Link>
                <div className="rounded-2xl border border-status-warning/20 bg-status-warning/5 p-6">
                    <h1 className="text-xl font-semibold text-fg mb-2">Saved shortcuts are unavailable</h1>
                    <p className="text-sm text-fg-secondary leading-relaxed">
                        Convex backend is not configured yet, so this management surface cannot load.
                    </p>
                </div>
            </div>
        );
    }

    if (status === "error" || !shortcut) {
        return (
            <div className="max-w-[1080px] mx-auto py-8">
                    <Link
                        href="/shortcuts?surface=my_shortcuts"
                        className="inline-flex items-center gap-2 text-sm text-fg-muted hover:text-fg no-underline mb-5"
                    >
                        <ArrowLeft size={14} />
                        Back to All Shortcuts
                    </Link>
                    <div className="rounded-2xl border border-status-error/20 bg-status-error/5 p-6">
                        <h1 className="text-xl font-semibold text-fg mb-2">Failed to load saved shortcut</h1>
                        <p className="text-sm text-fg-secondary leading-relaxed">
                            Try again in a moment. Builder access remains available from All Shortcuts if the saved record still exists.
                        </p>
                    </div>
                </div>
        );
    }

    return (
        <div className="max-w-[1080px] mx-auto py-8">
            <Link
                href="/shortcuts?surface=my_shortcuts"
                className="inline-flex items-center gap-2 text-sm text-fg-muted hover:text-fg no-underline mb-5"
            >
                <ArrowLeft size={14} />
                Back to All Shortcuts
            </Link>

            <div
                className="relative rounded-2xl border border-border-subtle overflow-hidden mb-8"
                style={{
                    background: `radial-gradient(ellipse at top left, color-mix(in srgb, ${meta.cssColor} 7%, transparent), var(--color-secondary) 72%)`,
                }}
            >
                <BaviumLogo
                    className="absolute top-1/2 right-4 sm:right-6 -translate-y-1/2 w-[120px] h-[120px] sm:w-[154px] sm:h-[154px] pointer-events-none select-none"
                    style={{
                        color: "var(--color-fg)",
                        opacity: 0.08,
                    }}
                    aria-hidden="true"
                />

                <div className="p-6 sm:p-8">
                    <div className="flex items-center gap-3 mb-5">
                        <div
                            className="flex items-center justify-center w-10 h-10 rounded-xl shrink-0"
                            style={{
                                backgroundColor: `color-mix(in srgb, ${meta.cssColor} 14%, transparent)`,
                                color: meta.cssColor,
                            }}
                        >
                            <CategoryIcon size={20} />
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <span
                                className="inline-flex items-center h-6 px-2.5 text-[12px] font-semibold tracking-wider uppercase rounded-md"
                                style={{
                                    backgroundColor: `color-mix(in srgb, ${meta.cssColor} 10%, transparent)`,
                                    color: meta.cssColor,
                                }}
                            >
                                {meta.label}
                            </span>
                            <span className="inline-flex items-center h-6 px-2.5 text-[12px] font-medium rounded-md bg-tertiary text-fg-muted">
                                Execution
                            </span>
                            <span
                                className={`inline-flex items-center h-6 px-2.5 text-[12px] font-medium rounded-md ${
                                    hasPublishedPublication
                                        ? "bg-brand-subtle text-brand"
                                        : "bg-tertiary text-fg-muted"
                                }`}
                            >
                                {visibilityLabel}
                            </span>
                        </div>
                    </div>

                    <h1 className="text-[22px] sm:text-[26px] font-semibold tracking-tight text-fg mb-2 leading-tight">
                        {displayName}
                    </h1>

                    <p className="text-[15px] text-fg-secondary leading-relaxed mb-5 max-w-[620px]">
                        {displayDescription}
                    </p>

                    <div className="flex items-center gap-4 flex-wrap text-[13px] text-fg-muted">
                        <span className="inline-flex items-center gap-1.5">
                            <Clock3 size={13} />
                            Updated {formatMetaDate(shortcut.updatedAt)}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <Layers size={13} />
                            {shortcut.steps.length} step{shortcut.steps.length !== 1 ? "s" : ""}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <Zap size={13} />
                            {linkedAutomations.length} linked automation{linkedAutomations.length !== 1 ? "s" : ""}
                        </span>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap mb-8">
                <Link
                    href={`/builder?shortcut=${shortcut._id}`}
                    className="h-10 px-5 inline-flex items-center gap-2 text-sm font-semibold rounded-lg transition-all duration-200 no-underline"
                    style={{
                        backgroundColor: meta.cssColor,
                        color: "var(--color-fg-inverse)",
                    }}
                >
                    <Pencil size={15} />
                    Edit in Builder
                </Link>

                <button
                    type="button"
                    onClick={() => setIsPublishDialogOpen(true)}
                    className="h-10 px-4 inline-flex items-center gap-2 text-sm font-medium text-fg-secondary bg-tertiary border border-border-subtle hover:border-border-default hover:text-fg rounded-lg transition-colors"
                >
                    <Globe size={14} />
                    {publication?.status === "archived"
                        ? "Share Again"
                        : publication
                            ? "Edit Details"
                            : "Share"}
                </button>

                {publication?.status === "published" && (
                    <Link
                        href={`/p/${publication.slug}`}
                        className="h-10 px-4 inline-flex items-center gap-2 text-sm font-medium text-fg-muted hover:text-fg no-underline rounded-lg transition-colors ml-auto"
                    >
                        Open Public Page
                        <ExternalLink size={13} />
                    </Link>
                )}
            </div>

            {showMadePrivateNotice && (
                <div className="flex items-start gap-2.5 p-3 mb-6 rounded-lg border border-status-success/20 bg-status-success/5 text-sm text-status-success">
                    <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                    <span>
                        This shortcut is private now. Public visibility has been removed, and you can continue managing automations or deletion from here.
                        {focusDeleteSection && " Delete controls are highlighted below."}
                    </span>
                </div>
            )}

            {publicationStatus === "error" && publicationError && (
                <div className="flex items-start gap-2.5 p-3 mb-6 rounded-lg border border-status-warning/20 bg-status-warning/5 text-sm text-status-warning">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>{publicationError}</span>
                </div>
            )}

            {automationsStatus === "error" && automationsError && (
                <div className="flex items-start gap-2.5 p-3 mb-6 rounded-lg border border-status-warning/20 bg-status-warning/5 text-sm text-status-warning">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>{automationsError}</span>
                </div>
            )}

            <div className="flex flex-col gap-6 mb-8">
                <ShortcutOwnerOperationalSummary
                    description="This page stays closest to execution truth for automations, delete guardrails, and visibility handoffs while Builder remains the editing workspace."
                    visibilityLabel={visibilityLabel}
                    visibilityHint={operationalVisibilityHint}
                    linkedAutomationsCount={linkedAutomations.length}
                    linkedAutomationsHint={operationalLinkedAutomationsHint}
                    deleteLabel={operationalDeleteLabel}
                    deleteHint={operationalDeleteHint}
                    updatedAtLabel={`Saved shortcut updated ${formatMetaDate(shortcut.updatedAt)}`}
                    statusPillLabel={operationalStatusPill}
                    guidance={operationalGuidance}
                    loading={isOperationalSummaryLoading}
                />

                <div className="rounded-2xl border border-border-subtle bg-secondary p-5">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="min-w-0">
                            <div className="text-sm font-medium text-fg mb-1">
                                Public Page
                            </div>
                            {publication ? (
                                <p className="text-sm text-fg-secondary leading-relaxed max-w-[560px]">
                                    {publication.status === "published"
                                        ? "This shortcut currently has a live public page. Its public name, description, and category can differ from Builder details without changing execution truth."
                                        : "This shortcut is private right now, but its last public details are still preserved here so you can share it again quickly."}
                                </p>
                            ) : (
                                <p className="text-sm text-fg-secondary leading-relaxed max-w-[560px]">
                                    This shortcut is private. Share it when you want a public page with its own name, description, category, and link.
                                </p>
                            )}
                        </div>

                        {publicationStatus === "loading" && (
                            <div className="inline-flex items-center gap-2 text-sm text-fg-muted">
                                <Loader2 size={14} className="animate-spin" />
                                Loading public details...
                            </div>
                        )}
                    </div>

                    {publication && (
                        <div className="flex items-center gap-2 flex-wrap mt-4">
                            <span className="inline-flex items-center h-7 px-3 rounded-full bg-tertiary text-[12px] font-medium text-fg-muted">
                                /{publication.slug}
                            </span>
                            <span className="inline-flex items-center h-7 px-3 rounded-full bg-tertiary text-[12px] font-medium text-fg-muted">
                                Version {publication.publishVersion}
                            </span>
                            <span
                                className={`inline-flex items-center h-7 px-3 rounded-full text-[12px] font-medium ${
                                    publication.status === "published"
                                        ? "bg-brand-subtle text-brand"
                                        : "bg-tertiary text-fg-muted"
                                }`}
                            >
                                {publication.status === "published" ? "Public" : "Private"}
                            </span>
                            {publicCategory && (
                                <span
                                    className="inline-flex items-center h-7 px-3 rounded-full text-[12px] font-medium"
                                    style={{
                                        backgroundColor: `color-mix(in srgb, ${CATEGORY_META[publicCategory].cssColor} 10%, transparent)`,
                                        color: CATEGORY_META[publicCategory].cssColor,
                                    }}
                                >
                                    Public Category: {CATEGORY_META[publicCategory].label}
                                </span>
                            )}
                            {publicCategory && publicCategory !== executionCategory && (
                                <span className="inline-flex items-center h-7 px-3 rounded-full bg-tertiary text-[12px] font-medium text-fg-muted">
                                    Builder Category: {CATEGORY_META[executionCategory].label}
                                </span>
                            )}
                        </div>
                    )}
                </div>

                <div className="rounded-2xl border border-border-subtle bg-secondary p-5">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="min-w-0">
                            <div className="text-sm font-medium text-fg mb-1">
                                Linked automations
                            </div>
                            <p className="text-sm text-fg-secondary leading-relaxed max-w-[560px]">
                                Automations point at the saved shortcut as canonical execution truth. As long as they stay linked, delete remains blocked by design.
                            </p>
                        </div>
                        <Link
                            href="/automations"
                            className="h-9 px-3 inline-flex items-center gap-2 text-sm font-medium text-fg-secondary bg-tertiary border border-border-subtle hover:border-border-default hover:text-fg rounded-lg transition-colors no-underline"
                        >
                            Open Automations
                            <ExternalLink size={13} />
                        </Link>
                    </div>

                    {automationsStatus === "loading" ? (
                        <div className="inline-flex items-center gap-2 text-sm text-fg-muted mt-4">
                            <Loader2 size={14} className="animate-spin" />
                            Loading linked automations...
                        </div>
                    ) : linkedAutomations.length > 0 ? (
                        <div className="flex flex-col gap-2 mt-4">
                            {linkedAutomations.map((automation) => (
                                <div
                                    key={automation.id}
                                    className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border-subtle bg-primary"
                                >
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium text-fg truncate">
                                            {automation.name}
                                        </div>
                                        <div className="text-[12px] text-fg-muted mt-0.5">
                                            {automation.nextRunAt
                                                ? `Next run ${formatDateTime(automation.nextRunAt)}`
                                                : automation.description?.trim() || "No next run scheduled."}
                                        </div>
                                    </div>
                                    <span className={`inline-flex items-center h-7 px-3 rounded-full text-[12px] font-medium shrink-0 ${automationStatusClass(automation.status)}`}>
                                        {automation.status}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex items-start gap-2.5 p-3 mt-4 rounded-lg border border-border-subtle bg-tertiary/50 text-sm text-fg-muted">
                            <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-status-success" />
                            <span>No automations currently reference this shortcut.</span>
                        </div>
                    )}
                </div>
            </div>

            <ShortcutInputsSection inputs={shortcut.inputs} />

            <ShortcutWorkflowSection steps={workflowSteps} />

            <div
                id="delete-shortcut"
                ref={deleteSectionRef}
                className={`rounded-2xl p-5 mb-8 transition-colors ${
                    focusDeleteSection
                        ? "border border-status-error/35 bg-status-error/10"
                        : "border border-status-error/20 bg-status-error/5"
                }`}
            >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                        <div className="text-sm font-medium text-fg mb-1">
                            Delete shortcut
                        </div>
                        <p className="text-sm text-fg-secondary leading-relaxed max-w-[560px]">
                            Delete is permanent for the saved source record. Publication and automation guards are checked server-side to prevent orphaned references.
                        </p>
                    </div>

                    {deleteState === "confirm" ? (
                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                type="button"
                                onClick={handleCancelDelete}
                                className="h-9 px-3 inline-flex items-center justify-center text-sm font-medium text-fg-secondary hover:text-fg bg-tertiary rounded-lg transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleDelete}
                                className="h-9 px-3 inline-flex items-center gap-2 text-sm font-medium text-status-error bg-status-error/10 hover:bg-status-error/15 rounded-lg transition-colors"
                            >
                                <Trash2 size={14} />
                                Confirm Delete
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={handleDelete}
                            disabled={deleteState === "deleting" || hasKnownDeleteBlockers}
                            className="h-9 px-3 inline-flex items-center gap-2 text-sm font-medium text-status-error bg-status-error/10 hover:bg-status-error/15 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            <Trash2 size={14} />
                            {hasKnownDeleteBlockers ? "Delete Locked" : "Delete Shortcut"}
                        </button>
                    )}
                </div>

                {hasKnownDeleteBlockers && (
                    <div className="mt-4 flex flex-col gap-2 text-sm text-status-error">
                        {hasPublishedPublication && publication && (
                            <div className="flex items-start gap-2.5">
                                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                                <span>
                                    Delete is blocked while this shortcut is public. Open{" "}
                                    <Link
                                        href={`/p/${publication.slug}`}
                                        className="underline decoration-status-error/40 underline-offset-4 hover:decoration-status-error"
                                    >
                                        the public page
                                    </Link>{" "}
                                    to remove it from the community first.
                                </span>
                            </div>
                        )}
                        {hasAutomationBlockers && (
                            <div className="flex items-start gap-2.5">
                                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                                <span>
                                    Delete is blocked while {linkedAutomations.length} automation{linkedAutomations.length !== 1 ? "s" : ""} still reference this shortcut.
                                    Update or remove them from{" "}
                                    <Link
                                        href="/automations"
                                        className="underline decoration-status-error/40 underline-offset-4 hover:decoration-status-error"
                                    >
                                        Automations
                                    </Link>.
                                </span>
                            </div>
                        )}
                    </div>
                )}

                {!hasKnownDeleteBlockers && (publicationStatus === "error" || automationsStatus === "error") && (
                    <div className="mt-4 flex items-start gap-2.5 text-sm text-status-warning">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                        <span>
                            Delete guardrails could not be fully preloaded. Server-side checks still apply if you continue.
                        </span>
                    </div>
                )}

                {deleteError && (
                    <div className="mt-4 flex items-start gap-2.5 text-sm text-status-error">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                        <span>{deleteError}</span>
                    </div>
                )}
            </div>

            <div className="flex items-center justify-center gap-2 py-6 border-t border-border-subtle text-[12px] text-fg-muted">
                <BaviumLogo className="w-4 h-4 opacity-40" aria-hidden="true" />
                <span>Built with Bavium — Base Onchain Automation</span>
            </div>

            {isPublishDialogOpen && (
                <PublishShortcutDialog
                    shortcut={{
                        _id: shortcut._id,
                        name: shortcut.name,
                        description: shortcut.description,
                        category: executionCategory,
                        steps: shortcut.steps,
                    }}
                    onClose={() => setIsPublishDialogOpen(false)}
                    onPublished={(nextPublication) => {
                        setIsPublishDialogOpen(false);
                        handlePublished(nextPublication);
                    }}
                />
            )}
        </div>
    );
}
