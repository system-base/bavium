/* ==========================================================================
   Constants & Static Data
   ========================================================================== */

export type BlockCategory =
    | "wallet"
    | "swap"
    | "bridge"
    | "defi"
    | "nft"
    | "social"
    | "data"
    | "x402"
    | "logic";

export interface CategoryMeta {
    label: string;
    cssColor: string;
    showInShortcutFilters?: boolean;
    showInPublishDialog?: boolean;
}

export const CATEGORY_META: Record<
    BlockCategory,
    CategoryMeta
> = {
    wallet: { label: "Wallet", cssColor: "var(--color-block-wallet)" },
    swap: { label: "Swap", cssColor: "var(--color-block-swap)" },
    bridge: { label: "Bridge", cssColor: "var(--color-block-bridge)" },
    defi: { label: "DeFi", cssColor: "var(--color-block-defi)" },
    nft: { label: "NFT", cssColor: "var(--color-block-nft)" },
    social: {
        label: "Social",
        cssColor: "var(--color-block-social)",
        showInShortcutFilters: false,
        showInPublishDialog: false,
    },
    data: { label: "Data", cssColor: "var(--color-block-data)" },
    x402: {
        label: "x402",
        cssColor: "var(--color-block-x402)",
        showInShortcutFilters: false,
        showInPublishDialog: false,
    },
    logic: { label: "Logic", cssColor: "var(--color-block-logic)" },
};

function collectVisibleCategories(
    flag: "showInShortcutFilters" | "showInPublishDialog",
): BlockCategory[] {
    return (Object.entries(CATEGORY_META) as [BlockCategory, CategoryMeta][])
        .filter(([, meta]) => meta[flag] !== false)
        .map(([category]) => category);
}

export const SHORTCUT_FILTER_CATEGORIES = collectVisibleCategories(
    "showInShortcutFilters",
);
export const PUBLISHABLE_SHORTCUT_CATEGORIES = collectVisibleCategories(
    "showInPublishDialog",
);

import {
    Wallet,
    ArrowLeftRight,
    Landmark,
    Image,
    MessageCircle,
    BarChart3,
    Globe,
    Cog,
    Waypoints,
} from "lucide-react";
import { ACROSS_DESTINATION_OPTIONS } from "@/lib/across-config";

export const CATEGORY_ICONS: Record<BlockCategory, typeof Wallet> = {
    wallet: Wallet,
    swap: ArrowLeftRight,
    bridge: Waypoints,
    defi: Landmark,
    nft: Image,
    social: MessageCircle,
    data: BarChart3,
    x402: Globe,
    logic: Cog,
};

/* Skill palette items for the builder */

export type ParamType =
    | "token"       // Token dropdown (ETH, USDC, WETH, DAI, AERO, DEGEN)
    | "address"     // Ethereum address input with 0x validation
    | "amount"      // Numeric amount input
    | "number"      // Generic number input
    | "text"        // Free text
    | "select"      // Predefined options dropdown
    | "boolean"     // Toggle / checkbox
    | "operator"    // Math operator (+, -, *, /)
    | "condition";  // Structured condition builder (Apple Shortcuts style)

export interface SkillParamDef {
    /** Parameter key sent to the skill executor */
    key: string;
    /** Human-readable label shown in UI */
    label: string;
    /** Input type — determines which widget renders */
    type: ParamType;
    /** Whether the param is required */
    required: boolean;
    /** Default value (used when block is first added) */
    defaultValue?: string;
    /** Options for 'select' type */
    options?: Array<{ label: string; value: string; description?: string; group?: string; disabled?: boolean }>;
    /** Placeholder text */
    placeholder?: string;
    /** Short description shown as tooltip/hint */
    hint?: string;
    /** Whether this parameter should live under Advanced in the Builder */
    advanced?: boolean;
}

export interface SkillDefinition {
    id: string;
    label: string;
    description: string;
    category: BlockCategory;
    tier: SkillTier;
    /** Parameter definitions — used to auto-build smart param editor */
    params: SkillParamDef[];
    /** Whether this skill requires wallet confirmation */
    requiresConfirmation?: boolean;
}

export type SkillTier = "core" | "support" | "advanced";

const ACROSS_TOKEN_OPTIONS: { label: string; value: string }[] = [
    { label: "USDC", value: "USDC" },
    { label: "WETH", value: "WETH" },
    { label: "DAI", value: "DAI" },
    { label: "WBTC", value: "WBTC" },
    { label: "USDT", value: "USDT" },
];

