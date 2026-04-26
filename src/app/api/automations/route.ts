/* ==========================================================================
   API Route: /api/automations
   CRUD for user automations — auth-protected.
   ========================================================================== */

import { NextRequest, NextResponse } from "next/server";
import {
    createAutomationInConvex,
    getSavedShortcutFromConvex,
    hasConvexBackend,
    listAutomationsPaginatedFromConvex,
} from "@/lib/convex-server";
import type { AutomationStatus as ConvexAutomationStatus, Id } from "@/lib/convex-server";
import { requireAuth } from "@/lib/api-middleware";
import { getNetworkByChainId, getRegisteredTokens } from "@/lib/chain-config";
import { computeNextScheduledRunAt } from "@/lib/automation-schedule";
import type { Action, Automation, Trigger } from "@/types/automation";
import { consumeServerRateLimit } from "@/lib/server-rate-limit";
import { sanitizeErrorMessage } from "@/lib/error-sanitizer";
import { PRICE_TRIGGER_SYMBOLS, resolvePriceSymbols } from "@/engine/price-feed";
import {
    ShortcutValidationError,
    validateShortcutForAutomation,
} from "@/lib/shortcut-validation";
import { hydrateWalletExecutionContext } from "@/lib/wallet-context";



interface AutomationCreateBody {
    name?: string;
    description?: string;
    trigger?: Trigger;
    action?: Action;
    targetShortcutId?: string;
    maxExecutions?: number;
}

const MAX_AUTOMATION_NAME_LENGTH = 80;
const MAX_AUTOMATION_DESCRIPTION_LENGTH = 280;
const MAX_AUTOMATION_EXECUTIONS = 1000;

function normalizeMaxExecutions(value: unknown): number | null {
    const next = Number(value ?? 0);
    if (!Number.isFinite(next) || !Number.isInteger(next)) return null;
    if (next < 0 || next > MAX_AUTOMATION_EXECUTIONS) return null;
    return next;
}

function supportedPriceSymbolsForNetwork(networkId: Parameters<typeof getRegisteredTokens>[0]): string[] {
    const supported = new Set(PRICE_TRIGGER_SYMBOLS.map((symbol) => symbol.toUpperCase()));
    return getRegisteredTokens(networkId)
        .map((token) => token.symbol.toUpperCase())
        .filter((symbol) => supported.has(symbol));
}

// ---------------------------------------------------------------------------
// GET /api/automations — List MY automations (filtered by wallet address)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const { session } = auth;

    if (!hasConvexBackend()) {
        return NextResponse.json(
            { error: "Convex backend is not configured." },
            { status: 503 },
        );
    }

    try {
        const { searchParams } = new URL(request.url);
        const cursor = searchParams.get("cursor") ?? undefined;
        const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10) || 20, 100);

        const result = await listAutomationsPaginatedFromConvex(
            session.address,
            { numItems: limit, cursor: cursor ?? null },
        );
        const automations = result.page;
        const mapped = automations.map((automation: {
            _id: string;
            name: string;
            description?: string;
            accountAddress: string;
            networkId?: string;
            trigger: unknown;
            action: unknown;
            targetShortcutId: string;
            status: string;
            maxExecutions: number;
            executionCount: number;
            createdAt: string;
            lastTriggeredAt?: string;
            lastExecutedAt?: string;
            nextRunAt?: string;
            lastError?: string;
            lastRunId?: string;
        }) => ({
            id: String(automation._id),
            name: automation.name,
            description: automation.description ?? "",
            accountAddress: automation.accountAddress,
            networkId: automation.networkId,
            trigger: automation.trigger,
            action: automation.action,
            targetShortcutId: automation.targetShortcutId,
            status: automation.status,
            maxExecutions: automation.maxExecutions,
            executionCount: automation.executionCount,
            createdAt: automation.createdAt,
            lastTriggeredAt: automation.lastTriggeredAt,
            lastExecutedAt: automation.lastExecutedAt,
            nextRunAt: automation.nextRunAt,
            lastError: automation.lastError,
            lastRunId: automation.lastRunId,
        }));
        return NextResponse.json({
            automations: mapped,
            continueCursor: result.continueCursor,
            isDone: result.isDone,
        });
    } catch (error) {
        return NextResponse.json(
            { error: sanitizeErrorMessage(error, "Failed to list automations.") },
            { status: 500 },
        );
    }
}

