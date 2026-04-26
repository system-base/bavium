/* ==========================================================================
   API Route: GET /api/prices
   Returns current prices for supported tokens.
   ========================================================================== */

import { NextResponse } from "next/server";
import { getPrices } from "@/engine/price-feed";

// ---------------------------------------------------------------------------
// Simple IP-based rate limiter (in-memory, per-instance)
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 30; // max requests per window

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
    const now = Date.now();
    const entry = rateLimitMap.get(ip);

    if (!entry || now > entry.resetAt) {
        rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return false;
    }

    entry.count++;
    return entry.count > RATE_LIMIT_MAX;
}

export async function GET(request: Request) {
    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";

    if (isRateLimited(ip)) {
        return NextResponse.json(
            { error: "Too many requests. Please try again later." },
            { status: 429 },
        );
    }

    const { searchParams } = new URL(request.url);
    const tokens = searchParams.get("tokens");

    try {
        if (tokens) {
            // Multiple tokens: ?tokens=ETH,BTC,USDC
            const symbols = tokens.split(",").map((s) => s.trim());
            const prices = await getPrices(symbols);
            return NextResponse.json({ prices });
        }

        // Default: fetch common tokens
        const prices = await getPrices(["ETH", "BTC", "USDC"]);
        return NextResponse.json({ prices });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to fetch prices" },
            { status: 500 },
        );
    }
}
