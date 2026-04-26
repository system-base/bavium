import {
    SKILL_PALETTE,
    type SkillDefinition,
    type SkillParamDef,
    type SkillTier,
} from "@/lib/constants";

export type SupportedChain = "base" | "base-sepolia" | "offchain";
export type SkillAccessMode = "read" | "write" | "control";
export type SkillRiskLevel = "low" | "medium" | "high";

export interface SkillOutputDef {
    key: string;
    label: string;
    description: string;
}

interface SkillManifestMeta {
    supportedChains: SupportedChain[];
    access: SkillAccessMode;
    producesTransaction: boolean;
    requiresWallet: boolean;
    tier: SkillTier;
    riskLevel: SkillRiskLevel;
    outputs: SkillOutputDef[];
    guardrails: string[];
    examples: string[];
}

export interface PlannerSkillManifestEntry
    extends SkillDefinition,
    SkillManifestMeta {}

const SKILL_MANIFEST_META: Record<string, SkillManifestMeta> = {
    "wallet.get_balance": {
        supportedChains: ["base", "base-sepolia"],
        access: "read",
        producesTransaction: false,
        requiresWallet: false,
        tier: "core",
        riskLevel: "low",
        outputs: [
            { key: "walletAddress", label: "Wallet Address", description: "Wallet address used for the balance lookup" },
            { key: "balance", label: "Balance", description: "Formatted token balance" },
            { key: "symbol", label: "Symbol", description: "Resolved token symbol" },
            { key: "decimals", label: "Decimals", description: "Token decimals" },
        ],
        guardrails: [
            "Use the connected wallet when no address is supplied.",
            "Use this when you need exactly one token balance.",
            "Prefer known tokens such as ETH, USDC, WETH, and DAI.",
        ],
        examples: [
            "Check my ETH balance",
            "Get my USDC balance on Base",
        ],
    },
    "wallet.send_eth": {
        supportedChains: ["base", "base-sepolia"],
        access: "write",
        producesTransaction: true,
        requiresWallet: true,
        tier: "core",
        riskLevel: "high",
        outputs: [
            { key: "status", label: "Status", description: "Prepared transaction state" },
            { key: "networkId", label: "Network ID", description: "Base network used for the prepared transaction" },
            { key: "callCount", label: "Call Count", description: "Number of unsigned calls in the batch" },
            { key: "calls", label: "Calls", description: "Unsigned wallet call batch" },
            { key: "description", label: "Description", description: "Human-readable transaction summary" },
            { key: "explorerBaseUrl", label: "Explorer Base URL", description: "Explorer base URL that will be used after submission" },
        ],
        guardrails: [
            "Only use explicit 0x recipient addresses.",
            "Always require confirmation before execution.",
            "Prefer adding a balance validation step before spending.",
        ],
        examples: [
            "Send 0.01 ETH to a wallet",
        ],
    },
    "wallet.send_token": {
        supportedChains: ["base", "base-sepolia"],
        access: "write",
        producesTransaction: true,
        requiresWallet: true,
        tier: "core",
        riskLevel: "high",
        outputs: [
            { key: "status", label: "Status", description: "Prepared transaction state" },
            { key: "networkId", label: "Network ID", description: "Base network used for the prepared transaction" },
            { key: "callCount", label: "Call Count", description: "Number of unsigned calls in the batch" },
            { key: "calls", label: "Calls", description: "Unsigned ERC-20 transfer call batch" },
            { key: "description", label: "Description", description: "Human-readable transaction summary" },
            { key: "explorerBaseUrl", label: "Explorer Base URL", description: "Explorer base URL that will be used after submission" },
        ],
        guardrails: [
            "Only use explicit 0x recipient addresses.",
            "Use known tokens supported by the current network configuration.",
            "Prefer adding a balance validation step before spending.",
        ],
        examples: [
            "Send 100 USDC to a wallet",
        ],
    },
    "wallet.details": {
        supportedChains: ["base", "base-sepolia"],
        access: "read",
        producesTransaction: false,
        requiresWallet: true,
        tier: "support",
        riskLevel: "low",
        outputs: [
            { key: "address", label: "Address", description: "Connected wallet address" },
            { key: "basename", label: "Basename", description: "Resolved Base/ENS reverse name when available" },
            { key: "network", label: "Network", description: "Current network label" },
            { key: "chainId", label: "Chain ID", description: "Current chain identifier" },
            { key: "ethBalance", label: "ETH Balance", description: "Native ETH balance" },
            { key: "balances", label: "Balances", description: "Registered token balances keyed by symbol" },
            { key: "explorerUrl", label: "Explorer URL", description: "Address page on the block explorer" },
            { key: "latestBlock", label: "Latest Block", description: "Latest observed block number" },
        ],
        guardrails: [
            "Use when the user needs wallet identity or network context.",
            "Do not use this when you only need one token balance.",
            "Basename lookup is best-effort and may be absent even for a valid wallet.",
            "Returned token balances cover Bavium's registered tokens on the active Base network, not every token ever held by the wallet.",
            "Requires a connected wallet.",
        ],
        examples: [
            "Show my wallet overview",
        ],
    },
    "wallet.resolve_basename": {
        supportedChains: ["offchain", "base", "base-sepolia"],
        access: "read",
        producesTransaction: false,
        requiresWallet: false,
        tier: "support",
        riskLevel: "low",
        outputs: [
            { key: "address", label: "Address", description: "Wallet address used for the reverse lookup" },
            { key: "basename", label: "Basename", description: "Resolved Base or ENS name when available" },
            { key: "found", label: "Found", description: "Whether a reverse name was resolved" },
        ],
        guardrails: [
            "This is a read-only identity helper.",
            "Resolution is best-effort and may return found=false even for a valid wallet.",
            "Use a connected wallet by default when no address is supplied.",
            "Do not imply ownership or verification beyond the resolver result.",
        ],
        examples: [
            "Resolve the basename for my connected wallet",
            "Check whether this address has a basename",
        ],
    },
    "wallet.resolve_address": {
        supportedChains: ["offchain", "base", "base-sepolia"],
        access: "read",
        producesTransaction: false,
        requiresWallet: false,
        tier: "support",
        riskLevel: "low",
        outputs: [
            { key: "name", label: "Name", description: "Requested basename or ENS name" },
            { key: "address", label: "Address", description: "Resolved wallet address when available" },
            { key: "found", label: "Found", description: "Whether the name resolved to an address" },
        ],
        guardrails: [
            "This is a read-only identity helper.",
            "Prefer Base basenames first; ENS fallback is best-effort.",
            "A missing resolution should be treated as found=false, not as proof the name is invalid or unregistered.",
        ],
        examples: [
            "Resolve jesse.base.eth",
            "Look up the address for a basename before using it downstream",
        ],
    },
    "social.prepare_base_share": {
        supportedChains: ["base", "base-sepolia", "offchain"],
        access: "read",
        producesTransaction: false,
        requiresWallet: false,
        tier: "support",
        riskLevel: "low",
        outputs: [
            { key: "title", label: "Title", description: "Short share title" },
            { key: "message", label: "Message", description: "Share message body" },
            { key: "summary", label: "Summary", description: "Short run summary for the prepared share payload" },
            { key: "shareText", label: "Share Text", description: "Combined text ready for copy/share UI" },
            { key: "shareUrl", label: "Share URL", description: "Absolute URL to include when available" },
            { key: "fallbackCopy", label: "Fallback Copy", description: "Plain text fallback containing share text and optional Base links" },
            { key: "baseProfileUrl", label: "Base Profile URL", description: "Base App profile URL when a wallet address is available" },
            { key: "baseTokenUrl", label: "Base Token URL", description: "Base App token URL for Base mainnet tokens" },
            { key: "webShareData", label: "Web Share Data", description: "Client-ready title/text/url payload for a later Web Share action" },
        ],
        guardrails: [
            "This action only prepares copy and links; it never posts automatically.",
            "Do not claim a swap or payment happened unless a prior run step confirms execution.",
            "Use Prepared or Quoted language when sharing a quote or unsigned transaction.",
            "Base token deep links are mainnet-only; avoid token deep links for Base Sepolia.",
        ],
        examples: [
            "Prepare share text for my Base workflow",
            "Create copy for sharing a swap quote in Base App",
            "Prepare a Base profile link for this wallet",
        ],
    },
    "social.prepare_trade_share": {
        supportedChains: ["base", "base-sepolia", "offchain"],
        access: "read",
        producesTransaction: false,
        requiresWallet: false,
        tier: "support",
        riskLevel: "low",
        outputs: [
            { key: "title", label: "Title", description: "Trade-focused share title" },
            { key: "message", label: "Message", description: "Trade-focused share message body" },
            { key: "summary", label: "Summary", description: "Short run summary for the prepared trade share" },
            { key: "shareText", label: "Share Text", description: "Combined text ready for copy/share UI" },
            { key: "shareUrl", label: "Share URL", description: "Workflow, run, or published page URL when available" },
            { key: "baseProfileUrl", label: "Base Profile URL", description: "Base App profile URL when a wallet address is available" },
            { key: "baseTokenUrl", label: "Base Token URL", description: "Base App token URL for a Base mainnet token when provided" },
            { key: "tradeStatus", label: "Trade Status", description: "Quoted, prepared, submitted, or confirmed trade-share state" },
            { key: "webShareData", label: "Web Share Data", description: "Client-ready title/text/url payload for a later Web Share action" },
        ],
        guardrails: [
            "This action only prepares copy and links; it never posts automatically.",
            "Do not use Confirmed language unless a prior step or receipt actually confirms the trade.",
            "Prefer Prepared or Quoted wording when you only have a quote or unsigned transaction.",
            "Base token deep links are mainnet-only; avoid token deep links for Base Sepolia.",
        ],
        examples: [
            "Prepare Base App share text for a quoted ETH to USDC trade",
            "Create safe share copy for a prepared cbBTC trade workflow",
            "Prepare trade share copy with a Base token link",
        ],
    },
    "social.prepare_shortcut_share": {
        supportedChains: ["base", "base-sepolia", "offchain"],
        access: "read",
        producesTransaction: false,
        requiresWallet: false,
        tier: "support",
        riskLevel: "low",
        outputs: [
            { key: "title", label: "Title", description: "Workflow share title" },
            { key: "message", label: "Message", description: "Workflow share message body" },
            { key: "summary", label: "Summary", description: "Short run summary for the prepared workflow share" },
            { key: "shareText", label: "Share Text", description: "Combined text ready for copy/share UI" },
            { key: "shareUrl", label: "Share URL", description: "Absolute published Bavium workflow URL" },
            { key: "shortcutSlug", label: "Published Slug", description: "Published slug used to build the workflow URL when provided" },
            { key: "webShareData", label: "Web Share Data", description: "Client-ready title/text/url payload for a later Web Share action" },
        ],
        guardrails: [
            "This action only prepares copy and links; it never posts automatically.",
            "Prefer using a published Bavium /p/{slug} URL when possible.",
            "Use workflow language in public copy; avoid implying automatic execution.",
        ],
        examples: [
            "Prepare share copy for this published Bavium workflow",
            "Create a shareable /p slug link for my Base workflow",
            "Prepare workflow share text for a saved published shortcut",
        ],
    },
    "social.prepare_open_profile": {
        supportedChains: ["base", "base-sepolia", "offchain"],
        access: "read",
        producesTransaction: false,
        requiresWallet: false,
        tier: "support",
        riskLevel: "low",
        outputs: [
            { key: "title", label: "Title", description: "Open-profile share title" },
            { key: "message", label: "Message", description: "Open-profile share message body" },
            { key: "summary", label: "Summary", description: "Short run summary for the prepared profile link" },
            { key: "shareText", label: "Share Text", description: "Combined text ready for copy/share UI" },
            { key: "shareUrl", label: "Share URL", description: "Base profile URL to open or share" },
            { key: "shareUrlLabel", label: "Share URL Label", description: "UI label used for the primary open action" },
            { key: "baseProfileUrl", label: "Base Profile URL", description: "Base App profile URL when the target resolves successfully" },
            { key: "walletAddress", label: "Wallet Address", description: "Resolved wallet address used for the profile link" },
            { key: "webShareData", label: "Web Share Data", description: "Client-ready title/text/url payload for a later Web Share action" },
        ],
        guardrails: [
            "This action only prepares copy and links; it never posts automatically.",
            "Provide a wallet address or a resolvable .base.eth / ENS name.",
            "If the name cannot be resolved, treat that as a normal error and ask the user for a concrete address.",
        ],
        examples: [
            "Prepare a Base profile link for my connected wallet",
            "Open jesse.base.eth in Base",
            "Create copy and a Base profile link for this address",
        ],
    },
    "social.prepare_open_token": {
        supportedChains: ["base", "base-sepolia", "offchain"],
        access: "read",
        producesTransaction: false,
        requiresWallet: false,
        tier: "support",
        riskLevel: "low",
        outputs: [
            { key: "title", label: "Title", description: "Open-token share title" },
            { key: "message", label: "Message", description: "Open-token share message body" },
            { key: "summary", label: "Summary", description: "Short run summary for the prepared token link" },
            { key: "shareText", label: "Share Text", description: "Combined text ready for copy/share UI" },
            { key: "shareUrl", label: "Share URL", description: "Primary token URL for sharing or opening" },
            { key: "shareUrlLabel", label: "Share URL Label", description: "UI label used for the primary open action" },
            { key: "baseTokenUrl", label: "Base Token URL", description: "Base App token URL when the token is on Base mainnet" },
            { key: "tokenAddress", label: "Token Address", description: "Resolved token address on the active Base network" },
            { key: "networkNote", label: "Network Note", description: "Explains when Base App token deep links are unavailable on the active network" },
            { key: "webShareData", label: "Web Share Data", description: "Client-ready title/text/url payload for a later Web Share action" },
        ],
        guardrails: [
            "This action only prepares copy and links; it never posts automatically.",
            "Base App token deep links are mainnet-only. Base Sepolia should fall back to the explorer.",
            "If the token cannot be resolved on the active Base network, stop and ask for a supported symbol or contract address.",
        ],
        examples: [
            "Prepare an openable Base token link for USDC",
            "Open cbBTC on Base",
            "Prepare a token link for a Base Sepolia test token",
        ],
    },
    "social.prepare_open_tx": {
        supportedChains: ["base", "base-sepolia", "offchain"],
        access: "read",
        producesTransaction: false,
        requiresWallet: false,
        tier: "support",
        riskLevel: "low",
        outputs: [
            { key: "title", label: "Title", description: "Open-transaction share title" },
            { key: "message", label: "Message", description: "Open-transaction share message body" },
            { key: "summary", label: "Summary", description: "Short run summary for the prepared transaction link" },
            { key: "shareText", label: "Share Text", description: "Combined text ready for copy/share UI" },
            { key: "shareUrl", label: "Share URL", description: "Transaction explorer URL for the active Base network" },
            { key: "shareUrlLabel", label: "Share URL Label", description: "UI label used for the primary open action" },
            { key: "webShareData", label: "Web Share Data", description: "Client-ready title/text/url payload for a later Web Share action" },
        ],
        guardrails: [
            "This action only prepares copy and links; it never posts automatically.",
            "Use a real Base or Base Sepolia transaction hash. Do not invent or truncate hashes.",
            "This prepares an explorer link, not a Base App transaction submission request.",
        ],
        examples: [
            "Prepare an openable link for this Base transaction hash",
            "Create copy around a confirmed swap transaction",
            "Open a Base Sepolia transaction in the explorer",
        ],
    },
    "x402.discover_services": {
        supportedChains: ["offchain"],
        access: "read",
        producesTransaction: false,
        requiresWallet: false,
        tier: "support",
        riskLevel: "low",
        outputs: [
            { key: "facilitator", label: "Facilitator", description: "Bazaar facilitator used for discovery" },
            { key: "searchMode", label: "Search Mode", description: "Whether the result came from catalog browsing or Coinbase semantic search" },
            { key: "typeFilter", label: "Type Filter", description: "Applied type filter such as http or mcp" },
            { key: "networkFilter", label: "Network Filter", description: "Applied Base network filter" },
            { key: "keyword", label: "Search Query", description: "Optional free-text search query used for discovery" },
            { key: "asset", label: "Asset Filter", description: "Optional asset filter used for Coinbase Bazaar semantic search" },
            { key: "scheme", label: "Scheme Filter", description: "Optional x402 scheme filter such as exact or upto" },
            { key: "maxUsdPrice", label: "Max USD Price", description: "Optional maximum USD price filter" },
            { key: "payTo", label: "Merchant", description: "Optional merchant payTo address filter" },
            { key: "returnedCount", label: "Returned Count", description: "Number of discovered services returned" },
            { key: "services.0.resource", label: "First Resource", description: "First discovered resource URL or identifier" },
            { key: "services.0.type", label: "First Type", description: "Resource type for the first result" },
            { key: "services.0.networks.0", label: "First Network", description: "First supported payment network for the first result" },
            { key: "services.0.pricePreview", label: "First Price Preview", description: "Best-effort first pricing preview" },
        ],
        guardrails: [
            "This is a read-only Bazaar discovery skill.",
            "Bavium does not pay for x402 resources yet and does not fetch protected content through this skill.",
            "Use Coinbase Bazaar semantic search when the user asks for a topic, asset, scheme, price ceiling, or merchant filter.",
            "For broad browsing with PayAI, expect catalog-style filtering rather than Coinbase semantic ranking.",
            "Use this to find candidate HTTP endpoints or MCP tools, then decide whether later phases should add manual payment UX.",
            "Discovery response fields can vary slightly across facilitators, so treat price previews and metadata as best-effort.",
        ],
        examples: [
            "Discover x402 HTTP services on Base mainnet",
            "List MCP tools from the Coinbase Bazaar",
            "Find USDC-paid Base services related to onchain data under one dollar",
        ],
    },
    "swap.uniswap_quote": {
        supportedChains: ["base", "base-sepolia"],
        access: "read",
        producesTransaction: false,
        requiresWallet: false,
        tier: "core",
        riskLevel: "low",
        outputs: [
            { key: "amountOut", label: "Estimated Receive", description: "Estimated output amount for the selected receive token" },
            { key: "feeTier", label: "Pool Fee", description: "Resolved Uniswap v3 pool fee tier used for the quote" },
            { key: "gasEstimate", label: "Gas Estimate", description: "Quoter gas estimate" },
            { key: "initializedTicksCrossed", label: "Ticks Crossed", description: "Initialized ticks crossed by the simulated route" },
        ],
        guardrails: [
            "Phase 1 supports single-pool ERC-20 pairs only.",
            "Native ETH is supported via WETH aliasing for single-pool quote flows.",
            "Auto fee should be the default path; only override fee tier when the exact pool is known.",
            "Auto slippage should be the default path; Bavium currently resolves Auto to a 0.5% baseline.",
            "Quotes are path-specific and still limited to supported Uniswap v3 fee tiers.",
        ],
        examples: [
            "Quote WETH to USDC on Base",
            "Check how much USDC I would get for 0.1 WETH",
        ],
    },
    "swap.uniswap_prepare_swap": {
        supportedChains: ["base", "base-sepolia"],
        access: "write",
        producesTransaction: true,
        requiresWallet: true,
        tier: "core",
        riskLevel: "high",
        outputs: [
            { key: "status", label: "Status", description: "Prepared transaction state" },
            { key: "networkId", label: "Network ID", description: "Base network used for the prepared transaction" },
            { key: "callCount", label: "Call Count", description: "Number of unsigned calls in the batch" },
            { key: "calls", label: "Calls", description: "Approve plus swap transaction batch" },
            { key: "quotedAmountOut", label: "Estimated Receive", description: "Estimated output amount before slippage protection" },
            { key: "amountOutMinimum", label: "Minimum Receive", description: "Minimum output after slippage protection" },
            { key: "router", label: "Router Address", description: "Uniswap swap router contract address" },
            { key: "explorerBaseUrl", label: "Explorer Base URL", description: "Explorer base URL that will be used after submission" },
        ],
        guardrails: [
            "Phase 1 supports single-pool swaps only.",
            "Native ETH is supported through explicit WETH wrap/unwrap steps.",
            "Auto fee should be the default path; manual fee tier override is advanced behavior.",
            "Auto slippage should be the default path; Bavium currently resolves Auto to a 0.5% baseline.",
            "This uses approve plus SwapRouter02; Permit2 and Universal Router are not exposed yet.",
            "ETH routes use WETH internally on Uniswap v3, so wrap/unwrap steps are expected under the hood.",
            "Base Sepolia is testnet-only; quotes can succeed while final execution still fails because liquidity is sparse or unstable.",
        ],
        examples: [
            "Prepare a WETH to USDC swap on Base",
            "Swap 100 USDC to WETH on Base",
        ],
    },
    "swap.uniswap_positions": {
        supportedChains: ["base", "base-sepolia"],
        access: "read",
        producesTransaction: false,
        requiresWallet: true,
        tier: "advanced",
        riskLevel: "low",
        outputs: [
            { key: "positions", label: "Positions", description: "Array of Uniswap v3 LP positions owned by the wallet" },
            { key: "summary.positionCount", label: "Position Count", description: "Total LP NFT position count for the wallet" },
            { key: "summary.hasActiveLiquidity", label: "Has Active Liquidity", description: "Whether any returned position currently has non-zero liquidity" },
        ],
        guardrails: [
            "Phase 1 reads Uniswap v3 positions via NonfungiblePositionManager only.",
            "Returned positions are capped by maxPositions for Builder readability.",
            "This is a read-only primitive and does not estimate portfolio value yet.",
        ],
        examples: [
            "Show my Uniswap LP positions on Base",
            "Check whether I have any active Uniswap liquidity",
        ],
    },
    "swap.uniswap_collect_fees": {
        supportedChains: ["base", "base-sepolia"],
        access: "write",
        producesTransaction: true,
        requiresWallet: true,
        tier: "advanced",
        riskLevel: "medium",
        outputs: [
            { key: "tokenId", label: "Token ID", description: "LP NFT token ID used for fee collection" },
            { key: "pairLabel", label: "Pair", description: "Resolved pair label for the position" },
            { key: "tokensOwed0", label: "Token 0 Owed", description: "Current token0 fees owed to the position" },
            { key: "tokensOwed1", label: "Token 1 Owed", description: "Current token1 fees owed to the position" },
            { key: "status", label: "Status", description: "Prepared transaction state" },
            { key: "networkId", label: "Network ID", description: "Base network used for the prepared transaction" },
            { key: "callCount", label: "Call Count", description: "Number of unsigned calls in the batch" },
            { key: "calls", label: "Calls", description: "Unsigned fee collection transaction" },
            { key: "explorerBaseUrl", label: "Explorer Base URL", description: "Explorer base URL that will be used after submission" },
        ],
        guardrails: [
            "Collects fees only; it does not add or remove liquidity.",
            "Requires a valid Uniswap v3 LP NFT token ID owned by the connected wallet.",
            "Fee amounts are best-effort values from the latest position read before submission.",
        ],
        examples: [
            "Collect fees from my Uniswap position",
            "Prepare fee collection for LP NFT #12345",
        ],
    },
    "bridge.list_routes": {
        supportedChains: ["base", "base-sepolia"],
        access: "read",
        producesTransaction: false,
        requiresWallet: false,
        tier: "support",
        riskLevel: "low",
        outputs: [
            { key: "provider", label: "Provider", description: "Bridge routing provider" },
            { key: "networkId", label: "Network ID", description: "Active Base network used for the route lookup" },
            { key: "originChainId", label: "Origin Chain ID", description: "Base chain ID used as the origin of the route search" },
            { key: "returnedCount", label: "Returned Count", description: "Number of route candidates returned" },
            { key: "routes.0.destinationChainId", label: "First Destination Chain", description: "Destination chain ID for the first route" },
            { key: "routes.0.originTokenSymbol", label: "First Origin Token", description: "Origin token symbol for the first route" },
            { key: "routes.0.destinationTokenSymbol", label: "First Destination Token", description: "Destination token symbol for the first route" },
        ],
        guardrails: [
            "Bavium currently exposes Across as a read-only planning surface only.",
            "Returned routes depend on the active Base network: Base mainnet and Base Sepolia do not share the same destination list.",
            "This is a read-only planning step; it does not prepare or submit a bridge transaction.",
            "Executable Across Swap API integration is not exposed in this bridge block yet.",
        ],
        examples: [
            "List bridge routes from Base",
            "What chains can I bridge to from Base Sepolia?",
        ],
    },
    "bridge.get_quote": {
        supportedChains: ["base", "base-sepolia"],
        access: "read",
        producesTransaction: false,
        requiresWallet: false,
        tier: "support",
        riskLevel: "low",
        outputs: [
            { key: "provider", label: "Provider", description: "Bridge routing provider" },
            { key: "networkId", label: "Network ID", description: "Active Base network used for the quote" },
            { key: "requestedAmount", label: "Requested Amount", description: "Human-readable amount requested for the quote" },
            { key: "originChainId", label: "Origin Chain ID", description: "Origin Base chain ID" },
            { key: "destinationChainId", label: "Destination Chain ID", description: "Destination chain ID" },
            { key: "inputTokenSymbol", label: "Input Token", description: "Token symbol on the origin chain" },
            { key: "outputTokenSymbol", label: "Output Token", description: "Token symbol on the destination chain" },
            { key: "totalRelayFeePct", label: "Relay Fee Percent", description: "Across relay fee percentage" },
            { key: "totalRelayFeeAmount", label: "Relay Fee Amount", description: "Across relay fee amount in base units" },
            { key: "expectedFillTimeSec", label: "Expected Fill Time", description: "Estimated fill time in seconds" },
            { key: "isAmountTooLow", label: "Amount Too Low", description: "Whether the requested amount is too low for the route" },
        ],
        guardrails: [
            "This first phase only supports same-symbol routes such as USDC to USDC.",
            "Quotes are read-only and indicative; they are not a bridge transaction builder.",
            "Amounts are returned in base units from Across where applicable, so format them before showing them to end users.",
            "Bavium does not expose Across approval/deposit calldata from this block yet.",
            "Executable Across Swap API flows are deferred until an authenticated integrator path is added.",
        ],
        examples: [
            "Quote bridging 100 USDC from Base to Arbitrum",
            "Estimate the Across fee to move WETH off Base",
        ],
    },
    "bridge.track_transfer": {
        supportedChains: ["base", "base-sepolia"],
        access: "read",
        producesTransaction: false,
        requiresWallet: false,
        tier: "advanced",
        riskLevel: "low",
        outputs: [
            { key: "provider", label: "Provider", description: "Bridge routing provider" },
            { key: "networkId", label: "Network ID", description: "Network used to query the transfer status" },
            { key: "status", label: "Status", description: "Across transfer status" },
            { key: "depositTxnRef", label: "Deposit Tx Ref", description: "Origin deposit transaction reference" },
            { key: "fillTxnRef", label: "Fill Tx Ref", description: "Destination fill transaction reference when available" },
            { key: "depositRefundTxnRef", label: "Refund Tx Ref", description: "Refund transaction reference when available" },
            { key: "destinationChainId", label: "Destination Chain ID", description: "Destination chain for the transfer" },
            { key: "actionsSucceeded", label: "Actions Succeeded", description: "Whether downstream fill actions succeeded" },
        ],
        guardrails: [
            "Status is read from Across public endpoints only.",
            "This expects an Across deposit transaction ref; generic transaction hashes from unrelated bridge systems will not resolve.",
            "Use this to monitor bridge progress, not to infer portfolio balances.",
            "Tracking a transfer does not prepare, resume, or retry the bridge transaction.",
        ],
        examples: [
            "Track this Across bridge transfer",
            "Check whether my Base bridge deposit has filled yet",
        ],
    },
    "defi.morpho_deposit": {
        supportedChains: ["base"],
        access: "write",
        producesTransaction: true,
        requiresWallet: true,
        tier: "core",
        riskLevel: "high",
        outputs: [
            { key: "status", label: "Status", description: "Prepared transaction state" },
            { key: "networkId", label: "Network ID", description: "Base network used for the prepared transaction" },
            { key: "callCount", label: "Call Count", description: "Number of unsigned calls in the batch" },
            { key: "calls", label: "Calls", description: "Approve plus deposit transaction batch" },
            { key: "description", label: "Description", description: "Deposit summary" },
            { key: "explorerBaseUrl", label: "Explorer Base URL", description: "Explorer base URL that will be used after submission" },
        ],
        guardrails: [
            "Only the morpho-usdc vault is currently supported.",
            "Morpho deposit is currently exposed only on Base mainnet.",
            "Requires confirmation and a connected wallet.",
            "The prepared action is approve plus deposit; it does not simulate yield or portfolio impact.",
            "Prefer checking balance before deposit.",
        ],
        examples: [
            "Deposit 100 USDC into Morpho",
        ],
    },
    "defi.morpho_withdraw": {
        supportedChains: ["base"],
        access: "write",
        producesTransaction: true,
        requiresWallet: true,
        tier: "core",
        riskLevel: "high",
        outputs: [
            { key: "status", label: "Status", description: "Prepared transaction state" },
            { key: "networkId", label: "Network ID", description: "Base network used for the prepared transaction" },
            { key: "callCount", label: "Call Count", description: "Number of unsigned calls in the batch" },
            { key: "calls", label: "Calls", description: "Unsigned withdraw transaction batch" },
            { key: "description", label: "Description", description: "Withdraw summary" },
            { key: "explorerBaseUrl", label: "Explorer Base URL", description: "Explorer base URL that will be used after submission" },
        ],
        guardrails: [
            "Only the morpho-usdc vault is currently supported.",
            "Morpho withdraw is currently exposed only on Base mainnet.",
            "Requires confirmation and a connected wallet.",
            "This block prepares only the withdraw transaction; it does not auto-claim unrelated rewards or move funds elsewhere.",
        ],
        examples: [
            "Withdraw 50 USDC from Morpho",
        ],
    },
    "defi.morpho_portfolio": {
        supportedChains: ["base"],
        access: "read",
        producesTransaction: false,
        requiresWallet: true,
        tier: "support",
        riskLevel: "low",
        outputs: [
            { key: "positions", label: "Positions", description: "Array of Morpho vault positions" },
        ],
        guardrails: [
            "Use only for Morpho portfolio inspection on Base mainnet.",
            "Requires a connected wallet.",
            "This is a read-only Morpho view, not a general DeFi portfolio indexer.",
        ],
        examples: [
            "Show my Morpho positions",
        ],
    },
    "defi.clanker_deploy_token": {
        supportedChains: ["base", "base-sepolia"],
        access: "write",
        producesTransaction: true,
        requiresWallet: true,
        tier: "advanced",
        riskLevel: "high",
        outputs: [
            { key: "status", label: "Status", description: "Prepared transaction state" },
            { key: "networkId", label: "Network ID", description: "Base network used for the prepared transaction" },
            { key: "callCount", label: "Call Count", description: "Number of unsigned calls in the batch" },
            { key: "calls", label: "Calls", description: "Unsigned Clanker deployment call batch" },
            { key: "description", label: "Description", description: "Human-readable launch summary" },
            { key: "factory", label: "Factory", description: "Clanker factory contract address" },
            { key: "token.symbol", label: "Token Symbol", description: "Requested token ticker" },
            { key: "launchConfig.quoteToken", label: "Quote Token", description: "Paired quote token for the launch pool" },
            { key: "explorerBaseUrl", label: "Explorer Base URL", description: "Explorer base URL that will be used after submission" },
        ],
        guardrails: [
            "This first phase only supports the standard WETH quote token launch path.",
            "Clanker launch preparation is currently exposed only with the standard preset path; custom pool engineering is not available in Builder.",
            "Deployment is prepared client-side and still requires explicit wallet confirmation.",
            "No dev buy, custom rewards, vault, or custom extension configuration is exposed yet.",
            "Clanker launches use v4 pool infrastructure, while the built-in swap skill is still limited to Uniswap v3 single-pool routes.",
        ],
        examples: [
            "Launch a memecoin with Clanker on Base",
            "Prepare a Base Sepolia test token launch via Clanker",
        ],
    },
    "nft.check_ownership": {
        supportedChains: ["base", "base-sepolia"],
        access: "read",
        producesTransaction: false,
        requiresWallet: false,
        tier: "core",
        riskLevel: "low",
        outputs: [
            { key: "contractAddress", label: "Contract Address", description: "NFT contract address" },
            { key: "tokenId", label: "Token ID", description: "Requested token ID" },
            { key: "standard", label: "Standard", description: "Resolved NFT standard" },
            { key: "walletAddress", label: "Wallet Address", description: "Wallet address checked for ownership" },
            { key: "owner", label: "Owner", description: "ERC-721 owner address when available" },
            { key: "balance", label: "Balance", description: "ERC-1155 balance for the checked wallet" },
            { key: "isOwner", label: "Owns Token", description: "Whether the checked wallet owns the token" },
        ],
        guardrails: [
            "Use this when the flow depends on a wallet owning a specific NFT.",
            "Auto detection covers common ERC-721 and ERC-1155 contracts, but some custom collections may need a manual standard override.",
            "For ERC-1155, ownership means balance greater than zero for the specified token ID.",
            "This is a read-only ownership check; transfer, listing, mint, and marketplace actions are not exposed here.",
        ],
        examples: [
            "Check whether I own NFT #1",
            "Does this wallet hold token 42 from this collection?",
        ],
    },
    "nft.get_token_metadata": {
        supportedChains: ["base", "base-sepolia"],
        access: "read",
        producesTransaction: false,
        requiresWallet: false,
        tier: "support",
        riskLevel: "low",
        outputs: [
            { key: "contractAddress", label: "Contract Address", description: "NFT contract address" },
            { key: "tokenId", label: "Token ID", description: "Requested token ID" },
            { key: "standard", label: "Standard", description: "Resolved NFT standard" },
            { key: "collection.name", label: "Collection Name", description: "Collection name when available" },
            { key: "collection.symbol", label: "Collection Symbol", description: "Collection symbol when available" },
            { key: "token.tokenUri", label: "Token URI", description: "Resolved token URI" },
            { key: "token.name", label: "Token Name", description: "Token metadata name when available" },
            { key: "token.description", label: "Token Description", description: "Token metadata description when available" },
            { key: "token.image", label: "Image", description: "Resolved token image URL when available" },
            { key: "token.animationUrl", label: "Animation URL", description: "Resolved animation URL when available" },
            { key: "metadataAvailable", label: "Metadata Available", description: "Whether off-chain metadata could be loaded" },
        ],
        guardrails: [
            "Collection name and symbol are best-effort reads and may be absent on some ERC-1155 contracts.",
            "Off-chain metadata fetches are best-effort; IPFS or remote metadata may be unavailable without failing the whole step.",
            "Use this for display, branching, or notifications about a known NFT token ID.",
            "This is a metadata read surface only; Bavium does not expose NFT transfer, mint, buy, or list actions here.",
        ],
        examples: [
            "Fetch metadata for NFT #1",
            "Get the image and description for this Base NFT token",
        ],
    },
    "data.pyth_price": {
        supportedChains: ["offchain", "base", "base-sepolia"],
        access: "read",
        producesTransaction: false,
        requiresWallet: false,
        tier: "core",
        riskLevel: "low",
        outputs: [
            { key: "symbol", label: "Symbol", description: "Requested asset symbol" },
            { key: "price", label: "Price", description: "Latest formatted price" },
            { key: "confidence", label: "Confidence", description: "Price confidence interval" },
            { key: "timestamp", label: "Timestamp", description: "Oracle publish timestamp" },
        ],
        guardrails: [
            "Prefer BTC, ETH, SOL, and USDC unless feedId support is added later.",
            "Use for read-only price checks and validations.",
        ],
        examples: [
            "Get the ETH price",
            "Check the current SOL price",
        ],
    },
    "data.token_prices": {
        supportedChains: ["offchain", "base", "base-sepolia"],
        access: "read",
        producesTransaction: false,
        requiresWallet: false,
        tier: "core",
        riskLevel: "low",
        outputs: [
            { key: "prices", label: "Prices", description: "Token price object keyed by resolved token symbol" },
            { key: "symbols", label: "Resolved Symbols", description: "Symbols successfully resolved for price lookup" },
            { key: "unsupported", label: "Unsupported Tokens", description: "Requested token refs that could not be resolved to a supported price symbol" },
        ],
        guardrails: [
            "Use token symbols such as ETH or USDC, or registered token addresses on the active Base network.",
            "Unsupported token refs are returned separately instead of silently failing the whole step.",
            "Best for read-only summaries and comparisons.",
        ],
        examples: [
            "Compare ETH and USDC prices",
            "Fetch prices for WETH, DAI, and a registered token address",
        ],
    },
    "data.portfolio_snapshot": {
        supportedChains: ["base", "base-sepolia"],
        access: "read",
        producesTransaction: false,
        requiresWallet: false,
        tier: "core",
        riskLevel: "low",
        outputs: [
            { key: "wallet", label: "Wallet", description: "Wallet address, network, and optional basename metadata" },
            { key: "native", label: "Native Assets", description: "Native ETH holdings with canonical asset identifiers" },
            { key: "tokens", label: "Tracked Tokens", description: "Tracked asset list with symbol, address, assetId, and optional USD values" },
            { key: "trackedByAsset", label: "Tracked By Asset", description: "Tracked asset lookup keyed by canonical assetId" },
            { key: "defi", label: "DeFi Positions", description: "Best-effort protocol positions, currently Morpho vaults" },
            { key: "liquidity", label: "Liquidity Positions", description: "Best-effort Uniswap LP position summary and returned positions" },
            { key: "summary", label: "Summary", description: "Aggregate portfolio summary fields" },
        ],
        guardrails: [
            "Base wallet balances are always read onchain; DeFi and LP sections are best-effort enrichments.",
            "Use an explicit wallet address when you want a read-only snapshot without requiring a connected wallet.",
            "USD values are best-effort and depend on available price sources.",
            "Basename lookup is optional and best-effort; the snapshot still succeeds if no reverse name resolves.",
            "Use this when you need several balances in one step or portfolio-aware conditions.",
            "Use before portfolio-aware conditions, routing, or notifications.",
            "This is a wallet snapshot, not a full indexed Base portfolio, PnL, or tax accounting export.",
        ],
        examples: [
            "Capture my Base wallet portfolio",
            "Check ETH, USDC, and DAI before running a shortcut",
            "Summarize my wallet, Morpho, and LP positions on Base",
        ],
    },
    "data.wallet_activity": {
        supportedChains: ["base", "base-sepolia"],
        access: "read",
        producesTransaction: false,
        requiresWallet: false,
        tier: "core",
        riskLevel: "low",
        outputs: [
            { key: "provider", label: "Provider", description: "Explorer index provider used for the activity read" },
            { key: "walletAddress", label: "Wallet Address", description: "Wallet address inspected for recent activity" },
            { key: "networkId", label: "Network ID", description: "Base network used for the activity lookup" },
            { key: "filter", label: "Filter", description: "Applied direction filter" },
            { key: "returnedCount", label: "Returned Count", description: "Number of recent activity items returned" },
            { key: "nextPageAvailable", label: "Next Page Available", description: "Whether more activity pages are available" },
            { key: "items.0.hash", label: "Latest Tx Hash", description: "Transaction hash of the first activity item" },
            { key: "items.0.timestamp", label: "Latest Timestamp", description: "Timestamp of the first activity item" },
            { key: "items.0.direction", label: "Latest Direction", description: "Incoming, outgoing, self, or unknown" },
            { key: "items.0.status", label: "Latest Status", description: "Explorer status for the first activity item" },
            { key: "items.0.primaryAsset", label: "Latest Primary Asset", description: "Primary asset inferred from the first activity item" },
            { key: "items.0.counterparty", label: "Latest Counterparty", description: "Counterparty address inferred from the first activity item" },
        ],
        guardrails: [
            "Uses the public Blockscout explorer index and does not require an API key.",
            "This is recent explorer activity, not a full accounting ledger or exhaustive wallet history export.",
            "Use this for recent context, notifications, or branching logic rather than exact tax or reconciliation workflows.",
        ],
        examples: [
            "Show my recent wallet activity on Base",
            "Check whether I have any recent incoming transfers",
        ],
    },
    "tx.get_receipt": {
        supportedChains: ["base", "base-sepolia"],
        access: "read",
        producesTransaction: false,
        requiresWallet: false,
        tier: "support",
        riskLevel: "low",
        outputs: [
            { key: "provider", label: "Provider", description: "Underlying chain data provider" },
            { key: "networkId", label: "Network ID", description: "Base network used for the receipt lookup" },
            { key: "txHash", label: "Transaction Hash", description: "Transaction hash that was inspected" },
            { key: "status", label: "Status", description: "Receipt status such as success or reverted" },
            { key: "blockNumber", label: "Block Number", description: "Block number that included the transaction" },
            { key: "gasUsed", label: "Gas Used", description: "Gas used by the transaction" },
            { key: "effectiveGasPrice", label: "Effective Gas Price", description: "Effective gas price from the receipt" },
            { key: "from", label: "From", description: "Transaction sender" },
            { key: "to", label: "To", description: "Transaction recipient when present" },
            { key: "contractAddress", label: "Contract Address", description: "Created contract address when applicable" },
            { key: "explorerUrl", label: "Explorer URL", description: "Explorer link for the transaction" },
        ],
        guardrails: [
            "Use this for mined transaction inspection, not for estimating future transactions.",
            "The hash must belong to the active Base network or Base Sepolia network selected for the run.",
            "If the receipt is not available yet, prefer tx.wait_confirmation.",
            "This is a read-only receipt view; it does not decode every protocol-specific event or execution path for you.",
        ],
        examples: [
            "Get the receipt for this Base transaction hash",
            "Inspect whether a transaction succeeded or reverted",
        ],
    },
    "tx.wait_confirmation": {
        supportedChains: ["base", "base-sepolia"],
        access: "read",
        producesTransaction: false,
        requiresWallet: false,
        tier: "support",
        riskLevel: "low",
        outputs: [
            { key: "provider", label: "Provider", description: "Underlying chain data provider" },
            { key: "networkId", label: "Network ID", description: "Base network used while waiting" },
            { key: "txHash", label: "Transaction Hash", description: "Transaction hash being monitored" },
            { key: "confirmations", label: "Confirmations", description: "Requested confirmation count" },
            { key: "status", label: "Status", description: "Receipt status once confirmations are reached" },
            { key: "blockNumber", label: "Block Number", description: "Block number that confirmed the transaction" },
            { key: "gasUsed", label: "Gas Used", description: "Gas used by the transaction" },
            { key: "effectiveGasPrice", label: "Effective Gas Price", description: "Effective gas price from the receipt" },
            { key: "from", label: "From", description: "Transaction sender" },
            { key: "to", label: "To", description: "Transaction recipient when present" },
            { key: "contractAddress", label: "Contract Address", description: "Created contract address when applicable" },
            { key: "explorerUrl", label: "Explorer URL", description: "Explorer link for the transaction" },
        ],
        guardrails: [
            "Use this after a transaction hash is already known.",
            "Keep confirmation counts small for interactive shortcuts.",
            "Prefer a bounded timeout so the shortcut fails clearly instead of waiting forever.",
            "This waits on a known hash only; it does not submit, replace, or speed up the transaction.",
        ],
        examples: [
            "Wait for this transaction to confirm on Base",
            "Wait for two confirmations before continuing",
        ],
    },
    "logic.assert": {
        supportedChains: ["offchain", "base", "base-sepolia"],
        access: "control",
        producesTransaction: false,
        requiresWallet: false,
        tier: "core",
        riskLevel: "low",
        outputs: [
            { key: "result", label: "Result", description: "Boolean assertion result" },
        ],
        guardrails: [
            "Use before irreversible spend or deposit steps.",
            "Condition should reference prior outputs or inputs.",
        ],
        examples: [
            "Assert that the balance is high enough",
        ],
    },
    "logic.if_else": {
        supportedChains: ["offchain", "base", "base-sepolia"],
        access: "control",
        producesTransaction: false,
        requiresWallet: false,
        tier: "core",
        riskLevel: "low",
        outputs: [
            { key: "branch", label: "Branch", description: "then or else branch decision" },
            { key: "value", label: "Value", description: "Boolean condition result" },
        ],
        guardrails: [
            "Use for branching decisions, not for executing unsupported protocols.",
        ],
        examples: [
            "Branch if ETH is below a threshold",
        ],
    },
    "logic.ask_input": {
        supportedChains: ["offchain", "base", "base-sepolia"],
        access: "control",
        producesTransaction: false,
        requiresWallet: false,
        tier: "core",
        riskLevel: "low",
        outputs: [
            { key: "value", label: "Value", description: "Value entered by the user at runtime" },
            { key: "inputType", label: "Input Type", description: "Requested input type" },
            { key: "prompt", label: "Prompt", description: "Prompt shown to the user" },
        ],
        guardrails: [
            "Prefer a shortcut input when the value can be provided before the run starts; use Ask Input when the shortcut needs to pause mid-flow.",
            "Use this when a critical address, amount, or free-form value must be supplied at run time instead of being guessed.",
            "Keep prompts specific so the returned value is easy to reuse downstream.",
        ],
        examples: [
            "Ask the user which wallet address to inspect",
            "Ask how much USDC to send before building the transfer",
        ],
    },
    "logic.choose_menu": {
        supportedChains: ["offchain", "base", "base-sepolia"],
        access: "control",
        producesTransaction: false,
        requiresWallet: false,
        tier: "core",
        riskLevel: "low",
        outputs: [
            { key: "value", label: "Value", description: "Selected option value" },
            { key: "label", label: "Label", description: "Selected option label" },
            { key: "prompt", label: "Prompt", description: "Prompt shown to the user" },
        ],
        guardrails: [
            "Prefer a shortcut input with predefined options when the choice can be made before the run starts; use Choose Menu for mid-flow decisions.",
            "Use this when the user should choose from a short fixed list instead of typing free-form text.",
            "Keep the option list small and obvious so the selected value can drive later logic cleanly.",
        ],
        examples: [
            "Let the user choose ETH or USDC before checking balance",
            "Ask which action path to take from a short menu",
        ],
    },
    "logic.repeat": {
        supportedChains: ["offchain", "base", "base-sepolia"],
        access: "control",
        producesTransaction: false,
        requiresWallet: false,
        tier: "core",
        riskLevel: "low",
        outputs: [
            { key: "mode", label: "Mode", description: "Loop mode identifier" },
            { key: "count", label: "Count", description: "Requested repeat count" },
            { key: "totalIterations", label: "Total Iterations", description: "Total number of loop iterations" },
            { key: "currentIndex", label: "Current Index", description: "Zero-based index during the active loop iteration" },
            { key: "iteration", label: "Iteration", description: "One-based iteration number during the active loop iteration" },
            { key: "completedIterations", label: "Completed Iterations", description: "Total iterations completed after the loop finishes" },
            { key: "isFirst", label: "Is First", description: "Whether the active iteration is the first one" },
            { key: "isLast", label: "Is Last", description: "Whether the active iteration is the last one" },
        ],
        guardrails: [
            "Use repeatSteps for the nested loop body.",
            "Keep loop counts small and deterministic.",
            "Prefer Repeat with Each when iterating over a known list.",
        ],
        examples: [
            "Repeat a notification three times",
        ],
    },
    "logic.repeat_each": {
        supportedChains: ["offchain", "base", "base-sepolia"],
        access: "control",
        producesTransaction: false,
        requiresWallet: false,
        tier: "core",
        riskLevel: "low",
        outputs: [
            { key: "mode", label: "Mode", description: "Loop mode identifier" },
            { key: "count", label: "Count", description: "Resolved item count" },
            { key: "totalIterations", label: "Total Iterations", description: "Total number of loop iterations" },
            { key: "currentIndex", label: "Current Index", description: "Zero-based index during the active loop iteration" },
            { key: "iteration", label: "Iteration", description: "One-based iteration number during the active loop iteration" },
            { key: "currentItem", label: "Current Item", description: "Resolved item for the active iteration" },
            { key: "lastItem", label: "Last Item", description: "Final processed item after the loop finishes" },
            { key: "completedIterations", label: "Completed Iterations", description: "Total iterations completed after the loop finishes" },
        ],
        guardrails: [
            "Use repeatSteps for the nested loop body.",
            "Pass a short list, JSON array, or a previous step that resolves to an array.",
            "Use currentItem inside repeatSteps when the body needs the current value.",
        ],
        examples: [
            "Repeat a balance check for each token in a list",
        ],
    },
    "logic.wait": {
        supportedChains: ["offchain", "base", "base-sepolia"],
        access: "control",
        producesTransaction: false,
        requiresWallet: false,
        tier: "advanced",
        riskLevel: "medium",
        outputs: [
            { key: "waited", label: "Waited", description: "Number of seconds waited" },
        ],
        guardrails: [
            "Keep waits short because runtime caps them at 60 seconds.",
        ],
        examples: [
            "Wait 10 seconds before continuing",
        ],
    },
    "logic.stop": {
        supportedChains: ["offchain", "base", "base-sepolia"],
        access: "control",
        producesTransaction: false,
        requiresWallet: false,
        tier: "support",
        riskLevel: "low",
        outputs: [
            { key: "message", label: "Message", description: "Reason the shortcut stopped" },
        ],
        guardrails: [
            "Use for controlled exits when the flow should end early without pretending to succeed fully.",
        ],
        examples: [
            "Stop the shortcut if a required precondition is not met",
        ],
    },
    "logic.set_variable": {
        supportedChains: ["offchain", "base", "base-sepolia"],
        access: "control",
        producesTransaction: false,
        requiresWallet: false,
        tier: "advanced",
        riskLevel: "low",
        outputs: [],
        guardrails: [
            "Prefer direct prior-step references first; use this only when a value needs a clearer reusable name.",
            "Use this for computed, assembled, or branch-derived values rather than for ordinary step-to-step reuse.",
        ],
        examples: [
            "Name a computed threshold so later steps can reference it clearly",
        ],
    },
    "logic.get_variable": {
        supportedChains: ["offchain", "base", "base-sepolia"],
        access: "control",
        producesTransaction: false,
        requiresWallet: false,
        tier: "support",
        riskLevel: "low",
        outputs: [],
        guardrails: [
            "Use this only when reusing a saved variable as the current step result makes the shortcut easier to read than referencing it inline.",
            "Prefer variables that were explicitly saved earlier in the shortcut.",
            "Do not add this step when a direct saved-variable reference is already clear enough.",
        ],
        examples: [
            "Load a saved variable after branching before using it in later logic or notifications",
        ],
    },
    "logic.format": {
        supportedChains: ["offchain", "base", "base-sepolia"],
        access: "control",
        producesTransaction: false,
        requiresWallet: false,
        tier: "core",
        riskLevel: "low",
        outputs: [
            { key: "text", label: "Formatted Text", description: "Rendered text template output" },
        ],
        guardrails: [
            "Use template variables from inputs or prior step outputs.",
        ],
        examples: [
            "Format a summary message from prior step outputs",
        ],
    },
    "logic.notify": {
        supportedChains: ["offchain", "base", "base-sepolia"],
        access: "control",
        producesTransaction: false,
        requiresWallet: false,
        tier: "core",
        riskLevel: "low",
        outputs: [
            { key: "message", label: "Message", description: "Notification message" },
            { key: "level", label: "Level", description: "Notification level" },
        ],
        guardrails: [
            "Use for user-facing completion or status messages.",
        ],
        examples: [
            "Notify me that the shortcut is complete",
        ],
    },
    "logic.math": {
        supportedChains: ["offchain", "base", "base-sepolia"],
        access: "control",
        producesTransaction: false,
        requiresWallet: false,
        tier: "core",
        riskLevel: "low",
        outputs: [
            { key: "result", label: "Result", description: "Computed numeric result" },
        ],
        guardrails: [
            "Use only supported operators: +, -, *, /, %.",
        ],
        examples: [
            "Compute a derived amount from a price and balance",
        ],
    },
};

