/* ==========================================================================
   API Middleware — Auth Helpers
   ─────────────────────────────
   Use requireAuth() in any API route that needs authentication.
   Reads the session cookie and validates it.
   ========================================================================== */

import { NextRequest, NextResponse } from "next/server";
import {
    decodeSession,
    isSessionValid,
    LEGACY_SESSION_COOKIE_NAME,
    SESSION_COOKIE_NAME,
    type SessionData,
} from "@/lib/auth";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function extractOriginCandidate(request: Request): string | null {
    const origin = request.headers.get("origin");
    if (origin) {
        return origin;
    }

    const referer = request.headers.get("referer");
    if (!referer) {
        return null;
    }

    try {
        return new URL(referer).origin;
    } catch {
        return null;
    }
}

export function requireSameOrigin(
    request: Request,
): NextResponse | null {
    const expectedOrigin = new URL(request.url).origin;
    const receivedOrigin = extractOriginCandidate(request);

    if (!receivedOrigin || receivedOrigin !== expectedOrigin) {
        return NextResponse.json(
            { error: "Cross-site request blocked." },
            { status: 403 },
        );
    }

    return null;
}

export function applyNoStoreHeaders(response: NextResponse): NextResponse {
    response.headers.set("Cache-Control", "no-store, max-age=0");
    response.headers.set("Pragma", "no-cache");
    return response;
}

/**
 * Extract and validate the session from the request cookies.
 * Returns the session data if valid, or null if not authenticated.
 */
export function getSessionFromRequest(request: NextRequest): SessionData | null {
    const cookie =
        request.cookies.get(SESSION_COOKIE_NAME) ??
        request.cookies.get(LEGACY_SESSION_COOKIE_NAME);
    if (!cookie?.value) return null;

    const session = decodeSession(cookie.value);
    if (!session) return null;
    if (!isSessionValid(session)) return null;

    return session;
}

/**
 * Guard an API route handler — returns 401 if not authenticated.
 *
 * Usage:
 *   export async function GET(request: NextRequest) {
 *     const auth = requireAuth(request);
 *     if (auth instanceof NextResponse) return auth; // 401
 *     const { session } = auth;
 *     ...
 *   }
 */
export function requireAuth(
    request: NextRequest,
): { session: SessionData } | NextResponse {
    if (!SAFE_METHODS.has(request.method)) {
        const sameOriginFailure = requireSameOrigin(request);
        if (sameOriginFailure) {
            return sameOriginFailure;
        }
    }

    const session = getSessionFromRequest(request);
    if (!session) {
        return NextResponse.json(
            { error: "Unauthorized. Please connect your wallet and sign in." },
            { status: 401 },
        );
    }
    return { session };
}
