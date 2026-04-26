import { NextRequest, NextResponse } from "next/server";
import {
    fetchX402DiscoveryDirect,
    type X402DiscoveryFilters,
} from "@/lib/x402-bazaar";

export const dynamic = "force-dynamic";

function parseSearchParams(
    request: NextRequest,
): X402DiscoveryFilters {
    const searchParams = request.nextUrl.searchParams;
    return {
        facilitator:
            searchParams.get("facilitator") === "payai"
                ? "payai"
                : "coinbase",
        type:
            searchParams.get("type") === "http" || searchParams.get("type") === "mcp"
                ? (searchParams.get("type") as "http" | "mcp")
                : "all",
        network:
            searchParams.get("network") === "all"
            || searchParams.get("network") === "base-sepolia"
            || searchParams.get("network") === "base-mainnet"
                ? (searchParams.get("network") as "all" | "base-mainnet" | "base-sepolia")
                : "base-mainnet",
        keyword: searchParams.get("keyword") ?? undefined,
        asset: searchParams.get("asset") ?? undefined,
        scheme: searchParams.get("scheme") ?? undefined,
        maxUsdPrice: searchParams.get("maxUsdPrice") ?? undefined,
        payTo: searchParams.get("payTo") ?? undefined,
        maxResults: searchParams.get("maxResults")
            ? Number(searchParams.get("maxResults"))
            : undefined,
    };
}

export async function GET(request: NextRequest) {
    try {
        const result = await fetchX402DiscoveryDirect(parseSearchParams(request));

        return NextResponse.json(result, {
            headers: {
                "Cache-Control": "no-store",
            },
        });
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "x402 discovery failed.",
            },
            {
                status: 502,
                headers: {
                    "Cache-Control": "no-store",
                },
            },
        );
    }
}
