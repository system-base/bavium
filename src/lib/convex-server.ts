import { fetchMutation, fetchQuery } from "convex/nextjs";
import { type FunctionArgs } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

function getConvexUrl(): string | null {
    const value = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
    return value ? value : null;
}

function getConvexOptions() {
    const url = getConvexUrl();
    if (!url) return null;
    return { url };
}

function getServerSecret(): string {
    const secret = process.env.CONVEX_SERVER_SECRET?.trim();
    if (!secret) {
        throw new Error("CONVEX_SERVER_SECRET is not configured.");
    }
    return secret;
}

export function hasConvexBackend(): boolean {
    return getConvexOptions() !== null;
}

export async function persistNonceInConvex(
    sessionKey: string,
    nonce: string,
    expiresAt: number,
): Promise<boolean> {
    const options = getConvexOptions();
    if (!options) return false;

    try {
        await fetchMutation(
            api.auth.storeNonce,
            { serverSecret: getServerSecret(), sessionKey, nonce, expiresAt },
            options,
        );
        return true;
    } catch (error) {
        console.error("[convex] Failed to persist nonce:", error);
        return false;
    }
}

export async function consumeNonceInConvex(
    sessionKey: string,
    nonce: string,
): Promise<boolean | null> {
    const options = getConvexOptions();
    if (!options) return null;

    try {
        return await fetchMutation(
            api.auth.consumeNonce,
            { serverSecret: getServerSecret(), sessionKey, nonce },
            options,
        );
    } catch (error) {
        console.error("[convex] Failed to consume nonce:", error);
        return null;
    }
}

export async function getNonceStateFromConvex(sessionKey: string) {
    const options = getConvexOptions();
    if (!options) return null;

    try {
        return await fetchQuery(
            api.auth.getNonceState,
            { serverSecret: getServerSecret(), sessionKey },
            options,
        );
    } catch (error) {
        console.error("[convex] Failed to query nonce state:", error);
        return null;
    }
}

export async function consumeDurableRateLimitInConvex(
    bucket: string,
    key: string,
    windowMs: number,
    max: number,
): Promise<{ allowed: boolean; retryAfterSeconds: number } | null> {
    const options = getConvexOptions();
    if (!options) return null;

    try {
        return await fetchMutation(
            api.auth.consumeRateLimit,
            {
                serverSecret: getServerSecret(),
                bucket,
                key,
                windowMs,
                max,
            },
            options,
        );
    } catch (error) {
        console.error("[convex] Failed to consume durable rate limit:", error);
        return null;
    }
}

export type { Id } from "../../convex/_generated/dataModel";
export type RunStatus = "queued" | "running" | "awaiting_signature" | "succeeded" | "failed" | "canceled";
export type RunStepStatus =
    | "pending"
    | "running"
    | "waiting_confirmation"
    | "waiting_input"
    | "waiting_signature"
    | "success"
    | "error"
    | "skipped";
export type RunSourceType = "manual" | "automation";
export type AutomationStatus = "active" | "paused" | "completed" | "error";
export type PublishedShortcutStatus = "published" | "archived";

type SavedShortcutPayload = Omit<FunctionArgs<typeof api.shortcuts.create>, "serverSecret">;
type SavedShortcutUpdatePayload = Omit<
    FunctionArgs<typeof api.shortcuts.update>,
    "serverSecret" | "ownerAddress" | "shortcutId"
>;
type AutomationPayload = Omit<FunctionArgs<typeof api.automations.create>, "serverSecret">;
type AutomationUpdatePayload = Omit<
    FunctionArgs<typeof api.automations.update>,
    "serverSecret" | "ownerAddress" | "automationId"
>;
type PublicShortcutPayload = Omit<FunctionArgs<typeof api.publicShortcuts.publish>, "serverSecret">;
type RunCreatePayload = Omit<FunctionArgs<typeof api.runs.create>, "serverSecret">;
export type RunDefinitionSnapshot = NonNullable<RunCreatePayload["definitionSnapshot"]>;

interface RunStepWrite {
    stepId: string;
    label: string;
    status: RunStepStatus;
    outputSummary?: string;
    error?: string;
    startedAt: string;
    completedAt?: string;
    durationMs?: number;
    sequence: number;
}

export async function listSavedShortcutsPaginatedFromConvex(
    ownerAddress: string,
    paginationOpts: { numItems: number; cursor: string | null },
) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    return await fetchQuery(
        api.shortcuts.listMinePaginated,
        { serverSecret: getServerSecret(), ownerAddress, paginationOpts },
        options,
    );
}

