import { formatUnits, type Address } from "viem";
import {
    ERC20_ABI,
    getActiveNetwork,
    getRegisteredTokens,
    NETWORKS,
    type NetworkId,
} from "@/lib/chain-config";
import {
    getPublicClient,
    getTokenMetadata,
    parseTokenAmountWithReference,
    type TokenMetadataResult,
} from "@/lib/viem-client";

export type FeeTier = 500 | 3000 | 10000;
export type RequestedFeeTier = FeeTier | "auto";
export type RequestedSlippage = number | "auto";

export interface ResolvedSwapTokenSelection {
    token: TokenMetadataResult;
    isNativeEth: boolean;
    displaySymbol: string;
}

export interface UniswapExactInputPreview {
    networkId: NetworkId;
    tokenInSelection: ResolvedSwapTokenSelection;
    tokenOutSelection: ResolvedSwapTokenSelection;
    amountInDisplay: string;
    amountInRaw: bigint;
    quotedAmountOut: string;
    quotedAmountOutRaw: bigint;
    amountOutMinimum: string;
    amountOutMinimumRaw: bigint;
    feeTier: FeeTier;
    requestedFeeTier: RequestedFeeTier;
    requestedSlippage: RequestedSlippage;
    slippageBps: number;
    initializedTicksCrossed: number;
    gasEstimate: bigint;
    router: Address;
    requiresApproval: boolean | null;
    nativeInput: boolean;
    nativeOutput: boolean;
    quoteTimestamp: number;
}

const QUOTER_V2_ABI = [
    {
        inputs: [
            {
                components: [
                    { internalType: "address", name: "tokenIn", type: "address" },
                    { internalType: "address", name: "tokenOut", type: "address" },
                    { internalType: "uint256", name: "amountIn", type: "uint256" },
                    { internalType: "uint24", name: "fee", type: "uint24" },
                    { internalType: "uint160", name: "sqrtPriceLimitX96", type: "uint160" },
                ],
                internalType: "struct IQuoterV2.QuoteExactInputSingleParams",
                name: "params",
                type: "tuple",
            },
        ],
        name: "quoteExactInputSingle",
        outputs: [
            { internalType: "uint256", name: "amountOut", type: "uint256" },
            { internalType: "uint160", name: "sqrtPriceX96After", type: "uint160" },
            { internalType: "uint32", name: "initializedTicksCrossed", type: "uint32" },
            { internalType: "uint256", name: "gasEstimate", type: "uint256" },
        ],
        stateMutability: "nonpayable",
        type: "function",
    },
] as const;

const V3_FACTORY_ABI = [
    {
        inputs: [
            { internalType: "address", name: "tokenA", type: "address" },
            { internalType: "address", name: "tokenB", type: "address" },
            { internalType: "uint24", name: "fee", type: "uint24" },
        ],
        name: "getPool",
        outputs: [{ internalType: "address", name: "pool", type: "address" }],
        stateMutability: "view",
        type: "function",
    },
] as const;

export const UNISWAP_V3_NETWORKS: Record<NetworkId, {
    quoterV2: Address;
    swapRouter02: Address;
    factory: Address;
    positionManager: Address;
}> = {
    "base-mainnet": {
        quoterV2: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
        swapRouter02: "0x2626664c2603336E57B271c5C0b26F421741e481",
        factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
        positionManager: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
    },
    "base-sepolia": {
        quoterV2: "0xC5290058841028F1614F3A6F0F5816cAd0df5E27",
        swapRouter02: "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4",
        factory: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",
        positionManager: "0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2",
    },
};

const SUPPORTED_FEE_TIERS: FeeTier[] = [500, 3000, 10000];

function isNativeEthSymbol(value: string): boolean {
    return value.trim().toUpperCase() === "ETH";
}

function isZeroAddress(address: Address): boolean {
    return address.toLowerCase() === "0x0000000000000000000000000000000000000000";
}

export function parseRequestedFeeTier(value: unknown): RequestedFeeTier {
    const normalized = String(value ?? "auto").trim().toLowerCase();
    if (normalized === "" || normalized === "auto") return "auto";
    if (normalized === "500") return 500;
    if (normalized === "10000") return 10000;
    return 3000;
}

export function parseRequestedSlippage(value: unknown): RequestedSlippage {
    const normalized = String(value ?? "auto").trim().toLowerCase();
    if (normalized === "" || normalized === "auto") return "auto";

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return "auto";
    return Math.max(1, Math.min(5000, Math.floor(parsed)));
}

