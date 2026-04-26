"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
    ArrowLeft,
    Layers,
    GitFork,
    User,
    Copy,
    Check,
    ExternalLink,
    Loader2,
    AlertTriangle,
    Bookmark,
    Pencil,
    Trash2,
    MessageSquareShare,
} from "lucide-react";
import { isBlockCategoryValue } from "@/lib/block-categories";
import type { BlockCategory } from "@/lib/constants";
import { CATEGORY_META, CATEGORY_ICONS } from "@/lib/constants";
import { useAuthSession } from "@/hooks/useAuthSession";
import PublishedShortcutShareDialog from "@/components/gallery/PublishedShortcutShareDialog";
import PublishShortcutDialog from "@/components/gallery/PublishShortcutDialog";
import {
    ShortcutInputsSection,
    ShortcutOwnerOperationalSummary,
    ShortcutWorkflowSection,
} from "@/components/gallery/ShortcutDetailSections";
import { BaviumLogo } from "@/components/ui/BaviumLogo";

/* --------------------------------------------------------------------------
   Types
   -------------------------------------------------------------------------- */

interface PublishedShortcutDetail {
    _id: string;
    slug: string;
    name: string;
    description?: string;
    category: string;
    creatorAddress: string;
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
    remixCount: number;
    publishVersion: number;
    publishedAt: string;
    updatedAt: string;
    version: string;
}

interface OwnerShortcutContext {
    sourceShortcutId: string;
    updatedAt: string | null;
    linkedAutomations: number;
    deleteLocked: boolean;
    deleteBlockedByPublic: boolean;
    deleteBlockedByAutomations: boolean;
}

/* --------------------------------------------------------------------------
   Helpers
   -------------------------------------------------------------------------- */

