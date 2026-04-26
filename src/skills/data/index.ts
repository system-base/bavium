/* ==========================================================================
   Skills — Data
   Price feeds and wallet portfolio data.
   Actions: pyth_price, token_prices, portfolio_snapshot, wallet_activity
   ========================================================================== */

import type { ISkill, SkillResult, SkillActionMeta } from "../types";
import type { VariableContext } from "@/engine/types";
import { resolveWalletAddress } from "../helpers";
import { skillRegistry } from "../registry";
import { getPrice, getPrices, resolvePriceSymbols } from "@/engine/price-feed";
import { getBalance, getPublicClient, getRegisteredTokenBalances } from "@/lib/viem-client";
import {
    getActiveNetwork,
    getRegisteredTokens,
    getTokenInfo,
    getTokenInfoByAddress,
    NETWORKS,
    type NetworkId,
} from "@/lib/chain-config";
import { getWalletActivityFromBlockscout, type BlockscoutActivityFilter } from "@/lib/blockscout";
import { getAddress, type Address } from "viem";
import { resolveBasenameForAddress } from "@/lib/basename";

// ---------------------------------------------------------------------------
// Price feed implementations (direct API calls, no AgentKit dependency)
// ---------------------------------------------------------------------------

/** Well-known Pyth price feed IDs for major assets */
const PYTH_FEED_IDS: Record<string, string> = {
    "BTC": "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    "ETH": "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    "SOL": "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    "USDC": "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
};

interface PortfolioAsset {
    symbol: string;
    assetId: string;
    address?: string;
    amount: string;
    decimals: number;
    usdValue?: string;
    priceSource?: "coingecko" | "unknown";
}

interface MorphoPosition {
    vault: string;
    shares: string;
    assets: string;
    symbol: string;
}

interface LiquidityPosition {
    tokenId: string;
    poolAddress: string;
    feeTier: number;
    liquidity: string;
    tokensOwed0: string;
    tokensOwed1: string;
    pairLabel: string;
}

function normalizeActivityFilter(value: unknown): BlockscoutActivityFilter {
    const input = String(value ?? "all").trim().toLowerCase();
    if (input === "to" || input === "from") return input;
    return "all";
}

function parseMaxItems(value: unknown, fallback = 10): number {
    const numeric = Number(value ?? fallback);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(1, Math.min(20, Math.floor(numeric)));
}

function isTruthyBoolean(value: unknown, fallback = false): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true") return true;
        if (normalized === "false") return false;
    }
    return fallback;
}

function parseTrackedTokens(params: Record<string, unknown>, networkId?: NetworkId): string[] {
    const raw = String(params.tokens ?? "").trim();
    if (!raw) {
        return getRegisteredTokens(networkId)
            .map((token) => token.symbol)
            .filter((symbol) => symbol !== "ETH");
    }

    return raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
}

function buildAssetId(
    chainId: number,
    address: string | undefined,
    symbol: string,
): string {
    const key = address ? address.toLowerCase() : `symbol:${symbol.toLowerCase()}`;
    return `${chainId}:${key}`;
}

function resolvePortfolioAssetIdentity(
    tokenRef: string,
    resolvedSymbol: string,
    networkId: NetworkId,
): { address?: string; assetId: string } {
    const directAddress =
        tokenRef.startsWith("0x") && tokenRef.length === 42
            ? getAddress(tokenRef)
            : undefined;
    const registryToken = directAddress
        ? getTokenInfoByAddress(directAddress, networkId)
        : getTokenInfo(tokenRef, networkId) ?? getTokenInfo(resolvedSymbol, networkId);
    const address = registryToken?.address ?? directAddress;
    const assetId = buildAssetId(NETWORKS[networkId].chain.id, address, resolvedSymbol);

    return { address, assetId };
}

async function enrichUsdValue(symbol: string, amount: string): Promise<Pick<PortfolioAsset, "usdValue" | "priceSource">> {
    try {
        const price = await getPrice(symbol);
        return {
            usdValue: (Number(amount) * price.priceUsd).toFixed(2),
            priceSource: "coingecko",
        };
    } catch {
        return {
            priceSource: "unknown",
        };
    }
}

