/* ==========================================================================
   API Route: GET /api/cron/check
   Secure scheduler endpoint for automation evaluation.
   The recurring schedule is owned by Convex cron jobs, which call this
   route with the shared cron secret.
   Evaluates all active automations and executes triggered actions.
   ========================================================================== */

import { NextResponse } from "next/server";
import { runAutomationCheck } from "@/engine/automation-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
    // Verify scheduler secret (prevents unauthorized triggers)
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const result = await runAutomationCheck();

        return NextResponse.json({
            success: true,
            scheduler: request.headers.get("x-bavium-scheduler") ?? "unknown",
            checked: result.totalChecked,
            triggered: result.totalTriggered,
            executed: result.totalExecuted,
            errors: result.totalErrors,
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        console.error("[CRON] Automation check failed:", err);
        return NextResponse.json(
            {
                success: false,
                error: err instanceof Error ? err.message : "Cron check failed",
            },
            { status: 500 },
        );
    }
}
