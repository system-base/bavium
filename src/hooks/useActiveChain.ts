/* ==========================================================================
   useActiveChain — Wallet-Aware Network Resolution Hook
   ──────────────────────────────────────────────────────
   Returns the currently active network config by combining:
     1. The connected wallet's chain (authoritative when connected)
     2. The stored preferred network while disconnected
     3. The env-level fallback (NEXT_PUBLIC_NETWORK_ID)

   This is the client-side single source of truth for "which chain am I on?"
   ========================================================================== */

"use client";

import { useAccount } from "wagmi";
import { useMemo, useSyncExternalStore } from "react";
import {
    getActiveNetwork,
    resolveActiveChain,
    type NetworkId,
} from "@/lib/chain-config";
import {
    getPreferredNetworkFallback,
    subscribeToPreferredNetwork,
} from "@/lib/network-preference";

export interface ActiveChainState {
    /** Resolved chain ID (e.g. 8453 for Base, 84532 for Base Sepolia) */
    chainId: number;
    /** Resolved network ID string (e.g. "base-mainnet" or "base-sepolia") */
    networkId: NetworkId;
    /** Human-readable network label (e.g. "Base" or "Base Sepolia") */
    label: string;
    /** Full resolved network config object */
    networkConfig: ReturnType<typeof resolveActiveChain>;
    /** Whether the active chain was derived from the connected wallet */
    isWalletDerived: boolean;
    /** Whether the wallet is on an unsupported chain */
    isUnsupportedChain: boolean;
    /** Whether the active supported chain is coming from stored disconnected preference */
    isPreferredFallback: boolean;
}

/**
 * Resolves the active chain by preferring the wallet's chain when connected.
 * The first render falls back to env defaults, then hydrates the stored
 * preferred network after mount to avoid SSR/client mismatches.
 *
 * Usage:
 * ```tsx
 * const { chainId, networkId, label, isWalletDerived } = useActiveChain();
 * ```
 */
export function useActiveChain(): ActiveChainState {
    const { chain: walletChain, isConnected } = useAccount();
    const preferredNetworkId = useSyncExternalStore(
        subscribeToPreferredNetwork,
        getPreferredNetworkFallback,
        () => getActiveNetwork().networkId,
    );

    return useMemo(() => {
        const walletChainId = isConnected ? walletChain?.id : undefined;
        const networkConfig = resolveActiveChain(walletChainId, preferredNetworkId);

        // Check if the wallet is on an unsupported chain:
        // wallet is connected and has a chain, but resolveActiveChain
        // fell back to preferred/env because the wallet's chain wasn't matched
        const isUnsupportedChain =
            isConnected &&
            walletChain != null &&
            networkConfig.chain.id !== walletChain.id;

        return {
            chainId: networkConfig.chain.id,
            networkId: networkConfig.networkId,
            label: networkConfig.label,
            networkConfig,
            isWalletDerived: isConnected && !isUnsupportedChain && walletChain != null,
            isUnsupportedChain,
            isPreferredFallback: !isConnected && networkConfig.networkId === preferredNetworkId,
        };
    }, [isConnected, preferredNetworkId, walletChain]);
}
