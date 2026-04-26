import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { unstable_cache } from "next/cache";
import { getPublishedShortcutBySlugFromConvex, hasConvexBackend } from "@/lib/convex-server";

type PublishedShortcutSocialRecord = NonNullable<
    Awaited<ReturnType<typeof getPublishedShortcutBySlugFromConvex>>
>;

const CATEGORY_LABELS = {
    wallet: "Wallet",
    swap: "Swap",
    bridge: "Bridge",
    defi: "DeFi",
    nft: "NFT",
    social: "Social",
    data: "Data",
    x402: "x402",
    logic: "Logic",
} as const;

const CATEGORY_HEX_COLORS = {
    wallet: "#e06040",
    swap: "#22c55e",
    bridge: "#14b8a6",
    defi: "#a78bfa",
    nft: "#f472b6",
    social: "#38bdf8",
    data: "#fbbf24",
    x402: "#818cf8",
    logic: "#94a3b8",
} as const;

const BRAND_COLOR = "#30D5C8";

const getPublishedShortcutSocialRecordCached = unstable_cache(
    async (slug: string): Promise<PublishedShortcutSocialRecord | null> => {
        if (!hasConvexBackend()) {
            return null;
        }

        try {
            return await getPublishedShortcutBySlugFromConvex(slug);
        } catch (error) {
            console.error("[social] Failed to load published shortcut:", error);
            return null;
        }
    },
    ["published-shortcut-social-record"],
    { revalidate: 300 },
);

let logoDataUrlPromise: Promise<string> | null = null;

export function trimText(value: string, maxLength: number): string {
    const normalized = value.trim().replace(/\s+/g, " ");
    if (normalized.length <= maxLength) {
        return normalized;
    }

    return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function getPublishedShortcutCategoryLabel(category: string): string {
    return CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] ?? category;
}

export function getPublishedShortcutCategoryColor(category: string): string {
    return CATEGORY_HEX_COLORS[category as keyof typeof CATEGORY_HEX_COLORS] ?? BRAND_COLOR;
}

export function getPublishedShortcutDescription(
    shortcut: Pick<PublishedShortcutSocialRecord, "description" | "category" | "steps">,
): string {
    const shortDescription = shortcut.description?.trim();
    if (shortDescription) {
        return trimText(shortDescription, 160);
    }

    const categoryLabel = getPublishedShortcutCategoryLabel(shortcut.category);
    const stepCount = shortcut.steps.length;
    return `${categoryLabel} shortcut on Base · ${stepCount} step${stepCount === 1 ? "" : "s"}.`;
}

export function withAlpha(hex: string, alpha: number): string {
    const sanitized = hex.replace("#", "");
    if (sanitized.length !== 6) {
        return `rgba(48, 213, 200, ${alpha})`;
    }

    const red = Number.parseInt(sanitized.slice(0, 2), 16);
    const green = Number.parseInt(sanitized.slice(2, 4), 16);
    const blue = Number.parseInt(sanitized.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export async function getPublishedShortcutSocialRecord(slug: string) {
    return await getPublishedShortcutSocialRecordCached(slug);
}

export async function getBrandLogoDataUrl(color = "#ffffff"): Promise<string> {
    if (!logoDataUrlPromise) {
        logoDataUrlPromise = readFile(path.join(process.cwd(), "public", "logo.svg"), "utf8").then((svg) => {
            return svg;
        });
    }

    const svgTemplate = await logoDataUrlPromise;
    const tintedSvg = svgTemplate.replaceAll("currentColor", color);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(tintedSvg)}`;
}
