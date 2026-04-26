/* ==========================================================================
   Skills — Swap
   Uniswap-focused swap quote and prepared transaction helpers for Base.
   Phase 1 intentionally supports only single-pool ERC-20 swaps.
   ========================================================================== */

import type { ISkill, SkillActionMeta, SkillResult } from "../types";
import type { VariableContext } from "@/engine/types";
import { resolveWalletAddress } from "../helpers";
import { skillRegistry } from "../registry";
import {
    ERC20_ABI,
    getActiveNetwork,
    type NetworkId,
} from "@/lib/chain-config";
import {
    getBalance,
    getETHBalance,
    getPublicClient,
} from "@/lib/viem-client";
import { createPreparedTransactionOutput } from "@/lib/transaction-output";
import {
    BaseError,
    ContractFunctionRevertedError,
    encodeFunctionData,
    formatEther,
    formatUnits,
    type Address,
} from "viem";
import type { TokenMetadataResult } from "@/lib/viem-client";
import {
    buildUniswapExactInputPreview,
    resolveErc20Metadata,
    UNISWAP_V3_NETWORKS,
} from "@/lib/uniswap-v3";

const SWAP_ROUTER_02_ABI = [
    {
        inputs: [{ internalType: "bytes[]", name: "data", type: "bytes[]" }],
        name: "multicall",
        outputs: [{ internalType: "bytes[]", name: "results", type: "bytes[]" }],
        stateMutability: "payable",
        type: "function",
    },
    {
        inputs: [
            { internalType: "uint256", name: "amountMinimum", type: "uint256" },
            { internalType: "address", name: "recipient", type: "address" },
        ],
        name: "unwrapWETH9",
        outputs: [],
        stateMutability: "payable",
        type: "function",
    },
    {
        inputs: [
            {
                components: [
                    { internalType: "address", name: "tokenIn", type: "address" },
                    { internalType: "address", name: "tokenOut", type: "address" },
                    { internalType: "uint24", name: "fee", type: "uint24" },
                    { internalType: "address", name: "recipient", type: "address" },
                    { internalType: "uint256", name: "amountIn", type: "uint256" },
                    { internalType: "uint256", name: "amountOutMinimum", type: "uint256" },
                    { internalType: "uint160", name: "sqrtPriceLimitX96", type: "uint160" },
                ],
                internalType: "struct IV3SwapRouter.ExactInputSingleParams",
                name: "params",
                type: "tuple",
            },
        ],
        name: "exactInputSingle",
        outputs: [{ internalType: "uint256", name: "amountOut", type: "uint256" }],
        stateMutability: "payable",
        type: "function",
    },
] as const;

// Uniswap router SDK uses this sentinel recipient when the router must custody
// output temporarily before unwrap/sweep steps in the same multicall.
const UNISWAP_ROUTER_ADDRESS_THIS = "0x0000000000000000000000000000000000000002" as const;

