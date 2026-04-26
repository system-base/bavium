/* ==========================================================================
   Scheduler — Convex scheduled automation trigger

   ARCHITECTURAL NOTE:
   Automation evaluation still executes on the Next.js server
   (`/api/cron/check` -> `engine/automation-runner.ts`).

   We intentionally keep execution on the app server because the runner
   already depends on wallet-aware execution helpers and the shortcut
   runtime. However, the recurring trigger no longer needs to depend on
   Vercel Cron. Convex cron jobs are used to durably invoke this secure
   HTTP endpoint.

   Local development note:
   Convex cloud actions cannot reach `http://localhost:*`. If the configured
   app URL points at localhost, this trigger returns a skipped status instead
   of failing every 5 minutes.
   ========================================================================== */

import { internalAction } from "./_generated/server";
import { v } from "convex/values";

const schedulerTriggerResultValidator = v.union(
    v.object({
        status: v.literal("skipped_localhost_url"),
        baseUrl: v.string(),
    }),
    v.object({
        status: v.literal("forwarded"),
        endpoint: v.string(),
        responseStatus: v.number(),
        body: v.union(
            v.string(),
            v.object({
                success: v.boolean(),
                scheduler: v.string(),
                checked: v.number(),
                triggered: v.number(),
                executed: v.number(),
                errors: v.number(),
                timestamp: v.string(),
            }),
        ),
    }),
);

interface SchedulerForwardedBody {
    success: boolean;
    scheduler: string;
    checked: number;
    triggered: number;
    executed: number;
    errors: number;
    timestamp: string;
}

function normalizeBaseUrl(value: string): string {
    return value.trim().replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSchedulerForwardedBody(value: unknown): value is SchedulerForwardedBody {
    return (
        isRecord(value) &&
        typeof value.success === "boolean" &&
        typeof value.scheduler === "string" &&
        typeof value.checked === "number" &&
        typeof value.triggered === "number" &&
        typeof value.executed === "number" &&
        typeof value.errors === "number" &&
        typeof value.timestamp === "string"
    );
}

function isLocalhostUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.hostname === "localhost" || url.hostname === "127.0.0.1";
    } catch {
        return false;
    }
}

function getAutomationCheckBaseUrl(): string | null {
    const value =
        process.env.APP_URL?.trim() ||
        process.env.NEXT_PUBLIC_APP_URL?.trim() ||
        "";

    return value ? normalizeBaseUrl(value) : null;
}

export const triggerAutomationCheck = internalAction({
    args: {},
    returns: schedulerTriggerResultValidator,
    handler: async () => {
        const baseUrl = getAutomationCheckBaseUrl();
        if (!baseUrl) {
            throw new Error(
                "APP_URL or NEXT_PUBLIC_APP_URL must be configured for Convex scheduler automation checks.",
            );
        }

        if (isLocalhostUrl(baseUrl)) {
            return {
                status: "skipped_localhost_url" as const,
                baseUrl,
            };
        }

        const cronSecret = process.env.CRON_SECRET?.trim();
        if (!cronSecret) {
            throw new Error("CRON_SECRET must be configured for Convex scheduler automation checks.");
        }

        const endpoint = `${baseUrl}/api/cron/check`;
        const response = await fetch(endpoint, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${cronSecret}`,
                "X-Bavium-Scheduler": "convex-cron",
            },
        });

        const bodyText = await response.text();
        if (!response.ok) {
            throw new Error(
                `Automation check proxy failed (${response.status} ${response.statusText}): ${bodyText}`,
            );
        }

        let parsedBody: string | SchedulerForwardedBody = bodyText;
        try {
            const candidate: unknown = JSON.parse(bodyText);
            parsedBody = isSchedulerForwardedBody(candidate) ? candidate : bodyText;
        } catch {
            // Keep raw text when the response is not JSON.
        }

        return {
            status: "forwarded" as const,
            endpoint,
            responseStatus: response.status,
            body: parsedBody,
        };
    },
});
