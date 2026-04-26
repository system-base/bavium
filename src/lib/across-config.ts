import type { NetworkId } from "@/lib/chain-config";

export type AcrossRuntime = "mainnet" | "testnet";

export interface AcrossDestinationOption {
    label: string;
    value: string;
}

export const ACROSS_ORIGIN_CHAIN_ID_BY_NETWORK: Record<NetworkId, number> = {
    "base-mainnet": 8453,
    "base-sepolia": 84532,
};

export const ACROSS_MAINNET_DESTINATION_OPTIONS: AcrossDestinationOption[] = [
    { label: "Ethereum", value: "1" },
    { label: "Optimism", value: "10" },
    { label: "Polygon", value: "137" },
    { label: "Arbitrum", value: "42161" },
    { label: "zkSync Era", value: "324" },
    { label: "Linea", value: "59144" },
    { label: "Mode", value: "34443" },
    { label: "Blast", value: "81457" },
    { label: "Lisk", value: "1135" },
    { label: "Scroll", value: "534352" },
    { label: "World Chain", value: "480" },
    { label: "Unichain", value: "130" },
    { label: "Zora", value: "7777777" },
    { label: "BNB Smart Chain", value: "56" },
    { label: "Ink", value: "57073" },
    { label: "Lens", value: "232" },
    { label: "Soneium", value: "1868" },
    { label: "HyperEVM", value: "999" },
    { label: "Monad", value: "143" },
    { label: "Plasma", value: "9745" },
    { label: "Solana", value: "34268394551451" },
];

export const ACROSS_TESTNET_DESTINATION_OPTIONS: AcrossDestinationOption[] = [
    { label: "Ethereum Sepolia", value: "11155111" },
    { label: "Arbitrum Sepolia", value: "421614" },
    { label: "Optimism Sepolia", value: "11155420" },
    { label: "Polygon Amoy", value: "80002" },
    { label: "Mode Sepolia", value: "919" },
    { label: "Blast Sepolia", value: "168587773" },
    { label: "Lisk Sepolia", value: "4202" },
    { label: "Unichain Sepolia", value: "1301" },
];

export const ACROSS_DESTINATION_OPTIONS: AcrossDestinationOption[] = [
    ...ACROSS_MAINNET_DESTINATION_OPTIONS,
    ...ACROSS_TESTNET_DESTINATION_OPTIONS,
];

const MAINNET_DESTINATION_CHAIN_IDS = new Set(
    ACROSS_MAINNET_DESTINATION_OPTIONS.map((option) => option.value),
);

const TESTNET_DESTINATION_CHAIN_IDS = new Set(
    ACROSS_TESTNET_DESTINATION_OPTIONS.map((option) => option.value),
);

export function getAcrossRuntime(networkId: NetworkId): AcrossRuntime {
    return networkId === "base-mainnet" ? "mainnet" : "testnet";
}

export function getAcrossOriginChainId(networkId: NetworkId): number {
    return ACROSS_ORIGIN_CHAIN_ID_BY_NETWORK[networkId];
}

export function getAcrossNetworkLabel(networkId: NetworkId): string {
    return networkId === "base-mainnet" ? "Base mainnet" : "Base Sepolia";
}

export function getAcrossDestinationOptionsForNetwork(
    networkId?: string,
): AcrossDestinationOption[] {
    if (networkId === "base-mainnet") {
        return [...ACROSS_MAINNET_DESTINATION_OPTIONS];
    }

    if (networkId === "base-sepolia") {
        return [...ACROSS_TESTNET_DESTINATION_OPTIONS];
    }

    return [...ACROSS_DESTINATION_OPTIONS];
}

export function getAcrossDestinationRuntime(
    destinationChainId: number,
): AcrossRuntime | undefined {
    const value = String(destinationChainId);
    if (MAINNET_DESTINATION_CHAIN_IDS.has(value)) return "mainnet";
    if (TESTNET_DESTINATION_CHAIN_IDS.has(value)) return "testnet";
    return undefined;
}

export function getAcrossRuntimeLabel(runtime: AcrossRuntime): string {
    return runtime === "mainnet" ? "mainnet" : "testnet";
}
