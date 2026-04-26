import {
    createPublicClient,
    fallback,
    getAddress,
    http,
    isAddress,
    namehash,
    toCoinType,
    type Address,
    type PublicClient,
} from "viem";
import { base, baseSepolia, mainnet } from "viem/chains";
import { getPublicClient } from "@/lib/viem-client";

type BasenameNetworkId = "base-mainnet" | "base-sepolia";

const FALLBACK_MAINNET_RPC_URL = "https://ethereum-rpc.publicnode.com";
const BASENAME_L2_RESOLVER_ADDRESSES: Record<BasenameNetworkId, Address> = {
    "base-mainnet": "0xC6d566A56A1aFf6508b41f6c90ff131615583BCD",
    "base-sepolia": "0x6533C856767766e767A4Bcb76cEf0b32F1130AfA",
};

const RESOLVER_ADDR_ABI = [
    {
        type: "function",
        name: "addr",
        stateMutability: "view",
        inputs: [{ name: "node", type: "bytes32" }],
        outputs: [{ name: "", type: "address" }],
    },
] as const;

const RESOLVER_NAME_ABI = [
    {
        type: "function",
        name: "name",
        stateMutability: "view",
        inputs: [{ name: "node", type: "bytes32" }],
        outputs: [{ name: "", type: "string" }],
    },
] as const;

const reverseBasenameCache = new Map<string, string | null>();
const forwardBasenameCache = new Map<string, Address | null>();
let ensMainnetClient: PublicClient | null = null;

function getEnsMainnetRpcUrls(): string[] {
    const serverRpcUrl =
        typeof window === "undefined"
            ? process.env.BASENAME_MAINNET_RPC_URL?.trim() ?? ""
            : "";

    return Array.from(
        new Set(
            [
                serverRpcUrl,
                ...mainnet.rpcUrls.default.http,
                FALLBACK_MAINNET_RPC_URL,
            ].filter((value) => value.length > 0),
        ),
    );
}

function getEnsMainnetClient(): PublicClient {
    if (ensMainnetClient) {
        return ensMainnetClient;
    }

    ensMainnetClient = createPublicClient({
        chain: mainnet,
        transport: fallback(
            getEnsMainnetRpcUrls().map((url) =>
                http(url, {
                    retryCount: 2,
                    retryDelay: 250,
                    timeout: 10_000,
                }),
            ),
        ),
    });

    return ensMainnetClient;
}

function normalizeResolvableName(name: string): string {
    return name.trim().toLowerCase();
}

function getBasenameNetworksToTry(
    networkId?: string,
): BasenameNetworkId[] {
    if (networkId === "base-sepolia") {
        return ["base-sepolia", "base-mainnet"];
    }

    return ["base-mainnet"];
}

function getReverseNode(address: Address, networkId: BasenameNetworkId): `0x${string}` {
    const coinTypeHex = toCoinType(networkId === "base-sepolia" ? baseSepolia.id : base.id).toString(16);
    return namehash(`${address.slice(2).toLowerCase()}.${coinTypeHex}.reverse`);
}

async function resolveAddressViaBaseResolver(
    name: string,
    networkId: BasenameNetworkId,
): Promise<Address | undefined> {
    try {
        const client = getPublicClient(networkId);
        const resolvedAddress = await client.readContract({
            address: BASENAME_L2_RESOLVER_ADDRESSES[networkId],
            abi: RESOLVER_ADDR_ABI,
            functionName: "addr",
            args: [namehash(name.toLowerCase())],
        });

        if (!resolvedAddress || resolvedAddress === "0x0000000000000000000000000000000000000000") {
            return undefined;
        }

        return getAddress(resolvedAddress);
    } catch {
        return undefined;
    }
}

async function resolveNameViaBaseResolver(
    address: Address,
    networkId: BasenameNetworkId,
): Promise<string | undefined> {
    try {
        const client = getPublicClient(networkId);
        const resolvedName = await client.readContract({
            address: BASENAME_L2_RESOLVER_ADDRESSES[networkId],
            abi: RESOLVER_NAME_ABI,
            functionName: "name",
            args: [getReverseNode(address, networkId)],
        });

        const normalized = normalizeResolvableName(String(resolvedName ?? ""));
        return normalized.length > 0 ? normalized : undefined;
    } catch {
        return undefined;
    }
}

export function looksLikeResolvableName(value: string): boolean {
    const normalized = normalizeResolvableName(value);
    return normalized.includes(".") && /^[a-z0-9._-]+$/.test(normalized);
}

export async function resolveBasenameForAddress(
    address: Address,
    networkId?: string,
): Promise<string | undefined> {
    const normalizedAddress = getAddress(address);
    const cacheKey = `${networkId ?? "base-mainnet"}:${normalizedAddress.toLowerCase()}`;

    if (reverseBasenameCache.has(cacheKey)) {
        return reverseBasenameCache.get(cacheKey) ?? undefined;
    }

    let resolvedName: string | undefined;

    for (const candidateNetworkId of getBasenameNetworksToTry(networkId)) {
        resolvedName = await resolveNameViaBaseResolver(normalizedAddress, candidateNetworkId);
        if (resolvedName) {
            break;
        }
    }

    if (!resolvedName) {
        try {
            resolvedName =
                (await getEnsMainnetClient().getEnsName({
                    address: normalizedAddress,
                })) ?? undefined;
        } catch {
            resolvedName = undefined;
        }
    }

    reverseBasenameCache.set(cacheKey, resolvedName ?? null);
    if (resolvedName) {
        forwardBasenameCache.set(normalizeResolvableName(resolvedName), normalizedAddress);
    }

    return resolvedName;
}

export async function resolveAddressForName(
    name: string,
    networkId?: string,
): Promise<Address | undefined> {
    const normalizedName = normalizeResolvableName(name);
    if (!looksLikeResolvableName(normalizedName)) {
        return undefined;
    }

    const cacheKey = `${networkId ?? "base-mainnet"}:${normalizedName}`;
    if (forwardBasenameCache.has(cacheKey)) {
        return forwardBasenameCache.get(cacheKey) ?? undefined;
    }

    let resolvedAddress: Address | undefined;

    if (normalizedName.endsWith(".base.eth")) {
        for (const candidateNetworkId of getBasenameNetworksToTry(networkId)) {
            resolvedAddress = await resolveAddressViaBaseResolver(normalizedName, candidateNetworkId);
            if (resolvedAddress) {
                break;
            }
        }
    }

    if (!resolvedAddress) {
        try {
            resolvedAddress =
                (await getEnsMainnetClient().getEnsAddress({
                    name: normalizedName,
                })) ?? undefined;
        } catch {
            resolvedAddress = undefined;
        }
    }

    const normalizedAddress = resolvedAddress
        ? getAddress(resolvedAddress)
        : undefined;

    forwardBasenameCache.set(cacheKey, normalizedAddress ?? null);
    if (normalizedAddress) {
        reverseBasenameCache.set(
            `${networkId ?? "base-mainnet"}:${normalizedAddress.toLowerCase()}`,
            normalizedName,
        );
    }

    return normalizedAddress;
}

export async function resolveAddressOrName(
    value: string,
    networkId?: string,
): Promise<Address | undefined> {
    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }

    if (isAddress(trimmed)) {
        return getAddress(trimmed);
    }

    return resolveAddressForName(trimmed, networkId);
}
