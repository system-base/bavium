/* ==========================================================================
   Chain Configuration — Base Network Constants & Token Registry
   Central source of truth for chain IDs, RPC endpoints, and token addresses.
   CDP-free: uses only viem chain definitions.
   ========================================================================== */

import { base, baseSepolia } from "viem/chains";
import type { Chain, Address } from "viem";

// ---------------------------------------------------------------------------
// Network Configuration
// ---------------------------------------------------------------------------

export type NetworkId = "base-mainnet" | "base-sepolia";

interface NetworkConfig {
    readonly chain: Chain;
    readonly networkId: NetworkId;
    readonly label: string;
    readonly explorerUrl: string;
    readonly rpcUrl: string;
    readonly fallbackRpcUrls: readonly string[];
}

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
    "base-mainnet": {
        chain: base,
        networkId: "base-mainnet",
        label: "Base",
        explorerUrl: "https://basescan.org",
        rpcUrl: "https://mainnet.base.org",
        fallbackRpcUrls: ["https://base-rpc.publicnode.com"],
    },
    "base-sepolia": {
        chain: baseSepolia,
        networkId: "base-sepolia",
        label: "Base Sepolia",
        explorerUrl: "https://sepolia.basescan.org",
        rpcUrl: "https://sepolia.base.org",
        fallbackRpcUrls: ["https://base-sepolia-rpc.publicnode.com"],
    },
} as const;

function uniqueRpcUrls(urls: readonly string[]): string[] {
    return Array.from(new Set(urls.filter((url) => url.trim().length > 0)));
}

export function getNetworkRpcUrls(networkId?: NetworkId): string[] {
    const nid = networkId ?? getActiveNetwork().networkId;
    const network = NETWORKS[nid];
    const envPrimary =
        nid === "base-mainnet"
            ? process.env.NEXT_PUBLIC_BASE_MAINNET_RPC_URL
            : process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL;

    return uniqueRpcUrls([
        envPrimary ?? "",
        network.rpcUrl,
        ...network.fallbackRpcUrls,
    ]);
}

/**
 * Active network — controlled by NEXT_PUBLIC_NETWORK_ID env var.
 * Defaults to base-sepolia for safety.
 *
 * This is the final fallback only. For wallet-aware or user-preferred
 * resolution, use `resolveActiveChain(...)` instead.
 */
export function getActiveNetwork(): NetworkConfig {
    const envNetwork = process.env.NEXT_PUBLIC_NETWORK_ID;
    if (envNetwork === "base-mainnet") return NETWORKS["base-mainnet"];
    return NETWORKS["base-sepolia"];
}

/**
 * Find network config by chain ID.
 * Returns undefined for unsupported chains.
 */
export function getNetworkByChainId(chainId: number): NetworkConfig | undefined {
    return Object.values(NETWORKS).find((n) => n.chain.id === chainId);
}

/**
 * Resolve the active network by preferring the wallet's chain.
 *
 * Priority:
 *   1. walletChainId — if the wallet is connected and on a supported chain
 *   2. preferredNetworkId — persisted user preference when disconnected
 *   3. env var fallback — NEXT_PUBLIC_NETWORK_ID
 *
 * Use this instead of `getActiveNetwork()` whenever the wallet chain is available.
 */
export function resolveActiveChain(
    walletChainId?: number,
    preferredNetworkId?: NetworkId,
): NetworkConfig {
    if (walletChainId != null) {
        const matched = getNetworkByChainId(walletChainId);
        if (matched) return matched;
    }

    if (preferredNetworkId) {
        return NETWORKS[preferredNetworkId];
    }

    return getActiveNetwork();
}

// ---------------------------------------------------------------------------
// Well-Known Token Addresses
// ---------------------------------------------------------------------------

export interface TokenInfo {
    readonly symbol: string;
    readonly name: string;
    readonly address: Address;
    readonly decimals: number;
    readonly image: string;
    readonly chainId: number;
}

/** Native ETH representation (address = "0x" zero-address convention) */
const ETH_IMAGE =
    "https://wallet-api-production.s3.amazonaws.com/uploads/tokens/eth_288.png";
const USDC_IMAGE =
    "https://d3r81g40ycuhqg.cloudfront.net/wallet/wais/44/2b/442b80bd16af0c0d9b22e03a16753823fe826e5bfd457292b55fa0ba8c1ba213-ZWUzYjJmZGUtMDYxNy00NDcyLTg0NjQtMWI4OGEwYjBiODE2";