export async function listRunsPaginatedFromConvex(
    ownerAddress: string,
    paginationOpts: { numItems: number; cursor: string | null },
) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    return await fetchQuery(
        api.runs.listMinePaginated,
        { serverSecret: getServerSecret(), ownerAddress, paginationOpts },
        options,
    );
}

export async function getSavedShortcutFromConvex(
    ownerAddress: string,
    shortcutId: Id<"saved_shortcuts">,
) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    return await fetchQuery(
        api.shortcuts.getMine,
        { serverSecret: getServerSecret(), ownerAddress, shortcutId },
        options,
    );
}

export async function getSavedShortcutManageDetailFromConvex(
    ownerAddress: string,
    shortcutId: Id<"saved_shortcuts">,
) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    return await fetchQuery(
        api.shortcuts.getMineManageDetail,
        { serverSecret: getServerSecret(), ownerAddress, shortcutId },
        options,
    );
}

export async function createSavedShortcutInConvex(payload: SavedShortcutPayload) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    return await fetchMutation(
        api.shortcuts.create,
        { serverSecret: getServerSecret(), ...payload },
        options,
    );
}

export async function updateSavedShortcutInConvex(
    ownerAddress: string,
    shortcutId: Id<"saved_shortcuts">,
    updates: SavedShortcutUpdatePayload,
) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    return await fetchMutation(
        api.shortcuts.update,
        {
            serverSecret: getServerSecret(),
            ownerAddress,
            shortcutId,
            ...updates,
        },
        options,
    );
}

export async function deleteSavedShortcutFromConvex(
    ownerAddress: string,
    shortcutId: Id<"saved_shortcuts">,
) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    return await fetchMutation(
        api.shortcuts.remove,
        {
            serverSecret: getServerSecret(),
            ownerAddress,
            shortcutId,
        },
        options,
    );
}

export async function listPublishedShortcutsPaginatedFromConvex(
    paginationOpts: { numItems: number; cursor: string | null },
) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    return await fetchQuery(
        api.shortcuts.listPublicPaginated,
        { serverSecret: getServerSecret(), paginationOpts },
        options,
    );
}

export async function getPublishedShortcutBySlugFromConvex(slug: string) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    return await fetchQuery(
        api.shortcuts.getPublicBySlug,
        { serverSecret: getServerSecret(), slug },
        options,
    );
}

export async function getPublicationForSavedShortcutFromConvex(
    ownerAddress: string,
    shortcutId: Id<"saved_shortcuts">,
) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    return await fetchQuery(
        api.shortcuts.getMineShareConfig,
        { serverSecret: getServerSecret(), ownerAddress, shortcutId },
        options,
    );
}

export async function getPublishedShortcutViewerContextFromConvex(payload: {
    ownerAddress: string;
    slug: string;
}) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    return await fetchQuery(
        api.shortcuts.getPublicViewerContext,
        { serverSecret: getServerSecret(), ...payload },
        options,
    );
}

export async function publishShortcutInConvex(payload: PublicShortcutPayload) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    const args: FunctionArgs<typeof api.publicShortcuts.publish> = {
        serverSecret: getServerSecret(),
        ownerAddress: payload.ownerAddress,
        shortcutId: payload.shortcutId,
        ...(payload.slug !== undefined ? { slug: payload.slug } : {}),
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(payload.description !== undefined ? { description: payload.description } : {}),
        ...(payload.category !== undefined ? { category: payload.category } : {}),
        ...(payload.status !== undefined ? { status: payload.status } : {}),
    };

    return await fetchMutation(
        api.publicShortcuts.publish,
        args,
        options,
    );
}

export async function remixPublishedShortcutInConvex(payload: {
    ownerAddress: string;
    slug: string;
}) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    const args: FunctionArgs<typeof api.publicShortcuts.remix> = {
        serverSecret: getServerSecret(),
        ownerAddress: payload.ownerAddress,
        slug: payload.slug,
    };

    return await fetchMutation(
        api.publicShortcuts.remix,
        args,
        options,
    );
}

export async function archivePublishedShortcutInConvex(payload: {
    ownerAddress: string;
    slug: string;
}) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    const args: FunctionArgs<typeof api.publicShortcuts.archive> = {
        serverSecret: getServerSecret(),
        ownerAddress: payload.ownerAddress,
        slug: payload.slug,
    };

    return await fetchMutation(
        api.publicShortcuts.archive,
        args,
        options,
    );
}

export async function listBookmarkedPublishedShortcutsPaginatedFromConvex(
    ownerAddress: string,
    paginationOpts: { numItems: number; cursor: string | null },
) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    return await fetchQuery(
        api.shortcutBookmarks.listMinePaginated,
        { serverSecret: getServerSecret(), ownerAddress, paginationOpts },
        options,
    );
}

