import {
    PUBLISHABLE_SHORTCUT_CATEGORIES,
    type BlockCategory,
} from "@/lib/constants";

export const BLOCK_CATEGORY_VALUES = [
    "wallet",
    "swap",
    "bridge",
    "defi",
    "nft",
    "social",
    "data",
    "x402",
    "logic",
] as const satisfies readonly BlockCategory[];

export function isBlockCategoryValue(value: string): value is BlockCategory {
    return (BLOCK_CATEGORY_VALUES as readonly string[]).includes(value);
}

export function isPublishableShortcutCategory(value: string): value is BlockCategory {
    return (PUBLISHABLE_SHORTCUT_CATEGORIES as readonly string[]).includes(value);
}