export const CHAIN_CAPABILITY_NOTES = [
    "Base is the primary production chain for onchain shortcuts and automations.",
    "Base Sepolia should be treated as a testing environment and limited to clearly safe flows.",
    "Logic and notification skills are chain-agnostic control steps.",
    "Data skills are read-only and should be preferred when the user only wants information.",
] as const;

function getManifestMeta(skillId: string): SkillManifestMeta {
    const meta = SKILL_MANIFEST_META[skillId];
    if (!meta) {
        throw new Error(`Missing skill manifest metadata for "${skillId}"`);
    }
    return meta;
}

function formatParamDef(param: SkillParamDef): string {
    const parts = [`${param.key}:${param.type}`, param.required ? "required" : "optional"];

    if (param.defaultValue !== undefined && String(param.defaultValue).length > 0) {
        parts.push(`default=${String(param.defaultValue)}`);
    }

    if (param.options && param.options.length > 0) {
        parts.push(`options=${param.options.map((option) => option.value).join("|")}`);
    }

    return parts.join(", ");
}

export const PLANNER_SKILL_MANIFEST: PlannerSkillManifestEntry[] = SKILL_PALETTE.map(
    (skill) => ({
        ...skill,
        ...getManifestMeta(skill.id),
    }),
);

export function getPlannerSkillManifestEntry(
    skillId: string,
): PlannerSkillManifestEntry | undefined {
    return PLANNER_SKILL_MANIFEST.find((skill) => skill.id === skillId);
}

