import { parseUnits } from "viem";
import type { NetworkId } from "@/lib/chain-config";
import {
    getAcrossDestinationRuntime,
    getAcrossNetworkLabel,
    getAcrossOriginChainId,
    getAcrossRuntime,
    getAcrossRuntimeLabel,
} from "@/lib/across-config";

export interface AcrossRouteSummary {
    originChainId: number;
    destinationChainId: number;
    originTokenSymbol?: string;
    destinationTokenSymbol?: string;
    originTokenAddress?: string;
    destinationTokenAddress?: string;
    isNative?: boolean;
}

export interface AcrossFeeQuote {
    originChainId: number;
    destinationChainId: number;
    inputTokenSymbol: string;
    outputTokenSymbol: string;
    inputTokenAddress: string;
    outputTokenAddress: string;
    inputAmount: string;
    outputAmount: string;
    totalRelayFeePct?: string;
    totalRelayFeeAmount?: string;
    relayerGasFeeAmount?: string;
    relayerCapitalFeeAmount?: string;
    lpFeeAmount?: string;
    expectedFillTimeSec?: number;
    fillDeadline?: number;
    exclusivityDeadline?: number;
    quoteTimestamp?: number;
    spokePoolAddress?: string;
    isAmountTooLow?: boolean;
}

export interface AcrossDepositStatus {
    status: "pending" | "filled" | "expired" | "refunded" | string;
    depositTxnRef?: string;
    fillTxnRef?: string;
    depositRefundTxnRef?: string;
    originChainId?: number;
    destinationChainId?: number;
    depositId?: number;
    actionsSucceeded?: boolean;
}

interface ParsedAcrossTokenRef {
    symbol: string;
    address: string;
    decimals: number;
}

const MAINNET_API_BASE = "https://app.across.to/api";
const TESTNET_API_BASE = "https://testnet.across.to/api";

const COMMON_TOKEN_DECIMALS: Record<string, number> = {
    ETH: 18,
    WETH: 18,
    USDC: 6,
    USDT: 6,
    DAI: 18,
    WBTC: 8,
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
        if (value === "true") return true;
        if (value === "false") return false;
    }
    return undefined;
}

function getAcrossRequestHeaders(): HeadersInit {
    const headers: Record<string, string> = { accept: "application/json" };
    const apiKey = process.env.ACROSS_API_KEY?.trim();
    if (apiKey) {
        headers.authorization = `Bearer ${apiKey}`;
    }
    return headers;
}

function getAcrossIntegratorId(): string | undefined {
    const integratorId = process.env.ACROSS_INTEGRATOR_ID?.trim();
    return integratorId && /^0x[0-9a-fA-F]{4}$/.test(integratorId)
        ? integratorId
        : undefined;
}

function getAcrossApiBase(networkId: NetworkId): string {
    return getAcrossRuntime(networkId) === "mainnet" ? MAINNET_API_BASE : TESTNET_API_BASE;
}

function buildUrl(base: string, path: string, params?: Record<string, string | undefined>) {
    const cleanBase = base.replace(/\/+$/, "");
    const cleanPath = path.replace(/^\/+/, "");
    const url = new URL(`${cleanBase}/${cleanPath}`);
    if (params) {
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== "") {
                url.searchParams.set(key, value);
            }
        }
    }
    return url;
}

function assertAcrossDestinationMatchesRuntime(
    networkId: NetworkId,
    destinationChainId?: number,
): void {
    if (destinationChainId === undefined) return;

    const destinationRuntime = getAcrossDestinationRuntime(destinationChainId);
    if (!destinationRuntime) return;

    const activeRuntime = getAcrossRuntime(networkId);
    if (destinationRuntime === activeRuntime) return;

    throw new Error(
        `Across destination chain ${destinationChainId} is a ${getAcrossRuntimeLabel(destinationRuntime)} destination, but the active network is ${getAcrossNetworkLabel(networkId)}. Switch the active Base network or choose a ${getAcrossRuntimeLabel(activeRuntime)} destination.`,
    );
}

async function fetchAcrossJson(
    networkId: NetworkId,
    path: string,
    params?: Record<string, string | undefined>,
): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
        const response = await fetch(buildUrl(getAcrossApiBase(networkId), path, params), {
            method: "GET",
            headers: getAcrossRequestHeaders(),
            signal: controller.signal,
        });

        if (!response.ok) {
            const body = await response.text().catch(() => "");
            throw new Error(
                `Across request failed (${response.status})${body ? `: ${body.slice(0, 160)}` : ""}`,
            );
        }

        return await response.json();
    } finally {
        clearTimeout(timeout);
    }
}

