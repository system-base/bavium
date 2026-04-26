/* ==========================================================================
   Skills — Bridge
   Public Across bridge read helpers for route discovery, quotes, and status.
   ========================================================================== */

import type { ISkill, SkillActionMeta, SkillResult } from "../types";
import type { VariableContext } from "@/engine/types";
import { skillRegistry } from "../registry";
import {
    getAcrossSameAssetQuote,
    listAcrossRoutes,
    trackAcrossDeposit,
} from "@/lib/across";
import { getActiveNetwork, type NetworkId } from "@/lib/chain-config";

function resolveNetworkId(context: VariableContext): NetworkId {
    return context.networkId ?? getActiveNetwork().networkId;
}

function parseOptionalChainId(value: unknown): number | undefined {
    const input = String(value ?? "").trim();
    if (!input) return undefined;
    const chainId = Number.parseInt(input, 10);
    if (!Number.isInteger(chainId) || chainId <= 0) {
        throw new Error("Destination chain ID must be a positive integer.");
    }
    return chainId;
}

function parseRequiredChainId(value: unknown): number {
    const chainId = parseOptionalChainId(value);
    if (chainId === undefined) {
        throw new Error("Choose a destination chain for the bridge step.");
    }
    return chainId;
}

function parseTokenSymbol(value: unknown): string {
    const symbol = String(value ?? "").trim().toUpperCase();
    if (!symbol) {
        throw new Error("Choose a token symbol for the Across quote.");
    }
    return symbol;
}

function parseAmount(value: unknown): string {
    const amount = String(value ?? "").trim();
    if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) {
        throw new Error("Amount must be a positive number.");
    }
    return amount;
}

function parseDepositTxnRef(value: unknown): string {
    const ref = String(value ?? "").trim();
    if (!ref) {
        throw new Error("Deposit transaction ref is required.");
    }
    return ref;
}

async function executeListRoutes(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    try {
        const networkId = resolveNetworkId(context);
        const destinationChainId = parseOptionalChainId(params.destinationChainId);
        const routes = await listAcrossRoutes(networkId, destinationChainId);
        const originChainId = networkId === "base-mainnet" ? 8453 : 84532;

        return {
            success: true,
            data: {
                provider: "across",
                networkId,
                originChainId,
                ...(destinationChainId !== undefined ? { destinationChainId } : {}),
                returnedCount: routes.length,
                routes,
            },
            message: destinationChainId !== undefined
                ? `Found ${routes.length} Across route${routes.length === 1 ? "" : "s"} from ${originChainId} to ${destinationChainId}.`
                : `Found ${routes.length} Across route${routes.length === 1 ? "" : "s"} from the active Base network.`,
        };
    } catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

async function executeGetQuote(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    try {
        const networkId = resolveNetworkId(context);
        const destinationChainId = parseRequiredChainId(params.destinationChainId);
        const tokenSymbol = parseTokenSymbol(params.tokenSymbol);
        const requestedAmount = parseAmount(params.amount);
        const quote = await getAcrossSameAssetQuote({
            networkId,
            destinationChainId,
            tokenSymbol,
            amount: requestedAmount,
        });

        if (quote.isAmountTooLow) {
            return {
                success: false,
                error: `Amount is too low for the selected Across route. Increase the ${tokenSymbol} amount and try again.`,
            };
        }

        return {
            success: true,
            data: {
                provider: "across",
                networkId,
                requestedAmount,
                ...quote,
            },
            message: `Across quote ready for ${requestedAmount} ${tokenSymbol} to chain ${destinationChainId}.`,
        };
    } catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

async function executeTrackTransfer(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    try {
        const networkId = resolveNetworkId(context);
        const depositTxnRef = parseDepositTxnRef(params.depositTxnRef);
        const status = await trackAcrossDeposit({
            networkId,
            depositTxnRef,
        });

        return {
            success: true,
            data: {
                provider: "across",
                networkId,
                ...status,
            },
            message: `Across transfer status: ${status.status}.`,
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
        name: "list_routes",
        label: "Across Routes",
        description: "List Across bridge routes from the active Base network.",
        params: [
            { name: "destinationChainId", type: "number", required: false, description: "Optional destination chain ID filter" },
        ],
    },
    {
        name: "get_quote",
        label: "Across Bridge Quote",
        description: "Get a read-only Across quote for a same-symbol bridge route.",
        params: [
            { name: "destinationChainId", type: "number", required: true, description: "Destination chain ID" },
            { name: "tokenSymbol", type: "string", required: true, description: "Token symbol such as USDC or WETH" },
            { name: "amount", type: "amount", required: true, description: "Human-readable token amount" },
        ],
    },
    {
        name: "track_transfer",
        label: "Track Bridge Transfer",
        description: "Check the status of an Across bridge transfer by deposit transaction ref.",
        params: [
            { name: "depositTxnRef", type: "string", required: true, description: "Across deposit transaction hash or reference" },
        ],
    },
];

const bridgeSkill: ISkill = {
    name: "bridge",
    label: "Bridge",
    category: "bridge",
    description: "Across bridge reads for Base: routes, quotes, and transfer status.",
    actions: ACTIONS,

    async execute(
        action: string,
        params: Record<string, unknown>,
        context: VariableContext,
    ): Promise<SkillResult> {
        switch (action) {
            case "list_routes":
                return executeListRoutes(params, context);
            case "get_quote":
                return executeGetQuote(params, context);
            case "track_transfer":
                return executeTrackTransfer(params, context);
            default:
                return { success: false, error: `Unknown bridge action "${action}"` };
        }
    },
};

skillRegistry.register(bridgeSkill);

export { bridgeSkill };
