import type { NetworkId } from "@/lib/chain-config";

export type BlockscoutActivityFilter = "all" | "to" | "from";

export interface BlockscoutWalletActivityTransfer {
    tokenSymbol?: string;
    tokenAddress?: string;
    tokenType?: string;
    amount?: string;
    from?: string;
    to?: string;
}

export interface BlockscoutWalletActivityItem {
    hash: string;
    timestamp?: string;
    status?: string;
    method?: string;
    direction: "incoming" | "outgoing" | "self" | "unknown";
    counterparty?: string;
    value?: string;
    tokenTransferCount: number;
    primaryAsset?: string;
    primaryAmount?: string;
    primaryTokenAddress?: string;
    primaryTokenType?: string;
}

export interface BlockscoutWalletActivityResult {
    provider: "blockscout";
    walletAddress: string;
    networkId: NetworkId;
    returnedCount: number;
    nextPageAvailable: boolean;
    items: BlockscoutWalletActivityItem[];
}

const BLOCKSCOUT_API_BASE: Record<NetworkId, string> = {
    "base-mainnet": "https://base.blockscout.com/api/v2",
    "base-sepolia": "https://base-sepolia.blockscout.com/api/v2",
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readNumberString(value: unknown): string | undefined {
    if (typeof value === "string" && value.trim().length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return undefined;
}

function readObject(value: unknown): Record<string, unknown> | undefined {
    return isRecord(value) ? value : undefined;
}

function normalizeAddress(value: unknown): string | undefined {
    const address = readString(value);
    return address?.toLowerCase();
}

function resolveHashAddress(value: unknown): string | undefined {
    const record = readObject(value);
    return normalizeAddress(record?.hash);
}

function inferDirection(
    walletAddress: string,
    fromHash?: string,
    toHash?: string,
): BlockscoutWalletActivityItem["direction"] {
    const wallet = walletAddress.toLowerCase();
    const from = fromHash?.toLowerCase();
    const to = toHash?.toLowerCase();

    if (from && to && from === wallet && to === wallet) return "self";
    if (to === wallet) return "incoming";
    if (from === wallet) return "outgoing";
    return "unknown";
}

function resolveCounterparty(
    direction: BlockscoutWalletActivityItem["direction"],
    fromHash?: string,
    toHash?: string,
): string | undefined {
    switch (direction) {
        case "incoming":
            return fromHash;
        case "outgoing":
            return toHash;
        default:
            return undefined;
    }
}

function parseTokenTransfer(entry: unknown): BlockscoutWalletActivityTransfer | null {
    if (!isRecord(entry)) return null;

    const token = readObject(entry.token);
    const total = readObject(entry.total);

    return {
        ...(readString(token?.symbol) ? { tokenSymbol: readString(token?.symbol) } : {}),
        ...(readString(token?.address_hash) ? { tokenAddress: readString(token?.address_hash) } : {}),
        ...(readString(token?.type) ? { tokenType: readString(token?.type) } : {}),
        ...(readNumberString(total?.value) ? { amount: readNumberString(total?.value) } : {}),
        ...(resolveHashAddress(entry.from) ? { from: resolveHashAddress(entry.from) } : {}),
        ...(resolveHashAddress(entry.to) ? { to: resolveHashAddress(entry.to) } : {}),
    };
}

function parseActivityItem(
    entry: unknown,
    walletAddress: string,
    index: number,
): BlockscoutWalletActivityItem | null {
    if (!isRecord(entry)) return null;

    const hash = readString(entry.hash) ?? `activity-${index + 1}`;
    const fromHash = resolveHashAddress(entry.from);
    const toHash = resolveHashAddress(entry.to);
    const direction = inferDirection(walletAddress, fromHash, toHash);
    const tokenTransfers = Array.isArray(entry.token_transfers)
        ? entry.token_transfers.map(parseTokenTransfer).filter((item): item is BlockscoutWalletActivityTransfer => Boolean(item))
        : [];
    const primaryTransfer = tokenTransfers[0];

    return {
        hash,
        ...(readString(entry.timestamp) ? { timestamp: readString(entry.timestamp) } : {}),
        ...(readString(entry.status) ? { status: readString(entry.status) } : {}),
        ...(readString(entry.method) ? { method: readString(entry.method) } : {}),
        direction,
        ...(resolveCounterparty(direction, fromHash, toHash) ? { counterparty: resolveCounterparty(direction, fromHash, toHash) } : {}),
        ...(readNumberString(entry.value) ? { value: readNumberString(entry.value) } : {}),
        tokenTransferCount: tokenTransfers.length,
        ...(primaryTransfer?.tokenSymbol ? { primaryAsset: primaryTransfer.tokenSymbol } : {}),
        ...(primaryTransfer?.amount ? { primaryAmount: primaryTransfer.amount } : {}),
        ...(primaryTransfer?.tokenAddress ? { primaryTokenAddress: primaryTransfer.tokenAddress } : {}),
        ...(primaryTransfer?.tokenType ? { primaryTokenType: primaryTransfer.tokenType } : {}),
    };
}

export async function getWalletActivityFromBlockscout(params: {
    walletAddress: string;
    networkId: NetworkId;
    filter?: BlockscoutActivityFilter;
    maxItems?: number;
}): Promise<BlockscoutWalletActivityResult> {
    const maxItems = Math.max(1, Math.min(20, params.maxItems ?? 10));
    const url = new URL(`${BLOCKSCOUT_API_BASE[params.networkId]}/addresses/${params.walletAddress}/transactions`);
    if (params.filter && params.filter !== "all") {
        url.searchParams.set("filter", params.filter);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
        const response = await fetch(url.toString(), {
            method: "GET",
            headers: { accept: "application/json" },
            signal: controller.signal,
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => "");
            throw new Error(
                `Blockscout activity request failed (${response.status})${errorBody ? `: ${errorBody.slice(0, 160)}` : ""}`,
            );
        }

        const payload = await response.json() as Record<string, unknown>;
        const entries = Array.isArray(payload.items) ? payload.items : [];
        const items = entries
            .slice(0, maxItems)
            .map((entry, index) => parseActivityItem(entry, params.walletAddress, index))
            .filter((item): item is BlockscoutWalletActivityItem => Boolean(item));

        return {
            provider: "blockscout",
            walletAddress: params.walletAddress,
            networkId: params.networkId,
            returnedCount: items.length,
            nextPageAvailable: isRecord(payload.next_page_params),
            items,
        };
    } finally {
        clearTimeout(timeout);
    }
}
