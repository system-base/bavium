import { NETWORKS, type NetworkId } from "@/lib/chain-config";

export interface PreparedTransactionCall {
    to: string;
    value: string;
    data: string;
}

export interface PreparedTransactionOutput {
    type: "transaction";
    status: "prepared";
    networkId: NetworkId;
    explorerBaseUrl: string;
    requiresSignature: true;
    callCount: number;
    calls: PreparedTransactionCall[];
    description: string;
    summary: string;
    protocol?: string;
    action?: string;
    [key: string]: unknown;
}

export interface SubmittedTransactionOutput {
    type: "transaction";
    status: "submitted";
    networkId: NetworkId;
    txHash: string;
    explorerUrl: string;
    requiresSignature: false;
    description: string;
    summary: string;
    protocol?: string;
    action?: string;
    [key: string]: unknown;
}

export function buildExplorerTransactionUrl(
    networkId: NetworkId,
    txHash: string,
): string {
    return `${NETWORKS[networkId].explorerUrl}/tx/${txHash}`;
}

export function createPreparedTransactionOutput(
    networkId: NetworkId,
    config: {
        calls: PreparedTransactionCall[];
        description: string;
        summary?: string;
        protocol?: string;
        action?: string;
        extras?: Record<string, unknown>;
    },
): PreparedTransactionOutput {
    return {
        type: "transaction",
        status: "prepared",
        networkId,
        explorerBaseUrl: NETWORKS[networkId].explorerUrl,
        requiresSignature: true,
        callCount: config.calls.length,
        calls: config.calls,
        description: config.description,
        summary: config.summary ?? config.description,
        ...(config.protocol ? { protocol: config.protocol } : {}),
        ...(config.action ? { action: config.action } : {}),
        ...(config.extras ?? {}),
    };
}

export function createSubmittedTransactionOutput(
    networkId: NetworkId,
    txHash: string,
    config: {
        description: string;
        summary?: string;
        protocol?: string;
        action?: string;
        explorerUrl?: string;
        extras?: Record<string, unknown>;
    },
): SubmittedTransactionOutput {
    return {
        type: "transaction",
        status: "submitted",
        networkId,
        txHash,
        explorerUrl: config.explorerUrl ?? buildExplorerTransactionUrl(networkId, txHash),
        requiresSignature: false,
        description: config.description,
        summary: config.summary ?? config.description,
        ...(config.protocol ? { protocol: config.protocol } : {}),
        ...(config.action ? { action: config.action } : {}),
        ...(config.extras ?? {}),
    };
}

export function isPreparedTransactionOutput(
    value: unknown,
): value is PreparedTransactionOutput {
    if (typeof value !== "object" || value === null) return false;
    if (!("type" in value) || value.type !== "transaction") return false;
    if (!("status" in value) || value.status !== "prepared") return false;
    if (!("networkId" in value) || typeof value.networkId !== "string") return false;
    if (!("calls" in value) || !Array.isArray(value.calls)) return false;
    return true;
}

export function isSubmittedTransactionOutput(
    value: unknown,
): value is SubmittedTransactionOutput {
    if (typeof value !== "object" || value === null) return false;
    if (!("type" in value) || value.type !== "transaction") return false;
    if (!("status" in value) || value.status !== "submitted") return false;
    if (!("networkId" in value) || typeof value.networkId !== "string") return false;
    if (!("txHash" in value) || typeof value.txHash !== "string") return false;
    if (!("explorerUrl" in value) || typeof value.explorerUrl !== "string") return false;
    return true;
}
