/* ==========================================================================
   API: RainbowKit Auth Nonce — GET /api/auth/rainbowkit/nonce
   Returns an address-independent nonce for RainbowKit's auth adapter.
   ========================================================================== */

import { NextResponse } from "next/server";
import { applyNoStoreHeaders } from "@/lib/api-middleware";
import { createDetachedNoncePersistent } from "@/lib/auth";
import { consumeServerRateLimit } from "@/lib/server-rate-limit";

const RATE_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_IP = 20;

function getClientIp(request: Request): string {
    const xff = request.headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0]!.trim();
    return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function GET(request: Request) {
    try {
        const rateLimit = await consumeServerRateLimit({
            bucket: "auth-rainbowkit-nonce-ip",
            key: getClientIp(request),
            windowMs: RATE_WINDOW_MS,
            max: MAX_REQUESTS_PER_IP,
        });

        if (!rateLimit.allowed) {
            return applyNoStoreHeaders(NextResponse.json(
                {
                    error: `Too many nonce requests from this IP. Try again in ${rateLimit.retryAfterSeconds}s.`,
                },
                { status: 429 },
            ));
        }

        const nonce = await createDetachedNoncePersistent();
        return applyNoStoreHeaders(NextResponse.json({ nonce }));
    } catch (error) {
        console.error("[auth/rainbowkit/nonce] Error:", error);
        return applyNoStoreHeaders(NextResponse.json(
            { error: "Failed to generate nonce" },
            { status: 500 },
        ));
    }
}

