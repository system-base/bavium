/* ==========================================================================
   Skills — Transaction Lifecycle
   Read-only transaction receipt and confirmation helpers for Base networks.
   ========================================================================== */

import type { ISkill, SkillActionMeta, SkillResult } from "../types";
import type { VariableContext } from "@/engine/types";
import { skillRegistry } from "../registry";
import { getPublicClient } from "@/lib/viem-client";
import { getActiveNetwork, NETWORKS, type NetworkId } from "@/lib/chain-config";
import { type Address, type Hash } from "viem";

function resolveNetworkId(context: VariableContext): NetworkId {
    return context.networkId ?? getActiveNetwork().networkId;
}

function parseTxHash(value: unknown): Hash {
    const txHash = String(value ?? "").trim();
    if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
        throw new Error("Transaction hash must be a 0x-prefixed 32-byte hash.");
    }
    return txHash as Hash;
}

function parseConfirmations(value: unknown, fallback = 1): number {
    const parsed = Number(value ?? fallback);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
        throw new Error("Confirmations must be an integer between 1 and 100.");
    }
    return parsed;
}

function parseTimeoutMs(value: unknown, fallbackSeconds = 120): number {
    const parsed = Number(value ?? fallbackSeconds);
    if (!Number.isFinite(parsed) || parsed < 5 || parsed > 600) {
        throw new Error("Timeout must be between 5 and 600 seconds.");
    }
    return Math.floor(parsed * 1000);
}

function buildExplorerUrl(networkId: NetworkId, txHash: string): string {
    return `${NETWORKS[networkId].explorerUrl}/tx/${txHash}`;
}

async function executeGetReceipt(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    try {
        const networkId = resolveNetworkId(context);
        const txHash = parseTxHash(params.txHash ?? params.hash);
        const client = getPublicClient(networkId);
        const receipt = await client.getTransactionReceipt({ hash: txHash });

        return {
            success: true,
            data: {
                provider: "rpc",
                networkId,
                txHash,
                status: receipt.status,
                blockHash: receipt.blockHash,
                blockNumber: receipt.blockNumber.toString(),
                transactionIndex: receipt.transactionIndex,
                gasUsed: receipt.gasUsed.toString(),
                cumulativeGasUsed: receipt.cumulativeGasUsed.toString(),
                effectiveGasPrice: receipt.effectiveGasPrice?.toString(),
                from: receipt.from,
                to: receipt.to ?? undefined,
                contractAddress: receipt.contractAddress ?? undefined,
                explorerUrl: buildExplorerUrl(networkId, txHash),
            },
            message: `Transaction ${txHash} is ${receipt.status} on ${networkId}.`,
        };
    } catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

async function executeWaitConfirmation(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    try {
        const networkId = resolveNetworkId(context);
        const txHash = parseTxHash(params.txHash ?? params.hash);
        const confirmations = parseConfirmations(params.confirmations, 1);
        const timeout = parseTimeoutMs(params.timeoutSeconds, 120);
        const client = getPublicClient(networkId);
        const receipt = await client.waitForTransactionReceipt({
            hash: txHash,
            confirmations,
            timeout,
        });

        return {
            success: true,
            data: {
                provider: "rpc",
                networkId,
                txHash,
                confirmations,
                status: receipt.status,
                blockHash: receipt.blockHash,
                blockNumber: receipt.blockNumber.toString(),
                transactionIndex: receipt.transactionIndex,
                gasUsed: receipt.gasUsed.toString(),
                cumulativeGasUsed: receipt.cumulativeGasUsed.toString(),
                effectiveGasPrice: receipt.effectiveGasPrice?.toString(),
                from: receipt.from,
                to: receipt.to ?? undefined,
                contractAddress: receipt.contractAddress ?? undefined,
                explorerUrl: buildExplorerUrl(networkId, txHash),
            },
            message: `Transaction ${txHash} reached ${confirmations} confirmation${confirmations === 1 ? "" : "s"} on ${networkId}.`,
        };
    } catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

const ACTIONS: SkillActionMeta[] = [
    {
        name: "get_receipt",
        label: "Get Transaction Receipt",
        description: "Fetch a transaction receipt by hash from the active Base network.",
        params: [
            { name: "txHash", type: "string", required: true, description: "0x transaction hash to inspect" },
        ],
    },
    {
        name: "wait_confirmation",
        label: "Wait for Confirmation",
        description: "Wait for a transaction to reach the requested confirmation count on the active Base network.",
        params: [
            { name: "txHash", type: "string", required: true, description: "0x transaction hash to wait for" },
            { name: "confirmations", type: "number", required: false, description: "Number of confirmations to wait for", default: 1 },
            { name: "timeoutSeconds", type: "number", required: false, description: "Max seconds to wait before failing", default: 120 },
        ],
    },
];

const txSkill: ISkill = {
    name: "tx",
    label: "Transactions",
    category: "data",
    description: "Read-only transaction receipt and confirmation helpers for Base networks.",
    actions: ACTIONS,

    async execute(
        action: string,
        params: Record<string, unknown>,
        context: VariableContext,
    ): Promise<SkillResult> {
        switch (action) {
            case "get_receipt":
                return executeGetReceipt(params, context);
            case "wait_confirmation":
                return executeWaitConfirmation(params, context);
            default:
                return { success: false, error: `Unknown tx action "${action}"` };
        }
    },
};

skillRegistry.register(txSkill);

export { txSkill };
