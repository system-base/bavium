/* ==========================================================================
   Skills - Social
   Prepare user-controlled share text and Base App-friendly links.
   ========================================================================== */

import { getAddress, isAddress, type Address } from "viem";
import type { ISkill, SkillActionMeta, SkillResult } from "../types";
import type { VariableContext } from "@/engine/types";
import { skillRegistry } from "../registry";
import { getAppBaseUrl } from "@/lib/app-url";
import { resolveAddressForName } from "@/lib/basename";
import {
    NETWORKS,
    getActiveNetwork,
    getTokenInfo,
    getTokenInfoByAddress,
    type NetworkId,
} from "@/lib/chain-config";

const BASE_APP_BASE_URL = "https://base.app";
const DEFAULT_BASE_SHARE_TITLE = "Base workflow";
const DEFAULT_BASE_SHARE_MESSAGE = "Built a Base workflow in Bavium.";

function readString(value: unknown): string {
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
    return "";
}

function readBoolean(value: unknown, defaultValue: boolean): boolean {
    if (typeof value === "boolean") return value;
    const normalized = readString(value).toLowerCase();
    if (!normalized) return defaultValue;
    if (["true", "1", "yes"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
    return defaultValue;
}

function truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function normalizeOptionalAddress(value: unknown): string | undefined {
    const raw = readString(value);
    if (!raw || !isAddress(raw)) return undefined;
    return getAddress(raw);
}

function normalizeNetworkLabel(networkId?: string): string {
    switch (networkId) {
        case "base-mainnet":
            return "Base";
        case "base-sepolia":
            return "Base Sepolia";
        default:
            return networkId ?? "Base";
    }
}

function getResolvedNetworkId(context: VariableContext): NetworkId {
    return context.networkId ?? getActiveNetwork().networkId;
}

function getResolvedNetworkConfig(context: VariableContext) {
    return NETWORKS[getResolvedNetworkId(context)];
}

function looksLikeTransactionHash(value: string): boolean {
    return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function resolveShareUrl(params: Record<string, unknown>): string | undefined {
    const baseUrl = getAppBaseUrl();
    const candidates = [
        readString(params.url),
        readString(params.shareUrl),
        readString(params.shortcutUrl),
    ].filter(Boolean);
    const runId = readString(params.runId);

    if (runId) {
        candidates.push("/runs");
    }

    for (const candidate of candidates) {
        const looksLikeShareUrl =
            /^https?:\/\//i.test(candidate) || candidate.startsWith("/");
        if (!looksLikeShareUrl) continue;

        try {
            return new URL(candidate, baseUrl).toString();
        } catch {
            continue;
        }
    }

    return undefined;
}

function resolvePublishedShortcutUrl(params: Record<string, unknown>): string | undefined {
    const directUrl = resolveShareUrl(params);
    if (directUrl) return directUrl;

    const slug = readString(params.slug)
        || readString(params.shortcutSlug)
        || readString(params.publishedSlug);

    if (!slug) return undefined;

    try {
        return new URL(`/p/${slug}`, getAppBaseUrl()).toString();
    } catch {
        return undefined;
    }
}

function buildBaseProfileUrl(address: string | undefined): string | undefined {
    if (!address) return undefined;
    return `${BASE_APP_BASE_URL}/profile/${address}`;
}

function buildExplorerTokenUrl(
    address: string | undefined,
    context: VariableContext,
): string | undefined {
    if (!address) return undefined;
    const network = getResolvedNetworkConfig(context);
    return `${network.explorerUrl}/token/${address}`;
}

function buildExplorerTransactionUrl(
    txHash: string | undefined,
    context: VariableContext,
): string | undefined {
    if (!txHash) return undefined;
    const network = getResolvedNetworkConfig(context);
    return `${network.explorerUrl}/tx/${txHash}`;
}

function buildBaseTokenUrl(
    address: string | undefined,
    context: VariableContext,
): string | undefined {
    if (!address || context.networkId !== "base-mainnet") return undefined;
    return `${BASE_APP_BASE_URL}/coin/base-mainnet/${address}`;
}

function buildSharePayload(options: {
    shareKind: "generic" | "trade" | "workflow";
    title: string;
    message: string;
    summary: string;
    shareUrl?: string;
    shareUrlLabel?: string;
    walletAddress?: string;
    tokenAddress?: string;
    includeBaseLinks: boolean;
    context: VariableContext;
    extras?: Record<string, unknown>;
}): SkillResult {
    const {
        shareKind,
        title,
        message,
        summary,
        shareUrl,
        shareUrlLabel,
        walletAddress,
        tokenAddress,
        includeBaseLinks,
        context,
        extras,
    } = options;

    const baseProfileUrl = includeBaseLinks ? buildBaseProfileUrl(walletAddress) : undefined;
    const baseTokenUrl = includeBaseLinks ? buildBaseTokenUrl(tokenAddress, context) : undefined;
    const networkNote =
        tokenAddress && context.networkId !== "base-mainnet"
            ? "Base token deep links are mainnet-only, so no token link was generated for the active network."
            : undefined;

    const shareTextParts = [title, message, shareUrl].filter(Boolean);
    const shareText = shareTextParts.join("\n\n");
    const fallbackCopyParts = [
        shareText,
        baseTokenUrl ? `Token: ${baseTokenUrl}` : "",
        baseProfileUrl ? `Profile: ${baseProfileUrl}` : "",
        networkNote ?? "",
    ].filter(Boolean);

    return {
        success: true,
        data: {
            kind: "share_preparation",
            shareKind,
            title,
            message,
            summary,
            shareText,
            shareUrl,
            ...(shareUrlLabel ? { shareUrlLabel } : {}),
            fallbackCopy: fallbackCopyParts.join("\n"),
            baseProfileUrl,
            baseTokenUrl,
            walletAddress,
            tokenAddress,
            networkId: context.networkId,
            networkNote,
            webShareData: {
                title,
                text: message,
                ...(shareUrl ? { url: shareUrl } : {}),
            },
            ...(extras ?? {}),
        },
        message: summary,
    };
}

function formatTradeLeg(amount: string | undefined, symbol: string | undefined): string | undefined {
    if (amount && symbol) return `${amount} ${symbol}`;
    if (amount) return amount;
    if (symbol) return symbol;
    return undefined;
}

function normalizeTradeShareStatus(value: unknown): "quoted" | "prepared" | "submitted" | "confirmed" {
    const raw = readString(value).toLowerCase();
    switch (raw) {
        case "quoted":
        case "prepared":
        case "submitted":
        case "confirmed":
            return raw;
        default:
            return "prepared";
    }
}

function buildTradeTitle(params: Record<string, unknown>, networkLabel: string): string {
    const customTitle = truncate(readString(params.title), 96);
    if (customTitle) return customTitle;

    const fromTokenSymbol = readString(params.fromTokenSymbol) || readString(params.sellTokenSymbol);
    const toTokenSymbol = readString(params.toTokenSymbol) || readString(params.buyTokenSymbol);
    const route = fromTokenSymbol && toTokenSymbol
        ? `${fromTokenSymbol} -> ${toTokenSymbol}`
        : fromTokenSymbol || toTokenSymbol || "trade";
    const status = normalizeTradeShareStatus(params.status);
    const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
    return truncate(`${statusLabel} ${route} on ${networkLabel}`, 96);
}

function buildTradeMessage(params: Record<string, unknown>, context: VariableContext): {
    message: string;
    summary: string;
    tokenAddress?: string;
} {
    const customMessage = truncate(readString(params.message), 360);
    const networkLabel = normalizeNetworkLabel(context.networkId);
    const status = normalizeTradeShareStatus(params.status);
    const workflowName = readString(params.workflowName);
    const fromTokenSymbol = readString(params.fromTokenSymbol) || readString(params.sellTokenSymbol);
    const toTokenSymbol = readString(params.toTokenSymbol) || readString(params.buyTokenSymbol);
    const amountIn = readString(params.amountIn);
    const amountOut = readString(params.amountOut) || readString(params.expectedAmountOut);
    const fromLeg = formatTradeLeg(amountIn, fromTokenSymbol);
    const toLeg = formatTradeLeg(amountOut, toTokenSymbol);
    const route = fromTokenSymbol && toTokenSymbol
        ? `${fromTokenSymbol} -> ${toTokenSymbol}`
        : fromTokenSymbol || toTokenSymbol || "trade";
    const routeSummary = fromLeg && toLeg
        ? `${fromLeg} to ${toLeg}`
        : fromLeg
            ? fromLeg
            : route;
    const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);

    if (customMessage) {
        return {
            message: customMessage,
            summary: `${statusLabel} trade share for ${route} on ${networkLabel}.`,
            tokenAddress: normalizeOptionalAddress(params.tokenAddress ?? params.toTokenAddress),
        };
    }

    const workflowSuffix = workflowName ? ` via "${workflowName}"` : "";
    let message: string;

    switch (status) {
        case "quoted":
            message = `Quoted ${routeSummary} on ${networkLabel} with Bavium${workflowSuffix}. Inspect or reuse the workflow here.`;
            break;
        case "submitted":
            message = `Submitted ${routeSummary} on ${networkLabel} with Bavium${workflowSuffix}. Track or reuse the workflow here.`;
            break;
        case "confirmed":
            message = `Confirmed ${routeSummary} on ${networkLabel} with Bavium${workflowSuffix}. Inspect or reuse the workflow here.`;
            break;
        case "prepared":
        default:
            message = `Prepared ${routeSummary} on ${networkLabel} with Bavium${workflowSuffix}. Review it before you run it.`;
            break;
    }

    return {
        message: truncate(message, 360),
        summary: `${statusLabel} trade share for ${route} on ${networkLabel}.`,
        tokenAddress: normalizeOptionalAddress(params.tokenAddress ?? params.toTokenAddress),
    };
}

function buildShortcutShareMessage(params: Record<string, unknown>): {
    title: string;
    message: string;
    summary: string;
} {
    const name = truncate(
        readString(params.name)
            || readString(params.shortcutName)
            || readString(params.workflowName)
            || "Base workflow",
        96,
    );
    const customMessage = truncate(readString(params.message), 360);
    const description = truncate(
        readString(params.description)
            || readString(params.shortDescription),
        220,
    );
    const category = readString(params.category);
    const stepCount = readString(params.stepCount);

    if (customMessage) {
        return {
            title: name,
            message: customMessage,
            summary: `Prepared workflow share for ${name}.`,
        };
    }

    const parts: string[] = [];
    if (description) parts.push(description);

    const metadataBits = [
        category ? `${category} workflow` : "Base workflow",
        stepCount ? `${stepCount} step${stepCount === "1" ? "" : "s"}` : "",
    ].filter(Boolean);

    if (metadataBits.length > 0) {
        parts.push(`${metadataBits.join(" with ")} from Bavium.`);
    }

    parts.push("Open, run, or remix it here.");

    return {
        title: name,
        message: truncate(parts.join(" "), 360),
        summary: `Prepared workflow share for ${name}.`,
    };
}

async function resolveWalletAddressInput(
    value: unknown,
    context: VariableContext,
): Promise<Address | undefined> {
    const raw = readString(value) || readString(context.wallet.address);
    if (!raw) return undefined;

    if (isAddress(raw)) {
        return getAddress(raw);
    }

    return resolveAddressForName(raw, context.networkId);
}

function resolveTokenInput(
    value: unknown,
    context: VariableContext,
): { address: Address; symbol: string } | undefined {
    const raw = readString(value);
    if (!raw) return undefined;

    const networkId = getResolvedNetworkId(context);

    if (isAddress(raw)) {
        const address = getAddress(raw);
        const token = getTokenInfoByAddress(address, networkId);
        return {
            address,
            symbol: token?.symbol ?? `${address.slice(0, 6)}...${address.slice(-4)}`,
        };
    }

    const token = getTokenInfo(raw, networkId);
    if (!token) return undefined;

    return {
        address: token.address,
        symbol: token.symbol,
    };
}

async function executePrepareOpenProfile(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    const targetInput =
        readString(params.target)
        || readString(params.name)
        || readString(params.walletAddress)
        || readString(context.wallet.basename)
        || readString(context.wallet.address);

    if (!targetInput) {
        return {
            success: false,
            error: "Profile target is required. Provide a wallet address or .base.eth name.",
        };
    }

    const walletAddress = await resolveWalletAddressInput(targetInput, context);
    if (!walletAddress) {
        return {
            success: false,
            error: `Could not resolve "${targetInput}" to a wallet address.`,
        };
    }

    const title = truncate(
        readString(params.title) || "Open Base Profile",
        96,
    );
    const message = truncate(
        readString(params.message)
            || `Open ${targetInput} in Base and inspect the wallet profile.`,
        360,
    );
    const baseProfileUrl = buildBaseProfileUrl(walletAddress);

    return buildSharePayload({
        shareKind: "generic",
        title,
        message,
        summary: `Prepared Base profile link for ${targetInput}.`,
        shareUrl: baseProfileUrl,
        shareUrlLabel: "Open Base Profile",
        walletAddress,
        includeBaseLinks: true,
        context,
    });
}

async function executePrepareOpenToken(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    const tokenInput = readString(params.token) || readString(params.tokenAddress);
    if (!tokenInput) {
        return {
            success: false,
            error: "Token is required. Provide a symbol like USDC or a token contract address.",
        };
    }

    const token = resolveTokenInput(tokenInput, context);
    if (!token) {
        return {
            success: false,
            error: `Could not resolve token "${tokenInput}" on the active Base network.`,
        };
    }

    const networkId = getResolvedNetworkId(context);
    const title = truncate(
        readString(params.title) || "Open Token",
        96,
    );
    const message = truncate(
        readString(params.message)
            || (
                networkId === "base-mainnet"
                    ? `Open ${token.symbol} in Base and inspect the live token page.`
                    : `Open ${token.symbol} on ${normalizeNetworkLabel(networkId)} in the explorer.`
            ),
        360,
    );
    const mainnetTokenUrl = buildBaseTokenUrl(token.address, {
        ...context,
        networkId,
    });
    const explorerTokenUrl = buildExplorerTokenUrl(token.address, {
        ...context,
        networkId,
    });

    return buildSharePayload({
        shareKind: "generic",
        title,
        message,
        summary: `Prepared token link for ${token.symbol} on ${normalizeNetworkLabel(networkId)}.`,
        shareUrl: mainnetTokenUrl ?? explorerTokenUrl,
        shareUrlLabel: networkId === "base-mainnet" ? "Open Base Token" : "Open Token",
        tokenAddress: token.address,
        includeBaseLinks: true,
        context: {
            ...context,
            networkId,
        },
    });
}

async function executePrepareOpenTransaction(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    const txHash = readString(params.txHash) || readString(params.hash);
    if (!txHash) {
        return {
            success: false,
            error: "Transaction hash is required.",
        };
    }

    if (!looksLikeTransactionHash(txHash)) {
        return {
            success: false,
            error: "Transaction hash must be a 0x-prefixed 32-byte hash.",
        };
    }

    const networkId = getResolvedNetworkId(context);
    const title = truncate(
        readString(params.title) || "Open Transaction",
        96,
    );
    const message = truncate(
        readString(params.message)
            || `Open this ${normalizeNetworkLabel(networkId)} transaction in the explorer.`,
        360,
    );

    return buildSharePayload({
        shareKind: "generic",
        title,
        message,
        summary: `Prepared transaction link for ${normalizeNetworkLabel(networkId)}.`,
        shareUrl: buildExplorerTransactionUrl(txHash, {
            ...context,
            networkId,
        }),
        shareUrlLabel: "Open Transaction",
        includeBaseLinks: false,
        context: {
            ...context,
            networkId,
        },
    });
}

async function executePrepareBaseShare(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    const title = truncate(
        readString(params.title) || DEFAULT_BASE_SHARE_TITLE,
        96,
    );
    const message = truncate(
        readString(params.message) || DEFAULT_BASE_SHARE_MESSAGE,
        360,
    );
    const shareUrl = resolveShareUrl(params);
    const walletAddress = normalizeOptionalAddress(params.walletAddress ?? context.wallet.address);
    const tokenAddress = normalizeOptionalAddress(params.tokenAddress);
    const includeBaseLinks = readBoolean(params.includeBaseLinks, true);

    return buildSharePayload({
        shareKind: "generic",
        title,
        message,
        summary: shareUrl
            ? `Prepared Base share for ${shareUrl}.`
            : "Prepared Base share copy.",
        shareUrl,
        walletAddress,
        tokenAddress,
        includeBaseLinks,
        context,
    });
}

async function executePrepareTradeShare(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    const networkLabel = normalizeNetworkLabel(context.networkId);
    const { message, summary, tokenAddress } = buildTradeMessage(params, context);
    const title = buildTradeTitle(params, networkLabel);
    const shareUrl = resolveShareUrl(params);
    const walletAddress = normalizeOptionalAddress(params.walletAddress ?? context.wallet.address);
    const includeBaseLinks = readBoolean(params.includeBaseLinks, true);

    return buildSharePayload({
        shareKind: "trade",
        title,
        message,
        summary,
        shareUrl,
        walletAddress,
        tokenAddress,
        includeBaseLinks,
        context,
        extras: {
            tradeStatus: normalizeTradeShareStatus(params.status),
            fromTokenSymbol: readString(params.fromTokenSymbol) || readString(params.sellTokenSymbol),
            toTokenSymbol: readString(params.toTokenSymbol) || readString(params.buyTokenSymbol),
            amountIn: readString(params.amountIn),
            amountOut: readString(params.amountOut) || readString(params.expectedAmountOut),
            workflowName: readString(params.workflowName) || undefined,
        },
    });
}

async function executePrepareShortcutShare(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    const { title, message, summary } = buildShortcutShareMessage(params);
    const shareUrl = resolvePublishedShortcutUrl(params);

    return buildSharePayload({
        shareKind: "workflow",
        title,
        message,
        summary,
        shareUrl,
        includeBaseLinks: false,
        context,
        extras: {
            shortcutSlug: readString(params.slug)
                || readString(params.shortcutSlug)
                || readString(params.publishedSlug)
                || undefined,
            category: readString(params.category) || undefined,
            stepCount: readString(params.stepCount) || undefined,
        },
    });
}

const ACTIONS: SkillActionMeta[] = [
    {
        name: "prepare_base_share",
        label: "Prepare Base Share",
        description:
            "Prepare Base App-friendly share text, copy fallback, and optional Base profile/token links without posting automatically.",
        params: [
            { name: "title", type: "string", required: false, description: "Short share title" },
            { name: "message", type: "string", required: false, description: "Share message body" },
            { name: "url", type: "string", required: false, description: "Primary URL to share" },
            { name: "tokenAddress", type: "address", required: false, description: "Optional Base mainnet token address for a Base App token link" },
            { name: "walletAddress", type: "address", required: false, description: "Optional wallet address for a Base App profile link" },
            { name: "runId", type: "string", required: false, description: "Optional Bavium run identifier for context" },
            { name: "includeBaseLinks", type: "boolean", required: false, description: "Whether to include Base App profile/token links", default: true },
        ],
    },
    {
        name: "prepare_trade_share",
        label: "Prepare Trade Share",
        description:
            "Prepare Base App-ready share copy for a quoted, prepared, submitted, or confirmed trade without posting automatically.",
        params: [
            { name: "status", type: "string", required: false, description: "Trade share status: quoted, prepared, submitted, or confirmed", default: "prepared" },
            { name: "fromTokenSymbol", type: "string", required: false, description: "Input token symbol such as ETH or USDC" },
            { name: "toTokenSymbol", type: "string", required: false, description: "Output token symbol such as USDC or cbBTC" },
            { name: "amountIn", type: "amount", required: false, description: "Input token amount for the share text" },
            { name: "amountOut", type: "amount", required: false, description: "Output or expected amount for the share text" },
            { name: "workflowName", type: "string", required: false, description: "Optional workflow name for context" },
            { name: "url", type: "string", required: false, description: "Workflow, published page, or run URL to include" },
            { name: "tokenAddress", type: "address", required: false, description: "Optional Base mainnet token address for a Base App token link" },
            { name: "walletAddress", type: "address", required: false, description: "Optional wallet address for a Base App profile link" },
            { name: "includeBaseLinks", type: "boolean", required: false, description: "Whether to include Base App profile/token links", default: true },
        ],
    },
    {
        name: "prepare_shortcut_share",
        label: "Prepare Workflow Share",
        description:
            "Prepare share copy and a published Bavium workflow URL for Base App or the web without posting automatically.",
        params: [
            { name: "name", type: "string", required: false, description: "Workflow name for the share title" },
            { name: "slug", type: "string", required: false, description: "Published Bavium slug that maps to /p/{slug}" },
            { name: "url", type: "string", required: false, description: "Optional absolute workflow URL override" },
            { name: "description", type: "string", required: false, description: "Short workflow description for the share body" },
            { name: "category", type: "string", required: false, description: "Workflow category such as Swap or DeFi" },
            { name: "stepCount", type: "string", required: false, description: "Optional workflow step count for context" },
            { name: "message", type: "string", required: false, description: "Optional custom share body override" },
        ],
    },
    {
        name: "prepare_open_profile",
        label: "Open Base Profile",
        description:
            "Prepare copy and an openable Base profile link for a wallet address or basename without posting automatically.",
        params: [
            { name: "target", type: "string", required: false, description: "Wallet address or .base.eth / ENS name. Defaults to the connected wallet when omitted." },
            { name: "title", type: "string", required: false, description: "Optional custom title" },
            { name: "message", type: "string", required: false, description: "Optional custom message body" },
        ],
    },
    {
        name: "prepare_open_token",
        label: "Open Token",
        description:
            "Prepare copy and an openable token link for Base App on mainnet or explorer fallback on Base Sepolia without posting automatically.",
        params: [
            { name: "token", type: "string", required: true, description: "Token symbol or contract address on the active Base network" },
            { name: "title", type: "string", required: false, description: "Optional custom title" },
            { name: "message", type: "string", required: false, description: "Optional custom message body" },
        ],
    },
    {
        name: "prepare_open_tx",
        label: "Open Transaction",
        description:
            "Prepare copy and an explorer link for a Base or Base Sepolia transaction hash without posting automatically.",
        params: [
            { name: "txHash", type: "string", required: true, description: "Transaction hash to open" },
            { name: "title", type: "string", required: false, description: "Optional custom title" },
            { name: "message", type: "string", required: false, description: "Optional custom message body" },
        ],
    },
];

const socialSkill: ISkill = {
    name: "social",
    label: "Social",
    category: "social",
    description: "User-controlled share preparation for Base App and standard web contexts.",
    actions: ACTIONS,

    async execute(action, params, context) {
        switch (action) {
            case "prepare_base_share":
                return executePrepareBaseShare(params, context);
            case "prepare_trade_share":
                return executePrepareTradeShare(params, context);
            case "prepare_shortcut_share":
                return executePrepareShortcutShare(params, context);
            case "prepare_open_profile":
                return executePrepareOpenProfile(params, context);
            case "prepare_open_token":
                return executePrepareOpenToken(params, context);
            case "prepare_open_tx":
                return executePrepareOpenTransaction(params, context);
            default:
                return {
                    success: false,
                    error: `Unknown social action "${action}"`,
                };
        }
    },
};

skillRegistry.register(socialSkill);
