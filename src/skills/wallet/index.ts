/* ==========================================================================
   Skills — Wallet (CDP-Free)
   Uses viem public client for read operations. Write operations (send_eth,
   send_token) return unsigned transaction data that the client-side wallet
   (Base Account / Smart Wallet) signs and submits.

   Actions: get_balance, send_eth, send_token, details
   ========================================================================== */

import type { ISkill, SkillResult, SkillActionMeta } from "../types";
import type { VariableContext } from "@/engine/types";
import { resolveWalletAddress } from "../helpers";
import { skillRegistry } from "../registry";
import {
    getBalance,
    getETHBalance,
    getTokenMetadata,
    getPublicClient,
    getRegisteredTokenBalances,
    parseTokenAmount,
    parseTokenAmountWithReference,
} from "@/lib/viem-client";
import {
    getActiveNetwork,
    isNativeETH,
    ERC20_ABI,
    NETWORKS,
    type NetworkId,
} from "@/lib/chain-config";
import {
    encodeFunctionData,
    formatEther,
    BaseError,
    ContractFunctionRevertedError,
    type Address,
} from "viem";
import { createPreparedTransactionOutput } from "@/lib/transaction-output";
import {
    looksLikeResolvableName,
    resolveAddressOrName,
    resolveAddressForName,
    resolveBasenameForAddress,
} from "@/lib/basename";

function readBooleanParam(value: unknown, defaultValue: boolean): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (!normalized) return defaultValue;
        if (["true", "1", "yes"].includes(normalized)) return true;
        if (["false", "0", "no"].includes(normalized)) return false;
    }
    return defaultValue;
}

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

// ---------------------------------------------------------------------------
// Action Implementations
// ---------------------------------------------------------------------------