async function executePythPrice(
    params: Record<string, unknown>,
): Promise<SkillResult> {
    const symbol = String(params.symbol ?? params.token ?? "ETH").toUpperCase();
    const feedId = PYTH_FEED_IDS[symbol] ?? String(params.feedId ?? "");

    if (!feedId) {
        return {
            success: false,
            error: `Unknown token "${symbol}". Available: ${Object.keys(PYTH_FEED_IDS).join(", ")} or provide a feedId.`,
        };
    }

    try {
        const url = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${feedId}`;
        const res = await fetch(url);
        if (!res.ok) {
            return { success: false, error: `Pyth request failed: ${res.status}` };
        }

        const data = await res.json();
        const parsed = data?.parsed?.[0]?.price;
        if (!parsed) {
            return { success: false, error: "No price data available" };
        }

        const price = Number(parsed.price) * Math.pow(10, Number(parsed.expo));
        const conf = Number(parsed.conf) * Math.pow(10, Number(parsed.expo));

        return {
            success: true,
            data: {
                symbol,
                price: price.toFixed(2),
                confidence: conf.toFixed(4),
                timestamp: new Date(Number(parsed.publish_time) * 1000).toISOString(),
            },
            message: `${symbol}: $${price.toFixed(2)} (±$${conf.toFixed(4)})`,
        };
    } catch (err) {
        return {
            success: false,
            error: `Pyth price fetch failed: ${err instanceof Error ? err.message : err}`,
        };
    }
}

async function executeTokenPrices(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    const rawTokens = String(params.tokens ?? "ETH,USDC");
    const vs = String(params.vs ?? "usd");
    const networkId = context.networkId ?? getActiveNetwork().networkId;
    const requestedTokens = rawTokens
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

    const { symbols, unsupported } = resolvePriceSymbols(requestedTokens, networkId);

    if (symbols.length === 0) {
        return {
            success: false,
            error:
                "No supported price tokens were provided. Use supported symbols such as ETH, BTC, USDC, WETH, DAI, USDT, LINK, UNI, AAVE, or COMP, or a registered token address on the active Base network.",
        };
    }

    try {
        const prices = await getPrices(symbols);
        const priceMap = Object.fromEntries(
            prices.map((price) => [
                price.symbol,
                {
                    [vs]: price.priceUsd,
                    change24h: price.change24h,
                    timestamp: price.timestamp,
                },
            ]),
        );
        const entries = prices.map((price) => `${price.symbol}: $${price.priceUsd}`);
        const unsupportedMessage =
            unsupported.length > 0
                ? ` Unsupported: ${unsupported.join(", ")}.`
                : "";

        return {
            success: true,
            data: {
                prices: priceMap,
                symbols,
                unsupported,
                vs,
            },
            message: `${entries.join(", ")}.${unsupportedMessage}`.trim(),
        };
    } catch (err) {
        return {
            success: false,
            error: `Token prices failed: ${err instanceof Error ? err.message : err}`,
        };
    }
}

async function executePortfolioSnapshot(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    const walletAddress = resolveWalletAddress(params, context);
    if (!walletAddress) {
        return { success: false, error: "No wallet address available. Connect your wallet first." };
    }

    const includeBasename = isTruthyBoolean(params.includeBasename, true);
    const includeUsdValue = isTruthyBoolean(params.includeUsdValue, true);
    const networkId = context.networkId ?? getActiveNetwork().networkId;
    const trackedTokens = parseTrackedTokens(params, networkId);
    const network = NETWORKS[networkId];

    try {
        const [ethBalance, blockNumber, basename] = await Promise.all([
            getBalance("ETH", walletAddress, networkId),
            getPublicClient(networkId).getBlockNumber(),
            includeBasename ? resolveBasenameForAddress(walletAddress, networkId) : Promise.resolve(undefined),
        ]);
        const registeredTokenBalances = await getRegisteredTokenBalances(walletAddress, networkId);
        const registeredBalanceMap = new Map(
            registeredTokenBalances.flatMap((asset) => [
                [asset.symbol.toUpperCase(), asset],
                [asset.token.address.toLowerCase(), asset],
            ]),
        );
        const nativeIdentity = resolvePortfolioAssetIdentity("ETH", ethBalance.symbol, networkId);

        const nativeAsset: PortfolioAsset = {
            assetId: nativeIdentity.assetId,
            symbol: ethBalance.symbol,
            address: nativeIdentity.address,
            amount: ethBalance.balance,
            decimals: ethBalance.decimals,
        };

        if (includeUsdValue) {
            Object.assign(nativeAsset, await enrichUsdValue(nativeAsset.symbol, nativeAsset.amount));
        }

        const tokenBalances = await Promise.all(
            trackedTokens.map(async (token) => {
                const registryBalance =
                    registeredBalanceMap.get(token.toUpperCase())
                    ?? (token.startsWith("0x")
                        ? registeredBalanceMap.get(token.toLowerCase())
                        : undefined);
                const balance = registryBalance ?? await getBalance(token, walletAddress, networkId);
                const identity = resolvePortfolioAssetIdentity(token, balance.symbol, networkId);
                const asset: PortfolioAsset = {
                    assetId: identity.assetId,
                    symbol: balance.symbol,
                    address: identity.address,
                    amount: balance.balance,
                    decimals: balance.decimals,
                };

                if (includeUsdValue) {
                    Object.assign(asset, await enrichUsdValue(balance.symbol, balance.balance));
                }

                return asset;
            }),
        );

        const totalUsdValue = [nativeAsset, ...tokenBalances]
            .reduce((sum, asset) => sum + Number(asset.usdValue ?? 0), 0);

        const data = {
            wallet: {
                address: walletAddress,
                ...(basename ? { basename } : {}),
                chainId: network.chain.id,
                network: network.networkId,
                blockTag: "latest",
                blockNumber: blockNumber.toString(),
            },
            native: [nativeAsset],
            tokens: tokenBalances,
            tracked: Object.fromEntries(
                tokenBalances.map((asset) => [
                    asset.symbol,
                    {
                        assetId: asset.assetId,
                        ...(asset.address ? { address: asset.address } : {}),
                        amount: asset.amount,
                        ...(asset.usdValue ? { usdValue: asset.usdValue } : {}),
                    },
                ]),
            ),
            trackedByAsset: Object.fromEntries(
                tokenBalances.map((asset) => [
                    asset.assetId,
                    {
                        symbol: asset.symbol,
                        ...(asset.address ? { address: asset.address } : {}),
                        amount: asset.amount,
                        ...(asset.usdValue ? { usdValue: asset.usdValue } : {}),
                    },
                ]),
            ),
            summary: {
                ...(includeUsdValue ? { totalUsdValue: totalUsdValue.toFixed(2) } : {}),
                trackedTokenCount: tokenBalances.length,
            },
        };

        const tokenSummary = tokenBalances
            .map((asset) => `${asset.symbol}: ${asset.amount}${asset.usdValue ? ` ($${asset.usdValue})` : ""}`)
            .join(", ");

        return {
            success: true,
            data,
            message: [
                basename ? `${basename}` : walletAddress,
                `ETH: ${nativeAsset.amount}${nativeAsset.usdValue ? ` ($${nativeAsset.usdValue})` : ""}`,
                tokenSummary,
            ].filter(Boolean).join(" | "),
        };
    } catch (err) {
        return {
            success: false,
            error: `Portfolio snapshot failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

async function executeWalletPortfolio(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    const baseSnapshot = await executePortfolioSnapshot(params, context);
    if (!baseSnapshot.success || !baseSnapshot.data || typeof baseSnapshot.data !== "object" || baseSnapshot.data === null) {
        return baseSnapshot;
    }

    const includeDefiPositions = isTruthyBoolean(params.includeDefiPositions, true);
    const includeLiquidityPositions = isTruthyBoolean(params.includeLiquidityPositions, true);
    const maxLiquidityPositions = Math.max(1, Math.min(20, Number(params.maxLiquidityPositions ?? 5)));
    const warnings: Record<string, string> = {};
    let morphoPositions: MorphoPosition[] = [];
    let liquidityPositions: LiquidityPosition[] = [];
    let liquiditySummary = {
        positionCount: 0,
        returnedPositionCount: 0,
        hasActiveLiquidity: false,
    };

    if (includeDefiPositions) {
        try {
            const result = await skillRegistry.getOrThrow("defi").execute(
                "morpho_portfolio",
                params,
                context,
            );

            if (result.success && result.data && typeof result.data === "object" && result.data !== null) {
                const rawPositions = (result.data as { positions?: unknown }).positions;
                if (Array.isArray(rawPositions)) {
                    morphoPositions = rawPositions as MorphoPosition[];
                }
            } else if (result.error || result.message) {
                warnings.morpho = result.error ?? result.message ?? "Morpho portfolio could not be loaded.";
            }
        } catch (err) {
            warnings.morpho = err instanceof Error ? err.message : String(err);
        }
    }

    if (includeLiquidityPositions) {
        try {
            const result = await skillRegistry.getOrThrow("swap").execute(
                "uniswap_positions",
                { address: params.address, maxPositions: maxLiquidityPositions },
                context,
            );

            if (result.success && result.data && typeof result.data === "object" && result.data !== null) {
                const data = result.data as {
                    positions?: unknown;
                    summary?: {
                        positionCount?: unknown;
                        returnedPositionCount?: unknown;
                        hasActiveLiquidity?: unknown;
                    };
                };

                if (Array.isArray(data.positions)) {
                    liquidityPositions = data.positions as LiquidityPosition[];
                }

                liquiditySummary = {
                    positionCount: Number(data.summary?.positionCount ?? liquidityPositions.length),
                    returnedPositionCount: Number(data.summary?.returnedPositionCount ?? liquidityPositions.length),
                    hasActiveLiquidity: Boolean(data.summary?.hasActiveLiquidity),
                };
            } else if (result.error || result.message) {
                warnings.liquidity = result.error ?? result.message ?? "Liquidity positions could not be loaded.";
            }
        } catch (err) {
            warnings.liquidity = err instanceof Error ? err.message : String(err);
        }
    }

    const snapshotData = baseSnapshot.data as {
        wallet: Record<string, unknown>;
        native: PortfolioAsset[];
        tokens: PortfolioAsset[];
        tracked: Record<string, { assetId: string; address?: string; amount: string; usdValue?: string }>;
        trackedByAsset?: Record<string, { symbol: string; address?: string; amount: string; usdValue?: string }>;
        summary: Record<string, unknown>;
    };

    const data = {
        ...snapshotData,
        defi: {
            positions: morphoPositions,
            summary: {
                morphoPositionCount: morphoPositions.length,
            },
        },
        liquidity: {
            positions: liquidityPositions,
            summary: liquiditySummary,
        },
        summary: {
            ...snapshotData.summary,
            morphoPositionCount: morphoPositions.length,
            uniswapPositionCount: liquiditySummary.positionCount,
            protocolPositionCount: morphoPositions.length + liquiditySummary.positionCount,
            hasActiveLiquidity: liquiditySummary.hasActiveLiquidity,
        },
        ...(Object.keys(warnings).length > 0 ? { warnings } : {}),
    };

    const baseMessage = baseSnapshot.message ?? "Wallet portfolio captured.";
    const extraSummary = [
        includeDefiPositions ? `Morpho positions: ${morphoPositions.length}` : null,
        includeLiquidityPositions ? `Uniswap positions: ${liquiditySummary.positionCount}` : null,
    ].filter(Boolean).join(" | ");

    return {
        success: true,
        data,
        message: extraSummary ? `${baseMessage} | ${extraSummary}` : baseMessage,
    };
}

async function executeWalletActivity(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    const walletAddress = resolveWalletAddress(params, context);
    if (!walletAddress) {
        return { success: false, error: "No wallet address available. Connect your wallet first." };
    }

    try {
        const networkId = context.networkId ?? getActiveNetwork().networkId;
        const filter = normalizeActivityFilter(params.filter);
        const maxItems = parseMaxItems(params.maxItems, 10);
        const data = await getWalletActivityFromBlockscout({
            walletAddress,
            networkId,
            filter,
            maxItems,
        });

        const firstItem = data.items[0];
        return {
            success: true,
            data: {
                ...data,
                filter,
            },
            message: firstItem
                ? `Found ${data.returnedCount} recent wallet activit${data.returnedCount === 1 ? "y" : "ies"} for ${walletAddress}. Latest: ${firstItem.direction} ${firstItem.primaryAsset ?? "transfer"}${firstItem.status ? ` (${firstItem.status})` : ""}.`
                : `No recent wallet activity was returned for ${walletAddress}.`,
        };
    } catch (err) {
        return {
            success: false,
            error: `Wallet activity failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

// ---------------------------------------------------------------------------
// Skill definition
// ---------------------------------------------------------------------------

const ACTIONS: SkillActionMeta[] = [
    {
        name: "pyth_price",
        label: "Pyth Price",
        description:
            "Get a real-time price from the Pyth oracle network. Supports BTC, ETH, SOL, USDC.",
        params: [
            { name: "symbol", type: "string", required: true, description: "Token symbol (BTC, ETH, SOL, USDC)" },
        ],
    },
    {
        name: "token_prices",
        label: "Token Prices",
        description:
            "Fetch current prices for multiple tokens via CoinGecko.",
        params: [
            { name: "tokens", type: "string", required: true, description: "Comma-separated token symbols or registered token addresses (e.g. 'ETH,USDC')" },
            { name: "vs", type: "string", required: false, description: "Currency to price against (default: usd)", default: "usd" },
        ],
    },
    {
        name: "portfolio_snapshot",
        label: "Wallet Portfolio",
        description:
            "Capture wallet balances with optional USD values, basename lookup, and best-effort DeFi/liquidity context.",
        params: [
            { name: "address", type: "address", required: false, description: "Wallet address to inspect (default: connected wallet)" },
            { name: "tokens", type: "string", required: false, description: "Comma-separated token symbols or addresses to track" },
            { name: "includeUsdValue", type: "boolean", required: false, description: "Whether to enrich balances with USD values", default: true },
            { name: "includeBasename", type: "boolean", required: false, description: "Whether to attempt Base/ENS reverse name resolution", default: true },
            { name: "includeDefiPositions", type: "boolean", required: false, description: "Whether to include Morpho positions", default: true },
            { name: "includeLiquidityPositions", type: "boolean", required: false, description: "Whether to include Uniswap LP positions", default: true },
            { name: "maxLiquidityPositions", type: "number", required: false, description: "Maximum number of Uniswap LP positions to load", default: 5 },
        ],
    },
    {
        name: "wallet_activity",
        label: "Wallet Activity",
        description:
            "Read recent wallet transaction activity from the public Blockscout explorer for Base.",
        params: [
            { name: "address", type: "address", required: false, description: "Wallet address to inspect (default: connected wallet)" },
            { name: "filter", type: "string", required: false, description: "Direction filter: all, to, or from", default: "all" },
            { name: "maxItems", type: "number", required: false, description: "Maximum number of recent activity items to return", default: 10 },
        ],
    },
];

const dataSkill: ISkill = {
    name: "data",
    label: "Data",
    category: "data",
    description: "Price feeds, wallet portfolio, and recent wallet activity reads for Base shortcuts.",
    actions: ACTIONS,

    async execute(
        action: string,
        params: Record<string, unknown>,
        _context: VariableContext,
    ): Promise<SkillResult> {
        switch (action) {
            case "pyth_price":
                return executePythPrice(params);
            case "token_prices":
                return executeTokenPrices(params, _context);
            case "portfolio_snapshot":
                return executeWalletPortfolio(params, _context);
            case "wallet_activity":
                return executeWalletActivity(params, _context);
            default:
                return { success: false, error: `Unknown data action "${action}"` };
        }
    },
};

// Self-register
skillRegistry.register(dataSkill);

export { dataSkill };
