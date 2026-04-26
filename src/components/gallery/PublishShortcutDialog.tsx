"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Globe, Layers, Loader2, X } from "lucide-react";
import { BaviumLogo } from "@/components/ui/BaviumLogo";
import { Skeleton } from "@/components/ui/Skeleton";
import type { BlockCategory } from "@/lib/constants";
import {
    CATEGORY_ICONS,
    CATEGORY_META,
    PUBLISHABLE_SHORTCUT_CATEGORIES,
} from "@/lib/constants";
import { isBlockCategoryValue } from "@/lib/block-categories";

interface PublishShortcutDialogProps {
    shortcut: {
        _id: string;
        name: string;
        description?: string;
        category: BlockCategory;
        steps: unknown[];
    };
    onClose: () => void;
    onPublished?: (publication: PublicationSnapshot) => void;
}

interface PublicationSnapshot {
    slug: string;
    name: string;
    description?: string;
    category: string;
    status: "published" | "archived";
    publishVersion: number;
}

interface PublishFormState {
    name: string;
    description: string;
    category: BlockCategory;
    slug: string;
}

function sanitizeSlugPart(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
}

function buildDefaultForm(
    shortcut: PublishShortcutDialogProps["shortcut"],
): PublishFormState {
    return {
        name: shortcut.name,
        description: shortcut.description ?? "",
        category: shortcut.category,
        slug: sanitizeSlugPart(shortcut.name),
    };
}

function buildFormFromPublication(
    shortcut: PublishShortcutDialogProps["shortcut"],
    publication: PublicationSnapshot,
): PublishFormState {
    const fallback = buildDefaultForm(shortcut);

    return {
        name: publication.name.trim() || fallback.name,
        description: publication.description ?? "",
        category: isBlockCategoryValue(publication.category)
            ? publication.category
            : fallback.category,
        slug: publication.slug.trim() || fallback.slug,
    };
}

function normalizeDescription(value: string): string {
    return value.trim().replace(/\s+/g, " ");
}