export function buildPlannerSkillCatalogText(): string {
    return PLANNER_SKILL_MANIFEST.map((skill) => {
        const params =
            skill.params.length > 0
                ? skill.params.map(formatParamDef).join("; ")
                : "none";
        const outputs =
            skill.outputs.length > 0
                ? skill.outputs.map((output) => output.key).join(", ")
                : "none";

        return [
            `- ${skill.id}`,
            `  label: ${skill.label}`,
            `  category: ${skill.category}`,
            `  tier: ${skill.tier}`,
            `  supportedChains: ${skill.supportedChains.join(", ")}`,
            `  access: ${skill.access}`,
            `  producesTransaction: ${skill.producesTransaction ? "yes" : "no"}`,
            `  requiresWallet: ${skill.requiresWallet ? "yes" : "no"}`,
            `  requiresConfirmation: ${skill.requiresConfirmation ? "yes" : "no"}`,
            `  riskLevel: ${skill.riskLevel}`,
            `  params: ${params}`,
            `  outputs: ${outputs}`,
            `  guardrails: ${skill.guardrails.join(" ")}`,
            `  examples: ${skill.examples.join(" | ")}`,
        ].join("\n");
    }).join("\n");
}

export function buildPlannerSystemPrompt(): string {
    const skillCatalog = buildPlannerSkillCatalogText();
    const chainNotes = CHAIN_CAPABILITY_NOTES.map((note) => `- ${note}`).join("\n");
    const productBoundaryNotes = [
        "- Swap is currently a single-pool Uniswap v3 flow on Base. Do not imply multi-hop routing, aggregation, Universal Router, or cross-DEX execution.",
        "- Bridge is currently read-only planning and tracking through Across public endpoints. Do not imply Bavium can build or submit Across bridge deposits yet.",
        "- Morpho actions are currently limited to the supported USDC vault on Base mainnet.",
        "- Clanker launch preparation is currently the standard preset path only, not a full launch studio with custom pool engineering.",
        "- Base App social skills prepare copy and links only. They do not post automatically.",
        "- x402 is currently read-only Bazaar discovery only. Do not imply Bavium can pay for x402 resources or fetch protected paid responses yet.",
    ].join("\n");

    return `You are Bavium's planning model. Bavium is an onchain shortcut and automation control plane.

Core operating principles:
- You are a planner, not an executor.
- Convert the user's intent into a deterministic skill graph.
- Use only the live skill manifest below.
- Never invent unsupported actions, raw calldata, arbitrary contract addresses, or protocols not listed in the manifest.
- Prefer Base-compatible flows unless the user explicitly asks for a supported read-only check.
- Read-only requests should stay read-only whenever possible.
- Write actions should include validation or confirmation-aware steps when appropriate.

Chain capability notes:
${chainNotes}

Product boundary notes:
${productBoundaryNotes}

Live skill manifest:
${skillCatalog}

Planning rules:
1. Each step needs: id, skill, action, params.
2. Use dependsOn for sequential execution.
3. Every step result is reusable by step id; prefer direct prior-step references before introducing extra variable steps.
4. Use output.as only when a result needs a short readable alias that will be reused later or across branches.
5. Use {{input.fieldName}} for user-provided values.
6. Use {{stepId.field}} or {{savedAlias}} to reference previous results.
7. Do not add logic.set_variable when a direct step reference or output.as on the producing step is enough.
8. If you use logic.set_variable, that step must also set output.as to the saved variable name.
9. Use logic.get_variable only when surfacing a saved variable as the current step result clearly improves readability, and pass the saved variable as {{savedAlias}}.
10. Saved variable names should be short identifier-like names such as balanceCheck, latestPrice, or targetWallet.
11. Add logic.assert before irreversible spend or deposit flows when a balance or threshold should be checked.
12. Use structured condition objects for conditional logic, not prose strings.
13. When using logic.if_else, put nested child steps inside thenSteps and elseSteps.
14. When using logic.repeat or logic.repeat_each, put nested child steps inside repeatSteps.
15. Prefer shortcut inputs for values the user can provide before the run starts.
16. Use logic.ask_input only when the shortcut should pause mid-flow for contextual free-form input.
17. Use logic.choose_menu only when the shortcut should pause mid-flow for a short fixed choice list.
18. Never output steps that are not present in the manifest.
19. If the request needs unsupported functionality, keep the plan inside supported capabilities instead of hallucinating.
20. Prefer explicit user inputs over guessed addresses, amounts, vault IDs, or token identifiers.
21. Keep the shortcut category aligned with the main user outcome.
22. When a capability is read-only or planning-only in the manifest, keep the plan read-only instead of implying execution.
23. Do not describe helper skills as if they complete downstream product actions automatically.

Respond ONLY with valid JSON matching this structure:
{
  "name": "Shortcut Name",
  "description": "What this shortcut does",
  "category": "wallet",
  "steps": [
    {
      "id": "step-1",
      "skill": "wallet",
      "action": "get_balance",
      "params": { "token": "ETH" },
      "output": { "as": "balance" },
      "confirm": false,
      "onFailure": "abort",
      "condition": {
        "inputRef": "wallet.balance.ETH",
        "operator": "greater_than",
        "compareValue": "0.1",
        "valueType": "number"
      },
      "thenSteps": [],
      "elseSteps": [],
      "repeatSteps": []
    }
  ],
  "inputs": [
    {
      "id": "recipient",
      "label": "Recipient Address",
      "type": "address",
      "required": true
    }
  ]
}`;
}