function truncateAddress(address: string): string {
    if (address.length <= 10) return address;
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function stepLabel(step: { skill: string; action: string; label?: string }): string {
    if (step.label) return step.label;
    // Convert snake_case action to human-readable Title Case
    return step.action
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

function skillDisplayName(skill: string): string {
    return skill.charAt(0).toUpperCase() + skill.slice(1);
}

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

/* --------------------------------------------------------------------------
   X Share URL Builder
   -------------------------------------------------------------------------- */

function buildXShareUrl(shortcut: PublishedShortcutDetail, pageUrl: string): string {
    const text = `Check out "${shortcut.name}" on Bavium — a Base workflow.\n\n${pageUrl}`;
    return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

/* --------------------------------------------------------------------------
   Page
   -------------------------------------------------------------------------- */

export default function PublishedShortcutDetailPage() {
    const params = useParams();
    const router = useRouter();
    const slug = typeof params.slug === "string" ? params.slug : "";
    const { authState, sessionAddress } = useAuthSession();

    const [shortcut, setShortcut] = useState<PublishedShortcutDetail | null>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "not_found" | "error">("loading");

    const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
    const [addState, setAddState] = useState<"idle" | "adding" | "done" | "error">("idle");
    const [addError, setAddError] = useState<string | null>(null);
    const [bookmarkStatus, setBookmarkStatus] = useState<"idle" | "loading" | "saving" | "removing" | "error">("idle");
    const [bookmarkError, setBookmarkError] = useState<string | null>(null);
    const [isBookmarked, setIsBookmarked] = useState(false);
    const [archiveState, setArchiveState] = useState<"idle" | "confirm" | "archiving" | "done" | "error">("idle");
    const [archiveError, setArchiveError] = useState<string | null>(null);
    const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [ownerContext, setOwnerContext] = useState<OwnerShortcutContext | null>(null);
    const [ownerContextStatus, setOwnerContextStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
    const [ownerContextError, setOwnerContextError] = useState<string | null>(null);

    /* ----- Fetch shortcut ----- */

    useEffect(() => {
        if (!slug) {
            setStatus("not_found");
            return;
        }

        let cancelled = false;

        async function load() {
            try {
                const res = await fetch(`/api/published-shortcuts/${encodeURIComponent(slug)}`);
                if (!res.ok) {
                    if (!cancelled) setStatus(res.status === 404 ? "not_found" : "error");
                    return;
                }
                const data = (await res.json()) as { shortcut?: PublishedShortcutDetail };
                if (!cancelled && data.shortcut) {
                    setShortcut(data.shortcut);
                    setStatus("ready");
                } else if (!cancelled) {
                    setStatus("not_found");
                }
            } catch {
                if (!cancelled) setStatus("error");
            }
        }

        void load();
        return () => {
            cancelled = true;
        };
    }, [slug]);

    /* ----- Viewer context ----- */

    useEffect(() => {
        if (!slug || authState !== "authenticated") {
            setIsBookmarked(false);
            setBookmarkStatus("idle");
            setBookmarkError(null);
            setOwnerContext(null);
            setOwnerContextStatus("idle");
            setOwnerContextError(null);
            return;
        }

        let cancelled = false;

        async function loadViewerContext() {
            setBookmarkStatus("loading");
            setBookmarkError(null);
            setOwnerContextStatus("loading");
            setOwnerContextError(null);

            try {
                const res = await fetch(`/api/published-shortcuts/${encodeURIComponent(slug)}/viewer-context`, {
                    credentials: "include",
                });
                const data = (await res.json().catch(() => ({}))) as {
                    error?: string;
                    exists?: boolean;
                    bookmarked?: boolean;
                    ownerContext?: {
                        sourceShortcutId?: string;
                        updatedAt?: string | null;
                        linkedAutomations?: number;
                        deleteLocked?: boolean;
                        deleteBlockedByPublic?: boolean;
                        deleteBlockedByAutomations?: boolean;
                    } | null;
                };

                if (!res.ok) {
                    throw new Error(data.error ?? "Failed to load viewer context.");
                }

                if (cancelled) return;

                if (data.exists === false) {
                    setIsBookmarked(false);
                    setOwnerContext(null);
                    setBookmarkStatus("idle");
                    setOwnerContextStatus("idle");
                    return;
                }

                setIsBookmarked(Boolean(data.bookmarked));
                setBookmarkStatus("idle");
                if (data.ownerContext && typeof data.ownerContext.sourceShortcutId === "string") {
                    setOwnerContext({
                        sourceShortcutId: data.ownerContext.sourceShortcutId,
                        updatedAt: typeof data.ownerContext.updatedAt === "string" ? data.ownerContext.updatedAt : null,
                        linkedAutomations: typeof data.ownerContext.linkedAutomations === "number" ? data.ownerContext.linkedAutomations : 0,
                        deleteLocked: data.ownerContext.deleteLocked !== false,
                        deleteBlockedByPublic: data.ownerContext.deleteBlockedByPublic !== false,
                        deleteBlockedByAutomations: Boolean(data.ownerContext.deleteBlockedByAutomations),
                    });
                } else {
                    setOwnerContext(null);
                }
                setOwnerContextStatus("ready");
            } catch (error) {
                if (cancelled) return;
                const message = error instanceof Error ? error.message : "Failed to load viewer context.";
                setIsBookmarked(false);
                setBookmarkStatus("error");
                setBookmarkError(message);
                setOwnerContext(null);
                setOwnerContextStatus("error");
                setOwnerContextError(message);
            }
        }

        void loadViewerContext();
        return () => {
            cancelled = true;
        };
    }, [authState, slug]);

    /* ----- Copy link ----- */

    const handleCopyLink = useCallback(async () => {
        const url = `${window.location.origin}/p/${slug}`;
        try {
            await navigator.clipboard.writeText(url);
            setCopyState("copied");
            setTimeout(() => setCopyState("idle"), 2000);
        } catch {
            // Fallback for older browsers
            const textarea = document.createElement("textarea");
            textarea.value = url;
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand("copy");
            document.body.removeChild(textarea);
            setCopyState("copied");
            setTimeout(() => setCopyState("idle"), 2000);
        }
    }, [slug]);

    /* ----- Add shortcut ----- */

    const handleAddShortcut = useCallback(async () => {
        if (addState !== "idle") return;
        setAddState("adding");
        setAddError(null);

        try {
            const res = await fetch(`/api/published-shortcuts/${encodeURIComponent(slug)}/remix`, {
                method: "POST",
                credentials: "include",
            });
            const data = (await res.json()) as { shortcutId?: string; error?: string };
            if (!res.ok) {
                throw new Error(data.error ?? "Failed to add shortcut.");
            }
            setAddState("done");
            // Navigate to Builder with the new saved shortcut
            if (data.shortcutId) {
                setTimeout(() => {
                    router.push(`/builder?shortcut=${data.shortcutId}`);
                }, 600);
            }
        } catch (err) {
            setAddError(err instanceof Error ? err.message : "Failed to add shortcut.");
            setAddState("error");
            setTimeout(() => setAddState("idle"), 3000);
        }
    }, [addState, router, slug]);

    /* ----- Bookmark toggle ----- */

    const handleBookmarkToggle = useCallback(async () => {
        if (authState !== "authenticated") return;

        setBookmarkStatus(isBookmarked ? "removing" : "saving");
        setBookmarkError(null);

        try {
            const res = await fetch(`/api/published-shortcuts/${encodeURIComponent(slug)}/bookmark`, {
                method: isBookmarked ? "DELETE" : "POST",
                credentials: "include",
            });
            const data = (await res.json().catch(() => ({}))) as { error?: string };

            if (!res.ok) {
                throw new Error(data.error ?? "Failed to update bookmark.");
            }

            setIsBookmarked((prev) => !prev);
            setBookmarkStatus("idle");
        } catch (error) {
            setBookmarkStatus("error");
            setBookmarkError(error instanceof Error ? error.message : "Failed to update bookmark.");
        }
    }, [authState, isBookmarked, slug]);

    /* ----- Unpublish / archive ----- */

    const handleArchive = useCallback(async () => {
        if (archiveState === "idle") {
            setArchiveError(null);
            setArchiveState("confirm");
            return;
        }

        if (archiveState !== "confirm") return;

        setArchiveState("archiving");
        setArchiveError(null);

        try {
            const res = await fetch(`/api/published-shortcuts/${encodeURIComponent(slug)}`, {
                method: "DELETE",
                credentials: "include",
            });
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            if (!res.ok) {
                throw new Error(data.error ?? "Failed to make shortcut private.");
            }

            setArchiveState("done");
            setTimeout(() => {
                if (ownerContext?.sourceShortcutId) {
                    router.push(`/shortcuts/saved/${ownerContext.sourceShortcutId}?notice=made_private&focus=delete#delete-shortcut`);
                    return;
                }
                router.push("/shortcuts?surface=my_shortcuts");
            }, 700);
        } catch (err) {
            setArchiveError(err instanceof Error ? err.message : "Failed to make shortcut private.");
            setArchiveState("error");
            setTimeout(() => setArchiveState("idle"), 3000);
        }
    }, [archiveState, ownerContext?.sourceShortcutId, router, slug]);

    const handleArchiveCancel = useCallback(() => {
        setArchiveError(null);
        setArchiveState("idle");
    }, []);

    /* ----- Loading / Error states ----- */

    if (status === "loading") {
        return (
            <div className="max-w-[720px] mx-auto">
                <div className="flex items-center gap-3 mb-8">
                    <div className="w-6 h-6 rounded bg-tertiary animate-pulse-slow" />
                    <div className="h-4 w-32 rounded bg-tertiary animate-pulse-slow" />
                </div>
                <div className="space-y-4">
                    <div className="h-10 w-3/4 rounded-lg bg-tertiary animate-pulse-slow" />
                    <div className="h-5 w-1/2 rounded bg-tertiary animate-pulse-slow" />
                    <div className="h-32 rounded-xl bg-secondary border border-border-subtle animate-pulse-slow" />
                </div>
            </div>
        );
    }

    if (status === "not_found") {
        return (
            <div className="max-w-[720px] mx-auto text-center py-16">
                <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 rounded-xl bg-tertiary">
                    <AlertTriangle size={20} className="text-fg-muted" />
                </div>
                <h2 className="text-lg font-semibold text-fg mb-2">
                    Shortcut not found
                </h2>
                <p className="text-sm text-fg-secondary mb-6 max-w-[360px] mx-auto">
                    This shortcut may have been unpublished or the link is incorrect.
                </p>
                <Link
                    href="/shortcuts"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-light hover:text-brand no-underline transition-colors"
                >
                    <ArrowLeft size={14} />
                    Back to Shortcuts
                </Link>
            </div>
        );
    }

    if (status === "error" || !shortcut) {
        return (
            <div className="max-w-[720px] mx-auto text-center py-16">
                <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 rounded-xl bg-status-error/10">
                    <AlertTriangle size={20} className="text-status-error" />
                </div>
                <h2 className="text-lg font-semibold text-fg mb-2">
                    Something went wrong
                </h2>
                <p className="text-sm text-fg-secondary mb-6">
                    Could not load this shortcut. Please try again.
                </p>
                <Link
                    href="/shortcuts"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-light hover:text-brand no-underline transition-colors"
                >
                    <ArrowLeft size={14} />
                    Back to Shortcuts
                </Link>
            </div>
        );
    }

    /* ----- Render ----- */

    const category = shortcut.category as BlockCategory;
    const meta = CATEGORY_META[category] ?? {
        label: shortcut.category,
        cssColor: "var(--color-fg-muted)",
    };
    const CatIcon = CATEGORY_ICONS[category] ?? Layers;
    const pageUrl = typeof window !== "undefined"
        ? `${window.location.origin}/p/${shortcut.slug}`
        : "";
    const xShareUrl = buildXShareUrl(shortcut, pageUrl);
    const isAuthenticated = authState === "authenticated";
    const isOwner = isAuthenticated
        && typeof sessionAddress === "string"
        && sessionAddress.toLowerCase() === shortcut.creatorAddress.toLowerCase();
    const ownerBuilderHref = ownerContext?.sourceShortcutId
        ? `/builder?shortcut=${ownerContext.sourceShortcutId}`
        : `/builder?public=${shortcut.slug}`;
    const ownerShortcutHref = ownerContext?.sourceShortcutId
        ? `/shortcuts/saved/${ownerContext.sourceShortcutId}`
        : null;
    const editDialogCategory: BlockCategory = isBlockCategoryValue(shortcut.category)
        ? shortcut.category
        : "logic";
    const workflowSteps = shortcut.steps.map((step) => ({
        id: step.id,
        label: stepLabel(step),
        skillLabel: skillDisplayName(step.skill),
        color: getSkillColor(step.skill),
    }));

    return (
        <div className="max-w-[720px] mx-auto animate-fade-in">
            {/* Back link */}
            <Link
                href="/shortcuts"
                className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg no-underline transition-colors mb-6"
            >
                <ArrowLeft size={14} />
                Shortcuts
            </Link>

            {/* Hero section */}
            <div
                className="relative rounded-2xl border border-border-subtle overflow-hidden mb-8"
                style={{
                    background: `radial-gradient(ellipse at top left, color-mix(in srgb, ${meta.cssColor} 6%, transparent), var(--color-secondary) 70%)`,
                }}
            >
                {/* Bavium watermark logo */}
                <BaviumLogo
                    className="absolute top-1/2 right-4 sm:right-6 -translate-y-1/2 w-[120px] h-[120px] sm:w-[154px] sm:h-[154px] pointer-events-none select-none"
                    style={{
                        color: "var(--color-fg)",
                        opacity: 0.08,
                    }}
                    aria-hidden="true"
                />

                <div className="p-6 sm:p-8">
                    {/* Category + meta */}
                    <div className="flex items-center gap-3 mb-5">
                        <div
                            className="flex items-center justify-center w-10 h-10 rounded-xl shrink-0"
                            style={{
                                backgroundColor: `color-mix(in srgb, ${meta.cssColor} 14%, transparent)`,
                                color: meta.cssColor,
                            }}
                        >
                            <CatIcon size={20} />
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
                            <span className="inline-flex items-center h-6 px-2.5 text-[12px] font-medium rounded-md bg-white/5 text-fg-muted">
                                Public
                            </span>
                            {isOwner && (
                                <span className="text-[12px] text-fg-muted">
                                    By you
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Title */}
                    <h1 className="text-[22px] sm:text-[26px] font-semibold tracking-tight text-fg mb-2 leading-tight">
                        {shortcut.name}
                    </h1>

                    {/* Description */}
                    {shortcut.description && (
                        <p className="text-[15px] text-fg-secondary leading-relaxed mb-5 max-w-[560px]">
                            {shortcut.description}
                        </p>
                    )}

                    {/* Meta row */}
                    <div className="flex items-center gap-4 flex-wrap text-[13px] text-fg-muted">
                        <span className="inline-flex items-center gap-1.5">
                            <User size={13} />
                            By {truncateAddress(shortcut.creatorAddress)}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <Layers size={13} />
                            {shortcut.steps.length} step{shortcut.steps.length !== 1 ? "s" : ""}
                        </span>
                    </div>
                </div>
            </div>

            {/* Action bar */}
            <div className="flex items-center gap-2 flex-wrap mb-8">
                {isOwner ? (
                    <>
                        <Link
                            href={ownerBuilderHref}
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
                            onClick={() => setIsEditDialogOpen(true)}
                            disabled={ownerContextStatus !== "ready" || !ownerContext}
                            className="h-10 px-4 inline-flex items-center gap-2 text-sm font-medium text-fg-secondary bg-tertiary border border-border-subtle hover:border-border-default hover:text-fg rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            title={ownerContextStatus !== "ready" ? "Loading owner controls..." : undefined}
                        >
                            {ownerContextStatus === "loading" ? (
                                <>
                                    <Loader2 size={14} className="animate-spin" />
                                    Loading...
                                </>
                            ) : (
                                <>
                                    <Pencil size={14} />
                                    Edit Details
                                </>
                            )}
                        </button>

                        {ownerShortcutHref && (
                            <Link
                                href={ownerShortcutHref}
                                className="h-10 px-4 inline-flex items-center gap-2 text-sm font-medium text-fg-secondary bg-tertiary border border-border-subtle hover:border-border-default hover:text-fg rounded-lg transition-colors no-underline"
                            >
                                Open Shortcut
                                <ExternalLink size={13} />
                            </Link>
                        )}
                    </>
                ) : (
                    <button
                        type="button"
                        onClick={handleAddShortcut}
                        disabled={addState !== "idle" || !isAuthenticated}
                        className="h-10 px-5 inline-flex items-center gap-2 text-sm font-semibold rounded-lg transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                        style={{
                            backgroundColor: addState === "done"
                                ? "var(--color-status-success)"
                                : meta.cssColor,
                            color: "var(--color-fg-inverse)",
                        }}
                        title={!isAuthenticated ? "Sign in to add this shortcut" : undefined}
                    >
                        {addState === "adding" ? (
                            <>
                                <Loader2 size={15} className="animate-spin" />
                                Adding…
                            </>
                        ) : addState === "done" ? (
                            <>
                                <Check size={15} />
                                Added — Opening Builder
                            </>
                        ) : addState === "error" ? (
                            <>
                                <AlertTriangle size={15} />
                                Failed
                            </>
                        ) : (
                            <>
                                <GitFork size={15} />
                                Get Shortcut
                            </>
                        )}
                    </button>
                )}

                {/* Copy link */}
                <button
                    type="button"
                    onClick={handleCopyLink}
                    className="h-10 px-4 inline-flex items-center gap-2 text-sm font-medium text-fg-secondary bg-tertiary border border-border-subtle hover:border-border-default hover:text-fg rounded-lg transition-colors"
                >
                    {copyState === "copied" ? (
                        <>
                            <Check size={14} className="text-status-success" />
                            Copied
                        </>
                    ) : (
                        <>
                            <Copy size={14} />
                            Copy Link
                        </>
                    )}
                </button>

                {/* Share to X */}
                <button
                    type="button"
                    onClick={() => setIsShareDialogOpen(true)}
                    className="h-10 px-4 inline-flex items-center gap-2 text-sm font-medium text-fg-secondary bg-tertiary border border-border-subtle hover:border-border-default hover:text-fg rounded-lg transition-colors"
                >
                    <MessageSquareShare size={14} />
                    Share
                </button>

                {!isOwner && (
                    <>
                        <button
                            type="button"
                            onClick={handleBookmarkToggle}
                            disabled={
                                !isAuthenticated
                                || bookmarkStatus === "loading"
                                || bookmarkStatus === "saving"
                                || bookmarkStatus === "removing"
                            }
                            title={!isAuthenticated ? "Sign in to bookmark this shortcut" : undefined}
                            className={`h-10 px-4 inline-flex items-center gap-2 text-sm font-medium rounded-lg border transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                                isBookmarked
                                    ? "text-fg bg-brand-subtle border-brand/20"
                                    : "text-fg-secondary bg-tertiary border-border-subtle hover:border-border-default hover:text-fg"
                            }`}
                        >
                            <Bookmark size={14} className={isBookmarked ? "fill-current" : undefined} />
                            {bookmarkStatus === "saving"
                                ? "Saving..."
                                : bookmarkStatus === "removing"
                                    ? "Removing..."
                                    : isBookmarked
                                        ? "Bookmarked"
                                        : "Bookmark"}
                        </button>

                        <Link
                            href={`/builder?public=${shortcut.slug}`}
                            className="h-10 px-4 inline-flex items-center gap-2 text-sm font-medium text-fg-muted hover:text-fg no-underline rounded-lg transition-colors ml-auto"
                        >
                            Open in Builder
                            <ExternalLink size={13} />
                        </Link>
                    </>
                )}
            </div>

            {isOwner && (
                <div className="flex flex-col gap-4 mb-6">
                    <div className="flex items-start justify-between gap-4 p-4 rounded-xl border border-border-subtle bg-secondary">
                        <div>
                            <div className="text-sm font-medium text-fg mb-1">
                                Owner Controls
                            </div>
                            <p className="text-sm text-fg-secondary leading-relaxed max-w-[480px]">
                                This page is the public face of your shortcut. Edit details here, open the saved shortcut for automations and delete guardrails, or make it private to remove it from the gallery while keeping it in All Shortcuts.
                            </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            {archiveState === "confirm" ? (
                                <>
                                    <button
                                        type="button"
                                        onClick={handleArchiveCancel}
                                        className="h-9 px-3 inline-flex items-center justify-center text-sm font-medium text-fg-secondary hover:text-fg bg-tertiary rounded-lg transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleArchive}
                                        className="h-9 px-3 inline-flex items-center gap-2 text-sm font-medium text-status-error bg-status-error/10 hover:bg-status-error/15 rounded-lg transition-colors"
                                    >
                                        <Trash2 size={14} />
                                        Confirm Make Private
                                    </button>
                                </>
                            ) : (
                                <button
                                    type="button"
                                    onClick={handleArchive}
                                    disabled={archiveState === "archiving" || archiveState === "done"}
                                    className="h-9 px-3 inline-flex items-center gap-2 text-sm font-medium text-status-error bg-status-error/10 hover:bg-status-error/15 rounded-lg transition-colors disabled:opacity-70"
                                >
                                    {archiveState === "archiving" ? (
                                        <>
                                            <Loader2 size={14} className="animate-spin" />
                                            Making private…
                                        </>
                                    ) : archiveState === "done" ? (
                                        <>
                                            <Check size={14} />
                                            Private
                                        </>
                                    ) : (
                                        <>
                                            <Trash2 size={14} />
                                            Make Private
                                        </>
                                    )}
                                </button>
                            )}
                        </div>
                    </div>

                    <ShortcutOwnerOperationalSummary
                        description="Builder is still the editing workspace, but this public page now carries the main sharing state. Delete continues to follow saved shortcut guardrails."
                        visibilityLabel="Public"
                        visibilityHint="Live in the gallery"
                        linkedAutomationsCount={ownerContext?.linkedAutomations ?? 0}
                        linkedAutomationsHint={ownerContext && ownerContext.linkedAutomations > 0
                            ? "Still pointing at this shortcut"
                            : "No active shortcut links"}
                        deleteLabel={ownerContext?.deleteLocked ? "Locked" : "Available"}
                        deleteHint={ownerContext?.deleteBlockedByAutomations
                            ? "Requires private state and automation cleanup"
                            : "Requires private state first"}
                        updatedAtLabel={ownerContext?.updatedAt
                            ? `Saved shortcut updated ${formatMetaDate(ownerContext.updatedAt)}`
                            : null}
                        statusPillLabel={ownerContext?.deleteBlockedByPublic
                            ? "Make Private before Delete"
                            : "Delete Ready"}
                        guidance={ownerContext && ownerContext.linkedAutomations > 0
                            ? `To fully delete this shortcut, make it private here first, then remove or retarget ${ownerContext.linkedAutomations} linked automation${ownerContext.linkedAutomations !== 1 ? "s" : ""} from Open Shortcut.`
                            : "To fully delete this shortcut, make it private here first, then finish deletion from Open Shortcut."}
                        loading={ownerContextStatus === "loading"}
                    />
                </div>
            )}

            {/* Auth hint for adding */}
            {!isAuthenticated && (
                <div className="flex items-start gap-2.5 p-3 mb-6 rounded-lg border border-border-subtle bg-tertiary/50 text-sm text-fg-muted">
                    <User size={14} className="mt-0.5 shrink-0" />
                    <span>
                        Connect your wallet and sign in to add this shortcut to All Shortcuts.
                    </span>
                </div>
            )}

            {addError && (
                <div className="flex items-start gap-2.5 p-3 mb-6 rounded-lg border border-status-error/20 bg-status-error/5 text-sm text-status-error">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>{addError}</span>
                </div>
            )}

            {bookmarkError && (
                <div className="flex items-start gap-2.5 p-3 mb-6 rounded-lg border border-status-error/20 bg-status-error/5 text-sm text-status-error">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>{bookmarkError}</span>
                </div>
            )}

            {archiveError && (
                <div className="flex items-start gap-2.5 p-3 mb-6 rounded-lg border border-status-error/20 bg-status-error/5 text-sm text-status-error">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>{archiveError}</span>
                </div>
            )}

            {isOwner && ownerContextError && (
                <div className="flex items-start gap-2.5 p-3 mb-6 rounded-lg border border-status-warning/20 bg-status-warning/5 text-sm text-status-warning">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>{ownerContextError}</span>
                </div>
            )}

            <ShortcutInputsSection inputs={shortcut.inputs} />

            <ShortcutWorkflowSection steps={workflowSteps} />

            {/* Footer branding */}
            <div className="flex items-center justify-center gap-2 py-6 border-t border-border-subtle text-[12px] text-fg-muted">
                <Image
                    src="/logo.svg"
                    alt="Bavium"
                    width={16}
                    height={16}
                    className="opacity-40"
                />
                <span>Built with Bavium — Base Onchain Automation</span>
            </div>

            {isShareDialogOpen && (
                <PublishedShortcutShareDialog
                    shortcut={{
                        slug: shortcut.slug,
                        name: shortcut.name,
                        description: shortcut.description,
                        category: shortcut.category,
                        steps: shortcut.steps.map((step) => ({
                            id: step.id,
                            skill: step.skill,
                            label: stepLabel(step),
                        })),
                    }}
                    pageUrl={pageUrl}
                    xShareUrl={xShareUrl}
                    onClose={() => setIsShareDialogOpen(false)}
                />
            )}

            {isOwner && isEditDialogOpen && ownerContext?.sourceShortcutId && (
                <PublishShortcutDialog
                    shortcut={{
                        _id: ownerContext.sourceShortcutId,
                        name: shortcut.name,
                        description: shortcut.description,
                        category: editDialogCategory,
                        steps: shortcut.steps,
                    }}
                    onClose={() => setIsEditDialogOpen(false)}
                    onPublished={(publication) => {
                        setIsEditDialogOpen(false);
                        setShortcut((current) => {
                            if (!current) return current;
                            return {
                                ...current,
                                slug: publication.slug,
                                name: publication.name,
                                description: publication.description,
                                category: publication.category,
                                publishVersion: publication.publishVersion,
                                updatedAt: new Date().toISOString(),
                            };
                        });

                        if (publication.slug !== slug) {
                            router.replace(`/p/${publication.slug}`);
                        }
                    }}
                />
            )}
        </div>
    );
}
