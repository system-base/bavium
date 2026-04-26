"use client";

import { getActiveNetwork, type NetworkId } from "@/lib/chain-config";

const PREFERRED_NETWORK_STORAGE_KEY = "base-shortcuts-preferred-network";
const PREFERRED_NETWORK_EVENT = "bavium:preferred-network-change";

function isNetworkId(value: unknown): value is NetworkId {
    return value === "base-mainnet" || value === "base-sepolia";
}

export function getStoredPreferredNetwork(): NetworkId | undefined {
    if (typeof window === "undefined") return undefined;

    const value = window.localStorage.getItem(PREFERRED_NETWORK_STORAGE_KEY);
    return isNetworkId(value) ? value : undefined;
}

export function getPreferredNetworkFallback(): NetworkId {
    return getStoredPreferredNetwork() ?? getActiveNetwork().networkId;
}

export function setStoredPreferredNetwork(networkId: NetworkId): void {
    if (typeof window === "undefined") return;

    window.localStorage.setItem(PREFERRED_NETWORK_STORAGE_KEY, networkId);
    window.dispatchEvent(
        new CustomEvent(PREFERRED_NETWORK_EVENT, {
            detail: { networkId },
        }),
    );
}

export function subscribeToPreferredNetwork(
    listener: (networkId: NetworkId) => void,
): () => void {
    if (typeof window === "undefined") return () => undefined;

    const handleStorage = (event: StorageEvent) => {
        if (event.key !== PREFERRED_NETWORK_STORAGE_KEY) return;
        const next = isNetworkId(event.newValue)
            ? event.newValue
            : getActiveNetwork().networkId;
        listener(next);
    };

    const handleCustomEvent = (event: Event) => {
        const detail = (event as CustomEvent<{ networkId?: unknown }>).detail;
        if (detail && isNetworkId(detail.networkId)) {
            listener(detail.networkId);
        }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(PREFERRED_NETWORK_EVENT, handleCustomEvent);

    return () => {
        window.removeEventListener("storage", handleStorage);
        window.removeEventListener(PREFERRED_NETWORK_EVENT, handleCustomEvent);
    };
}