// ---------------------------------------------------------------------------
// POST /api/automations — Create a new automation
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const { session } = auth;

    if (!hasConvexBackend()) {
        return NextResponse.json(
            { error: "Convex backend is not configured." },
            { status: 503 },
        );
    }

    try {
        const rateLimit = await consumeServerRateLimit({
            bucket: "automation-create",
            key: session.address,
            windowMs: 5 * 60_000,
            max: 8,
        });
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { error: `Too many automation create requests. Try again in ${rateLimit.retryAfterSeconds}s.` },
                { status: 429 },
            );
        }

        const body = await request.json() as AutomationCreateBody;

        // Validate required fields
        if (!body.name || !body.trigger || !body.action) {
            return NextResponse.json(
                { error: "Missing required fields: name, trigger, action" },
                { status: 400 },
            );
        }

        const name = String(body.name).trim();
        if (!name || name.length > MAX_AUTOMATION_NAME_LENGTH) {
            return NextResponse.json(
                { error: `Automation name must be 1-${MAX_AUTOMATION_NAME_LENGTH} characters.` },
                { status: 400 },
            );
        }

        const description = String(body.description ?? "").trim();
        if (description.length > MAX_AUTOMATION_DESCRIPTION_LENGTH) {
            return NextResponse.json(
                { error: `Automation description must be ${MAX_AUTOMATION_DESCRIPTION_LENGTH} characters or fewer.` },
                { status: 400 },
            );
        }

        const maxExecutions = normalizeMaxExecutions(body.maxExecutions);
        if (maxExecutions == null) {
            return NextResponse.json(
                { error: `Maximum run count must be a whole number from 0 to ${MAX_AUTOMATION_EXECUTIONS}.` },
                { status: 400 },
            );
        }

        // Validate trigger type
        const validTriggerTypes = ["price_below", "price_above", "scheduled"];
        if (!validTriggerTypes.includes(body.trigger.type)) {
            return NextResponse.json(
                { error: `Invalid trigger type. Must be one of: ${validTriggerTypes.join(", ")}` },
                { status: 400 },
            );
        }

        const sessionNetwork = getNetworkByChainId(session.chainId);
        if (!sessionNetwork) {
            return NextResponse.json(
                { error: `Unsupported session chain ID: ${session.chainId}` },
                { status: 400 },
            );
        }

        let normalizedTrigger: Trigger = body.trigger;

        // Validate price trigger tokens (network-aware; matches the Builder token registry where possible)
        if (body.trigger.type === "price_below" || body.trigger.type === "price_above") {
            const token = String(body.trigger.token ?? "").trim();
            const resolved = resolvePriceSymbols([token], sessionNetwork.networkId);
            const resolvedSymbol = resolved.symbols[0];
            const supported = supportedPriceSymbolsForNetwork(sessionNetwork.networkId);
            if (!resolvedSymbol || !supported.includes(resolvedSymbol)) {
                return NextResponse.json(
                    {
                        error: `Unsupported token "${token}" for price trigger on ${sessionNetwork.label}. Supported: ${supported.join(", ")}`,
                    },
                    { status: 400 },
                );
            }
            if (typeof body.trigger.priceUsd !== "number" || body.trigger.priceUsd <= 0) {
                return NextResponse.json(
                    { error: "Price trigger requires a positive priceUsd number" },
                    { status: 400 },
                );
            }

            normalizedTrigger = {
                ...body.trigger,
                token: resolvedSymbol,
            };
        }

        // Validate scheduled trigger cron
        if (normalizedTrigger.type === "scheduled") {
            const cron = String(normalizedTrigger.cron ?? "");
            if (!cron || cron.trim().split(/\s+/).length !== 5) {
                return NextResponse.json(
                    { error: "Scheduled trigger requires a valid 5-field cron expression (e.g. '0 9 * * *')" },
                    { status: 400 },
                );
            }
        }

        // Validate action type
        const validActionTypes = ["swap", "send", "notify"];
        if (!validActionTypes.includes(body.action.type)) {
            return NextResponse.json(
                { error: `Invalid action type. Must be one of: ${validActionTypes.join(", ")}` },
                { status: 400 },
            );
        }

        if (typeof body.targetShortcutId !== "string" || body.targetShortcutId.trim().length === 0) {
            return NextResponse.json(
                { error: "Select a saved shortcut to link this automation." },
                { status: 400 },
            );
        }
        const targetShortcutId = body.targetShortcutId.trim();

        const shortcut = await getSavedShortcutFromConvex(session.address, targetShortcutId as Id<"saved_shortcuts">);
        if (!shortcut) {
            return NextResponse.json(
                { error: "Selected shortcut was not found for this wallet." },
                { status: 400 },
            );
        }

        const automationInputValues: Record<string, unknown> = {
            walletAddress: session.address,
            ...(await hydrateWalletExecutionContext(session.address, sessionNetwork.networkId)),
            automationId: "automation-preview",
            triggerType: normalizedTrigger.type,
            ...(
                normalizedTrigger.type === "price_below" || normalizedTrigger.type === "price_above"
                    ? { priceAtCheck: normalizedTrigger.priceUsd }
                    : {}
            ),
        };

        try {
            validateShortcutForAutomation(
                {
                    steps: shortcut.steps as Parameters<typeof validateShortcutForAutomation>[0]["steps"],
                    inputs: Array.isArray(shortcut.inputs)
                        ? shortcut.inputs as Parameters<typeof validateShortcutForAutomation>[0]["inputs"]
                        : [],
                },
                automationInputValues,
                sessionNetwork.networkId,
            );
        } catch (error) {
            if (error instanceof ShortcutValidationError) {
                return NextResponse.json(
                    {
                        error: error.issues[0] ?? "Selected shortcut is not automation-compatible.",
                        issues: error.issues,
                    },
                    { status: 400 },
                );
            }
            throw error;
        }

        // Force accountAddress to authenticated address — prevents spoofing
        const automation: Automation = {
            id: "",
            name,
            description,
            accountAddress: session.address, // always the authenticated wallet
            networkId: sessionNetwork.networkId,
            trigger: normalizedTrigger,
            action: body.action,
            targetShortcutId,
            status: "active",
            maxExecutions,
            executionCount: 0,
            createdAt: new Date().toISOString(),
        };

        const nextRunAt =
            automation.trigger.type === "scheduled"
                ? computeNextScheduledRunAt(automation.trigger.cron, new Date())
                : undefined;

        if (automation.trigger.type === "scheduled" && !nextRunAt) {
            return NextResponse.json(
                {
                    error: "Could not compute the next scheduled execution time for this cron expression.",
                },
                { status: 400 },
            );
        }

        const automationId = await createAutomationInConvex({
            ownerAddress: session.address,
            networkId: automation.networkId,
            name: automation.name,
            description: automation.description,
            trigger: automation.trigger,
            action: automation.action,
            targetShortcutId: targetShortcutId as Id<"saved_shortcuts">,
            status: automation.status as ConvexAutomationStatus,
            maxExecutions: automation.maxExecutions,
            ...(nextRunAt ? { nextRunAt } : {}),
        });

        return NextResponse.json({
            automation: {
                ...automation,
                id: String(automationId),
                targetShortcutId,
                ...(nextRunAt ? { nextRunAt } : {}),
            },
        }, { status: 201 });
    } catch (error) {
        return NextResponse.json(
            { error: sanitizeErrorMessage(error, "Failed to create automation.") },
            { status: 500 },
        );
    }
}