const WETH_ABI = [
    {
        inputs: [],
        name: "deposit",
        outputs: [],
        stateMutability: "payable",
        type: "function",
    },
    {
        inputs: [{ internalType: "uint256", name: "wad", type: "uint256" }],
        name: "withdraw",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
] as const;

const NONFUNGIBLE_POSITION_MANAGER_ABI = [
    {
        inputs: [{ internalType: "address", name: "owner", type: "address" }],
        name: "balanceOf",
        outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [
            { internalType: "address", name: "owner", type: "address" },
            { internalType: "uint256", name: "index", type: "uint256" },
        ],
        name: "tokenOfOwnerByIndex",
        outputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
        name: "positions",
        outputs: [
            { internalType: "uint96", name: "nonce", type: "uint96" },
            { internalType: "address", name: "operator", type: "address" },
            { internalType: "address", name: "token0", type: "address" },
            { internalType: "address", name: "token1", type: "address" },
            { internalType: "uint24", name: "fee", type: "uint24" },
            { internalType: "int24", name: "tickLower", type: "int24" },
            { internalType: "int24", name: "tickUpper", type: "int24" },
            { internalType: "uint128", name: "liquidity", type: "uint128" },
            { internalType: "uint256", name: "feeGrowthInside0LastX128", type: "uint256" },
            { internalType: "uint256", name: "feeGrowthInside1LastX128", type: "uint256" },
            { internalType: "uint128", name: "tokensOwed0", type: "uint128" },
            { internalType: "uint128", name: "tokensOwed1", type: "uint128" },
        ],
        stateMutability: "view",
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

const MAX_UINT128 = (BigInt(1) << BigInt(128)) - BigInt(1);

function resolveEstimatedFeePerGas(
    fees: Awaited<ReturnType<ReturnType<typeof getPublicClient>["estimateFeesPerGas"]>>,
): bigint {
    return fees.maxFeePerGas ?? fees.gasPrice ?? BigInt(0);
}

function formatPreparationError(prefix: string, error: unknown): string {
    if (error instanceof BaseError) {
        const revertError = error.walk((current) => current instanceof ContractFunctionRevertedError);
        if (revertError instanceof ContractFunctionRevertedError) {
            const reason =
                revertError.data?.errorName ??
                revertError.shortMessage ??
                revertError.message;
            return `${prefix}: ${reason}`;
        }
    }

    return `${prefix}: ${error instanceof Error ? error.message : String(error)}`;
}

async function ensureSpendableInputBalance(args: {
    walletAddress: Address;
    tokenIn: TokenMetadataResult;
    tokenInDisplaySymbol: string;
    isNativeEth: boolean;
    amountInRaw: bigint;
    amountInDisplay: string;
    networkId?: NetworkId;
}): Promise<void> {
    const {
        walletAddress,
        tokenIn,
        tokenInDisplaySymbol,
        isNativeEth,
        amountInRaw,
        amountInDisplay,
        networkId,
    } = args;

    if (isNativeEth) {
        const ethBalance = await getETHBalance(walletAddress, networkId);
        if (ethBalance.balanceRaw < amountInRaw) {
            throw new Error(
                `Not enough ETH. Wallet balance is ${ethBalance.balance} ETH but this swap needs ${amountInDisplay} ETH.`,
            );
        }

        if (ethBalance.balanceRaw === amountInRaw) {
            throw new Error(
                "Leave a small amount of ETH for gas before swapping your full native ETH balance.",
            );
        }

        return;
    }

    const [tokenBalance, ethBalance] = await Promise.all([
        getBalance(tokenIn.address, walletAddress, networkId),
        getETHBalance(walletAddress, networkId),
    ]);

    if (tokenBalance.balanceRaw < amountInRaw) {
        throw new Error(
            `Not enough ${tokenInDisplaySymbol}. Wallet balance is ${tokenBalance.balance} ${tokenInDisplaySymbol} but this swap needs ${amountInDisplay} ${tokenInDisplaySymbol}.`,
        );
    }

    if (ethBalance.balanceRaw === BigInt(0)) {
        throw new Error(
            "Your wallet has no ETH for gas on the selected Base network. Keep some ETH before sending tokens or swapping.",
        );
    }
}

async function executeUniswapQuote(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    const nid = context.networkId;
    try {
        const preview = await buildUniswapExactInputPreview({
            tokenIn: params.tokenIn ?? "WETH",
            tokenOut: params.tokenOut ?? "USDC",
            amountIn: params.amountIn ?? params.amount ?? "",
            feeTier: params.feeTier,
            networkId: nid,
        });

        return {
            success: true,
            data: {
                description: "Quote ready",
                tokenIn: preview.tokenInSelection.displaySymbol,
                tokenOut: preview.tokenOutSelection.displaySymbol,
                amountIn: preview.amountInDisplay,
                amountInRaw: preview.amountInRaw.toString(),
                amountOut: preview.quotedAmountOut,
                amountOutRaw: preview.quotedAmountOutRaw.toString(),
                feeTier: preview.feeTier,
                requestedFeeTier: preview.requestedFeeTier === "auto"
                    ? undefined
                    : preview.requestedFeeTier,
                initializedTicksCrossed: preview.initializedTicksCrossed,
                gasEstimate: preview.gasEstimate.toString(),
                summary: `Estimated receive ${preview.quotedAmountOut} ${preview.tokenOutSelection.displaySymbol} for ${preview.amountInDisplay} ${preview.tokenInSelection.displaySymbol}`,
            },
            message: `Quote ready — estimated receive ${preview.quotedAmountOut} ${preview.tokenOutSelection.displaySymbol} via ${preview.feeTier / 10000}% pool`,
        };
    } catch (err) {
        return {
            success: false,
            error: `Uniswap quote failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

async function executeUniswapPrepare(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    const walletAddress = resolveWalletAddress(params, context);
    if (!walletAddress) {
        return { success: false, error: "No wallet address available. Connect your wallet first." };
    }

    try {
        const nid = context.networkId;
        const preview = await buildUniswapExactInputPreview({
            tokenIn: params.tokenIn ?? "WETH",
            tokenOut: params.tokenOut ?? "USDC",
            amountIn: params.amountIn ?? params.amount ?? "",
            feeTier: params.feeTier,
            slippageBps: params.slippageBps,
            walletAddress,
            networkId: nid,
        });

        await ensureSpendableInputBalance({
            walletAddress,
            tokenIn: preview.tokenInSelection.token,
            tokenInDisplaySymbol: preview.tokenInSelection.displaySymbol,
            isNativeEth: preview.tokenInSelection.isNativeEth,
            amountInRaw: preview.amountInRaw,
            amountInDisplay: preview.amountInDisplay,
            networkId: nid,
        });

        const resolvedNetworkId = nid ?? getActiveNetwork().networkId;
        const addresses = UNISWAP_V3_NETWORKS[resolvedNetworkId];
        const calls: Array<{ to: Address; value: string; data: `0x${string}` }> = [];
        const requiresApproval = preview.requiresApproval ?? true;

        if (preview.tokenInSelection.isNativeEth) {
            const wrapData = encodeFunctionData({
                abi: WETH_ABI,
                functionName: "deposit",
                args: [],
            });
            calls.push({
                to: preview.tokenInSelection.token.address,
                value: `0x${preview.amountInRaw.toString(16)}`,
                data: wrapData,
            });
        }

        if (requiresApproval) {
            const approveData = encodeFunctionData({
                abi: ERC20_ABI,
                functionName: "approve",
                args: [addresses.swapRouter02, preview.amountInRaw],
            });
            calls.push({
                to: preview.tokenInSelection.token.address,
                value: "0x0",
                data: approveData,
            });
        }

        const exactInputSingleData = encodeFunctionData({
            abi: SWAP_ROUTER_02_ABI,
            functionName: "exactInputSingle",
            args: [{
                tokenIn: preview.tokenInSelection.token.address,
                tokenOut: preview.tokenOutSelection.token.address,
                fee: preview.feeTier,
                recipient: preview.tokenOutSelection.isNativeEth
                    ? UNISWAP_ROUTER_ADDRESS_THIS
                    : walletAddress,
                amountIn: preview.amountInRaw,
                amountOutMinimum: preview.amountOutMinimumRaw,
                sqrtPriceLimitX96: BigInt(0),
            }],
        });

        if (preview.tokenOutSelection.isNativeEth) {
            const unwrapData = encodeFunctionData({
                abi: SWAP_ROUTER_02_ABI,
                functionName: "unwrapWETH9",
                args: [preview.amountOutMinimumRaw, walletAddress],
            });
            const multicallData = encodeFunctionData({
                abi: SWAP_ROUTER_02_ABI,
                functionName: "multicall",
                args: [[exactInputSingleData, unwrapData]],
            });
            calls.push({
                to: addresses.swapRouter02,
                value: "0x0",
                data: multicallData,
            });
        } else {
            calls.push({
                to: addresses.swapRouter02,
                value: "0x0",
                data: exactInputSingleData,
            });
        }

        if (calls.length === 1) {
            try {
                const client = getPublicClient(resolvedNetworkId);
                const call = calls[0];
                const callValue = call.value ? BigInt(call.value) : BigInt(0);
                const [ethBalance, estimatedGas, estimatedFees] = await Promise.all([
                    getETHBalance(walletAddress, resolvedNetworkId),
                    client.estimateGas({
                        account: walletAddress,
                        to: call.to,
                        data: call.data,
                        value: callValue,
                    }),
                    client.estimateFeesPerGas(),
                ]);

                const estimatedGasCost = estimatedGas * resolveEstimatedFeePerGas(estimatedFees);
                if (ethBalance.balanceRaw < estimatedGasCost + callValue) {
                    return {
                        success: false,
                        error: `Not enough ETH to cover swap gas. This swap needs about ${formatEther(estimatedGasCost)} ETH for gas on the selected Base network.`,
                    };
                }
            } catch (error) {
                return {
                    success: false,
                    error: formatPreparationError("Swap transaction simulation failed", error),
                };
            }
        }

        const summary = `Pay ${preview.amountInDisplay} ${preview.tokenInSelection.displaySymbol} to receive an estimated ${preview.quotedAmountOut} ${preview.tokenOutSelection.displaySymbol} with a minimum of ${preview.amountOutMinimum} ${preview.tokenOutSelection.displaySymbol}`;

        return {
            success: true,
            data: createPreparedTransactionOutput(resolvedNetworkId, {
                calls,
                description: requiresApproval ? "Swap ready for approval" : "Swap ready",
                summary,
                protocol: "uniswap",
                action: "exact_input_single",
                extras: {
                    tokenIn: preview.tokenInSelection.displaySymbol,
                    tokenOut: preview.tokenOutSelection.displaySymbol,
                    amountIn: preview.amountInDisplay,
                    amountOutMinimum: preview.amountOutMinimum,
                    quotedAmountOut: preview.quotedAmountOut,
                    feeTier: preview.feeTier,
                    requestedFeeTier: preview.requestedFeeTier === "auto"
                        ? undefined
                        : preview.requestedFeeTier,
                    slippageBps: preview.slippageBps,
                    router: addresses.swapRouter02,
                    nativeInput: preview.tokenInSelection.isNativeEth,
                    nativeOutput: preview.tokenOutSelection.isNativeEth,
                    requiresApproval,
                },
            }),
            message: requiresApproval
                ? `Swap ready for approval — pay ${preview.amountInDisplay} ${preview.tokenInSelection.displaySymbol} via ${preview.feeTier / 10000}% pool`
                : `Swap ready — pay ${preview.amountInDisplay} ${preview.tokenInSelection.displaySymbol} via ${preview.feeTier / 10000}% pool`,
        };
    } catch (err) {
        return {
            success: false,
            error: `Uniswap swap preparation failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

async function executeUniswapCollectFees(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    const walletAddress = resolveWalletAddress(params, context);
    if (!walletAddress) {
        return { success: false, error: "No wallet address available. Connect your wallet first." };
    }

    try {
        const tokenId = String(params.tokenId ?? "").trim();
        if (!tokenId) {
            return { success: false, error: "Token ID is required." };
        }

        const recipient = String(params.recipient ?? walletAddress).trim();
        if (!recipient.startsWith("0x")) {
            return { success: false, error: "Recipient must be a valid 0x address." };
        }

        const nid = context.networkId;
        const resolvedNetworkId = nid ?? getActiveNetwork().networkId;
        const addresses = UNISWAP_V3_NETWORKS[resolvedNetworkId];
        const client = getPublicClient(nid);

        const position = await client.readContract({
            address: addresses.positionManager,
            abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
            functionName: "positions",
            args: [BigInt(tokenId)],
        }) as readonly [bigint, Address, Address, Address, number, number, number, bigint, bigint, bigint, bigint, bigint];

        const [token0Meta, token1Meta] = await Promise.all([
            resolveErc20Metadata(position[2], nid),
            resolveErc20Metadata(position[3], nid),
        ]);

        const collectData = encodeFunctionData({
            abi: [
                {
                    inputs: [{
                        components: [
                            { internalType: "uint256", name: "tokenId", type: "uint256" },
                            { internalType: "address", name: "recipient", type: "address" },
                            { internalType: "uint128", name: "amount0Max", type: "uint128" },
                            { internalType: "uint128", name: "amount1Max", type: "uint128" },
                        ],
                        internalType: "struct INonfungiblePositionManager.CollectParams",
                        name: "params",
                        type: "tuple",
                    }],
                    name: "collect",
                    outputs: [
                        { internalType: "uint256", name: "amount0", type: "uint256" },
                        { internalType: "uint256", name: "amount1", type: "uint256" },
                    ],
                    stateMutability: "payable",
                    type: "function",
                },
            ] as const,
            functionName: "collect",
            args: [{
                tokenId: BigInt(tokenId),
                recipient: recipient as Address,
                amount0Max: MAX_UINT128,
                amount1Max: MAX_UINT128,
            }],
        });

        const description = `Collect fees from Uniswap position #${tokenId}`;

        return {
            success: true,
            data: createPreparedTransactionOutput(resolvedNetworkId, {
                calls: [{
                    to: addresses.positionManager,
                    value: "0x0",
                    data: collectData,
                }],
                description,
                summary: description,
                protocol: "uniswap",
                action: "collect_fees",
                extras: {
                    tokenId,
                    recipient,
                    pairLabel: `${token0Meta.symbol}/${token1Meta.symbol}`,
                    tokensOwed0: formatUnits(position[10], token0Meta.decimals),
                    tokensOwed1: formatUnits(position[11], token1Meta.decimals),
                },
            }),
            message: `Prepared: Collect fees from position #${tokenId}`,
        };
    } catch (err) {
        return {
            success: false,
            error: `Uniswap fee collection preparation failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

async function executeUniswapPositions(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    const walletAddress = resolveWalletAddress(params, context);
    if (!walletAddress) {
        return { success: false, error: "No wallet address available. Connect your wallet first." };
    }

    try {
        const nid = context.networkId;
        const resolvedNetworkId = nid ?? getActiveNetwork().networkId;
        const addresses = UNISWAP_V3_NETWORKS[resolvedNetworkId];
        const client = getPublicClient(nid);
        const maxPositions = Math.max(1, Math.min(20, Number(params.maxPositions ?? 5)));

        const rawBalance = await client.readContract({
            address: addresses.positionManager,
            abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
            functionName: "balanceOf",
            args: [walletAddress],
        }) as bigint;

        const totalCount = Number(rawBalance);
        if (totalCount === 0) {
            return {
                success: true,
                data: {
                    positions: [],
                    summary: {
                        positionCount: 0,
                        hasActiveLiquidity: false,
                    },
                },
                message: "No Uniswap positions found for the connected wallet.",
            };
        }

        const limit = Math.min(totalCount, maxPositions);
        const tokenIds = await Promise.all(
            Array.from({ length: limit }, (_, index) =>
                client.readContract({
                    address: addresses.positionManager,
                    abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
                    functionName: "tokenOfOwnerByIndex",
                    args: [walletAddress, BigInt(index)],
                }) as Promise<bigint>
            )
        );

        const positions = await Promise.all(tokenIds.map(async (tokenId) => {
            const position = await client.readContract({
                address: addresses.positionManager,
                abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
                functionName: "positions",
                args: [tokenId],
            }) as readonly [bigint, Address, Address, Address, number, number, number, bigint, bigint, bigint, bigint, bigint];

            const token0MetaPromise = resolveErc20Metadata(position[2], nid);
            const token1MetaPromise = resolveErc20Metadata(position[3], nid);
            const poolAddressPromise = client.readContract({
                address: addresses.factory,
                abi: V3_FACTORY_ABI,
                functionName: "getPool",
                args: [position[2], position[3], position[4]],
            }) as Promise<Address>;

            const [token0Meta, token1Meta, poolAddress] = await Promise.all([
                token0MetaPromise,
                token1MetaPromise,
                poolAddressPromise,
            ]);

            return {
                tokenId: tokenId.toString(),
                poolAddress,
                feeTier: position[4],
                tickLower: position[5],
                tickUpper: position[6],
                liquidity: position[7].toString(),
                tokensOwed0: formatUnits(position[10], token0Meta.decimals),
                tokensOwed1: formatUnits(position[11], token1Meta.decimals),
                token0: token0Meta,
                token1: token1Meta,
                pairLabel: `${token0Meta.symbol}/${token1Meta.symbol}`,
            };
        }));

        return {
            success: true,
            data: {
                positions,
                summary: {
                    positionCount: totalCount,
                    returnedPositionCount: positions.length,
                    hasActiveLiquidity: positions.some((position) => position.liquidity !== "0"),
                },
            },
            message: `Found ${positions.length} Uniswap position(s) for the connected wallet.`,
        };
    } catch (err) {
        return {
            success: false,
            error: `Uniswap positions fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

const ACTIONS: SkillActionMeta[] = [
    {
        name: "uniswap_quote",
        label: "Uniswap Quote",
        description: "Get a single-pool Uniswap v3 quote for a Base token pair using token symbols or contract addresses.",
        params: [
            { name: "tokenIn", type: "string", required: true, description: "Input token symbol or contract address" },
            { name: "tokenOut", type: "string", required: true, description: "Output token symbol or contract address" },
            { name: "amountIn", type: "amount", required: true, description: "Exact input amount" },
            { name: "feeTier", type: "string", required: false, description: "Pool fee tier: auto, 500, 3000, or 10000", default: "auto" },
        ],
    },
    {
        name: "uniswap_prepare_swap",
        label: "Uniswap Prepare Swap",
        description: "Prepare approve + exactInputSingle calls for a Base token swap using token symbols or contract addresses.",
        params: [
            { name: "tokenIn", type: "string", required: true, description: "Input token symbol or contract address" },
            { name: "tokenOut", type: "string", required: true, description: "Output token symbol or contract address" },
            { name: "amountIn", type: "amount", required: true, description: "Exact input amount" },
            { name: "feeTier", type: "string", required: false, description: "Pool fee tier: auto, 500, 3000, or 10000", default: "auto" },
            { name: "slippageBps", type: "string", required: false, description: "Max slippage: auto (0.5% default) or custom basis points such as 50, 100, or 500", default: "auto" },
        ],
        requiresConfirmation: true,
        requiresWallet: true,
    },
    {
        name: "uniswap_positions",
        label: "Uniswap Positions",
        description: "Read Uniswap v3 LP NFT positions for the connected wallet on Base.",
        params: [
            { name: "maxPositions", type: "number", required: false, description: "Maximum number of positions to return", default: 5 },
        ],
        requiresWallet: true,
    },
    {
        name: "uniswap_collect_fees",
        label: "Uniswap Collect Fees",
        description: "Prepare a fee collection transaction for a Uniswap v3 LP position NFT.",
        params: [
            { name: "tokenId", type: "string", required: true, description: "Uniswap LP NFT token ID" },
            { name: "recipient", type: "address", required: false, description: "Recipient address (defaults to connected wallet)" },
        ],
        requiresConfirmation: true,
        requiresWallet: true,
    },
];

const swapSkill: ISkill = {
    name: "swap",
    label: "Swap",
    category: "swap",
    description: "Uniswap-focused token swap quote and preparation tools for Base.",
    actions: ACTIONS,

    async execute(
        action: string,
        params: Record<string, unknown>,
        context: VariableContext,
    ): Promise<SkillResult> {
        switch (action) {
            case "uniswap_quote":
                return executeUniswapQuote(params, context);
            case "uniswap_prepare_swap":
                return executeUniswapPrepare(params, context);
            case "uniswap_positions":
                return executeUniswapPositions(params, context);
            case "uniswap_collect_fees":
                return executeUniswapCollectFees(params, context);
            default:
                return { success: false, error: `Unknown swap action "${action}"` };
        }
    },
};

skillRegistry.register(swapSkill);

export { swapSkill };