export const SKILL_PALETTE: SkillDefinition[] = [
    // ── Wallet ─────────────────────────────────────────────────────────────
    {
        id: "wallet.get_balance",
        label: "Check Balance",
        description: "Check one token balance for the connected wallet or any Base address",
        category: "wallet",
        tier: "core",
        params: [
            { key: "address", label: "Wallet Address", type: "address", required: false, placeholder: "0x...", hint: "Leave empty to use the connected wallet" },
            { key: "token", label: "Token", type: "token", required: false, defaultValue: "ETH", hint: "Token symbol or Base token contract address" },
        ],
    },
    {
        id: "wallet.send_eth",
        label: "Send ETH",
        description: "Transfer native ETH to an address",
        category: "wallet",
        tier: "core",
        requiresConfirmation: true,
        params: [
            { key: "to", label: "Recipient", type: "address", required: true, placeholder: "0x...", hint: "Destination address" },
            { key: "amount", label: "Amount (ETH)", type: "amount", required: true, placeholder: "0.01", hint: "Amount in ETH" },
        ],
    },
    {
        id: "wallet.send_token",
        label: "Send Token",
        description: "Transfer ERC-20 tokens to an address",
        category: "wallet",
        tier: "core",
        requiresConfirmation: true,
        params: [
            { key: "token", label: "Token", type: "token", required: false, defaultValue: "USDC", hint: "Token symbol or Base token contract address" },
            { key: "to", label: "Recipient", type: "address", required: true, placeholder: "0x...", hint: "Destination address" },
            { key: "amount", label: "Amount", type: "amount", required: true, placeholder: "100", hint: "Amount to send" },
        ],
    },
    {
        id: "wallet.details",
        label: "Get Wallet Overview",
        description: "See wallet address, optional basename, network, ETH, and registered token balances",
        category: "wallet",
        tier: "support",
        params: [
            { key: "includeBasename", label: "Resolve Basename", type: "boolean", required: false, defaultValue: "true", advanced: true, hint: "Try reverse name lookup for the connected wallet" },
        ],
    },
    {
        id: "wallet.resolve_basename",
        label: "Resolve Basename",
        description: "Best-effort reverse lookup from a Base wallet address to a basename or ENS name",
        category: "wallet",
        tier: "support",
        params: [
            { key: "address", label: "Wallet Address", type: "address", required: false, placeholder: "0x...", hint: "Leave empty to resolve the connected wallet" },
        ],
    },
    {
        id: "wallet.resolve_address",
        label: "Resolve Address",
        description: "Best-effort forward lookup from a .base.eth or ENS name to a wallet address",
        category: "wallet",
        tier: "support",
        params: [
            { key: "name", label: "Name", type: "text", required: true, placeholder: "jesse.base.eth", hint: "Resolve a Base basename or ENS name" },
        ],
    },

    // ── Swap ───────────────────────────────────────────────────────────────
    {
        id: "swap.uniswap_quote",
        label: "Get Swap Quote",
        description: "Estimate output for a single-pool Uniswap v3 swap on Base",
        category: "swap",
        tier: "core",
        params: [
            { key: "tokenIn", label: "Pay With", type: "token", required: true, defaultValue: "WETH", hint: "Token you want to spend" },
            { key: "tokenOut", label: "Receive", type: "token", required: true, defaultValue: "USDC", hint: "Token you want to receive" },
            { key: "amountIn", label: "Amount", type: "amount", required: true, placeholder: "0.1", hint: "Amount of the input token to swap" },
            {
                key: "feeTier", label: "Pool Fee", type: "select", required: false, defaultValue: "auto", advanced: true,
                options: [
                    { label: "Auto (Recommended)", value: "auto" },
                    { label: "0.05%", value: "500" },
                    { label: "0.30%", value: "3000" },
                    { label: "1.00%", value: "10000" },
                ],
                hint: "Auto tries supported Uniswap v3 fee tiers and picks the best quoted output. Only override this if you know the exact pool.",
            },
        ],
    },
    {
        id: "swap.uniswap_prepare_swap",
        label: "Swap Tokens",
        description: "Build unsigned approval and swap calls for a single-pool Uniswap v3 swap on Base",
        category: "swap",
        tier: "core",
        requiresConfirmation: true,
        params: [
            { key: "tokenIn", label: "Pay With", type: "token", required: true, defaultValue: "WETH", hint: "Token you want to spend" },
            { key: "tokenOut", label: "Receive", type: "token", required: true, defaultValue: "USDC", hint: "Token you want to receive" },
            { key: "amountIn", label: "Amount", type: "amount", required: true, placeholder: "0.1", hint: "Amount of the input token to swap" },
            {
                key: "feeTier", label: "Pool Fee", type: "select", required: false, defaultValue: "auto", advanced: true,
                options: [
                    { label: "Auto (Recommended)", value: "auto" },
                    { label: "0.05%", value: "500" },
                    { label: "0.30%", value: "3000" },
                    { label: "1.00%", value: "10000" },
                ],
                hint: "Auto tries supported Uniswap v3 fee tiers and picks the best quoted output. Only override this if you know the exact pool.",
            },
            {
                key: "slippageBps",
                label: "Max Slippage",
                type: "select",
                required: false,
                defaultValue: "auto",
                advanced: true,
                options: [
                    {
                        label: "Auto (Recommended)",
                        value: "auto",
                        description: "Bavium currently uses a 0.50% default.",
                    },
                    { label: "0.10%", value: "10" },
                    { label: "0.50%", value: "50" },
                    { label: "1.00%", value: "100" },
                    { label: "3.00%", value: "300" },
                    { label: "5.00%", value: "500" },
                ],
                hint: "Leave this in Auto for normal swaps. Raise it only for volatile pairs or tokens with transfer fees.",
            },
        ],
    },
    {
        id: "swap.uniswap_positions",
        label: "Uniswap Positions",
        description: "Read Uniswap LP NFT positions for the connected wallet",
        category: "swap",
        tier: "advanced",
        params: [
            { key: "maxPositions", label: "Max Positions", type: "number", required: false, defaultValue: "5", hint: "Limit returned positions for readability" },
        ],
    },
    {
        id: "swap.uniswap_collect_fees",
        label: "Uniswap Collect Fees",
        description: "Prepare a fee collection transaction for a Uniswap LP NFT position",
        category: "swap",
        tier: "advanced",
        requiresConfirmation: true,
        params: [
            { key: "tokenId", label: "Position Token ID", type: "text", required: true, placeholder: "12345" },
            { key: "recipient", label: "Recipient", type: "address", required: false, placeholder: "0x...", hint: "Defaults to the connected wallet" },
        ],
    },

    // ── DeFi ───────────────────────────────────────────────────────────────
    {
        id: "defi.morpho_deposit",
        label: "Morpho Deposit",
        description: "Prepare a Base mainnet Morpho deposit for the supported USDC vault",
        category: "defi",
        tier: "core",
        requiresConfirmation: true,
        params: [
            {
                key: "vaultId", label: "Vault", type: "select", required: false, defaultValue: "morpho-usdc",
                options: [{ label: "Morpho USDC Vault", value: "morpho-usdc" }]
            },
            { key: "amount", label: "Amount", type: "amount", required: true, placeholder: "100", hint: "USDC to deposit" },
        ],
    },
    {
        id: "defi.morpho_withdraw",
        label: "Morpho Withdraw",
        description: "Prepare a Base mainnet Morpho withdrawal from the supported USDC vault",
        category: "defi",
        tier: "core",
        requiresConfirmation: true,
        params: [
            {
                key: "vaultId", label: "Vault", type: "select", required: false, defaultValue: "morpho-usdc",
                options: [{ label: "Morpho USDC Vault", value: "morpho-usdc" }]
            },
            { key: "amount", label: "Amount", type: "amount", required: true, placeholder: "100", hint: "USDC to withdraw" },
        ],
    },
    {
        id: "defi.morpho_portfolio",
        label: "DeFi Portfolio",
        description: "Read Morpho vault positions for the connected wallet on Base mainnet",
        category: "defi",
        tier: "support",
        params: [],
    },
    {
        id: "defi.clanker_deploy_token",
        label: "Clanker Launch Token",
        description: "Prepare a Clanker token launch with the standard WETH quote-token path",
        category: "defi",
        tier: "advanced",
        requiresConfirmation: true,
        params: [
            { key: "name", label: "Token Name", type: "text", required: true, placeholder: "Bavium Pepe" },
            { key: "symbol", label: "Token Symbol", type: "text", required: true, placeholder: "BPEPE", hint: "2-10 alphanumeric characters" },
            { key: "image", label: "Image URL", type: "text", required: false, placeholder: "ipfs://..." },
            { key: "description", label: "Description", type: "text", required: false, placeholder: "Launch campaign token" },
            { key: "website", label: "Website", type: "text", required: false, placeholder: "https://example.com" },
            { key: "socialLinks", label: "Social Links", type: "text", required: false, placeholder: "https://x.com/...,https://warpcast.com/..." },
            { key: "tokenAdmin", label: "Token Admin", type: "address", required: false, placeholder: "0x...", hint: "Defaults to the connected wallet" },
            {
                key: "quoteToken", label: "Quote Token", type: "select", required: false, defaultValue: "WETH",
                options: [{ label: "WETH", value: "WETH" }]
            },
            { key: "includeSniperProtection", label: "Sniper Protection", type: "boolean", required: false, defaultValue: "true", hint: "Use Clanker's default descending sniper fee module" },
        ],
    },
    // ── NFT ────────────────────────────────────────────────────────────────
    {
        id: "nft.check_ownership",
        label: "Check NFT Ownership",
        description: "Read whether a wallet owns a specific ERC-721 or ERC-1155 token on Base",
        category: "nft",
        tier: "core",
        params: [
            { key: "contractAddress", label: "Contract Address", type: "address", required: true, placeholder: "0x...", hint: "ERC-721 or ERC-1155 contract on Base" },
            { key: "tokenId", label: "Token ID", type: "number", required: true, placeholder: "1", hint: "NFT token identifier" },
            { key: "address", label: "Wallet Address", type: "address", required: false, placeholder: "0x...", hint: "Defaults to the connected wallet" },
            {
                key: "standard", label: "Standard", type: "select", required: false, defaultValue: "auto", advanced: true,
                options: [
                    { label: "Auto Detect", value: "auto" },
                    { label: "ERC-721", value: "erc721" },
                    { label: "ERC-1155", value: "erc1155" },
                ],
                hint: "Leave on auto unless you know the contract standard",
            },
        ],
    },
    {
        id: "nft.get_token_metadata",
        label: "Get NFT Metadata",
        description: "Read collection details and best-effort token metadata for a known NFT",
        category: "nft",
        tier: "support",
        params: [
            { key: "contractAddress", label: "Contract Address", type: "address", required: true, placeholder: "0x...", hint: "ERC-721 or ERC-1155 contract on Base" },
            { key: "tokenId", label: "Token ID", type: "number", required: true, placeholder: "1", hint: "NFT token identifier" },
            {
                key: "standard", label: "Standard", type: "select", required: false, defaultValue: "auto", advanced: true,
                options: [
                    { label: "Auto Detect", value: "auto" },
                    { label: "ERC-721", value: "erc721" },
                    { label: "ERC-1155", value: "erc1155" },
                ],
                hint: "Leave on auto unless you know the contract standard",
            },
        ],
    },
    // ── Data ───────────────────────────────────────────────────────────────
    {
        id: "data.pyth_price",
        label: "Get Price",
        description: "Get real-time price from Pyth oracle",
        category: "data",
        tier: "core",
        params: [
            {
                key: "symbol", label: "Token", type: "select", required: true, defaultValue: "ETH",
                options: [
                    { label: "ETH", value: "ETH" },
                    { label: "BTC", value: "BTC" },
                    { label: "SOL", value: "SOL" },
                    { label: "USDC", value: "USDC" },
                ]
            },
        ],
    },
    {
        id: "data.token_prices",
        label: "Token Prices",
        description: "Fetch prices for multiple tokens using token symbols or registered token addresses",
        category: "data",
        tier: "core",
        params: [
            { key: "tokens", label: "Tokens", type: "text", required: true, defaultValue: "ETH,USDC", hint: "Search and add token symbols or Base token addresses" },
        ],
    },
    {
        id: "data.portfolio_snapshot",
        label: "Wallet Portfolio",
        description: "Read wallet balances for the connected wallet or any Base address, with optional USD, basename, DeFi, and LP context",
        category: "data",
        tier: "core",
        params: [
            { key: "address", label: "Wallet Address", type: "address", required: false, placeholder: "0x...", hint: "Leave empty to use the connected wallet" },
            { key: "tokens", label: "Tracked Tokens", type: "text", required: false, defaultValue: "USDC,WETH,DAI", hint: "Search and add token symbols or token addresses to track" },
            { key: "includeUsdValue", label: "Include USD Value", type: "boolean", required: false, defaultValue: "true", hint: "Enrich balances with USD values when possible" },
            { key: "includeBasename", label: "Resolve Basename", type: "boolean", required: false, defaultValue: "true", hint: "Try reverse name lookup for the wallet" },
            { key: "includeDefiPositions", label: "Include DeFi Positions", type: "boolean", required: false, defaultValue: "true", hint: "Include Morpho vault positions in the portfolio result", advanced: true },
            { key: "includeLiquidityPositions", label: "Include LP Positions", type: "boolean", required: false, defaultValue: "true", hint: "Include Uniswap LP positions in the portfolio result", advanced: true },
            { key: "maxLiquidityPositions", label: "Max LP Positions", type: "number", required: false, defaultValue: "5", hint: "Limit Uniswap LP positions for readability", advanced: true },
        ],
    },
    {
        id: "data.wallet_activity",
        label: "Wallet Activity",
        description: "Read recent wallet activity from the public Base explorer index",
        category: "data",
        tier: "core",
        params: [
            { key: "address", label: "Wallet Address", type: "address", required: false, placeholder: "0x...", hint: "Defaults to the connected wallet" },
            {
                key: "filter", label: "Direction", type: "select", required: false, defaultValue: "all", advanced: true,
                options: [
                    { label: "All Activity", value: "all" },
                    { label: "Incoming Only", value: "to" },
                    { label: "Outgoing Only", value: "from" },
                ],
                hint: "Filter the recent activity stream by incoming or outgoing transactions.",
            },
            { key: "maxItems", label: "Max Items", type: "number", required: false, defaultValue: "10", hint: "Limit returned activity items for readability", advanced: true },
        ],
    },
    {
        id: "tx.get_receipt",
        label: "Get Transaction Receipt",
        description: "Inspect a mined transaction receipt by hash on the active Base network",
        category: "data",
        tier: "support",
        params: [
            { key: "txHash", label: "Transaction Hash", type: "text", required: true, placeholder: "0x...", hint: "A Base transaction hash to inspect" },
        ],
    },
    {
        id: "tx.wait_confirmation",
        label: "Wait for Confirmation",
        description: "Wait for a known Base transaction hash to reach a target confirmation count",
        category: "data",
        tier: "support",
        params: [
            { key: "txHash", label: "Transaction Hash", type: "text", required: true, placeholder: "0x...", hint: "A Base transaction hash to wait for" },
            { key: "confirmations", label: "Confirmations", type: "number", required: false, defaultValue: "1", hint: "How many confirmations to wait for", advanced: true },
            { key: "timeoutSeconds", label: "Timeout (seconds)", type: "number", required: false, defaultValue: "120", hint: "Stop waiting after this many seconds", advanced: true },
        ],
    },
    {
        id: "bridge.list_routes",
        label: "List Bridge Routes",
        description: "Read Across bridge route availability from the active Base network",
        category: "bridge",
        tier: "support",
        params: [
            {
                key: "destinationChainId", label: "Destination", type: "select", required: false, advanced: true,
                options: ACROSS_DESTINATION_OPTIONS,
                hint: "Leave empty to list all routes. Choose a chain supported by the active Base network.",
            },
        ],
    },
    {
        id: "bridge.get_quote",
        label: "Get Bridge Quote",
        description: "Read an indicative same-asset Across quote from Base to another chain",
        category: "bridge",
        tier: "support",
        params: [
            {
                key: "destinationChainId", label: "Destination", type: "select", required: true,
                options: ACROSS_DESTINATION_OPTIONS,
                hint: "Choose a destination supported by the active Base network.",
            },
            {
                key: "tokenSymbol", label: "Token", type: "select", required: true, defaultValue: "USDC",
                options: ACROSS_TOKEN_OPTIONS,
                hint: "Current Bavium bridge flow supports same-symbol routes only, such as USDC to USDC.",
            },
            { key: "amount", label: "Amount", type: "amount", required: true, placeholder: "100", hint: "Human-readable amount for a read-only quote preview" },
        ],
    },
    {
        id: "bridge.track_transfer",
        label: "Track Bridge Transfer",
        description: "Check the status of an Across bridge transfer",
        category: "bridge",
        tier: "advanced",
        params: [
            { key: "depositTxnRef", label: "Deposit Tx Ref", type: "text", required: true, placeholder: "0x...", hint: "Across deposit transaction hash or ref" },
        ],
    },

    // ── Social ─────────────────────────────────────────────────────────────
    {
        id: "social.prepare_base_share",
        label: "Prepare Base Share",
        description: "Prepare Base App-ready share text, copy fallback, and optional Base profile/token links",
        category: "social",
        tier: "support",
        params: [
            { key: "title", label: "Title", type: "text", required: false, defaultValue: "Base workflow", hint: "Short title for the share card or message" },
            { key: "message", label: "Message", type: "text", required: false, defaultValue: "Built a Base workflow in Bavium.", hint: "Text the user can copy or share" },
            { key: "url", label: "Share URL", type: "text", required: false, placeholder: "https://...", hint: "Published workflow, run, token, or profile URL" },
            { key: "tokenAddress", label: "Token Address", type: "address", required: false, placeholder: "0x...", hint: "Optional Base mainnet token address for a Base App token link", advanced: true },
            { key: "walletAddress", label: "Wallet Address", type: "address", required: false, placeholder: "0x...", hint: "Optional wallet address for a Base App profile link", advanced: true },
            { key: "runId", label: "Run ID", type: "text", required: false, placeholder: "run id", hint: "Optional Bavium run identifier for context", advanced: true },
            { key: "includeBaseLinks", label: "Include Base Links", type: "boolean", required: false, defaultValue: "true", hint: "Generate Base App profile/token links when possible", advanced: true },
        ],
    },
    {
        id: "social.prepare_trade_share",
        label: "Prepare Trade Share",
        description: "Prepare share copy for a quoted, prepared, submitted, or confirmed Base trade",
        category: "social",
        tier: "support",
        params: [
            {
                key: "status",
                label: "Trade Status",
                type: "select",
                required: false,
                defaultValue: "prepared",
                options: [
                    { label: "Quoted", value: "quoted" },
                    { label: "Prepared", value: "prepared" },
                    { label: "Submitted", value: "submitted" },
                    { label: "Confirmed", value: "confirmed" },
                ],
                hint: "Choose the safest status that matches the actual trade state.",
            },
            { key: "fromTokenSymbol", label: "From Token", type: "text", required: false, placeholder: "ETH", hint: "Input token symbol used in the trade" },
            { key: "toTokenSymbol", label: "To Token", type: "text", required: false, placeholder: "USDC", hint: "Output token symbol used in the trade" },
            { key: "amountIn", label: "Amount In", type: "amount", required: false, placeholder: "0.5", hint: "Input amount for the share copy" },
            { key: "amountOut", label: "Amount Out", type: "amount", required: false, placeholder: "900", hint: "Quoted or received amount for the share copy" },
            { key: "workflowName", label: "Workflow Name", type: "text", required: false, placeholder: "ETH to USDC Swing Trade", hint: "Optional Bavium workflow name for context" },
            { key: "url", label: "Share URL", type: "text", required: false, placeholder: "https://...", hint: "Workflow, run, or published page URL to include" },
            { key: "tokenAddress", label: "Token Address", type: "address", required: false, placeholder: "0x...", hint: "Optional Base mainnet receive-token address for a Base App token link", advanced: true },
            { key: "walletAddress", label: "Wallet Address", type: "address", required: false, placeholder: "0x...", hint: "Optional wallet address for a Base App profile link", advanced: true },
            { key: "includeBaseLinks", label: "Include Base Links", type: "boolean", required: false, defaultValue: "true", hint: "Generate Base App profile/token links when possible", advanced: true },
        ],
    },
    {
        id: "social.prepare_shortcut_share",
        label: "Prepare Workflow Share",
        description: "Prepare share copy and a published Bavium workflow URL for Base App or the web",
        category: "social",
        tier: "support",
        params: [
            { key: "name", label: "Workflow Name", type: "text", required: false, placeholder: "Conditional ETH to USDC Swap", hint: "Workflow title for the share output" },
            { key: "slug", label: "Published Slug", type: "text", required: false, placeholder: "conditional-eth-to-usdc-swap", hint: "Published Bavium slug used to build /p/{slug}" },
            { key: "url", label: "Workflow URL", type: "text", required: false, placeholder: "https://...", hint: "Optional absolute workflow URL override" },
            { key: "description", label: "Description", type: "text", required: false, placeholder: "Reacts to price moves and prepares a swap.", hint: "Short description for the share body" },
            {
                key: "category",
                label: "Category",
                type: "select",
                required: false,
                options: PUBLISHABLE_SHORTCUT_CATEGORIES.map((category) => ({
                    label: CATEGORY_META[category].label,
                    value: category,
                })),
                hint: "Optional published workflow category for share context.",
            },
            { key: "stepCount", label: "Step Count", type: "number", required: false, placeholder: "4", hint: "Optional step count shown in the share context" },
            { key: "message", label: "Custom Message", type: "text", required: false, placeholder: "Open, run, or remix this workflow in Bavium.", hint: "Optional custom share body override", advanced: true },
        ],
    },
    {
        id: "social.prepare_open_profile",
        label: "Open Base Profile",
        description: "Prepare copy and an openable Base profile link for an address or basename",
        category: "social",
        tier: "support",
        params: [
            { key: "target", label: "Address or Name", type: "text", required: false, placeholder: "jesse.base.eth or 0x...", hint: "Defaults to the connected wallet when left empty" },
            { key: "title", label: "Title", type: "text", required: false, defaultValue: "Open Base Profile", hint: "Short title for the share card or message", advanced: true },
            { key: "message", label: "Message", type: "text", required: false, placeholder: "Open this Base profile.", hint: "Optional custom text the user can copy or share", advanced: true },
        ],
    },
    {
        id: "social.prepare_open_token",
        label: "Open Token",
        description: "Prepare copy and an openable token link for Base App on mainnet or explorer fallback on Sepolia",
        category: "social",
        tier: "support",
        params: [
            { key: "token", label: "Token", type: "token", required: true, defaultValue: "USDC", hint: "Token symbol or Base token contract address" },
            { key: "title", label: "Title", type: "text", required: false, defaultValue: "Open Token", hint: "Short title for the share card or message", advanced: true },
            { key: "message", label: "Message", type: "text", required: false, placeholder: "Open this token page.", hint: "Optional custom text the user can copy or share", advanced: true },
        ],
    },
    {
        id: "social.prepare_open_tx",
        label: "Open Transaction",
        description: "Prepare copy and an openable transaction link for the active Base explorer",
        category: "social",
        tier: "support",
        params: [
            { key: "txHash", label: "Transaction Hash", type: "text", required: true, placeholder: "0x...", hint: "Base or Base Sepolia transaction hash" },
            { key: "title", label: "Title", type: "text", required: false, defaultValue: "Open Transaction", hint: "Short title for the share card or message", advanced: true },
            { key: "message", label: "Message", type: "text", required: false, placeholder: "Open this transaction in the explorer.", hint: "Optional custom text the user can copy or share", advanced: true },
        ],
    },

    // ── x402 ───────────────────────────────────────────────────────────────
    {
        id: "x402.discover_services",
        label: "Discover x402 Services",
        description: "Read Bazaar-discoverable x402 HTTP endpoints or MCP tools on Base without paying for them",
        category: "x402",
        tier: "support",
        params: [
            {
                key: "facilitator",
                label: "Facilitator",
                type: "select",
                required: false,
                defaultValue: "coinbase",
                options: [
                    { label: "Coinbase", value: "coinbase" },
                    { label: "PayAI", value: "payai" },
                ],
                hint: "Choose which Bazaar facilitator to query.",
            },
            {
                key: "type",
                label: "Service Type",
                type: "select",
                required: false,
                defaultValue: "all",
                options: [
                    { label: "All", value: "all" },
                    { label: "HTTP", value: "http" },
                    { label: "MCP", value: "mcp" },
                ],
                hint: "Filter by HTTP endpoints or MCP tools.",
            },
            {
                key: "network",
                label: "Network",
                type: "select",
                required: false,
                defaultValue: "base-mainnet",
                options: [
                    { label: "Base Mainnet", value: "base-mainnet" },
                    { label: "Base Sepolia", value: "base-sepolia" },
                    { label: "All Networks", value: "all" },
                ],
                hint: "Keep this on Base Mainnet unless you specifically want testnet services.",
            },
            {
                key: "keyword",
                label: "Search",
                type: "text",
                required: false,
                placeholder: "weather, market data, search",
                hint: "Uses Coinbase Bazaar semantic search when available; PayAI falls back to catalog filtering.",
            },
            {
                key: "asset",
                label: "Asset",
                type: "text",
                required: false,
                placeholder: "usdc",
                hint: "Optional Coinbase Bazaar filter for payment asset.",
                advanced: true,
            },
            {
                key: "scheme",
                label: "Scheme",
                type: "select",
                required: false,
                defaultValue: "",
                options: [
                    { label: "Any", value: "" },
                    { label: "Exact", value: "exact" },
                    { label: "Up To", value: "upto" },
                ],
                hint: "Optional Coinbase Bazaar filter for x402 payment scheme.",
                advanced: true,
            },
            {
                key: "maxUsdPrice",
                label: "Max USD Price",
                type: "text",
                required: false,
                placeholder: "0.50",
                hint: "Optional Coinbase Bazaar price ceiling.",
                advanced: true,
            },
            {
                key: "payTo",
                label: "Merchant",
                type: "text",
                required: false,
                placeholder: "0x...",
                hint: "Optional payTo address filter.",
                advanced: true,
            },
            {
                key: "maxResults",
                label: "Max Results",
                type: "number",
                required: false,
                defaultValue: "10",
                hint: "Limit returned services for readability.",
                advanced: true,
            },
        ],
    },

    // ── Logic ──────────────────────────────────────────────────────────────
    {
        id: "logic.assert",
        label: "Assert",
        description: "Validate a condition before proceeding",
        category: "logic",
        tier: "core",
        params: [
            { key: "condition", label: "Condition", type: "condition", required: true, hint: "Condition that must be true to continue" },
            { key: "errorMessage", label: "Error Message", type: "text", required: false, placeholder: "Assertion failed", defaultValue: "Assertion failed" },
        ],
    },
    {
        id: "logic.if_else",
        label: "If / Else",
        description: "Branch based on a condition",
        category: "logic",
        tier: "core",
        params: [
            { key: "condition", label: "Condition", type: "condition", required: true, hint: "Condition to evaluate for branching" },
        ],
    },
    {
        id: "logic.ask_input",
        label: "Ask for Input",
        description: "Pause the shortcut and collect a runtime value from the user",
        category: "logic",
        tier: "core",
        params: [
            { key: "prompt", label: "Prompt", type: "text", required: true, placeholder: "How much USDC should we send?" },
            {
                key: "inputType", label: "Input Type", type: "select", required: false, defaultValue: "text",
                options: [
                    { label: "Text", value: "text" },
                    { label: "Number", value: "number" },
                    { label: "Amount", value: "amount" },
                    { label: "Address", value: "address" },
                ],
            },
            { key: "defaultValue", label: "Default Value", type: "text", required: false, placeholder: "100" },
            { key: "placeholder", label: "Placeholder", type: "text", required: false, placeholder: "Enter a value" },
        ],
    },
    {
        id: "logic.choose_menu",
        label: "Choose from Menu",
        description: "Pause the shortcut and let the user pick from a fixed list of options",
        category: "logic",
        tier: "core",
        params: [
            { key: "prompt", label: "Prompt", type: "text", required: true, placeholder: "Which token should we inspect?" },
            { key: "options", label: "Options", type: "text", required: true, placeholder: "ETH, USDC, cbBTC", hint: "Use commas or new lines to list the available options" },
            { key: "defaultValue", label: "Default Option", type: "text", required: false, placeholder: "ETH" },
        ],
    },
    {
        id: "logic.repeat",
        label: "Repeat",
        description: "Run a nested group of actions a fixed number of times",
        category: "logic",
        tier: "core",
        params: [
            { key: "count", label: "Count", type: "number", required: true, defaultValue: "3", placeholder: "3" },
        ],
    },
    {
        id: "logic.repeat_each",
        label: "Repeat with Each",
        description: "Run a nested group of actions once for each item in a list",
        category: "logic",
        tier: "core",
        params: [
            {
                key: "items",
                label: "Items",
                type: "text",
                required: true,
                placeholder: "ETH, USDC, cbBTC",
                hint: "Use commas, new lines, JSON, or a previous step that resolves to an array",
            },
        ],
    },
    {
        id: "logic.wait",
        label: "Wait",
        description: "Pause execution for a duration",
        category: "logic",
        tier: "advanced",
        params: [
            { key: "seconds", label: "Duration (seconds)", type: "number", required: true, defaultValue: "5", placeholder: "5" },
        ],
    },
    {
        id: "logic.stop",
        label: "Stop Shortcut",
        description: "Stop the shortcut in a controlled way",
        category: "logic",
        tier: "support",
        params: [
            { key: "message", label: "Message", type: "text", required: false, placeholder: "Shortcut stopped", defaultValue: "Shortcut stopped" },
        ],
    },
    {
        id: "logic.set_variable",
        label: "Set Variable",
        description: "Give a computed value a readable variable name when direct step references would be unclear",
        category: "logic",
        tier: "advanced",
        params: [
            { key: "value", label: "Value", type: "text", required: true, placeholder: "Choose a value or type text" },
        ],
    },
    {
        id: "logic.get_variable",
        label: "Get Variable",
        description: "Load a saved variable as the current step result when it improves flow readability",
        category: "logic",
        tier: "support",
        params: [
            { key: "variable", label: "Variable", type: "text", required: true, placeholder: "Choose a saved variable" },
        ],
    },
    {
        id: "logic.format",
        label: "Format Text",
        description: "Combine multiple values into a single text output for downstream steps",
        category: "logic",
        tier: "core",
        params: [
            { key: "template", label: "Template", type: "text", required: true, placeholder: "Write text, then insert values from previous steps" },
        ],
    },
    {
        id: "logic.notify",
        label: "Show Notification",
        description: "Show a result notification",
        category: "logic",
        tier: "core",
        params: [
            { key: "message", label: "Message", type: "text", required: true, placeholder: "Transfer complete!" },
            {
                key: "level", label: "Level", type: "select", required: false, defaultValue: "info",
                options: [
                    { label: "Info", value: "info" },
                    { label: "Success", value: "success" },
                    { label: "Warning", value: "warning" },
                    { label: "Error", value: "error" },
                ]
            },
        ],
    },
    {
        id: "logic.math",
        label: "Math",
        description: "Perform arithmetic: +, -, *, /",
        category: "logic",
        tier: "core",
        params: [
            { key: "a", label: "Value A", type: "number", required: true, placeholder: "Choose a number or type one" },
            { key: "op", label: "Operator", type: "operator", required: true, defaultValue: "+" },
            { key: "b", label: "Value B", type: "number", required: true, placeholder: "100" },
        ],
    },
];