export function resolveRequestedSlippageBps(
    requested: RequestedSlippage,
    fallback = 50,
): number {
    return requested === "auto" ? fallback : requested;
}

export function formatFeeTierLabel(feeTier: FeeTier): string {
    return `${(feeTier / 10_000).toFixed(2)}%`;
}

export function formatSlippageBpsLabel(slippageBps: number): string {
    return `${(slippageBps / 100).toFixed(2)}%`;
}

export async function resolveSwapTokenSelection(
    token: unknown,
    networkId?: NetworkId,
): Promise<ResolvedSwapTokenSelection> {
    const normalized = String(token ?? "").trim().toUpperCase();
    if (normalized === "ETH") {
        const weth = await getTokenMetadata("WETH", networkId);

        return {
            token: weth,
            isNativeEth: true,
            displaySymbol: "ETH",
        };
    }

    const tokenInput = String(token ?? "").trim();
    if (!tokenInput) {
        throw new Error("Token is required.");
    }

    const metadata = await getTokenMetadata(tokenInput, networkId);
    return {
        token: metadata,
        isNativeEth: false,
        displaySymbol: metadata.symbol,
    };
}

export async function resolveErc20Metadata(
    tokenAddress: Address,
    networkId?: NetworkId,
): Promise<{
    address: Address;
    symbol: string;
    decimals: number;
}> {
    const known = getRegisteredTokens(networkId).find(
        (token) => token.address.toLowerCase() === tokenAddress.toLowerCase(),
    );
    if (known) {
        return {
            address: known.address,
            symbol: known.symbol,
            decimals: known.decimals,
        };
    }

    const client = getPublicClient(networkId);
    const [symbol, decimals] = await Promise.all([
        client.readContract({
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: "symbol",
        }),
        client.readContract({
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: "decimals",
        }),
    ]);

    return {
        address: tokenAddress,
        symbol,
        decimals,
    };
}

async function quoteSinglePoolExactInput(
    tokenIn: Address,
    tokenOut: Address,
    fee: FeeTier,
    amountIn: bigint,
    networkId?: NetworkId,
) {
    const client = getPublicClient(networkId);
    const resolvedNetworkId = networkId ?? getActiveNetwork().networkId;
    const addresses = UNISWAP_V3_NETWORKS[resolvedNetworkId];
    const poolAddress = await client.readContract({
        address: addresses.factory,
        abi: V3_FACTORY_ABI,
        functionName: "getPool",
        args: [tokenIn, tokenOut, fee],
    }) as Address;

    if (isZeroAddress(poolAddress)) {
        throw new Error(
            "No Uniswap v3 pool was found for this pair and fee tier. The current swap block only supports live single-pool Uniswap v3 routes, so pairs that live only on Uniswap v4 or another venue are not supported yet.",
        );
    }

    return client.readContract({
        address: addresses.quoterV2,
        abi: QUOTER_V2_ABI,
        functionName: "quoteExactInputSingle",
        args: [{
            tokenIn,
            tokenOut,
            amountIn,
            fee,
            sqrtPriceLimitX96: BigInt(0),
        }],
    }) as Promise<[bigint, bigint, number, bigint]>;
}

function getCandidateFeeTiers(requestedFeeTier: RequestedFeeTier): FeeTier[] {
    if (requestedFeeTier === "auto") {
        return [...SUPPORTED_FEE_TIERS];
    }

    return [requestedFeeTier];
}

