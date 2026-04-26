import type { BuilderBlock } from "@/lib/builder-shortcut";
import type { BlockCategory } from "@/lib/constants";

export interface TemplateShortcut {
    id: string;
    name: string;
    description: string;
    category: BlockCategory;
    stepCount: number;
    tags: string[];
}

interface TemplateDefinition extends TemplateShortcut {
    blocks: BuilderBlock[];
}

function conditionJSON(inputRef: string, operator: string, compareValue: string, valueType = "number"): string {
    return JSON.stringify({ inputRef, operator, compareValue, valueType });
}

function cloneTemplateBlocks(blocks: BuilderBlock[]): BuilderBlock[] {
    return blocks.map((block) => ({
        ...block,
        params: block.params.map((param) => ({ ...param })),
        thenBlocks: block.thenBlocks ? cloneTemplateBlocks(block.thenBlocks) : undefined,
        elseBlocks: block.elseBlocks ? cloneTemplateBlocks(block.elseBlocks) : undefined,
        repeatBlocks: block.repeatBlocks ? cloneTemplateBlocks(block.repeatBlocks) : undefined,
    }));
}

const TEMPLATE_DEFINITIONS: TemplateDefinition[] = [
    {
        id: "send-usdc",
        name: "Send USDC",
        description: "Check your USDC balance and transfer to any address on Base.",
        category: "wallet",
        stepCount: 3,
        tags: ["payment", "transfer"],
        blocks: [
            {
                id: "step-1",
                skillId: "wallet.get_balance",
                label: "Get USDC Balance",
                category: "wallet",
                params: [{ key: "token", value: "USDC" }],
            },
            {
                id: "step-2",
                skillId: "logic.assert",
                label: "Validate Funds",
                category: "logic",
                params: [
                    { key: "condition", value: conditionJSON("step-1.balance", "greater_or_equal", "100") },
                    { key: "errorMessage", value: "Not enough USDC balance" },
                ],
            },
            {
                id: "step-3",
                skillId: "wallet.send_token",
                label: "Send USDC",
                category: "wallet",
                params: [
                    { key: "token", value: "USDC" },
                    { key: "to", value: "" },
                    { key: "amount", value: "100" },
                ],
                confirm: true,
            },
        ],
    },
    {
        id: "portfolio-check",
        name: "Portfolio Check",
        description: "Query wallet balances for ETH and USDC, then format a summary.",
        category: "data",
        stepCount: 3,
        tags: ["balance", "price"],
        blocks: [
            {
                id: "step-1",
                skillId: "data.portfolio_snapshot",
                label: "Read Portfolio",
                category: "data",
                params: [
                    { key: "tokens", value: "ETH,USDC" },
                    { key: "includeUsdValue", value: "true" },
                ],
            },
            {
                id: "step-2",
                skillId: "logic.format",
                label: "Format Summary",
                category: "logic",
                params: [
                    {
                        key: "template",
                        value: "Wallet {{step-1.address}} currently tracks {{step-1.tokenCount}} assets with total value {{step-1.totalUsdValue}}.",
                    },
                ],
            },
            {
                id: "step-3",
                skillId: "logic.notify",
                label: "Show Summary",
                category: "logic",
                params: [
                    { key: "message", value: "{{step-2.text}}" },
                    { key: "level", value: "info" },
                ],
            },
        ],
    },
    {
        id: "morpho-deposit",
        name: "Morpho Deposit",
        description: "Deposit USDC into a Morpho vault on Base to earn yield automatically.",
        category: "defi",
        stepCount: 3,
        tags: ["yield", "lending"],
        blocks: [
            {
                id: "step-1",
                skillId: "wallet.get_balance",
                label: "Check USDC Balance",
                category: "wallet",
                params: [{ key: "token", value: "USDC" }],
            },
            {
                id: "step-2",
                skillId: "logic.assert",
                label: "Validate Balance",
                category: "logic",
                params: [
                    { key: "condition", value: conditionJSON("step-1.balance", "greater_or_equal", "100") },
                    { key: "errorMessage", value: "Need at least 100 USDC to deposit" },
                ],
            },
            {
                id: "step-3",
                skillId: "defi.morpho_deposit",
                label: "Deposit to Morpho",
                category: "defi",
                params: [
                    { key: "vaultId", value: "morpho-usdc" },
                    { key: "amount", value: "100" },
                ],
                confirm: true,
            },
        ],
    },
    {
        id: "price-alert",
        name: "Price Alert",
        description: "Fetch ETH price from Pyth oracle and assert it's above a threshold.",
        category: "data",
        stepCount: 3,
        tags: ["price", "alert"],
        blocks: [
            {
                id: "step-1",
                skillId: "data.pyth_price",
                label: "Get ETH Price",
                category: "data",
                params: [{ key: "symbol", value: "ETH" }],
            },
            {
                id: "step-2",
                skillId: "logic.assert",
                label: "Check Threshold",
                category: "logic",
                params: [
                    { key: "condition", value: conditionJSON("step-1.price", "greater_or_equal", "3000") },
                    { key: "errorMessage", value: "ETH is still below 3000" },
                ],
            },
            {
                id: "step-3",
                skillId: "logic.notify",
                label: "Alert Triggered",
                category: "logic",
                params: [
                    { key: "message", value: "ETH is above your alert threshold." },
                    { key: "level", value: "success" },
                ],
            },
        ],
    },
    {
        id: "conditional-send",
        name: "Conditional Send",
        description: "Check balance, verify it meets a minimum, then send ETH with notification.",
        category: "logic",
        stepCount: 4,
        tags: ["conditional", "transfer"],
        blocks: [
            {
                id: "step-1",
                skillId: "wallet.get_balance",
                label: "Check ETH Balance",
                category: "wallet",
                params: [{ key: "token", value: "ETH" }],
            },
            {
                id: "step-2",
                skillId: "logic.assert",
                label: "Validate Balance",
                category: "logic",
                params: [
                    { key: "condition", value: conditionJSON("step-1.balance", "greater_or_equal", "0.02") },
                    { key: "errorMessage", value: "Need at least 0.02 ETH to send" },
                ],
            },
            {
                id: "step-3",
                skillId: "wallet.send_eth",
                label: "Send ETH",
                category: "wallet",
                params: [
                    { key: "to", value: "" },
                    { key: "amount", value: "0.01" },
                ],
                confirm: true,
            },
            {
                id: "step-4",
                skillId: "logic.notify",
                label: "Show Result",
                category: "logic",
                params: [
                    { key: "message", value: "Conditional ETH send is ready." },
                    { key: "level", value: "success" },
                ],
            },
        ],
    },
    {
        id: "defi-portfolio",
        name: "DeFi Portfolio",
        description: "View your Morpho vault positions and wallet overview in one flow.",
        category: "defi",
        stepCount: 3,
        tags: ["portfolio", "yield"],
        blocks: [
            {
                id: "step-1",
                skillId: "wallet.details",
                label: "Get Wallet Overview",
                category: "wallet",
                params: [],
            },
            {
                id: "step-2",
                skillId: "defi.morpho_portfolio",
                label: "Read Morpho Portfolio",
                category: "defi",
                params: [],
            },
            {
                id: "step-3",
                skillId: "logic.notify",
                label: "Show Summary",
                category: "logic",
                params: [
                    { key: "message", value: "Wallet overview and Morpho positions loaded." },
                    { key: "level", value: "info" },
                ],
            },
        ],
    },
    {
        id: "launch-memecoin",
        name: "Launch Meme Token",
        description: "Prepare a Clanker memecoin deployment on Base with the connected wallet as admin.",
        category: "defi",
        stepCount: 2,
        tags: ["launch", "clanker"],
        blocks: [
            {
                id: "step-1",
                skillId: "defi.clanker_deploy_token",
                label: "Prepare Clanker Launch",
                category: "defi",
                params: [
                    { key: "name", value: "Bavium Pepe" },
                    { key: "symbol", value: "BPEPE" },
                    { key: "description", value: "Launch campaign token" },
                    { key: "quoteToken", value: "WETH" },
                    { key: "includeSniperProtection", value: "true" },
                ],
                confirm: true,
            },
            {
                id: "step-2",
                skillId: "logic.notify",
                label: "Launch Ready",
                category: "logic",
                params: [
                    { key: "message", value: "Review the token launch parameters before submitting." },
                    { key: "level", value: "warning" },
                ],
            },
        ],
    },
    {
        id: "swap-weth-usdc",
        name: "Swap WETH to USDC",
        description: "Quote and prepare a Uniswap swap from WETH to USDC on Base.",
        category: "swap",
        stepCount: 2,
        tags: ["uniswap", "swap"],
        blocks: [
            {
                id: "step-1",
                skillId: "swap.uniswap_quote",
                label: "Get Swap Quote",
                category: "swap",
                params: [
                    { key: "tokenIn", value: "WETH" },
                    { key: "tokenOut", value: "USDC" },
                    { key: "amountIn", value: "0.1" },
                    { key: "feeTier", value: "auto" },
                ],
            },
            {
                id: "step-2",
                skillId: "swap.uniswap_prepare_swap",
                label: "Swap WETH to USDC",
                category: "swap",
                params: [
                    { key: "tokenIn", value: "WETH" },
                    { key: "tokenOut", value: "USDC" },
                    { key: "amountIn", value: "0.1" },
                    { key: "feeTier", value: "auto" },
                    { key: "slippageBps", value: "auto" },
                ],
                confirm: true,
            },
        ],
    },
    {
        id: "bridge-usdc-route",
        name: "Bridge USDC Route",
        description: "Get an Across bridge quote from Base and turn it into a simple notification flow.",
        category: "bridge",
        stepCount: 3,
        tags: ["bridge", "across"],
        blocks: [
            {
                id: "step-1",
                skillId: "bridge.get_quote",
                label: "Get Across Quote",
                category: "bridge",
                params: [
                    { key: "destinationChainId", value: "42161" },
                    { key: "tokenSymbol", value: "USDC" },
                    { key: "amount", value: "100" },
                ],
            },
            {
                id: "step-2",
                skillId: "logic.format",
                label: "Format Quote",
                category: "logic",
                params: [
                    { key: "template", value: "Across quote is ready for {{step-1.requestedAmount}} {{step-1.inputTokenSymbol}} to chain {{step-1.destinationChainId}}." },
                ],
            },
            {
                id: "step-3",
                skillId: "logic.notify",
                label: "Show Quote",
                category: "logic",
                params: [
                    { key: "message", value: "{{step-2.text}}" },
                    { key: "level", value: "info" },
                ],
            },
        ],
    },
    {
        id: "recent-wallet-activity",
        name: "Recent Wallet Activity",
        description: "Inspect recent wallet activity on Base and summarize the latest movement.",
        category: "data",
        stepCount: 3,
        tags: ["activity", "history"],
        blocks: [
            {
                id: "step-1",
                skillId: "data.wallet_activity",
                label: "Read Wallet Activity",
                category: "data",
                params: [
                    { key: "filter", value: "all" },
                    { key: "maxItems", value: "5" },
                ],
            },
            {
                id: "step-2",
                skillId: "logic.format",
                label: "Summarize Latest Activity",
                category: "logic",
                params: [
                    { key: "template", value: "Latest activity: {{step-1.items.0.direction}} {{step-1.items.0.primaryAsset}} with {{step-1.items.0.counterparty}}." },
                ],
            },
            {
                id: "step-3",
                skillId: "logic.notify",
                label: "Show Activity",
                category: "logic",
                params: [
                    { key: "message", value: "{{step-2.text}}" },
                    { key: "level", value: "info" },
                ],
            },
        ],
    },
    {
        id: "open-base-profile",
        name: "Open Base Profile",
        description: "Resolve the connected wallet and prepare a Base profile link you can open or share.",
        category: "social",
        stepCount: 2,
        tags: ["base-app", "profile", "share"],
        blocks: [
            {
                id: "step-1",
                skillId: "wallet.details",
                label: "Read Wallet Details",
                category: "wallet",
                params: [],
            },
            {
                id: "step-2",
                skillId: "social.prepare_open_profile",
                label: "Prepare Base Profile Link",
                category: "social",
                params: [
                    { key: "target", value: "{{step-1.address}}" },
                    { key: "message", value: "Open this Base profile in Bavium." },
                ],
            },
        ],
    },
    {
        id: "open-usdc-on-base",
        name: "Open USDC on Base",
        description: "Prepare a Base-native token link for USDC on mainnet or an explorer link on Sepolia.",
        category: "social",
        stepCount: 1,
        tags: ["base-app", "token", "share"],
        blocks: [
            {
                id: "step-1",
                skillId: "social.prepare_open_token",
                label: "Prepare Token Link",
                category: "social",
                params: [
                    { key: "token", value: "USDC" },
                ],
            },
        ],
    },
    {
        id: "share-trade-quote",
        name: "Share Trade Quote",
        description: "Quote a USDC to ETH swap and prepare share-ready copy for the result.",
        category: "social",
        stepCount: 2,
        tags: ["base-app", "swap", "share"],
        blocks: [
            {
                id: "step-1",
                skillId: "swap.uniswap_quote",
                label: "Quote USDC to ETH",
                category: "swap",
                params: [
                    { key: "tokenIn", value: "USDC" },
                    { key: "tokenOut", value: "ETH" },
                    { key: "amountIn", value: "1" },
                    { key: "feeTier", value: "auto" },
                ],
            },
            {
                id: "step-2",
                skillId: "social.prepare_trade_share",
                label: "Prepare Quote Share",
                category: "social",
                params: [
                    { key: "status", value: "quoted" },
                    { key: "workflowName", value: "Share Trade Quote" },
                    { key: "fromTokenSymbol", value: "USDC" },
                    { key: "toTokenSymbol", value: "ETH" },
                    { key: "amountIn", value: "1" },
                    { key: "amountOut", value: "{{step-1.amountOut}}" },
                ],
            },
        ],
    },
    {
        id: "discover-x402-services",
        name: "Discover x402 APIs",
        description: "Search Coinbase Bazaar for paid Base-compatible data services without paying for them.",
        category: "x402",
        stepCount: 3,
        tags: ["x402", "bazaar", "discovery", "api"],
        blocks: [
            {
                id: "step-1",
                skillId: "x402.discover_services",
                label: "Discover Services",
                category: "x402",
                params: [
                    { key: "facilitator", value: "coinbase" },
                    { key: "type", value: "http" },
                    { key: "network", value: "base-mainnet" },
                    { key: "keyword", value: "onchain data" },
                    { key: "asset", value: "usdc" },
                    { key: "scheme", value: "exact" },
                    { key: "maxUsdPrice", value: "1.00" },
                    { key: "maxResults", value: "5" },
                ],
            },
            {
                id: "step-2",
                skillId: "logic.format",
                label: "Summarize Discovery",
                category: "logic",
                params: [
                    {
                        key: "template",
                        value: "Found {{step-1.returnedCount}} x402 services from {{step-1.facilitator}} for {{step-1.networkFilter}} using {{step-1.searchMode}} search.",
                    },
                ],
            },
            {
                id: "step-3",
                skillId: "logic.notify",
                label: "Show Discovery Summary",
                category: "logic",
                params: [
                    { key: "message", value: "{{step-2.text}}" },
                    { key: "level", value: "info" },
                ],
            },
        ],
    },
];

export const TEMPLATE_SHORTCUTS: TemplateShortcut[] = TEMPLATE_DEFINITIONS.map(
    ({ blocks, ...shortcut }) => shortcut,
);

export function getTemplateShortcutById(id: string): TemplateShortcut | undefined {
    return TEMPLATE_SHORTCUTS.find((template) => template.id === id);
}

export function getTemplateById(id: string): { name: string; blocks: BuilderBlock[] } | undefined {
    const template = TEMPLATE_DEFINITIONS.find((item) => item.id === id);
    if (!template) {
        return undefined;
    }

    return {
        name: template.name,
        blocks: cloneTemplateBlocks(template.blocks),
    };
}
