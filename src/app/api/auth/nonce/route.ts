/* ==========================================================================
   API: Auth Nonce — GET /api/auth/nonce
   Returns a fresh SIWE nonce for the client to sign.
   ========================================================================== */

import { NextResponse } from "next/server";
import { createNoncePersistent, buildSIWEMessage } from "@/lib/auth";
import { getActiveNetwork, getNetworkByChainId } from "@/lib/chain-config";
import { applyNoStoreHeaders } from "@/lib/api-middleware";
import { consumeServerRateLimit } from "@/lib/server-rate-limit";

const RATE_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_IP = 20;
const MAX_REQUESTS_PER_ADDRESS = 6;

function getClientIp(request: Request): string {
    const xff = request.headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0]!.trim();
    return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function isValidAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const address = searchParams.get("address");

        if (!address || !isValidAddress(address)) {
            return applyNoStoreHeaders(NextResponse.json(
                { error: "Missing or invalid address parameter" },
                { status: 400 },
            ));
        }
        const normalizedAddress = address.toLowerCase();
        const clientIp = getClientIp(request);

        const ipRateLimit = await consumeServerRateLimit({
            bucket: "auth-nonce-ip",
            key: clientIp,
            windowMs: RATE_WINDOW_MS,
            max: MAX_REQUESTS_PER_IP,
        });
        if (!ipRateLimit.allowed) {
            return applyNoStoreHeaders(NextResponse.json(
                {
                    error: `Too many nonce requests from this IP. Try again in ${ipRateLimit.retryAfterSeconds}s.`,
                },
                { status: 429 },
            ));
        }
        const addressRateLimit = await consumeServerRateLimit({
            bucket: "auth-nonce-address",
            key: normalizedAddress,
            windowMs: RATE_WINDOW_MS,
            max: MAX_REQUESTS_PER_ADDRESS,
        });
        if (!addressRateLimit.allowed) {
            return applyNoStoreHeaders(NextResponse.json(
                {
                    error: `Too many nonce requests for this wallet address. Try again in ${addressRateLimit.retryAfterSeconds}s.`,
                },
                { status: 429 },
            ));
        }

        // Generate nonce keyed by address
        const nonce = await createNoncePersistent(normalizedAddress);

        // Resolve chain: prefer wallet-provided chainId if it's a supported chain
        const requestedChainId = searchParams.get("chainId");
        let resolvedChainId: number;
        if (requestedChainId) {
            const parsed = Number(requestedChainId);
            const matchedNetwork = getNetworkByChainId(parsed);
            if (matchedNetwork) {
                resolvedChainId = matchedNetwork.chain.id;
            } else {
                return applyNoStoreHeaders(NextResponse.json(
                    { error: `Unsupported chain ID: ${requestedChainId}. Please switch to Base or Base Sepolia.` },
                    { status: 400 },
                ));
            }
        } else {
            resolvedChainId = getActiveNetwork().chain.id;
        }

        // Build the SIWE message for the client to sign
        const uri = new URL(request.url).origin;
        const message = buildSIWEMessage({
            address: normalizedAddress,
            nonce,
            uri,
            chainId: resolvedChainId,
            statement: "Sign in to Bavium",
        });

        return applyNoStoreHeaders(NextResponse.json({
            nonce,
            message,
            chainId: resolvedChainId,
        }));
    } catch (err) {
        console.error("[auth/nonce] Error:", err);
        return applyNoStoreHeaders(NextResponse.json(
            { error: "Failed to generate nonce" },
            { status: 500 },
        ));
    }
}
