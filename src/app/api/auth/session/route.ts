/* ==========================================================================
   API: Auth Session — GET /api/auth/session
   Returns the current session if valid. DELETE to logout.
   ========================================================================== */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
    decodeSession,
    isSessionValid,
    LEGACY_SESSION_COOKIE_NAME,
    SESSION_COOKIE_NAME,
} from "@/lib/auth";
import { applyNoStoreHeaders, requireSameOrigin } from "@/lib/api-middleware";

const SESSION_COOKIE_OPTIONS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 24 * 60 * 60,
    path: "/",
};

/**
 * GET /api/auth/session — Check current session
 */
export async function GET() {
    try {
        const cookieStore = await cookies();
        const sessionCookie =
            cookieStore.get(SESSION_COOKIE_NAME) ??
            cookieStore.get(LEGACY_SESSION_COOKIE_NAME);

        if (!sessionCookie?.value) {
            const response = NextResponse.json(
                { authenticated: false },
                { status: 200 },
            );
            response.cookies.delete(LEGACY_SESSION_COOKIE_NAME);
            response.headers.set("Vary", "Cookie");
            return applyNoStoreHeaders(response);
        }

        const session = decodeSession(sessionCookie.value);

        if (!session || !isSessionValid(session)) {
            // Clear expired session
            const response = NextResponse.json(
                { authenticated: false, reason: "Session expired" },
                { status: 200 },
            );
            response.cookies.delete(SESSION_COOKIE_NAME);
            response.cookies.delete(LEGACY_SESSION_COOKIE_NAME);
            response.headers.set("Vary", "Cookie");
            return applyNoStoreHeaders(response);
        }

        const response = NextResponse.json({
            authenticated: true,
            address: session.address,
            chainId: session.chainId,
            authenticatedAt: session.authenticatedAt,
            expiresAt: session.expiresAt,
        });
        if (sessionCookie.name === LEGACY_SESSION_COOKIE_NAME) {
            response.cookies.set(SESSION_COOKIE_NAME, sessionCookie.value, SESSION_COOKIE_OPTIONS);
            response.cookies.delete(LEGACY_SESSION_COOKIE_NAME);
        }
        response.headers.set("Vary", "Cookie");
        return applyNoStoreHeaders(response);
    } catch (err) {
        console.error("[auth/session] Error:", err);
        return applyNoStoreHeaders(NextResponse.json(
            { authenticated: false, error: "Session check failed" },
            { status: 500 },
        ));
    }
}

/**
 * DELETE /api/auth/session — Logout (destroy session)
 */
export async function DELETE(request: Request) {
    const sameOriginFailure = requireSameOrigin(request);
    if (sameOriginFailure) {
        return sameOriginFailure;
    }

    const response = NextResponse.json({ success: true, message: "Logged out" });
    response.cookies.delete(SESSION_COOKIE_NAME);
    response.cookies.delete(LEGACY_SESSION_COOKIE_NAME);
    response.headers.set("Vary", "Cookie");
    return applyNoStoreHeaders(response);
}