export async function getPublishedShortcutBookmarkStateFromConvex(payload: {
    ownerAddress: string;
    slug: string;
}) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    return await fetchQuery(
        api.shortcutBookmarks.getStateBySlug,
        { serverSecret: getServerSecret(), ...payload },
        options,
    );
}

export async function bookmarkPublishedShortcutInConvex(payload: {
    ownerAddress: string;
    slug: string;
}) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    return await fetchMutation(
        api.shortcutBookmarks.add,
        { serverSecret: getServerSecret(), ...payload },
        options,
    );
}

export async function removePublishedShortcutBookmarkInConvex(payload: {
    ownerAddress: string;
    slug: string;
}) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    return await fetchMutation(
        api.shortcutBookmarks.remove,
        { serverSecret: getServerSecret(), ...payload },
        options,
    );
}

export async function createRunInConvex(payload: RunCreatePayload) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    return await fetchMutation(
        api.runs.create,
        { serverSecret: getServerSecret(), ...payload },
        options,
    );
}

export async function deleteRunFromConvex(ownerAddress: string, runId: Id<"runs">) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    return await fetchMutation(
        api.runs.removeMine,
        { serverSecret: getServerSecret(), ownerAddress, runId },
        options,
    );
}

export async function deleteRunBatchFromConvex(ownerAddress: string, limit = 25) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    return await fetchMutation(
        api.runs.removeMineBatch,
        { serverSecret: getServerSecret(), ownerAddress, limit },
        options,
    );
}

export async function finalizeRunInConvex(payload: {
    ownerAddress: string;
    runId: Id<"runs">;
    status: RunStatus;
    error?: string;
    completedAt?: string;
    steps: RunStepWrite[];
}) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    return await fetchMutation(
        api.runs.finalize,
        { serverSecret: getServerSecret(), ...payload },
        options,
    );
}

export async function getRunFromConvex(ownerAddress: string, runId: Id<"runs">) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    return await fetchQuery(
        api.runs.getMine,
        { serverSecret: getServerSecret(), ownerAddress, runId },
        options,
    );
}

export async function reconcileRunInConvex(payload: {
    ownerAddress: string;
    runId: Id<"runs">;
    status: RunStatus;
    error?: string;
    completedAt?: string;
    steps: RunStepWrite[];
}) {
    return await finalizeRunInConvex(payload);
}

export async function listAutomationsForSavedShortcutFromConvex(
    ownerAddress: string,
    shortcutId: Id<"saved_shortcuts">,
) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    return await fetchQuery(
        api.automations.listMineByTargetShortcut,
        { serverSecret: getServerSecret(), ownerAddress, shortcutId },
        options,
    );
}

export async function listAutomationsPaginatedFromConvex(
    ownerAddress: string,
    paginationOpts: { numItems: number; cursor: string | null },
) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    return await fetchQuery(
        api.automations.listMinePaginated,
        { serverSecret: getServerSecret(), ownerAddress, paginationOpts },
        options,
    );
}

export async function listActiveAutomationsFromConvex() {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    const automations = await fetchQuery(
        api.automations.listSchedulerCandidates,
        { serverSecret: getServerSecret(), now: new Date().toISOString() },
        options,
    );
    return automations;
}

export async function getAutomationFromConvex(ownerAddress: string, automationId: Id<"automations">) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    return await fetchQuery(
        api.automations.getMine,
        { serverSecret: getServerSecret(), ownerAddress, automationId },
        options,
    );
}

export async function createAutomationInConvex(payload: AutomationPayload) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    return await fetchMutation(
        api.automations.create,
        { serverSecret: getServerSecret(), ...payload },
        options,
    );
}

export async function updateAutomationInConvex(
    ownerAddress: string,
    automationId: Id<"automations">,
    updates: AutomationUpdatePayload,
) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    return await fetchMutation(
        api.automations.update,
        { serverSecret: getServerSecret(), ownerAddress, automationId, ...updates },
        options,
    );
}

export async function deleteAutomationInConvex(ownerAddress: string, automationId: Id<"automations">) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    return await fetchMutation(
        api.automations.remove,
        { serverSecret: getServerSecret(), ownerAddress, automationId },
        options,
    );
}

export async function listRunsBySourceFromConvex(
    ownerAddress: string,
    sourceType: RunSourceType,
    sourceId: string,
) {
    const options = getConvexOptions();
    if (!options) {
        throw new Error("Convex backend is not configured.");
    }

    return await fetchQuery(
        api.runs.listBySource,
        { serverSecret: getServerSecret(), ownerAddress, sourceType, sourceId },
        options,
    );
}
