/* ==========================================================================
   API: Auth Verify — POST /api/auth/verify
   Verifies a signed SIWE message and creates a session.
   ========================================================================== */

import { NextResponse } from "next/server";
import {
    consumeNoncePersistent,
    verifySIWESignature,
    createSessionData,
    encodeSession,
    LEGACY_SESSION_COOKIE_NAME,
    SESSION_COOKIE_NAME,
    parseSIWEMessage,
    consumeDetachedNoncePersistent,
} from "@/lib/auth";
import { applyNoStoreHeaders, requireSameOrigin } from "@/lib/api-middleware";
import { getNetworkByChainId } from "@/lib/chain-config";

interface VerifyBody {
    message: string;
    signature: string;
    address: string;
    nonce: string;
    chainId?: number;
}

function isVerifyBody(value: unknown): value is VerifyBody {
    if (typeof value !== "object" || value === null) return false;
    return (
        "message" in value && typeof value.message === "string" &&
        "signature" in value && typeof value.signature === "string" &&
        "address" in value && typeof value.address === "string" &&
        "nonce" in value && typeof value.nonce === "string"
    );
}

function isHexString(value: string): value is `0x${string}` {
    return value.startsWith("0x");
}

function isValidAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function isValidNonce(nonce: string): boolean {
    return /^[a-f0-9]{64}$/i.test(nonce);
}

export async function POST(request: Request) {
    try {
        const sameOriginFailure = requireSameOrigin(request);
        if (sameOriginFailure) {
            return sameOriginFailure;
        }

        const body: unknown = await request.json();

        if (!isVerifyBody(body)) {
            return applyNoStoreHeaders(NextResponse.json(
                { error: "Missing required fields: message, signature, address, nonce" },
                { status: 400 },
            ));
        }

        const { message, signature, address, nonce } = body;
        const normalizedAddress = address.toLowerCase();

        if (!isValidAddress(address) || !isValidNonce(nonce)) {
            return applyNoStoreHeaders(NextResponse.json(
                { error: "Invalid address or nonce format" },
                { status: 400 },
            ));
        }

        if (!isHexString(signature)) {
            return applyNoStoreHeaders(NextResponse.json(
                { error: "Invalid signature format" },
                { status: 400 },
            ));
        }

        const expectedUri = new URL(request.url).origin;
        const expectedDomain = new URL(request.url).host;
        const parsedMessage = parseSIWEMessage(message);

        if (!parsedMessage) {
            return applyNoStoreHeaders(NextResponse.json(
                { error: "Malformed SIWE message" },
                { status: 400 },
            ));
        }

        const messageNetwork = getNetworkByChainId(parsedMessage.chainId);
        if (!messageNetwork) {
            return applyNoStoreHeaders(NextResponse.json(
                { error: `Unsupported chain ID in SIWE message: ${parsedMessage.chainId}` },
                { status: 400 },
            ));
        }

        if (body.chainId != null) {
            const requestNetwork = getNetworkByChainId(body.chainId);
            if (!requestNetwork) {
                return applyNoStoreHeaders(NextResponse.json(
                    { error: `Unsupported chain ID: ${body.chainId}. Please switch to Base or Base Sepolia.` },
                    { status: 400 },
                ));
            }

            if (body.chainId !== parsedMessage.chainId) {
                return applyNoStoreHeaders(NextResponse.json(
                    { error: "Signed message chain does not match the connected wallet chain." },
                    { status: 400 },
                ));
            }
        }

        // 1. Verify SIWE message fields + signature
        const result = await verifySIWESignature(
            message,
            signature,
            normalizedAddress,
            {
                expectedNonce: nonce,
                expectedDomain,
                expectedUri,
                expectedChainId: parsedMessage.chainId,
            },
        );

        if (!result.valid) {
            return applyNoStoreHeaders(NextResponse.json(
                { error: result.error ?? "Signature verification failed" },
                { status: 401 },
            ));
        }

        // 2. Consume nonce only after successful signature validation.
        // Existing Header/Base fast-path nonces are address-scoped. RainbowKit's
        // custom adapter asks for a nonce before passing address to
        // createMessage(), so it uses a detached nonce keyed by nonce value.
        const nonceConsumed =
            await consumeNoncePersistent(normalizedAddress, nonce) ||
            await consumeDetachedNoncePersistent(nonce);

        if (!nonceConsumed) {
            return applyNoStoreHeaders(NextResponse.json(
                { error: "Invalid or expired nonce" },
                { status: 401 },
            ));
        }

        // 3. Create session — use the chain from the SIWE message or the body's explicit chainId
        const session = createSessionData(normalizedAddress, parsedMessage.chainId);
        const sessionToken = encodeSession(session);

        // 4. Set HTTP-only session cookie
        const response = NextResponse.json({
            success: true,
            address: session.address,
            chainId: session.chainId,
            expiresAt: session.expiresAt,
        });

        response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 24 * 60 * 60, // 24 hours in seconds
            path: "/",
        });
        response.cookies.delete(LEGACY_SESSION_COOKIE_NAME);

        return applyNoStoreHeaders(response);
    } catch (err) {
        console.error("[auth/verify] Error:", err);
        return applyNoStoreHeaders(NextResponse.json(
            { error: "Authentication failed" },
            { status: 500 },
        ));
    }
}
