import type { Doc } from "../_generated/dataModel";
import { isShortcutCategoryValue, type ShortcutCategory } from "./validators";

export type PublicShortcutSnapshot = {
    _id: Doc<"saved_shortcuts">["_id"];
    slug: string;
    name: string;
    description?: string;
    category: ShortcutCategory;
    creatorAddress: string;
    inputs: Doc<"saved_shortcuts">["inputs"];
    steps: Doc<"saved_shortcuts">["steps"];
    remixCount: number;
    publishVersion: number;
    publishedAt: string;
    updatedAt: string;
    version: string;
};

export type BookmarkShortcutSnapshot = {
    shortcutId: Doc<"saved_shortcuts">["_id"];
    slug: string;
    name: string;
    description?: string;
    category: ShortcutCategory;
    creatorAddress: string;
    stepsCount: number;
    remixCount: number;
    publishVersion: number;
    publishedAt: string;
    status: "published" | "archived";
    updatedAt: string;
};

export function sanitizePublicSlug(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
}

export function resolvePublicCategory(
    shortcut: Pick<Doc<"saved_shortcuts">, "publicCategory" | "category">,
): ShortcutCategory {
    if (shortcut.publicCategory && isShortcutCategoryValue(shortcut.publicCategory)) {
        return shortcut.publicCategory;
    }

    if (isShortcutCategoryValue(shortcut.category)) {
        return shortcut.category;
    }

    return "logic";
}

export function hasPublicShortcutState(
    shortcut: Pick<
        Doc<"saved_shortcuts">,
        "slug" | "publicName" | "publicDescription" | "publicCategory" | "publishVersion" | "publishedAt"
    >,
): boolean {
    return Boolean(
        shortcut.slug
        || shortcut.publicName
        || shortcut.publicDescription
        || shortcut.publicCategory
        || shortcut.publishVersion
        || shortcut.publishedAt,
    );
}

export function isPublicShortcutVisible(
    shortcut: Pick<Doc<"saved_shortcuts">, "visibility" | "slug" | "publishedAt">,
): boolean {
    return shortcut.visibility === "public" && Boolean(shortcut.slug) && Boolean(shortcut.publishedAt);
}

export function buildPublicShortcutSnapshot(
    shortcut: Doc<"saved_shortcuts">,
): PublicShortcutSnapshot | null {
    if (!isPublicShortcutVisible(shortcut)) {
        return null;
    }

    return {
        _id: shortcut._id,
        slug: shortcut.slug!,
        name: shortcut.publicName ?? shortcut.name,
        description: shortcut.publicDescription ?? shortcut.description,
        category: resolvePublicCategory(shortcut),
        creatorAddress: shortcut.ownerAddress,
        inputs: shortcut.inputs,
        steps: shortcut.steps,
        remixCount: shortcut.remixCount ?? 0,
        publishVersion: shortcut.publishVersion ?? 0,
        publishedAt: shortcut.publishedAt!,
        updatedAt: shortcut.updatedAt,
        version: shortcut.version,
    };
}

export function buildBookmarkShortcutSnapshot(
    shortcut: Doc<"saved_shortcuts">,
    status: "published" | "archived" = shortcut.visibility === "public" ? "published" : "archived",
): BookmarkShortcutSnapshot {
    return {
        shortcutId: shortcut._id,
        slug: shortcut.slug ?? sanitizePublicSlug(shortcut.publicName ?? shortcut.name),
        name: shortcut.publicName ?? shortcut.name,
        description: shortcut.publicDescription ?? shortcut.description,
        category: resolvePublicCategory(shortcut),
        creatorAddress: shortcut.ownerAddress,
        stepsCount: shortcut.steps.length,
        remixCount: shortcut.remixCount ?? 0,
        publishVersion: shortcut.publishVersion ?? 0,
        publishedAt: shortcut.publishedAt ?? shortcut.updatedAt,
        status,
        updatedAt: shortcut.updatedAt,
    };
}
