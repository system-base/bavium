/* ==========================================================================
   API Route: /api/runs/[id]
   Single run detail facade over Convex.
   ========================================================================== */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-middleware";
import {
    deleteRunFromConvex,
    getAutomationFromConvex,
    getRunFromConvex,
    hasConvexBackend,
    reconcileRunInConvex,
    updateAutomationInConvex,
} from "@/lib/convex-server";
import type { Id, RunStatus, RunStepStatus } from "@/lib/convex-server";
import { sanitizeErrorMessage } from "@/lib/error-sanitizer";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    if (!hasConvexBackend()) {
        return NextResponse.json(
            { error: "Convex backend is not configured." },
            { status: 503 },
        );
    }

    try {
        const { id } = await params;
        const result = await getRunFromConvex(auth.session.address, id as Id<"runs">);
        if (!result) {
            return NextResponse.json({ error: "Run not found" }, { status: 404 });
        }

        return NextResponse.json(result);
    } catch (error) {
        return NextResponse.json(
            { error: sanitizeErrorMessage(error, "Failed to load run detail.") },
            { status: 500 },
        );
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    if (!hasConvexBackend()) {
        return NextResponse.json(
            { error: "Convex backend is not configured." },
            { status: 503 },
        );
    }

    try {
        const { id } = await params;
        const result = await deleteRunFromConvex(auth.session.address, id as Id<"runs">);
        if (!result.deleted) {
            return NextResponse.json({ error: "Run not found" }, { status: 404 });
        }

        return NextResponse.json({ deleted: true });
    } catch (error) {
        return NextResponse.json(
            { error: sanitizeErrorMessage(error, "Failed to delete run.") },
            { status: 500 },
        );
    }
}

interface RunPatchBody {
    status: string;
    error?: string;
    completedAt?: string;
    steps: Array<{
        stepId: string;
        label: string;
        status: string;
        outputSummary?: string;
        error?: string;
        startedAt: string;
        completedAt?: string;
        durationMs?: number;
        sequence: number;
    }>;
}

function isRunPatchBody(value: unknown): value is RunPatchBody {
    if (typeof value !== "object" || value === null) return false;
    if (!("status" in value) || typeof value.status !== "string") return false;
    if (!("steps" in value) || !Array.isArray(value.steps)) return false;
    return true;
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    if (!hasConvexBackend()) {
        return NextResponse.json(
            { error: "Convex backend is not configured." },
            { status: 503 },
        );
    }

    try {
        const { id } = await params;
        const body: unknown = await request.json();

        if (!isRunPatchBody(body)) {
            return NextResponse.json(
                { error: "Invalid run update payload." },
                { status: 400 },
            );
        }

        const existing = await getRunFromConvex(auth.session.address, id as Id<"runs">);
        if (!existing) {
            return NextResponse.json({ error: "Run not found" }, { status: 404 });
        }

        const run = await reconcileRunInConvex({
            ownerAddress: auth.session.address,
            runId: id as Id<"runs">,
            status: body.status as RunStatus,
            error: body.error,
            completedAt: body.completedAt,
            steps: body.steps.map(s => ({ ...s, status: s.status as RunStepStatus })),
        });

        const previousStatus = existing.run.status;
        const nextStatus = body.status;
        const shouldSyncAutomation =
            existing.run.sourceType === "automation" &&
            previousStatus === "awaiting_signature" &&
            nextStatus !== "awaiting_signature";

        if (shouldSyncAutomation) {
            const automationId = existing.run.sourceId as Id<"automations">;
            const automation = await getAutomationFromConvex(auth.session.address, automationId);

            if (automation) {
                if (nextStatus === "succeeded") {
                    const nextExecutionCount = automation.executionCount + 1;
                    await updateAutomationInConvex(auth.session.address, automationId, {
                        executionCount: nextExecutionCount,
                        lastExecutedAt: body.completedAt ?? new Date().toISOString(),
                        lastError: null,
                        lastRunId: id as Id<"runs">,
                        ...(automation.maxExecutions > 0 && nextExecutionCount >= automation.maxExecutions
                            ? { status: "completed" as const }
                            : {}),
                    });
                } else if (nextStatus === "failed" || nextStatus === "canceled") {
                    await updateAutomationInConvex(auth.session.address, automationId, {
                        lastError: body.error ?? (
                            nextStatus === "canceled"
                                ? "Automation execution was canceled."
                                : "Automation execution failed."
                        ),
                        lastRunId: id as Id<"runs">,
                    });
                }
            }
        }

        return NextResponse.json({ run });
    } catch (error) {
        return NextResponse.json(
            { error: sanitizeErrorMessage(error, "Failed to update run.") },
            { status: 500 },
        );
    }
}