async function executeGetBalance(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    const walletAddress = resolveWalletAddress(params, context);
    if (!walletAddress) {
        return { success: false, error: "No wallet address available. Connect your wallet first." };
    }

    try {
        const token = String(params.token ?? "ETH");
        const result = await getBalance(token, walletAddress, context.networkId);

        return {
            success: true,
            data: {
                walletAddress,
                balance: result.balance,
                symbol: result.symbol,
                decimals: result.decimals,
            },
            message: `${result.symbol} Balance: ${result.balance}`,
        };
    } catch (err) {
        return {
            success: false,
            error: `Failed to get balance: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

async function executeSendEth(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    const walletAddress = resolveWalletAddress(params, context);
    if (!walletAddress) {
        return { success: false, error: "No wallet address available. Connect your wallet first." };
    }

    try {
        const rawTo = String(params.to ?? params.destination ?? "").trim();
        const amount = String(params.amount ?? params.value ?? "0");
        const networkId = context.networkId ?? getActiveNetwork().networkId;
        const to = rawTo ? await resolveAddressOrName(rawTo, networkId) : undefined;

        if (!to) {
            return {
                success: false,
                error: looksLikeResolvableName(rawTo)
                    ? `Could not resolve "${rawTo}" to a wallet address.`
                    : "Invalid destination address",
            };
        }

        const value = parseTokenAmount(amount, "ETH");
        const description = `Send ${amount} ETH to ${to}`;
        const client = getPublicClient(networkId);
        const ethBalance = await getETHBalance(walletAddress, networkId);

        if (ethBalance.balanceRaw < value) {
            return {
                success: false,
                error: `Not enough ETH. Wallet balance is ${ethBalance.balance} ETH but this transfer needs ${amount} ETH.`,
            };
        }

        if (ethBalance.balanceRaw === value) {
            return {
                success: false,
                error: "Leave a small amount of ETH for gas before sending your full native ETH balance.",
            };
        }

        try {
            const [estimatedGas, estimatedFees] = await Promise.all([
                client.estimateGas({
                    account: walletAddress,
                    to,
                    value,
                    data: "0x",
                }),
                client.estimateFeesPerGas(),
            ]);
            const estimatedGasCost = estimatedGas * resolveEstimatedFeePerGas(estimatedFees);
            if (ethBalance.balanceRaw < value + estimatedGasCost) {
                return {
                    success: false,
                    error: `Not enough ETH to cover both the transfer and gas. This transfer needs ${amount} ETH plus about ${formatEther(estimatedGasCost)} ETH for gas.`,
                };
            }
        } catch (error) {
            return {
                success: false,
                error: formatPreparationError("ETH transfer simulation failed", error),
            };
        }

        // Return prepared transaction data for client-side signing
        // The executor/UI layer will handle wallet_sendCalls
        return {
            success: true,
            data: createPreparedTransactionOutput(networkId, {
                calls: [
                    {
                        to,
                        value: `0x${value.toString(16)}`,
                        data: "0x",
                    },
                ],
                description,
                summary: description,
                protocol: "wallet",
                action: "send_eth",
            }),
            message: `Prepared: ${description}`,
        };
    } catch (err) {
        return {
            success: false,
            error: `Failed to prepare ETH transfer: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

async function executeSendToken(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    const walletAddress = resolveWalletAddress(params, context);
    if (!walletAddress) {
        return { success: false, error: "No wallet address available. Connect your wallet first." };
    }

    try {
        const token = String(params.token ?? "USDC");
        const rawTo = String(params.to ?? params.destination ?? "").trim();
        const amount = String(params.amount ?? "0");
        const networkId = context.networkId ?? getActiveNetwork().networkId;
        const to = rawTo ? await resolveAddressOrName(rawTo, networkId) : undefined;

        if (!to) {
            return {
                success: false,
                error: looksLikeResolvableName(rawTo)
                    ? `Could not resolve "${rawTo}" to a wallet address.`
                    : "Invalid destination address",
            };
        }

        if (isNativeETH(token)) {
            return executeSendEth(
                { ...params, to, amount },
                context,
            );
        }

        const tokenMetadata = await getTokenMetadata(token, networkId);
        const rawAmount = await parseTokenAmountWithReference(amount, token, networkId);
        const client = getPublicClient(networkId);
        const [tokenBalance, ethBalance] = await Promise.all([
            getBalance(tokenMetadata.address, walletAddress, networkId),
            getETHBalance(walletAddress, networkId),
        ]);

        if (tokenBalance.balanceRaw < rawAmount) {
            return {
                success: false,
                error: `Not enough ${tokenMetadata.symbol}. Wallet balance is ${tokenBalance.balance} ${tokenMetadata.symbol} but this transfer needs ${amount} ${tokenMetadata.symbol}.`,
            };
        }

        if (ethBalance.balanceRaw === BigInt(0)) {
            return {
                success: false,
                error: "Your wallet has no ETH for gas on the selected Base network. Keep some ETH before sending tokens.",
            };
        }

        try {
            const [simulation, estimatedGas, estimatedFees] = await Promise.all([
                client.simulateContract({
                    address: tokenMetadata.address,
                    abi: ERC20_ABI,
                    functionName: "transfer",
                    args: [to, rawAmount],
                    account: walletAddress,
                }),
                client.estimateContractGas({
                    address: tokenMetadata.address,
                    abi: ERC20_ABI,
                    functionName: "transfer",
                    args: [to, rawAmount],
                    account: walletAddress,
                }),
                client.estimateFeesPerGas(),
            ]);

            const estimatedGasCost = estimatedGas * resolveEstimatedFeePerGas(estimatedFees);
            if (ethBalance.balanceRaw < estimatedGasCost) {
                return {
                    success: false,
                    error: `Not enough ETH to cover token transfer gas. This transfer needs about ${formatEther(estimatedGasCost)} ETH for gas on the selected Base network.`,
                };
            }

            void simulation;
        } catch (error) {
            return {
                success: false,
                error: formatPreparationError(`${tokenMetadata.symbol} transfer simulation failed`, error),
            };
        }

        const description = `Send ${amount} ${tokenMetadata.symbol} to ${to}`;

        // Encode ERC-20 transfer call
        const transferData = encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "transfer",
            args: [to, rawAmount],
        });

        return {
            success: true,
            data: createPreparedTransactionOutput(networkId, {
                calls: [
                    {
                        to: tokenMetadata.address,
                        value: "0x0",
                        data: transferData,
                    },
                ],
                description,
                summary: description,
                protocol: "wallet",
                action: "send_token",
                extras: {
                    token: tokenMetadata.symbol,
                    tokenAddress: tokenMetadata.address,
                    decimals: tokenMetadata.decimals,
                },
            }),
            message: `Prepared: ${description}`,
        };
    } catch (err) {
        return {
            success: false,
            error: `Failed to prepare token transfer: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

async function executeDetails(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    const walletAddress = resolveWalletAddress(params, context);
    if (!walletAddress) {
        return { success: false, error: "No wallet address available. Connect your wallet first." };
    }

    try {
        const networkId = context.networkId ?? getActiveNetwork().networkId;
        const network = NETWORKS[networkId];
        const client = getPublicClient(networkId);
        const includeBasename = readBooleanParam(params.includeBasename, true);

        const [ethBalance, blockNumber, tokenBalances, basename] = await Promise.all([
            getETHBalance(walletAddress, networkId),
            client.getBlockNumber(),
            getRegisteredTokenBalances(walletAddress, networkId),
            includeBasename
                ? resolveBasenameForAddress(walletAddress as Address, networkId)
                : Promise.resolve(undefined),
        ]);

        const balanceSummary = Object.fromEntries(
            [{ symbol: "ETH", balance: ethBalance.balance }, ...tokenBalances]
                .map((b) => [b.symbol, b.balance]),
        );

        const balanceLines = Object.entries(balanceSummary)
            .map(([s, b]) => `${s}: ${b}`)
            .join(", ");
        const basenameLine = basename ? `\nBasename: ${basename}` : "";

        return {
            success: true,
            data: {
                address: walletAddress,
                ...(basename ? { basename } : {}),
                network: network.label,
                networkId: network.networkId,
                chainId: network.chain.id,
                ethBalance: ethBalance.balance,
                balances: balanceSummary,
                explorerUrl: `${network.explorerUrl}/address/${walletAddress}`,
                latestBlock: blockNumber.toString(),
            },
            message: `Wallet: ${walletAddress}${basenameLine}\nNetwork: ${network.label}\nBalances: ${balanceLines}\nBlock: ${blockNumber}`,
        };
    } catch (err) {
        return {
            success: false,
            error: `Failed to get wallet overview: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

async function executeResolveBasename(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    const walletAddress = resolveWalletAddress(params, context);
    if (!walletAddress) {
        return { success: false, error: "No wallet address available. Connect your wallet first or pass an explicit address." };
    }

    try {
        const basename = await resolveBasenameForAddress(walletAddress as Address, context.networkId);

        return {
            success: true,
            data: {
                address: walletAddress,
                found: Boolean(basename),
                ...(basename ? { basename } : {}),
            },
            message: basename
                ? `Resolved basename ${basename} for ${walletAddress}.`
                : `No basename resolved for ${walletAddress}.`,
        };
    } catch (err) {
        return {
            success: false,
            error: `Basename lookup failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

async function executeResolveAddress(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    const name = String(params.name ?? "").trim();
    if (!looksLikeResolvableName(name)) {
        return {
            success: false,
            error: "Enter a valid .base.eth or ENS name to resolve.",
        };
    }

    try {
        const address = await resolveAddressForName(name, context.networkId);

        return {
            success: true,
            data: {
                name,
                found: Boolean(address),
                ...(address ? { address } : {}),
            },
            message: address
                ? `Resolved ${name} to ${address}.`
                : `No address resolved for ${name}.`,
        };
    } catch (err) {
        return {
            success: false,
            error: `Address resolution failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}



// ---------------------------------------------------------------------------
// Skill Definition
// ---------------------------------------------------------------------------

const ACTIONS: SkillActionMeta[] = [
    {
        name: "get_balance",
        label: "Get Balance",
        description:
            "Check one native ETH or ERC-20 balance. Use this when you need a single token balance.",
        params: [
            { name: "token", type: "string", required: false, description: "Token symbol or address (default: ETH)", default: "ETH" },
            { name: "address", type: "address", required: false, description: "Address to check (default: connected wallet)" },
        ],
    },
    {
        name: "send_eth",
        label: "Send ETH",
        description: "Transfer native ETH to a destination address.",
        params: [
            { name: "to", type: "address", required: true, description: "Destination address" },
            { name: "amount", type: "amount", required: true, description: "Amount in ETH (e.g. 0.01)" },
        ],
        requiresConfirmation: true,
        requiresWallet: true,
    },
    {
        name: "send_token",
        label: "Send Token",
        description:
            "Transfer ERC-20 tokens (USDC, WETH, etc.) to a destination address.",
        params: [
            { name: "to", type: "address", required: true, description: "Destination address" },
            { name: "amount", type: "amount", required: true, description: "Amount to send" },
            { name: "token", type: "string", required: false, description: "Token symbol or address (default: USDC)", default: "USDC" },
        ],
        requiresConfirmation: true,
        requiresWallet: true,
    },
    {
        name: "details",
        label: "Wallet Overview",
        description: "Get wallet address, optional basename, current network, explorer link, ETH, known token balances, and latest block number.",
        params: [
            { name: "includeBasename", type: "boolean", required: false, description: "Attempt Base/ENS reverse name lookup", default: true },
        ],
        requiresWallet: true,
    },
    {
        name: "resolve_basename",
        label: "Resolve Basename",
        description: "Best-effort reverse lookup for a Base or ENS name from a wallet address.",
        params: [
            { name: "address", type: "address", required: false, description: "Address to resolve (default: connected wallet)" },
        ],
        requiresWallet: false,
    },
    {
        name: "resolve_address",
        label: "Resolve Address",
        description: "Best-effort forward lookup for a .base.eth or ENS name.",
        params: [
            { name: "name", type: "string", required: true, description: "Basename or ENS name to resolve" },
        ],
        requiresWallet: false,
    },
];

const walletSkill: ISkill = {
    name: "wallet",
    label: "Wallet",
    category: "wallet",
    description: "Wallet operations: balance checks, ETH and token transfers.",
    actions: ACTIONS,

    async execute(
        action: string,
        params: Record<string, unknown>,
        context: VariableContext,
    ): Promise<SkillResult> {
        switch (action) {
            case "get_balance":
                return executeGetBalance(params, context);
            case "send_eth":
                return executeSendEth(params, context);
            case "send_token":
                return executeSendToken(params, context);
            case "details":
                return executeDetails(params, context);
            case "resolve_basename":
                return executeResolveBasename(params, context);
            case "resolve_address":
                return executeResolveAddress(params, context);
            default:
                return { success: false, error: `Unknown wallet action "${action}"` };
        }
    },
};

// Self-register
skillRegistry.register(walletSkill);

export { walletSkill };
