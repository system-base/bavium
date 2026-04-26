/* ==========================================================================
   Viem Client — Public & Wallet Client Setup
   CDP-free: uses viem directly with Base RPC endpoints.
   Replaces lib/cdp.ts and lib/agentkit.ts.
   ========================================================================== */

import {
    createPublicClient,
    fallback,
    http,
    formatEther,
    formatUnits,
    hexToString,
    parseEther,
    parseUnits,
    getAddress,
    isAddress,
    type PublicClient,
    type Address,
} from "viem";
import {
    getActiveNetwork,
    ERC20_ABI,
    NETWORKS,
    getNetworkRpcUrls,
    isNativeETH,
    getTokenInfo,
    getTokenInfoByAddress,
    getRegisteredTokens,
    type NetworkId,
    type TokenInfo,
} from "./chain-config";

// ---------------------------------------------------------------------------
// Public Client (read-only, no wallet required)
// ---------------------------------------------------------------------------

const _publicClients: Partial<Record<NetworkId, PublicClient>> = {};

/**
 * Singleton public client for read-only RPC calls.
 * This requires no API keys or wallet connection.
 */
export function getPublicClient(networkId?: NetworkId): PublicClient {
    const targetNetworkId = networkId ?? getActiveNetwork().networkId;
    const existingClient = _publicClients[targetNetworkId];
    if (existingClient) return existingClient;

    const network = NETWORKS[targetNetworkId];
    const client = createPublicClient({
        batch: {
            multicall: true,
        },
        chain: network.chain,
        transport: fallback(
            getNetworkRpcUrls(targetNetworkId).map((rpcUrl) => http(rpcUrl, {
                retryCount: 2,
                retryDelay: 250,
                timeout: 10_000,
            })),
        ),
    });
    _publicClients[targetNetworkId] = client;

    return client;
}

/**
 * Reset the public client (useful when switching networks).
 */
export function resetPublicClient(networkId?: NetworkId): void {
    if (networkId) {
        delete _publicClients[networkId];
        return;
    }

    for (const key of Object.keys(_publicClients) as NetworkId[]) {
        delete _publicClients[key];
    }
}

// ---------------------------------------------------------------------------
// Balance Operations (read-only, CDP-free)
// ---------------------------------------------------------------------------

export interface BalanceResult {
    balance: string;
    balanceRaw: bigint;
    symbol: string;
    decimals: number;
}

export interface RegisteredTokenBalanceResult {
    token: TokenInfo;
    balance: string;
    balanceRaw: bigint;
    symbol: string;
    decimals: number;
}

export interface TokenMetadataResult {
    address: Address;
    symbol: string;
    name: string;
    decimals: number;
    source: "registry" | "chain";
}

