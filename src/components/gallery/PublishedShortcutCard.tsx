import Link from "next/link";
import {
    ArrowRight,
    Layers,
    GitFork,
    User,
} from "lucide-react";
import type { BlockCategory } from "@/lib/constants";
import { CATEGORY_META, CATEGORY_ICONS } from "@/lib/constants";

export interface PublishedShortcutData {
    _id: string;
    slug: string;
    name: string;
    description?: string;
    category: string;
    creatorAddress: string;
    steps: unknown[];
    remixCount: number;
    publishVersion: number;
    publishedAt: string;
    updatedAt: string;
}

interface PublishedShortcutCardProps {
    shortcut: PublishedShortcutData;
    isOwner?: boolean;
}

function truncateAddress(address: string): string {
    if (address.length <= 10) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function PublishedShortcutCard({ shortcut, isOwner = false }: PublishedShortcutCardProps) {
    const category = shortcut.category as BlockCategory;
    const meta = CATEGORY_META[category] ?? { label: shortcut.category, cssColor: "var(--color-fg-muted)" };
    const Icon = CATEGORY_ICONS[category] ?? Layers;

    return (
        <Link
            href={`/p/${shortcut.slug}`}
            className="group relative flex flex-col p-5 bg-secondary border border-border-subtle rounded-xl no-underline overflow-hidden hover:border-border-default hover:shadow-xl hover:scale-[1.02] transition-all duration-300 h-full"
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
                    <span
                        className="inline-flex items-center h-6 px-2 text-[13px] font-semibold tracking-wider uppercase rounded-md"
                        style={{ backgroundColor: "var(--color-brand-subtle)", color: "var(--color-brand)" }}
                    >
                        Public
                    </span>
                    {isOwner && (
                        <span className="inline-flex items-center h-6 px-2 text-[12px] font-semibold rounded-md bg-tertiary text-fg-muted">
                            Yours
                        </span>
                    )}
                </div>
            </div>

            <h3 className="text-base font-semibold text-fg mb-1">
                {shortcut.name}
            </h3>
            <p className="text-sm text-fg-secondary leading-relaxed flex-1">
                {shortcut.description?.trim() || "A public shortcut from the gallery."}
            </p>

            <div className="flex items-center gap-3 mt-auto pt-3 border-t border-border-subtle">
                <span className="flex items-center gap-1 text-[12px] text-fg-muted">
                    <User size={11} />
                    {truncateAddress(shortcut.creatorAddress)}
                </span>
                <span className="flex items-center gap-1 text-[12px] text-fg-muted">
                    <Layers size={11} />
                    {shortcut.steps.length}
                </span>
                {shortcut.remixCount > 0 && (
                    <span className="flex items-center gap-1 text-[12px] text-fg-muted">
                        <GitFork size={11} />
                        {shortcut.remixCount}
                    </span>
                )}
                <span className="flex items-center gap-1 text-[13px] text-brand-light sm:opacity-0 sm:group-hover:opacity-100 transition-opacity ml-auto">
                    {isOwner ? "Manage" : "View"}
                    <ArrowRight size={12} />
                </span>
            </div>
        </Link>
    );
}