function parseAcrossRoute(entry: unknown): AcrossRouteSummary | null {
    if (!isRecord(entry)) return null;

    const originToken = isRecord(entry.originToken) ? entry.originToken : undefined;
    const destinationToken = isRecord(entry.destinationToken) ? entry.destinationToken : undefined;

    const originChainId = readNumber(entry.originChainId);
    const destinationChainId = readNumber(entry.destinationChainId);

    if (originChainId === undefined || destinationChainId === undefined) return null;

    return {
        originChainId,
        destinationChainId,
        ...(readString(originToken?.symbol) ?? readString(entry.originTokenSymbol)
            ? { originTokenSymbol: readString(originToken?.symbol) ?? readString(entry.originTokenSymbol) }
            : {}),
        ...(readString(destinationToken?.symbol) ?? readString(entry.destinationTokenSymbol)
            ? { destinationTokenSymbol: readString(destinationToken?.symbol) ?? readString(entry.destinationTokenSymbol) }
            : {}),
        ...(readString(originToken?.address) ?? readString(entry.originToken)
            ? { originTokenAddress: readString(originToken?.address) ?? readString(entry.originToken) }
            : {}),
        ...(readString(destinationToken?.address) ?? readString(entry.destinationToken)
            ? { destinationTokenAddress: readString(destinationToken?.address) ?? readString(entry.destinationToken) }
            : {}),
        ...(readBoolean(entry.isNative) !== undefined ? { isNative: readBoolean(entry.isNative) } : {}),
    };
}

async function listRawAcrossRoutes(
    networkId: NetworkId,
    destinationChainId?: number,
): Promise<AcrossRouteSummary[]> {
    assertAcrossDestinationMatchesRuntime(networkId, destinationChainId);

    const payload = await fetchAcrossJson(networkId, "/available-routes", {
        originChainId: String(getAcrossOriginChainId(networkId)),
        ...(destinationChainId !== undefined ? { destinationChainId: String(destinationChainId) } : {}),
    });

    const entries = Array.isArray(payload)
        ? payload
        : isRecord(payload) && Array.isArray(payload.routes)
            ? payload.routes
            : [];

    return entries
        .map(parseAcrossRoute)
        .filter((entry): entry is AcrossRouteSummary => Boolean(entry));
}

function resolveTokenRef(route: AcrossRouteSummary, direction: "origin" | "destination"): ParsedAcrossTokenRef | null {
    const symbol = direction === "origin" ? route.originTokenSymbol : route.destinationTokenSymbol;
    const address = direction === "origin" ? route.originTokenAddress : route.destinationTokenAddress;
    if (!symbol || !address) return null;

    return {
        symbol,
        address,
        decimals: COMMON_TOKEN_DECIMALS[symbol.toUpperCase()] ?? 18,
    };
}

function normalizeTokenSymbol(value: string): string {
    return value.trim().toUpperCase();
}

function subtractFeeFromInput(inputAmount: string, feeAmount: string): string {
    try {
        const result = BigInt(inputAmount) - BigInt(feeAmount);
        return result > BigInt(0) ? result.toString() : "0";
    } catch {
        return inputAmount;
    }
}

export async function listAcrossRoutes(
    networkId: NetworkId,
    destinationChainId?: number,
): Promise<AcrossRouteSummary[]> {
    return listRawAcrossRoutes(networkId, destinationChainId);
}

