import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-middleware";
import {
    hasConvexBackend,
    listAutomationsForSavedShortcutFromConvex,
} from "@/lib/convex-server";
import type { Id } from "@/lib/convex-server";
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
        const automations = await listAutomationsForSavedShortcutFromConvex(
            auth.session.address,
            id as Id<"saved_shortcuts">,
        );

        return NextResponse.json({
            automations: automations.map((automation) => ({
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
            })),
        });
    } catch (error) {
        return NextResponse.json(
            { error: sanitizeErrorMessage(error, "Failed to load linked automations.") },
            { status: 500 },
        );
    }
}
