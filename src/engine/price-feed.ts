/* ==========================================================================
   Price Feed — Fetches current crypto prices
   Uses CoinGecko free API (no key required for MVP).
   ========================================================================== */

import {
    getTokenInfo,
    getTokenInfoByAddress,
    type NetworkId,
} from "@/lib/chain-config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PriceData {
    /** Token symbol */
    symbol: string;
    /** Current USD price */
    priceUsd: number;
    /** 24h change percentage */
    change24h: number;
    /** Timestamp of the price data */
    timestamp: string;
}

// ---------------------------------------------------------------------------
// CoinGecko token ID mapping
// ---------------------------------------------------------------------------

const COINGECKO_IDS: Record<string, string> = {
    ETH: "ethereum",
    BTC: "bitcoin",
    USDC: "usd-coin",
    WETH: "weth",
    DAI: "dai",
    USDT: "tether",
    LINK: "chainlink",
    UNI: "uniswap",
    AAVE: "aave",
    COMP: "compound-governance-token",
    // Base-native tokens
    AERO: "aerodrome-finance",
    DEGEN: "degen-base",
    // Cross-chain tokens (valid for price monitoring even if not on Base)
    SOL: "solana",
    MATIC: "matic-network",
    ARB: "arbitrum",
    OP: "optimism",
};

const STABLE_PRICE_SYMBOLS = new Set(["USDC", "USDT", "DAI"]);
const SUPPORTED_PRICE_SYMBOLS = new Set([
    ...Object.keys(COINGECKO_IDS),
    ...STABLE_PRICE_SYMBOLS,
]);

/**
 * Canonical list of token symbols supported by the price feed.
 * This is the SINGLE SOURCE OF TRUTH for the UI (Automations token picker),
 * API validation (POST /api/automations), and engine (automation-runner).
 *
 * Only tokens in this list can be used in price-based automation triggers.
 * Sorted with major assets first for UI display order.
 */
export const PRICE_TRIGGER_SYMBOLS: readonly string[] = [
    "ETH", "BTC", "USDC", "WETH", "DAI",
    "AERO", "DEGEN",
    "SOL", "MATIC", "ARB", "OP",
    "LINK", "UNI", "AAVE", "COMP",
] as const;

// ---------------------------------------------------------------------------
// Price cache (avoid rate limits)
// ---------------------------------------------------------------------------

interface CacheEntry {
    data: PriceData;
    expiresAt: number;
}

const priceCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000; // 30 seconds

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Get current price for a single token.
 */
export async function getPrice(symbol: string): Promise<PriceData> {
    const upperSymbol = symbol.toUpperCase();

    // Stablecoins — skip API call
    if (STABLE_PRICE_SYMBOLS.has(upperSymbol)) {
        return {
            symbol: upperSymbol,
            priceUsd: 1.0,
            change24h: 0,
            timestamp: new Date().toISOString(),
        };
    }

    // Check cache
    const cached = priceCache.get(upperSymbol);
    if (cached && Date.now() < cached.expiresAt) {
        return cached.data;
    }

    const geckoId = COINGECKO_IDS[upperSymbol];
    if (!geckoId) {
        throw new Error(`Unsupported token for price feed: ${symbol}`);
    }

    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${geckoId}&vs_currencies=usd&include_24hr_change=true`;

    const res = await fetch(url, {
        headers: { Accept: "application/json" },
        next: { revalidate: 30 },
    });

    if (!res.ok) {
        throw new Error(`CoinGecko API error: ${res.status} ${res.statusText}`);
    }

    const json = await res.json();
    const tokenData = json[geckoId];

    if (!tokenData) {
        throw new Error(`No price data returned for ${symbol}`);
    }

    const data: PriceData = {
        symbol: upperSymbol,
        priceUsd: tokenData.usd,
        change24h: tokenData.usd_24h_change ?? 0,
        timestamp: new Date().toISOString(),
    };

    // Update cache
    priceCache.set(upperSymbol, {
        data,
        expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return data;
}

/**
 * Get prices for multiple tokens at once.
 */
export async function getPrices(symbols: string[]): Promise<PriceData[]> {
    // Filter out stablecoins — handle locally
    const stablecoins = symbols.filter((s) => STABLE_PRICE_SYMBOLS.has(s.toUpperCase()));
    const nonStablecoins = symbols.filter(
        (s) => !STABLE_PRICE_SYMBOLS.has(s.toUpperCase()),
    );

    const stablePrices: PriceData[] = stablecoins.map((s) => ({
        symbol: s.toUpperCase(),
        priceUsd: 1.0,
        change24h: 0,
        timestamp: new Date().toISOString(),
    }));

    if (nonStablecoins.length === 0) return stablePrices;

    // Check which ones need fetching
    const needsFetch: string[] = [];
    const cachedResults: PriceData[] = [];

    for (const sym of nonStablecoins) {
        const upper = sym.toUpperCase();
        const cached = priceCache.get(upper);
        if (cached && Date.now() < cached.expiresAt) {
            cachedResults.push(cached.data);
        } else {
            needsFetch.push(upper);
        }
    }

    if (needsFetch.length === 0) {
        return [...stablePrices, ...cachedResults];
    }

    const geckoIds = needsFetch
        .map((s) => COINGECKO_IDS[s])
        .filter(Boolean)
        .join(",");

    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${geckoIds}&vs_currencies=usd&include_24hr_change=true`;

    const res = await fetch(url, {
        headers: { Accept: "application/json" },
    });

    if (!res.ok) {
        throw new Error(`CoinGecko API error: ${res.status}`);
    }

    const json = await res.json();
    const fetchedPrices: PriceData[] = [];

    for (const sym of needsFetch) {
        const geckoId = COINGECKO_IDS[sym];
        if (!geckoId || !json[geckoId]) continue;

        const data: PriceData = {
            symbol: sym,
            priceUsd: json[geckoId].usd,
            change24h: json[geckoId].usd_24h_change ?? 0,
            timestamp: new Date().toISOString(),
        };

        priceCache.set(sym, {
            data,
            expiresAt: Date.now() + CACHE_TTL_MS,
        });

        fetchedPrices.push(data);
    }

    return [...stablePrices, ...cachedResults, ...fetchedPrices];
}

function normalizePriceSymbol(
    tokenOrAddress: string,
    networkId?: NetworkId,
): string | null {
    const raw = tokenOrAddress.trim();
    if (!raw) return null;

    const fromAddress =
        raw.startsWith("0x") && raw.length === 42
            ? getTokenInfoByAddress(raw, networkId)?.symbol
            : undefined;
    const fromSymbol = getTokenInfo(raw, networkId)?.symbol;
    const candidate = (fromAddress ?? fromSymbol ?? raw).toUpperCase();

    return SUPPORTED_PRICE_SYMBOLS.has(candidate) ? candidate : null;
}

export function resolvePriceSymbols(
    tokenRefs: string[],
    networkId?: NetworkId,
): { symbols: string[]; unsupported: string[] } {
    const seen = new Set<string>();
    const symbols: string[] = [];
    const unsupported: string[] = [];

    for (const tokenRef of tokenRefs) {
        const resolved = normalizePriceSymbol(tokenRef, networkId);
        if (!resolved) {
            unsupported.push(tokenRef);
            continue;
        }
        if (seen.has(resolved)) continue;
        seen.add(resolved);
        symbols.push(resolved);
    }

    return { symbols, unsupported };
}
