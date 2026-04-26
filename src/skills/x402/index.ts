import type { ISkill, SkillActionMeta, SkillResult } from "../types";
import type { VariableContext } from "@/engine/types";
import { skillRegistry } from "../registry";
import {
    discoverX402Services,
    type X402DiscoveryFilters,
    type X402DiscoveryNetwork,
    type X402DiscoveryType,
} from "@/lib/x402-bazaar";

function parseFacilitator(value: unknown): X402DiscoveryFilters["facilitator"] {
    const normalized = String(value ?? "coinbase").trim().toLowerCase();
    return normalized === "payai" ? "payai" : "coinbase";
}

function parseType(value: unknown): X402DiscoveryType {
    const normalized = String(value ?? "all").trim().toLowerCase();
    if (normalized === "http" || normalized === "mcp") {
        return normalized;
    }
    return "all";
}

function parseNetwork(value: unknown): X402DiscoveryNetwork {
    const normalized = String(value ?? "base-mainnet").trim().toLowerCase();
    if (
        normalized === "all"
        || normalized === "base-mainnet"
        || normalized === "base-sepolia"
    ) {
        return normalized;
    }
    return "base-mainnet";
}

function parseKeyword(value: unknown): string | undefined {
    const keyword = String(value ?? "").trim();
    return keyword.length > 0 ? keyword : undefined;
}

function parseOptionalText(value: unknown): string | undefined {
    const text = String(value ?? "").trim();
    return text.length > 0 ? text : undefined;
}

function parseMaxResults(value: unknown): number {
    const numeric = Number(value ?? 10);
    if (!Number.isFinite(numeric)) {
        return 10;
    }
    return Math.max(1, Math.min(20, Math.floor(numeric)));
}

async function executeDiscoverServices(
    params: Record<string, unknown>,
): Promise<SkillResult> {
    try {
        const facilitator = parseFacilitator(params.facilitator);
        const type = parseType(params.type);
        const network = parseNetwork(params.network);
        const keyword = parseKeyword(params.keyword);
        const asset = parseOptionalText(params.asset);
        const scheme = parseOptionalText(params.scheme);
        const maxUsdPrice = parseOptionalText(params.maxUsdPrice);
        const payTo = parseOptionalText(params.payTo);
        const maxResults = parseMaxResults(params.maxResults);

        const result = await discoverX402Services({
            facilitator,
            type,
            network,
            keyword,
            asset,
            scheme,
            maxUsdPrice,
            payTo,
            maxResults,
        });

        return {
            success: true,
            data: {
                kind: "x402_discovery" as const,
                facilitator,
                typeFilter: type,
                networkFilter: network,
                searchMode: result.searchMode,
                ...(keyword ? { keyword } : {}),
                ...(asset ? { asset } : {}),
                ...(scheme ? { scheme } : {}),
                ...(maxUsdPrice ? { maxUsdPrice } : {}),
                ...(payTo ? { payTo } : {}),
                returnedCount: result.services.length,
                services: result.services,
            },
            message: `Found ${result.services.length} x402 service${result.services.length === 1 ? "" : "s"} from ${facilitator}.`,
        };
    } catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

const ACTIONS: SkillActionMeta[] = [
    {
        name: "discover_services",
        label: "Discover x402 Services",
        description: "List Bazaar-discoverable x402 HTTP endpoints or MCP tools without paying for them.",
        params: [
            { name: "facilitator", type: "string", required: false, description: "Bazaar provider: coinbase or payai", default: "coinbase" },
            { name: "type", type: "string", required: false, description: "Resource type filter: all, http, or mcp", default: "all" },
            { name: "network", type: "string", required: false, description: "Network filter: base-mainnet, base-sepolia, or all", default: "base-mainnet" },
            { name: "keyword", type: "string", required: false, description: "Optional keyword filter for resource URLs, descriptions, or MCP tool names" },
            { name: "asset", type: "string", required: false, description: "Optional Coinbase Bazaar search filter, for example usdc" },
            { name: "scheme", type: "string", required: false, description: "Optional payment scheme filter such as exact or upto" },
            { name: "maxUsdPrice", type: "string", required: false, description: "Optional maximum USD price filter for Coinbase Bazaar semantic search" },
            { name: "payTo", type: "string", required: false, description: "Optional merchant payTo address filter for Coinbase Bazaar semantic search" },
            { name: "maxResults", type: "number", required: false, description: "Maximum number of returned services", default: 10 },
        ],
    },
];

const x402Skill: ISkill = {
    name: "x402",
    label: "x402",
    category: "x402",
    description: "Read-only Bazaar discovery for x402-compatible services on Base.",
    actions: ACTIONS,

    async execute(
        action: string,
        params: Record<string, unknown>,
        _context: VariableContext,
    ): Promise<SkillResult> {
        switch (action) {
            case "discover_services":
                return executeDiscoverServices(params);
            default:
                return { success: false, error: `Unknown x402 action "${action}"` };
        }
    },
};

skillRegistry.register(x402Skill);

export { x402Skill };