const ERC20_BYTES32_TEXT_ABI = [
    {
        inputs: [],
        name: "symbol",
        outputs: [{ name: "", type: "bytes32" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [],
        name: "name",
        outputs: [{ name: "", type: "bytes32" }],
        stateMutability: "view",
        type: "function",
    },
] as const;

async function readOptionalTokenTextMetadata(
    client: PublicClient,
    address: Address,
    field: "symbol" | "name",
): Promise<string | undefined> {
    try {
        const value = await client.readContract({
            address,
            abi: ERC20_ABI,
            functionName: field,
        });
        const normalized = value.trim();
        return normalized.length > 0 ? normalized : undefined;
    } catch {
        try {
            const rawValue = await client.readContract({
                address,
                abi: ERC20_BYTES32_TEXT_ABI,
                functionName: field,
            });
            const normalized = hexToString(rawValue, { size: 32 }).trim();
            return normalized.length > 0 ? normalized : undefined;
        } catch {
            return undefined;
        }
    }
}

/**
 * Get native ETH balance for an address.
 * Optionally specify a network; defaults to active network.
 */
export async function getETHBalance(address: Address, networkId?: NetworkId): Promise<BalanceResult> {
    const client = getPublicClient(networkId);
    const balanceRaw = await client.getBalance({ address });
    return {
        balance: formatEther(balanceRaw),
        balanceRaw,
        symbol: "ETH",
        decimals: 18,
    };
}

/**
 * Get ERC-20 token balance for an address.
 * Optionally specify a network; defaults to active network.
 */
export async function getTokenBalance(
    tokenAddress: Address,
    walletAddress: Address,
    networkId?: NetworkId,
): Promise<BalanceResult> {
    const client = getPublicClient(networkId);
    const knownToken = getTokenInfoByAddress(tokenAddress, networkId);

    if (knownToken) {
        const balanceRaw = await client.readContract({
            address: knownToken.address,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [walletAddress],
        });

        return {
            balance: formatUnits(balanceRaw, knownToken.decimals),
            balanceRaw,
            symbol: knownToken.symbol,
            decimals: knownToken.decimals,
        };
    }

    // For unknown token contracts, fetch the minimum ERC-20 metadata needed
    // alongside the balance. Registered tokens should not hit this path.
    const [balanceRaw, decimals, symbol] = await Promise.all([
        client.readContract({
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [walletAddress],
        }),
        client.readContract({
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: "decimals",
        }),
        client.readContract({
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: "symbol",
        }),
    ]);

    return {
        balance: formatUnits(balanceRaw, decimals),
        balanceRaw,
        symbol,
        decimals,
    };
}

/**
 * Get balances for all registered ERC-20 tokens on the selected network.
 * Uses a single multicall when available, with a per-token fallback if the
 * provider rejects or rate-limits multicall.
 */
export async function getRegisteredTokenBalances(
    walletAddress: Address,
    networkId?: NetworkId,
): Promise<RegisteredTokenBalanceResult[]> {
    const client = getPublicClient(networkId);
    const tokens = getRegisteredTokens(networkId).filter((token) => !isNativeETH(token.symbol));

    if (tokens.length === 0) {
        return [];
    }

    try {
        const balances = await client.multicall({
            allowFailure: true,
            contracts: tokens.map((token) => ({
                address: token.address,
                abi: ERC20_ABI,
                functionName: "balanceOf",
                args: [walletAddress],
            })),
        });

        return tokens.map((token, index) => {
            const result = balances[index];
            const balanceRaw = result.status === "success" ? BigInt(result.result) : BigInt(0);

            return {
                token,
                balance: formatUnits(balanceRaw, token.decimals),
                balanceRaw,
                symbol: token.symbol,
                decimals: token.decimals,
            };
        });
    } catch {
        const fallbackBalances = await Promise.all(
            tokens.map(async (token) => {
                try {
                    const balanceRaw = await client.readContract({
                        address: token.address,
                        abi: ERC20_ABI,
                        functionName: "balanceOf",
                        args: [walletAddress],
                    });

                    return {
                        token,
                        balance: formatUnits(balanceRaw, token.decimals),
                        balanceRaw,
                        symbol: token.symbol,
                        decimals: token.decimals,
                    } satisfies RegisteredTokenBalanceResult;
                } catch {
                    return {
                        token,
                        balance: "0",
                        balanceRaw: BigInt(0),
                        symbol: token.symbol,
                        decimals: token.decimals,
                    } satisfies RegisteredTokenBalanceResult;
                }
            }),
        );

        return fallbackBalances;
    }
}

/**
 * Get balance for a token symbol or address.
 * Resolves "ETH" to native balance, others to ERC-20.
 * Optionally specify a network; defaults to active network.
 */
export async function getBalance(
    tokenSymbolOrAddress: string,
    walletAddress: Address,
    networkId?: NetworkId,
): Promise<BalanceResult> {
    if (isNativeETH(tokenSymbolOrAddress)) {
        return getETHBalance(walletAddress, networkId);
    }

    // Resolve symbol to address using the correct network
    const tokenInfo = getTokenInfo(tokenSymbolOrAddress, networkId);
    const tokenAddr = tokenInfo?.address
        ?? (tokenSymbolOrAddress.startsWith("0x")
            ? (tokenSymbolOrAddress as Address)
            : undefined);

    if (!tokenAddr) {
        throw new Error(
            `Unknown token "${tokenSymbolOrAddress}". Use a known symbol or provide a valid token contract address.`,
        );
    }

    return getTokenBalance(tokenAddr, walletAddress, networkId);
}

/**
 * Resolve a token symbol or contract address into displayable token metadata.
 * Reads unknown ERC-20 metadata directly from the appropriate Base RPC.
 * Optionally specify a network; defaults to active network.
 */
export async function getTokenMetadata(
    tokenSymbolOrAddress: string,
    networkId?: NetworkId,
): Promise<TokenMetadataResult> {
    const tokenInfo = getTokenInfo(tokenSymbolOrAddress, networkId);
    if (tokenInfo) {
        return {
            address: tokenInfo.address,
            symbol: tokenInfo.symbol,
            name: tokenInfo.name,
            decimals: tokenInfo.decimals,
            source: "registry",
        };
    }

    if (!isAddress(tokenSymbolOrAddress)) {
        throw new Error("Enter a valid Base token contract address.");
    }

    const resolvedNetworkId = networkId ?? getActiveNetwork().networkId;
    const activeNetwork = NETWORKS[resolvedNetworkId];
    const normalizedAddress = getAddress(tokenSymbolOrAddress);
    const registeredToken = getTokenInfoByAddress(normalizedAddress, resolvedNetworkId);
    if (registeredToken) {
        return {
            address: registeredToken.address,
            symbol: registeredToken.symbol,
            name: registeredToken.name,
            decimals: registeredToken.decimals,
            source: "registry",
        };
    }

    const client = getPublicClient(resolvedNetworkId);
    const bytecode = await client.getBytecode({ address: normalizedAddress });
    if (!bytecode || bytecode === "0x") {
        const alternateNetworkId: NetworkId =
            resolvedNetworkId === "base-mainnet"
                ? "base-sepolia"
                : "base-mainnet";
        const alternateBytecode = await getPublicClient(alternateNetworkId)
            .getBytecode({ address: normalizedAddress })
            .catch(() => null);

        if (alternateBytecode && alternateBytecode !== "0x") {
            throw new Error(
                `No contract found at ${normalizedAddress} on ${activeNetwork.label}. This address appears to be deployed on ${NETWORKS[alternateNetworkId].label}.`,
            );
        }

        throw new Error(
            `No contract found at ${normalizedAddress} on ${activeNetwork.label}. Check the token address or selected network.`,
        );
    }

    let decimals: number;
    try {
        decimals = await client.readContract({
            address: normalizedAddress,
            abi: ERC20_ABI,
            functionName: "decimals",
        });
    } catch {
        throw new Error(
            `Could not read ERC-20 decimals from ${normalizedAddress} on ${activeNetwork.label}. The contract may not be a standard ERC-20 token.`,
        );
    }
    const [symbol, name] = await Promise.all([
        readOptionalTokenTextMetadata(client, normalizedAddress, "symbol"),
        readOptionalTokenTextMetadata(client, normalizedAddress, "name"),
    ]);

    const fallbackSymbol = symbol || `${normalizedAddress.slice(0, 6)}…${normalizedAddress.slice(-4)}`;
    const fallbackName = name || symbol || "Unknown token";

    return {
        address: normalizedAddress,
        symbol: fallbackSymbol,
        name: fallbackName,
        decimals,
        source: "chain",
    };
}

/**
 * Resolve token decimals from a known symbol or contract address.
 * ETH is treated as 18 decimals.
 * Optionally specify a network; defaults to active network.
 */
export async function getTokenDecimals(
    tokenSymbolOrAddress: string,
    networkId?: NetworkId,
): Promise<number> {
    if (isNativeETH(tokenSymbolOrAddress)) {
        return 18;
    }

    const tokenMetadata = await getTokenMetadata(tokenSymbolOrAddress, networkId);
    return tokenMetadata.decimals;
}

/**
 * Parse a human-readable amount into raw bigint based on a known symbol
 * or token contract address.
 */
export async function parseTokenAmountWithReference(
    amount: string,
    tokenSymbolOrAddress: string,
    networkId?: NetworkId,
): Promise<bigint> {
    if (isNativeETH(tokenSymbolOrAddress)) {
        return parseEther(amount);
    }

    const decimals = await getTokenDecimals(tokenSymbolOrAddress, networkId);
    return parseUnits(amount, decimals);
}

// ---------------------------------------------------------------------------
// Transaction Utilities
// ---------------------------------------------------------------------------

/**
 * Parse a human-readable amount into raw bigint based on token decimals.
 */
export function parseTokenAmount(amount: string, symbol: string): bigint {
    if (isNativeETH(symbol)) {
        return parseEther(amount);
    }
    const tokenInfo = getTokenInfo(symbol);
    const decimals = tokenInfo?.decimals ?? 18;
    return parseUnits(amount, decimals);
}

/**
 * Format raw bigint amount to human-readable string.
 */
export function formatTokenAmount(amount: bigint, symbol: string): string {
    if (isNativeETH(symbol)) {
        return formatEther(amount);
    }
    const tokenInfo = getTokenInfo(symbol);
    const decimals = tokenInfo?.decimals ?? 18;
    return formatUnits(amount, decimals);
}

// ---------------------------------------------------------------------------
// Explorer Utilities
// ---------------------------------------------------------------------------

/**
 * Build a transaction URL for the block explorer.
 */
export function getTxUrl(txHash: string): string {
    const network = getActiveNetwork();
    return `${network.explorerUrl}/tx/${txHash}`;
}

/**
 * Build an address URL for the block explorer.
 */
export function getAddressUrl(address: string): string {
    const network = getActiveNetwork();
    return `${network.explorerUrl}/address/${address}`;
}
