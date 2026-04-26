"use client";

import Link from "next/link";
import {
    ArrowRight,
    Layers,
} from "lucide-react";
import { motion } from "framer-motion";
import { CATEGORY_META, CATEGORY_ICONS } from "@/lib/constants";
import type { TemplateShortcut } from "@/lib/template-shortcuts";

interface ShortcutCardProps {
    shortcut: TemplateShortcut;
}

export function ShortcutCard({ shortcut }: ShortcutCardProps) {
    const meta = CATEGORY_META[shortcut.category];
    const Icon = CATEGORY_ICONS[shortcut.category];

    return (
        <Link
            href={`/builder?template=${shortcut.id}`}
            className="group relative flex flex-col p-5 bg-secondary border border-border-subtle rounded-xl no-underline overflow-hidden hover:border-border-default hover:shadow-xl hover:scale-[1.02] transition-all duration-300 h-full"
        >

            <div className="flex items-start justify-between mb-3">
                <div
                    className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
                    style={{ backgroundColor: `color-mix(in srgb, ${meta.cssColor} 12%, transparent)`, color: meta.cssColor }}
                >
                    <Icon size={18} />
                </div>
                <span
                    className="inline-flex items-center h-6 px-2 text-[13px] font-semibold tracking-wider uppercase rounded-md"
                    style={{ backgroundColor: `color-mix(in srgb, ${meta.cssColor} 8%, transparent)`, color: meta.cssColor }}
                >
                    {meta.label}
                </span>
            </div>

            <h3 className="text-base font-semibold text-fg mb-1">
                {shortcut.name}
            </h3>
            <p className="text-sm text-fg-secondary leading-relaxed flex-1">
                {shortcut.description}
            </p>

            <div className="flex items-center justify-between mt-auto pt-3 border-t border-border-subtle">
                <span className="flex items-center gap-1 text-[13px] text-fg-muted">
                    <Layers size={13} />
                    {shortcut.stepCount} steps
                </span>
                <span className="flex items-center gap-1 text-[13px] text-brand-light sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    Open in Builder
                    <ArrowRight size={12} />
                </span>
            </div>
        </Link>
    );
}

export function ShortcutCardSkeleton() {
    return (
        <div className="relative flex flex-col p-5 bg-secondary border border-border-subtle rounded-xl overflow-hidden h-full min-h-[180px]">
            {/* Shimmer Effect */}
            <motion.div
                className="absolute inset-0 bg-gradient-to-r from-transparent via-border-subtle to-transparent w-full h-full skew-x-[-20deg]"
                animate={{ x: ["-100%", "200%"] }}
                transition={{ repeat: Infinity, duration: 1.8, ease: "linear" }}
            />

            <div className="flex items-start justify-between mb-4 relative z-10">
                <div className="w-8 h-8 rounded-lg bg-border-subtle/50 animate-pulse" />
                <div className="w-16 h-6 rounded-md bg-border-subtle/50 animate-pulse" />
            </div>

            <div className="w-3/4 h-5 rounded bg-border-subtle/50 mb-2 mt-1 relative z-10 animate-pulse" />
            <div className="w-full h-4 rounded bg-border-subtle/30 mb-1 relative z-10 animate-pulse" />
            <div className="w-4/5 h-4 rounded bg-border-subtle/30 mb-1 relative z-10 animate-pulse" />

            <div className="flex items-center justify-between mt-auto pt-3 border-t border-border-subtle relative z-10">
                <div className="w-16 h-4 rounded bg-border-subtle/50 animate-pulse" />
            </div>
        </div>
    );
}
