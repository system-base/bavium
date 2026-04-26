"use client";

import { useState } from "react";
import Link from "next/link";
import {
    Layers,
    ArrowRight,
    Clock3,
    Trash2,
    Globe,
    Loader2,
} from "lucide-react";
import PublishShortcutDialog from "@/components/gallery/PublishShortcutDialog";
import type { BlockCategory } from "@/lib/constants";
import { CATEGORY_META, CATEGORY_ICONS } from "@/lib/constants";

export interface SavedShortcutData {
    _id: string;
    ownerAddress: string;
    name: string;
    description?: string;
    category: BlockCategory;
    publicName?: string;
    publicDescription?: string;
    publicCategory?: BlockCategory;
    steps: unknown[];
    updatedAt: string;
}

interface SavedShortcutCardProps {
    shortcut: SavedShortcutData;
    onDeleted?: (id: string) => void;
    onPublished?: () => void;
}

export function SavedShortcutCard({ shortcut, onDeleted, onPublished }: SavedShortcutCardProps) {
    const displayName = shortcut.publicName?.trim() || shortcut.name;
    const displayDescription = shortcut.publicDescription?.trim() || shortcut.description?.trim();
    const displayCategory = shortcut.publicCategory ?? shortcut.category;
    const meta = CATEGORY_META[displayCategory] ?? { label: displayCategory, cssColor: "var(--color-fg-muted)" };
    const Icon = CATEGORY_ICONS[displayCategory] ?? Layers;

    const [deleteState, setDeleteState] = useState<"idle" | "confirm" | "deleting">("idle");
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false);

    const handleDelete = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (deleteState === "idle") {
            setDeleteError(null);
            setDeleteState("confirm");
            return;
        }

        if (deleteState !== "confirm") return;

        setDeleteState("deleting");
        try {
            const res = await fetch(`/api/shortcuts/${shortcut._id}`, {
                method: "DELETE",
                credentials: "include",
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({})) as { error?: string };
                throw new Error(data.error || "Failed to delete");
            }
            setDeleteError(null);
            onDeleted?.(shortcut._id);
        } catch (error) {
            setDeleteError(
                error instanceof Error
                    ? error.message
                    : "Failed to delete shortcut.",
            );
            setDeleteState("idle");
        }
    };

    const handleCancelDelete = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDeleteError(null);
        setDeleteState("idle");
    };

    const handlePublish = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsPublishDialogOpen(true);
    };

    return (
        <div className="group relative flex flex-col bg-secondary border border-border-subtle rounded-xl overflow-hidden hover:border-border-default hover:shadow-xl hover:scale-[1.02] transition-all duration-300 h-full">
            {/* Clickable content area */}
            <Link
                href={`/shortcuts/saved/${shortcut._id}`}
                className="flex flex-col p-5 pb-0 no-underline flex-1"
            >
                <div className="flex items-start justify-between mb-3">
                    <div
                        className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
                        style={{ backgroundColor: `color-mix(in srgb, ${meta.cssColor} 12%, transparent)`, color: meta.cssColor }}
                    >
                        <Icon size={18} />
                    </div>
                    <div className="flex items-center gap-2">
                        <span
                            className="inline-flex items-center h-6 px-2 text-[13px] font-semibold tracking-wider uppercase rounded-md"
                            style={{
                                backgroundColor: `color-mix(in srgb, ${meta.cssColor} 8%, transparent)`,
                                color: meta.cssColor,
                            }}
                        >
                            {meta.label}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[12px] text-fg-muted">
                            <Clock3 size={12} />
                            {new Date(shortcut.updatedAt).toLocaleDateString("en-US")}
                        </span>
                    </div>
                </div>

                <h3 className="text-base font-semibold text-fg mb-1">
                    {displayName}
                </h3>
                <p className="text-sm text-fg-secondary leading-relaxed flex-1">
                    {displayDescription || "Saved workflow from your builder workspace."}
                </p>
            </Link>

            {/* Footer with actions */}
            <div className="flex items-center justify-between px-5 py-3 mt-auto border-t border-border-subtle">
                <span className="flex items-center gap-1 text-[13px] text-fg-muted">
                    <Layers size={13} />
                    {shortcut.steps.length} steps
                </span>

                <div className="flex items-center gap-1">
                    {/* Delete */}
                    {deleteState === "confirm" ? (
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={handleCancelDelete}
                                className="h-7 px-2 text-[12px] font-medium text-fg-muted hover:text-fg rounded-md transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleDelete}
                                className="h-7 px-2.5 text-[12px] font-medium text-status-error bg-status-error/10 hover:bg-status-error/20 rounded-md transition-colors"
                            >
                                Confirm
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={handleDelete}
                            disabled={deleteState === "deleting"}
                            className="w-7 h-7 flex items-center justify-center rounded-md text-fg-muted hover:text-status-error hover:bg-status-error/10 transition-colors sm:opacity-0 sm:group-hover:opacity-100 disabled:opacity-50"
                            title="Delete shortcut"
                        >
                            {deleteState === "deleting" ? (
                                <Loader2 size={13} className="animate-spin" />
                            ) : (
                                <Trash2 size={13} />
                            )}
                        </button>
                    )}

                    {/* Share */}
                    <button
                        type="button"
                        onClick={handlePublish}
                        className="h-7 px-2.5 flex items-center gap-1.5 text-[12px] font-medium rounded-md transition-all text-fg-muted hover:text-brand-light hover:bg-brand-subtle sm:opacity-0 sm:group-hover:opacity-100"
                        title="Share shortcut"
                    >
                        <Globe size={12} />
                        Share
                    </button>

                    {/* Open arrow */}
                    <Link
                        href={`/builder?shortcut=${shortcut._id}`}
                        className="w-7 h-7 flex items-center justify-center rounded-md text-brand-light sm:opacity-0 sm:group-hover:opacity-100 transition-opacity no-underline"
                        title="Open in Builder"
                    >
                        <ArrowRight size={14} />
                    </Link>
                </div>
            </div>
            {deleteError && (
                <div className="px-5 pb-3 text-[12px] text-status-error">
                    {deleteError}
                </div>
            )}
            {isPublishDialogOpen && (
                <PublishShortcutDialog
                    shortcut={shortcut}
                    onClose={() => setIsPublishDialogOpen(false)}
                    onPublished={() => onPublished?.()}
                />
            )}
        </div>
    );
}