export async function resolveQuotedSinglePoolRoute(
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint,
    requestedFeeTier: RequestedFeeTier,
    networkId?: NetworkId,
): Promise<{
    feeTier: FeeTier;
    amountOut: bigint;
    initializedTicksCrossed: number;
    gasEstimate: bigint;
}> {
    const resolvedNetworkId = networkId ?? getActiveNetwork().networkId;
    const networkLabel = NETWORKS[resolvedNetworkId].label;
    const successfulQuotes: Array<{
        feeTier: FeeTier;
        amountOut: bigint;
        initializedTicksCrossed: number;
        gasEstimate: bigint;
    }> = [];
    let foundPoolWithoutQuote = false;
    const quoteErrors: string[] = [];

    for (const feeTier of getCandidateFeeTiers(requestedFeeTier)) {
        try {
            const [amountOut, , initializedTicksCrossed, gasEstimate] =
                await quoteSinglePoolExactInput(tokenIn, tokenOut, feeTier, amountIn, resolvedNetworkId);

            successfulQuotes.push({
                feeTier,
                amountOut,
                initializedTicksCrossed,
                gasEstimate,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("No Uniswap v3 pool was found")) {
                continue;
            }
            foundPoolWithoutQuote = true;
            quoteErrors.push(`${feeTier}: ${message}`);
        }
    }

    if (successfulQuotes.length > 0) {
        return successfulQuotes.sort((left, right) => {
            if (left.amountOut > right.amountOut) return -1;
            if (left.amountOut < right.amountOut) return 1;
            if (left.gasEstimate < right.gasEstimate) return -1;
            if (left.gasEstimate > right.gasEstimate) return 1;
            return left.feeTier - right.feeTier;
        })[0];
    }

    if (!foundPoolWithoutQuote && quoteErrors.length === 0) {
        throw new Error(
            requestedFeeTier === "auto"
                ? `No Uniswap v3 pool was found for this pair on ${networkLabel}. The built-in swap block currently supports only live single-pool Uniswap v3 routes.`
                : `No Uniswap v3 pool was found for this pair and fee tier on ${networkLabel}. Try Auto fee or choose a different pair.`,
        );
    }

    throw new Error(
        requestedFeeTier === "auto"
            ? `No quoted liquidity was available for this pair on ${networkLabel}. The built-in swap block currently supports only live single-pool Uniswap v3 routes. Try a different pair, a smaller amount, or Base mainnet. Details: ${quoteErrors.join(" | ")}`
            : `No quoted liquidity was available for the selected fee tier on ${networkLabel}. Try Auto fee, a different pair, or a smaller amount. Details: ${quoteErrors.join(" | ")}`,
    );
}

export async function buildUniswapExactInputPreview(args: {
    tokenIn: unknown;
    tokenOut: unknown;
    amountIn: unknown;
    feeTier: unknown;
    slippageBps?: unknown;
    walletAddress?: Address;
    networkId?: NetworkId;
}): Promise<UniswapExactInputPreview> {
    const resolvedNetworkId = args.networkId ?? getActiveNetwork().networkId;
    const [tokenInSelection, tokenOutSelection] = await Promise.all([
        resolveSwapTokenSelection(args.tokenIn, resolvedNetworkId),
        resolveSwapTokenSelection(args.tokenOut, resolvedNetworkId),
    ]);
    const amountInDisplay = String(args.amountIn ?? "").trim();
    const requestedFeeTier = parseRequestedFeeTier(args.feeTier);
    const requestedSlippage = parseRequestedSlippage(args.slippageBps);
    const slippageBps = resolveRequestedSlippageBps(requestedSlippage, 50);

    if (!amountInDisplay) {
        throw new Error("Enter an amount to preview this swap.");
    }

    if (
        tokenInSelection.token.address.toLowerCase()
        === tokenOutSelection.token.address.toLowerCase()
    ) {
        throw new Error("Pay With and Receive must be different tokens.");
    }

    const amountInRaw = await parseTokenAmountWithReference(
        amountInDisplay,
        String(args.tokenIn ?? "WETH"),
        resolvedNetworkId,
    );
    const {
        amountOut,
        feeTier,
        initializedTicksCrossed,
        gasEstimate,
    } = await resolveQuotedSinglePoolRoute(
        tokenInSelection.token.address,
        tokenOutSelection.token.address,
        amountInRaw,
        requestedFeeTier,
        resolvedNetworkId,
    );
    const amountOutMinimumRaw = (amountOut * BigInt(10_000 - slippageBps)) / BigInt(10_000);
    const router = UNISWAP_V3_NETWORKS[resolvedNetworkId].swapRouter02;
    let requiresApproval: boolean | null = null;

    if (args.walletAddress) {
        const client = getPublicClient(resolvedNetworkId);
        const allowance = await client.readContract({
            address: tokenInSelection.token.address,
            abi: ERC20_ABI,
            functionName: "allowance",
            args: [args.walletAddress, router],
        });
        requiresApproval = allowance < amountInRaw;
    }

    return {
        networkId: resolvedNetworkId,
        tokenInSelection,
        tokenOutSelection,
        amountInDisplay,
        amountInRaw,
        quotedAmountOut: formatUnits(amountOut, tokenOutSelection.token.decimals),
        quotedAmountOutRaw: amountOut,
        amountOutMinimum: formatUnits(amountOutMinimumRaw, tokenOutSelection.token.decimals),
        amountOutMinimumRaw,
        feeTier,
        requestedFeeTier,
        requestedSlippage,
        slippageBps,
        initializedTicksCrossed,
        gasEstimate,
        router,
        requiresApproval,
        nativeInput: tokenInSelection.isNativeEth,
        nativeOutput: tokenOutSelection.isNativeEth,
        quoteTimestamp: Date.now(),
    };
}