export async function getAcrossSameAssetQuote(params: {
    networkId: NetworkId;
    destinationChainId: number;
    tokenSymbol: string;
    amount: string;
}): Promise<AcrossFeeQuote> {
    const routes = await listRawAcrossRoutes(params.networkId, params.destinationChainId);
    const tokenSymbol = normalizeTokenSymbol(params.tokenSymbol);
    const matchedRoute = routes.find(
        (route) =>
            normalizeTokenSymbol(route.originTokenSymbol ?? "") === tokenSymbol
            && normalizeTokenSymbol(route.destinationTokenSymbol ?? "") === tokenSymbol,
    );

    if (!matchedRoute) {
        throw new Error(`Across does not expose a ${tokenSymbol} route for this destination from the active Base network.`);
    }

    const originToken = resolveTokenRef(matchedRoute, "origin");
    const destinationToken = resolveTokenRef(matchedRoute, "destination");

    if (!originToken || !destinationToken) {
        throw new Error("Across route metadata is incomplete for the selected token.");
    }

    const amountInBaseUnits = parseUnits(params.amount, originToken.decimals).toString();

    const payload = await fetchAcrossJson(params.networkId, "/suggested-fees", {
        inputToken: originToken.address,
        outputToken: destinationToken.address,
        originChainId: String(getAcrossOriginChainId(params.networkId)),
        destinationChainId: String(params.destinationChainId),
        amount: amountInBaseUnits,
        integratorId: getAcrossIntegratorId(),
    });

    if (!isRecord(payload)) {
        throw new Error("Across quote response was malformed.");
    }

    const quotedInputToken = isRecord(payload.inputToken) ? payload.inputToken : undefined;
    const quotedOutputToken = isRecord(payload.outputToken) ? payload.outputToken : undefined;
    const totalRelayFee = isRecord(payload.totalRelayFee) ? payload.totalRelayFee : undefined;
    const relayerGasFee = isRecord(payload.relayerGasFee) ? payload.relayerGasFee : undefined;
    const relayerCapitalFee = isRecord(payload.relayerCapitalFee) ? payload.relayerCapitalFee : undefined;
    const lpFee = isRecord(payload.lpFee) ? payload.lpFee : undefined;

    const totalRelayFeePct = readString(totalRelayFee?.pct) ?? readString(payload.relayFeePct);
    const totalRelayFeeAmount = readString(totalRelayFee?.total) ?? readString(payload.relayFeeTotal);
    const outputAmount = readString(payload.outputAmount)
        ?? (totalRelayFeeAmount ? subtractFeeFromInput(amountInBaseUnits, totalRelayFeeAmount) : amountInBaseUnits);
    const expectedFillTimeSec =
        readNumber(payload.expectedFillTimeSec) ?? readNumber(payload.estimatedFillTimeSec);

    return {
        originChainId: getAcrossOriginChainId(params.networkId),
        destinationChainId: params.destinationChainId,
        inputTokenSymbol: readString(quotedInputToken?.symbol) ?? originToken.symbol,
        outputTokenSymbol: readString(quotedOutputToken?.symbol) ?? destinationToken.symbol,
        inputTokenAddress: readString(quotedInputToken?.address) ?? originToken.address,
        outputTokenAddress: readString(quotedOutputToken?.address) ?? destinationToken.address,
        inputAmount: amountInBaseUnits,
        outputAmount,
        ...(totalRelayFeePct ? { totalRelayFeePct } : {}),
        ...(totalRelayFeeAmount ? { totalRelayFeeAmount } : {}),
        ...(readString(relayerGasFee?.total) ?? readString(payload.relayGasFeeTotal)
            ? { relayerGasFeeAmount: readString(relayerGasFee?.total) ?? readString(payload.relayGasFeeTotal) }
            : {}),
        ...(readString(relayerCapitalFee?.total) ?? readString(payload.capitalFeeTotal)
            ? { relayerCapitalFeeAmount: readString(relayerCapitalFee?.total) ?? readString(payload.capitalFeeTotal) }
            : {}),
        ...(readString(lpFee?.total) ?? readString(payload.lpFeeTotal)
            ? { lpFeeAmount: readString(lpFee?.total) ?? readString(payload.lpFeeTotal) }
            : {}),
        ...(expectedFillTimeSec !== undefined ? { expectedFillTimeSec } : {}),
        ...(readNumber(payload.fillDeadline) !== undefined ? { fillDeadline: readNumber(payload.fillDeadline) } : {}),
        ...(readNumber(payload.exclusivityDeadline) !== undefined ? { exclusivityDeadline: readNumber(payload.exclusivityDeadline) } : {}),
        ...(readNumber(payload.timestamp) !== undefined ? { quoteTimestamp: readNumber(payload.timestamp) } : {}),
        ...(readString(payload.spokePoolAddress) ? { spokePoolAddress: readString(payload.spokePoolAddress) } : {}),
        ...(typeof payload.isAmountTooLow === "boolean" ? { isAmountTooLow: payload.isAmountTooLow } : {}),
    };
}

export async function trackAcrossDeposit(params: {
    networkId: NetworkId;
    depositTxnRef: string;
}): Promise<AcrossDepositStatus> {
    const payload = await fetchAcrossJson(params.networkId, "/deposit/status", {
        depositTxnRef: params.depositTxnRef,
    });

    if (!isRecord(payload)) {
        throw new Error("Across status response was malformed.");
    }

    return {
        status: readString(payload.status) ?? "unknown",
        ...(readString(payload.depositTxnRef) ? { depositTxnRef: readString(payload.depositTxnRef) } : {}),
        ...(readString(payload.fillTxnRef) ? { fillTxnRef: readString(payload.fillTxnRef) } : {}),
        ...(readString(payload.depositRefundTxnRef) ? { depositRefundTxnRef: readString(payload.depositRefundTxnRef) } : {}),
        ...(readNumber(payload.originChainId) !== undefined ? { originChainId: readNumber(payload.originChainId) } : {}),
        ...(readNumber(payload.destinationChainId) !== undefined ? { destinationChainId: readNumber(payload.destinationChainId) } : {}),
        ...(readNumber(payload.depositId) !== undefined ? { depositId: readNumber(payload.depositId) } : {}),
        ...(typeof payload.actionsSucceeded === "boolean" ? { actionsSucceeded: payload.actionsSucceeded } : {}),
    };
}