const MAINNET_TOKENS: Record<string, TokenInfo> = {
    ETH: {
        symbol: "ETH",
        name: "Ethereum",
        address: "0x0000000000000000000000000000000000000000",
        decimals: 18,
        image: ETH_IMAGE,
        chainId: base.id,
    },
    USDC: {
        symbol: "USDC",
        name: "USD Coin",
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        decimals: 6,
        image: USDC_IMAGE,
        chainId: base.id,
    },
    WETH: {
        symbol: "WETH",
        name: "Wrapped Ether",
        address: "0x4200000000000000000000000000000000000006",
        decimals: 18,
        image: ETH_IMAGE,
        chainId: base.id,
    },
    DAI: {
        symbol: "DAI",
        name: "Dai Stablecoin",
        address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
        decimals: 18,
        image: "",
        chainId: base.id,
    },
    AERO: {
        symbol: "AERO",
        name: "Aerodrome",
        address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
        decimals: 18,
        image: "",
        chainId: base.id,
    },
    DEGEN: {
        symbol: "DEGEN",
        name: "Degen",
        address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
        decimals: 18,
        image: "",
        chainId: base.id,
    },
} as const;

const SEPOLIA_TOKENS: Record<string, TokenInfo> = {
    ETH: {
        symbol: "ETH",
        name: "Ethereum",
        address: "0x0000000000000000000000000000000000000000",
        decimals: 18,
        image: ETH_IMAGE,
        chainId: baseSepolia.id,
    },
    USDC: {
        symbol: "USDC",
        name: "USD Coin",
        address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        decimals: 6,
        image: USDC_IMAGE,
        chainId: baseSepolia.id,
    },
    WETH: {
        symbol: "WETH",
        name: "Wrapped Ether",
        address: "0x4200000000000000000000000000000000000006",
        decimals: 18,
        image: ETH_IMAGE,
        chainId: baseSepolia.id,
    },
} as const;

const TOKEN_REGISTRY: Record<NetworkId, Record<string, TokenInfo>> = {
    "base-mainnet": MAINNET_TOKENS,
    "base-sepolia": SEPOLIA_TOKENS,
};

/**
 * Get token info by symbol (case-insensitive).
 * Optionally specify a network; defaults to active network.
 */
export function getTokenInfo(symbol: string, networkId?: NetworkId): TokenInfo | undefined {
    const nid = networkId ?? getActiveNetwork().networkId;
    return TOKEN_REGISTRY[nid][symbol.toUpperCase()];
}

/**
 * Get token info by contract address (case-insensitive).
 * Optionally specify a network; defaults to active network.
 */
export function getTokenInfoByAddress(address: string, networkId?: NetworkId): TokenInfo | undefined {
    const normalized = address.toLowerCase();
    return getRegisteredTokens(networkId).find(
        (token) => token.address.toLowerCase() === normalized,
    );
}

/**
 * Resolve a symbol or address to a token address.
 * If input is already a 0x address, returns it as-is.
 * Optionally specify a network; defaults to active network.
 */
export function resolveTokenAddress(tokenOrAddress: string, networkId?: NetworkId): Address | undefined {
    // Already an address
    if (tokenOrAddress.startsWith("0x") && tokenOrAddress.length === 42) {
        return tokenOrAddress as Address;
    }
    const info = getTokenInfo(tokenOrAddress, networkId);
    return info?.address;
}

/**
 * Check if a token symbol represents native ETH.
 */
export function isNativeETH(symbol: string): boolean {
    return symbol.toUpperCase() === "ETH";
}

/**
 * Get all registered tokens for the specified or active network.
 */
export function getRegisteredTokens(networkId?: NetworkId): TokenInfo[] {
    const nid = networkId ?? getActiveNetwork().networkId;
    return Object.values(TOKEN_REGISTRY[nid]);
}

/**
 * Get tokens formatted for OnchainKit components.
 * Optionally specify a network; defaults to active network.
 */
export function getSwappableTokens(networkId?: NetworkId): Array<{
    name: string;
    address: string;
    symbol: string;
    decimals: number;
    image: string;
    chainId: number;
}> {
    return getRegisteredTokens(networkId).map((t) => ({
        name: t.name,
        address: t.address === "0x0000000000000000000000000000000000000000" ? "" : t.address,
        symbol: t.symbol,
        decimals: t.decimals,
        image: t.image,
        chainId: t.chainId,
    }));
}

// ---------------------------------------------------------------------------
// Common ABIs (minimal for read operations)
// ---------------------------------------------------------------------------

export const ERC20_ABI = [
    {
        inputs: [{ name: "account", type: "address" }],
        name: "balanceOf",
        outputs: [{ name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [
            { name: "to", type: "address" },
            { name: "amount", type: "uint256" },
        ],
        name: "transfer",
        outputs: [{ name: "", type: "bool" }],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
        ],
        name: "approve",
        outputs: [{ name: "", type: "bool" }],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
        ],
        name: "allowance",
        outputs: [{ name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [],
        name: "decimals",
        outputs: [{ name: "", type: "uint8" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [],
        name: "symbol",
        outputs: [{ name: "", type: "string" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [],
        name: "name",
        outputs: [{ name: "", type: "string" }],
        stateMutability: "view",
        type: "function",
    },
] as const;