export default function PublishShortcutDialog({
    shortcut,
    onClose,
    onPublished,
}: PublishShortcutDialogProps) {
    const [isMounted, setIsMounted] = useState(false);
    const [form, setForm] = useState<PublishFormState>(() => buildDefaultForm(shortcut));
    const [isLoadingExisting, setIsLoadingExisting] = useState(true);
    const [existingPublication, setExistingPublication] = useState<PublicationSnapshot | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [isPublishing, setIsPublishing] = useState(false);
    const [slugTouched, setSlugTouched] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onClose();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [onClose]);

    useEffect(() => {
        let isCancelled = false;

        async function loadExistingPublication() {
            setIsLoadingExisting(true);
            setLoadError(null);

            try {
                const response = await fetch(`/api/shortcuts/${shortcut._id}/publish`, {
                    credentials: "include",
                });
                const data = await response.json().catch(() => ({})) as {
                    error?: string;
                    publication?: PublicationSnapshot | null;
                };

                if (!response.ok) {
                    throw new Error(data.error || "Failed to load sharing settings.");
                }

                if (isCancelled) {
                    return;
                }

                const publication = data.publication ?? null;
                setExistingPublication(publication);

                if (publication) {
                    setForm(buildFormFromPublication(shortcut, publication));
                    setSlugTouched(true);
                } else {
                    setForm(buildDefaultForm(shortcut));
                    setSlugTouched(false);
                }
            } catch (error) {
                if (isCancelled) {
                    return;
                }

                setExistingPublication(null);
                setForm(buildDefaultForm(shortcut));
                setLoadError(
                    error instanceof Error
                        ? error.message
                        : "Failed to load sharing settings.",
                );
            } finally {
                if (!isCancelled) {
                    setIsLoadingExisting(false);
                }
            }
        }

        void loadExistingPublication();

        return () => {
            isCancelled = true;
        };
    }, [shortcut]);

    const categoryMeta = CATEGORY_META[form.category];
    const CategoryIcon = CATEGORY_ICONS[form.category] ?? Layers;
    const effectiveSlug = form.slug || sanitizeSlugPart(form.name) || "shortcut";
    const submitLabel = existingPublication?.status === "archived"
        ? "Share Again"
        : existingPublication
          ? "Edit Details"
          : "Share";

    const handleNameChange = (value: string) => {
        setSubmitError(null);
        setForm((current) => ({
            ...current,
            name: value,
            slug: slugTouched ? current.slug : sanitizeSlugPart(value),
        }));
    };

    const handleDescriptionChange = (value: string) => {
        setSubmitError(null);
        setForm((current) => ({ ...current, description: value }));
    };

    const handleCategoryChange = (value: BlockCategory) => {
        setSubmitError(null);
        setForm((current) => ({ ...current, category: value }));
    };

    const handleSlugChange = (value: string) => {
        setSubmitError(null);
        setSlugTouched(true);
        setForm((current) => ({ ...current, slug: sanitizeSlugPart(value) }));
    };

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (isPublishing) {
            return;
        }

        const trimmedName = form.name.trim();
        if (!trimmedName) {
            setSubmitError("Name is required.");
            return;
        }

        setIsPublishing(true);
        setSubmitError(null);

        try {
            const response = await fetch(`/api/shortcuts/${shortcut._id}/publish`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: trimmedName,
                    description: normalizeDescription(form.description) || undefined,
                    category: form.category,
                    slug: form.slug || undefined,
                }),
            });

            const data = await response.json().catch(() => ({})) as {
                error?: string;
                shortcut?: Partial<PublicationSnapshot>;
            };
            if (!response.ok) {
                throw new Error(data.error || "Failed to save sharing settings.");
            }

            onPublished?.({
                slug: typeof data.shortcut?.slug === "string" && data.shortcut.slug.trim().length > 0
                    ? data.shortcut.slug
                    : effectiveSlug,
                name: typeof data.shortcut?.name === "string" && data.shortcut.name.trim().length > 0
                    ? data.shortcut.name
                    : trimmedName,
                description: typeof data.shortcut?.description === "string"
                    ? data.shortcut.description
                    : (normalizeDescription(form.description) || undefined),
                category: typeof data.shortcut?.category === "string" && data.shortcut.category.trim().length > 0
                    ? data.shortcut.category
                    : form.category,
                status: data.shortcut?.status === "archived" ? "archived" : "published",
                publishVersion: typeof data.shortcut?.publishVersion === "number"
                    ? data.shortcut.publishVersion
                    : existingPublication
                        ? existingPublication.publishVersion + 1
                        : 1,
            });
            onClose();
        } catch (error) {
            setSubmitError(
                error instanceof Error
                    ? error.message
                    : "Failed to save sharing settings.",
            );
        } finally {
            setIsPublishing(false);
        }
    };

    if (!isMounted || typeof document === "undefined") {
        return null;
    }

    return createPortal(
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="flex w-full max-w-4xl max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-2xl border border-border-subtle bg-secondary shadow-2xl"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex shrink-0 items-start justify-between gap-4 p-5 border-b border-border-subtle">
                    <div>
                        <div className="text-base font-semibold text-fg">
                            {submitLabel}
                        </div>
                        <div className="mt-1 text-sm text-fg-secondary">
                            Control how this workflow appears in the gallery, on its public page, and in social previews.
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {existingPublication && (
                            <span
                                className="inline-flex items-center h-8 px-3 text-[12px] font-semibold rounded-full border"
                                style={{
                                    color: existingPublication.status === "archived"
                                        ? "var(--color-fg-secondary)"
                                        : "var(--color-brand)",
                                    borderColor: existingPublication.status === "archived"
                                        ? "var(--color-border-subtle)"
                                        : "color-mix(in srgb, var(--color-brand) 30%, transparent)",
                                    backgroundColor: existingPublication.status === "archived"
                                        ? "var(--color-tertiary)"
                                        : "var(--color-brand-subtle)",
                                }}
                            >
                                {existingPublication.status === "archived" ? "Private" : "Public"}
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            className="w-10 h-10 inline-flex items-center justify-center rounded-xl bg-tertiary text-fg-secondary hover:text-fg border border-border-subtle transition-colors shrink-0"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-5">
                    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <form className="space-y-5" onSubmit={handleSubmit}>
                        {isLoadingExisting ? (
                            <PublishShortcutDialogSkeleton />
                        ) : (
                            <>
                        {loadError ? (
                            <div className="rounded-xl border border-status-warning/30 bg-status-warning/10 px-4 py-3 text-sm text-status-warning">
                                {loadError}
                            </div>
                        ) : null}

                        <div className="space-y-2">
                            <label className="block text-sm font-medium text-fg" htmlFor="publish-shortcut-name">
                                Name
                            </label>
                            <input
                                id="publish-shortcut-name"
                                value={form.name}
                                onChange={(event) => handleNameChange(event.target.value)}
                                placeholder="Send USDC"
                                disabled={isLoadingExisting || isPublishing}
                                className="w-full h-11 px-4 text-sm bg-primary border border-border-subtle rounded-xl text-fg placeholder:text-fg-muted outline-none focus:border-brand disabled:opacity-70"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="block text-sm font-medium text-fg" htmlFor="publish-shortcut-description">
                                Description
                            </label>
                            <textarea
                                id="publish-shortcut-description"
                                value={form.description}
                                onChange={(event) => handleDescriptionChange(event.target.value)}
                                placeholder="What should other builders understand immediately?"
                                rows={4}
                                disabled={isLoadingExisting || isPublishing}
                                className="w-full px-4 py-3 text-sm bg-primary border border-border-subtle rounded-xl text-fg placeholder:text-fg-muted outline-none focus:border-brand resize-none disabled:opacity-70"
                            />
                        </div>

	                        <div className="space-y-3">
	                            <div className="text-sm font-medium text-fg">
	                                Public Category
	                            </div>
	                            <div className="text-xs text-fg-muted">
	                                Builder category stays <span className="text-fg-secondary">{CATEGORY_META[shortcut.category].label}</span>. Choose how this workflow should appear on public surfaces.
	                            </div>
	                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                {PUBLISHABLE_SHORTCUT_CATEGORIES.map((category) => {
                                    const meta = CATEGORY_META[category];
                                    const Icon = CATEGORY_ICONS[category];
                                    const isSelected = form.category === category;

                                    return (
                                        <button
                                            key={category}
                                            type="button"
                                            onClick={() => handleCategoryChange(category)}
                                            disabled={isLoadingExisting || isPublishing}
                                            className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-left transition-colors ${
                                                isSelected
                                                    ? "border-transparent bg-secondary"
                                                    : "border-border-subtle bg-primary hover:border-border-default"
                                            } disabled:opacity-70`}
                                            style={isSelected ? {
                                                boxShadow: `inset 0 0 0 1px ${meta.cssColor}33`,
                                                backgroundColor: `color-mix(in srgb, ${meta.cssColor} 12%, var(--color-secondary))`,
                                            } : undefined}
                                        >
                                            <span
                                                className="flex h-8 w-8 items-center justify-center rounded-lg shrink-0"
                                                style={{
                                                    backgroundColor: `color-mix(in srgb, ${meta.cssColor} 12%, transparent)`,
                                                    color: meta.cssColor,
                                                }}
                                            >
                                                <Icon size={16} />
                                            </span>
                                            <span className="text-sm font-medium text-fg">
                                                {meta.label}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="block text-sm font-medium text-fg" htmlFor="publish-shortcut-slug">
                                Link
                            </label>
                            <input
                                id="publish-shortcut-slug"
                                value={form.slug}
                                onChange={(event) => handleSlugChange(event.target.value)}
                                placeholder="send-usdc"
                                disabled={isLoadingExisting || isPublishing}
                                className="w-full h-11 px-4 text-sm bg-primary border border-border-subtle rounded-xl text-fg placeholder:text-fg-muted outline-none focus:border-brand disabled:opacity-70"
                            />
                            <div className="text-xs text-fg-muted">
                                Letters, numbers, and dashes only. Public path: <span className="text-fg-secondary">/p/{effectiveSlug}</span>
                            </div>
                        </div>

                        {submitError && (
                            <div className="rounded-xl border border-status-error/30 bg-status-error/10 px-4 py-3 text-sm text-status-error">
                                {submitError}
                            </div>
                        )}

                        <div className="flex items-center justify-end gap-3 pt-1">
                            <button
                                type="button"
                                onClick={onClose}
                                className="h-11 px-4 inline-flex items-center justify-center rounded-xl border border-border-subtle bg-tertiary text-sm font-medium text-fg-secondary hover:border-border-default hover:text-fg transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={isLoadingExisting || isPublishing}
                                className="h-11 px-4 inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold text-fg bg-brand-subtle border border-transparent transition-colors disabled:opacity-70"
                                style={{
                                    color: "var(--color-brand-light)",
                                    boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-brand-light) 22%, transparent)",
                                }}
                            >
                                {isPublishing ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" />
                                        Saving...
                                    </>
                                ) : (
                                    <>
                                        <Globe size={16} />
                                        {submitLabel}
                                    </>
                                )}
                            </button>
                        </div>
                            </>
                        )}
                    </form>

                    <div className="space-y-4">
                        {isLoadingExisting ? (
                            <PublishShortcutPreviewSkeleton />
                        ) : (
                            <>
                        <div
                            className="relative overflow-hidden rounded-2xl border border-border-subtle p-5 min-h-[320px]"
                            style={{
                                background: `radial-gradient(circle at top left, color-mix(in srgb, ${categoryMeta.cssColor} 18%, transparent) 0%, transparent 48%), linear-gradient(180deg, color-mix(in srgb, ${categoryMeta.cssColor} 7%, var(--color-secondary)) 0%, var(--color-primary) 100%)`,
                            }}
                        >
                            <div className="absolute right-[-12px] top-6 text-fg/5 pointer-events-none">
                                <BaviumLogo className="h-32 w-auto" />
                            </div>

                            <div className="relative flex h-full flex-col">
                                <div className="flex items-center gap-2">
                                    <span
                                        className="inline-flex items-center h-8 px-3 text-[12px] font-semibold rounded-full"
                                        style={{
                                            backgroundColor: `color-mix(in srgb, ${categoryMeta.cssColor} 12%, transparent)`,
                                            color: categoryMeta.cssColor,
                                        }}
                                    >
                                        {categoryMeta.label}
                                    </span>
                                    <span className="inline-flex items-center h-8 px-3 text-[12px] font-semibold rounded-full bg-tertiary text-fg-secondary">
                                        {existingPublication?.status === "archived" ? "Private" : "Public"}
                                    </span>
                                </div>

                                <div className="mt-10 flex items-center gap-3">
                                    <span
                                        className="flex h-12 w-12 items-center justify-center rounded-2xl"
                                        style={{
                                            backgroundColor: `color-mix(in srgb, ${categoryMeta.cssColor} 12%, transparent)`,
                                            color: categoryMeta.cssColor,
                                        }}
                                    >
                                        <CategoryIcon size={24} />
                                    </span>
                                </div>

                                <div className="mt-5 text-[2rem] font-semibold leading-[1.05] text-fg">
                                    {form.name.trim() || "Untitled shortcut"}
                                </div>
                                <div className="mt-3 max-w-[28ch] text-sm leading-6 text-fg-secondary">
                                    {form.description.trim()
                                        || `Base workflow with ${shortcut.steps.length} step${shortcut.steps.length === 1 ? "" : "s"}.`}
                                </div>

                                <div className="mt-auto flex items-end justify-between gap-4 pt-8">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-black/5 dark:bg-white/5">
                                            <BaviumLogo className="h-5 w-auto text-fg" />
                                        </div>
                                        <div>
                                            <div className="text-sm font-semibold tracking-[0.18em] text-fg">
                                                BAVIUM
                                            </div>
                                            <div className="text-xs text-fg-muted">
                                                Visual automation for Base
                                            </div>
                                        </div>
                                    </div>
                                    <div className="inline-flex items-center gap-2 rounded-full bg-black/5 px-3 py-2 text-xs font-medium text-fg-secondary dark:bg-white/5">
                                        <Layers size={13} />
                                        {shortcut.steps.length} steps
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-border-subtle bg-tertiary px-4 py-4">
                            <div className="text-[11px] font-semibold tracking-wider uppercase text-fg-muted">
                                Public URL
                            </div>
                            <div className="mt-2 text-sm text-fg-secondary break-all">
                                /p/{effectiveSlug}
                            </div>
                            {existingPublication && (
                                <div className="mt-3 text-xs text-fg-muted">
                                    Version #{existingPublication.publishVersion}
                                </div>
                            )}
                        </div>
                            </>
                        )}
                    </div>
                    </div>
                </div>
            </div>
        </div>
        ,
        document.body,
    );
}

function PublishShortcutDialogSkeleton() {
    return (
        <div className="space-y-5">
            <div className="rounded-xl border border-border-subtle bg-tertiary/40 p-4">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-3 h-11 w-full rounded-xl" />
            </div>

            <div className="space-y-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-11 w-full rounded-xl" />
            </div>

            <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-28 w-full rounded-xl" />
            </div>

            <div className="space-y-3">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-3/4" />
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {Array.from({ length: 8 }).map((_, index) => (
                        <Skeleton key={index} className="h-14 w-full rounded-xl" />
                    ))}
                </div>
            </div>

            <div className="space-y-2">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-11 w-full rounded-xl" />
                <Skeleton className="h-3 w-2/3" />
            </div>
        </div>
    );
}

function PublishShortcutPreviewSkeleton() {
    return (
        <div className="space-y-4">
            <div className="rounded-2xl border border-border-subtle bg-tertiary/30 p-5">
                <div className="flex items-center gap-2">
                    <Skeleton className="h-8 w-20 rounded-full" />
                    <Skeleton className="h-8 w-16 rounded-full" />
                </div>
                <div className="mt-10">
                    <Skeleton className="h-12 w-12 rounded-2xl" />
                </div>
                <Skeleton className="mt-5 h-10 w-3/4" />
                <Skeleton className="mt-3 h-4 w-full" />
                <Skeleton className="mt-2 h-4 w-5/6" />
                <div className="mt-10 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <Skeleton className="h-10 w-10 rounded-xl" />
                        <div className="space-y-2">
                            <Skeleton className="h-4 w-20" />
                            <Skeleton className="h-3 w-28" />
                        </div>
                    </div>
                    <Skeleton className="h-8 w-20 rounded-full" />
                </div>
            </div>
            <div className="rounded-2xl border border-border-subtle bg-tertiary/30 px-4 py-4">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-3 h-4 w-32" />
            </div>
        </div>
    );
}
