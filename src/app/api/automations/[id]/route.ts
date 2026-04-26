/* ==========================================================================
   API Route: /api/automations/[id]
   Single automation operations: GET, PATCH, DELETE — auth-protected.
   ========================================================================== */

import { NextRequest, NextResponse } from "next/server";
import {
    deleteAutomationInConvex,
    getAutomationFromConvex,
    hasConvexBackend,
    listRunsBySourceFromConvex,
    updateAutomationInConvex,
} from "@/lib/convex-server";
import type { Id, AutomationStatus as ConvexAutomationStatus } from "@/lib/convex-server";
import { requireAuth } from "@/lib/api-middleware";
import { computeNextScheduledRunAt } from "@/lib/automation-schedule";
import type { AutomationStatus } from "@/types/automation";
import { sanitizeErrorMessage } from "@/lib/error-sanitizer";

// Allowed fields for PATCH (whitelist to prevent overwriting sensitive fields)
const ALLOWED_PATCH_FIELDS: (keyof { status: AutomationStatus; name: string; maxExecutions: number; description: string })[] =
    ["status", "name", "maxExecutions", "description"];
const MAX_AUTOMATION_NAME_LENGTH = 80;
const MAX_AUTOMATION_DESCRIPTION_LENGTH = 280;
const MAX_AUTOMATION_EXECUTIONS = 1000;

function normalizeMaxExecutions(value: unknown): number | null {
    const next = Number(value ?? 0);
    if (!Number.isFinite(next) || !Number.isInteger(next)) return null;
    if (next < 0 || next > MAX_AUTOMATION_EXECUTIONS) return null;
    return next;
}

// ---------------------------------------------------------------------------
// GET /api/automations/[id] — Get automation details + recent logs
// ---------------------------------------------------------------------------

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const { session } = auth;
    const { id } = await params;

    if (!hasConvexBackend()) {
        return NextResponse.json(
            { error: "Convex backend is not configured." },
            { status: 503 },
        );
    }

    try {
        const automation = await getAutomationFromConvex(session.address, id as Id<"automations">);
        if (!automation) {
            return NextResponse.json({ error: "Automation not found" }, { status: 404 });
        }

        const runs = await listRunsBySourceFromConvex(session.address, "automation", id);
        const logs = runs.map((run: {
            _id: string;
            status: string;
            error?: string;
            completedAt?: string;
            startedAt: string;
        }) => ({
            id: String(run._id),
            automationId: id,
            triggered: true,
            success: run.status === "succeeded",
            status: run.status,
            error: run.error,
            executedAt: run.completedAt ?? run.startedAt,
        }));

        return NextResponse.json({
            automation: {
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
            },
            logs,
        });
    } catch (error) {
        return NextResponse.json(
            { error: sanitizeErrorMessage(error, "Failed to get automation.") },
            { status: 500 },
        );
    }
}

// ---------------------------------------------------------------------------
// PATCH /api/automations/[id] — Update automation (pause/resume/edit)
// ---------------------------------------------------------------------------

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const { session } = auth;
    const { id } = await params;

    if (!hasConvexBackend()) {
        return NextResponse.json(
            { error: "Convex backend is not configured." },
            { status: 503 },
        );
    }

    try {
        const automation = await getAutomationFromConvex(session.address, id as Id<"automations">);
        if (!automation) {
            return NextResponse.json({ error: "Automation not found" }, { status: 404 });
        }

        const body = await request.json();

        // Whitelist allowed fields
        const safeUpdates: Record<string, unknown> = {};
        for (const field of ALLOWED_PATCH_FIELDS) {
            if (field in body) {
                safeUpdates[field] = body[field];
            }
        }

        // Validate status if present
        if (safeUpdates.status) {
            const validStatuses = ["active", "paused", "completed", "error"];
            if (!validStatuses.includes(String(safeUpdates.status))) {
                return NextResponse.json(
                    { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
                    { status: 400 },
                );
            }
        }

        if (safeUpdates.name !== undefined) {
            const name = String(safeUpdates.name).trim();
            if (!name || name.length > MAX_AUTOMATION_NAME_LENGTH) {
                return NextResponse.json(
                    { error: `Automation name must be 1-${MAX_AUTOMATION_NAME_LENGTH} characters.` },
                    { status: 400 },
                );
            }
            safeUpdates.name = name;
        }

        if (safeUpdates.description !== undefined) {
            const description = String(safeUpdates.description).trim();
            if (description.length > MAX_AUTOMATION_DESCRIPTION_LENGTH) {
                return NextResponse.json(
                    { error: `Automation description must be ${MAX_AUTOMATION_DESCRIPTION_LENGTH} characters or fewer.` },
                    { status: 400 },
                );
            }
            safeUpdates.description = description;
        }

        if (safeUpdates.maxExecutions !== undefined) {
            const maxExecutions = normalizeMaxExecutions(safeUpdates.maxExecutions);
            if (maxExecutions == null) {
                return NextResponse.json(
                    { error: `Maximum run count must be a whole number from 0 to ${MAX_AUTOMATION_EXECUTIONS}.` },
                    { status: 400 },
                );
            }
            safeUpdates.maxExecutions = maxExecutions;
        }

        const updated = await updateAutomationInConvex(session.address, id as Id<"automations">, {
            ...(safeUpdates.status !== undefined ? { status: String(safeUpdates.status) as ConvexAutomationStatus } : {}),
            ...(safeUpdates.name !== undefined ? { name: String(safeUpdates.name) } : {}),
            ...(safeUpdates.maxExecutions !== undefined
                ? { maxExecutions: safeUpdates.maxExecutions as number }
                : {}),
            ...(safeUpdates.description !== undefined
                ? { description: String(safeUpdates.description) }
                : {}),
            ...(
                safeUpdates.status === "active" && automation.trigger.type === "scheduled"
                    ? {
                        nextRunAt: computeNextScheduledRunAt(automation.trigger.cron, new Date()) ?? undefined,
                    }
                    : {}
            ),
        });

        return NextResponse.json({
            automation: updated
                ? {
                    id: String(updated._id),
                    name: updated.name,
                    description: updated.description ?? "",
                    accountAddress: updated.accountAddress,
                    networkId: updated.networkId,
                    trigger: updated.trigger,
                    action: updated.action,
                    targetShortcutId: updated.targetShortcutId,
                    status: updated.status,
                    maxExecutions: updated.maxExecutions,
                    executionCount: updated.executionCount,
                    createdAt: updated.createdAt,
                    lastTriggeredAt: updated.lastTriggeredAt,
                    lastExecutedAt: updated.lastExecutedAt,
                    nextRunAt: updated.nextRunAt,
                    lastError: updated.lastError,
                    lastRunId: updated.lastRunId,
                }
                : null,
        });
    } catch (error) {
        return NextResponse.json(
            { error: sanitizeErrorMessage(error, "Failed to update automation.") },
            { status: 500 },
        );
    }
}

// ---------------------------------------------------------------------------
// DELETE /api/automations/[id] — Delete automation
// ---------------------------------------------------------------------------

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const { session } = auth;
    const { id } = await params;

    if (!hasConvexBackend()) {
        return NextResponse.json(
            { error: "Convex backend is not configured." },
            { status: 503 },
        );
    }

    try {
        const automation = await getAutomationFromConvex(session.address, id as Id<"automations">);
        if (!automation) {
            return NextResponse.json({ error: "Automation not found" }, { status: 404 });
        }

        await deleteAutomationInConvex(session.address, id as Id<"automations">);

        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json(
            { error: sanitizeErrorMessage(error, "Failed to delete automation.") },
            { status: 500 },
        );
    }
}
