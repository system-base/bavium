/* ==========================================================================
   Skills — DeFi (CDP-Free)
   Uses viem for direct contract interactions with DeFi protocols on Base.
   AgentKit Compound provider replaced with direct Morpho vault interaction
   and future Aerodrome integration.

   Actions: morpho_deposit, morpho_withdraw, morpho_portfolio
   Future: aerodrome_swap, compound_supply
   ========================================================================== */

import type { ISkill, SkillResult, SkillActionMeta } from "../types";
import type { VariableContext } from "@/engine/types";
import { resolveWalletAddress } from "../helpers";
import { skillRegistry } from "../registry";
import { getActiveNetwork, NETWORKS } from "@/lib/chain-config";
import { getBalance, getETHBalance, getPublicClient } from "@/lib/viem-client";
import { ERC20_ABI } from "@/lib/chain-config";
import { createPreparedTransactionOutput } from "@/lib/transaction-output";
import {
    encodeAbiParameters,
    encodeFunctionData,
    formatUnits,
    getAddress,
    isAddress,
    parseUnits,
    type Address,
    zeroAddress,
    zeroHash,
} from "viem";

// ---------------------------------------------------------------------------
// Morpho Vault ABI (minimal — deposit/withdraw/balanceOf)
// ---------------------------------------------------------------------------

const MORPHO_VAULT_ABI = [
    {
        inputs: [
            { name: "assets", type: "uint256" },
            { name: "receiver", type: "address" },
        ],
        name: "deposit",
        outputs: [{ name: "shares", type: "uint256" }],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [
            { name: "assets", type: "uint256" },
            { name: "receiver", type: "address" },
            { name: "owner", type: "address" },
        ],
        name: "withdraw",
        outputs: [{ name: "shares", type: "uint256" }],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [{ name: "account", type: "address" }],
        name: "balanceOf",
        outputs: [{ name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [{ name: "shares", type: "uint256" }],
        name: "convertToAssets",
        outputs: [{ name: "assets", type: "uint256" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [],
        name: "asset",
        outputs: [{ name: "", type: "address" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [],
        name: "totalAssets",
        outputs: [{ name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [],
        name: "totalSupply",
        outputs: [{ name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
    },
] as const;

// Well-known Morpho vaults on Base
const MORPHO_VAULTS: Record<string, {
    address: Address;
    name: string;
    underlyingSymbol: string;
    underlyingAddress: Address;
    decimals: number;
}> = {
    "morpho-usdc": {
        address: "0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A",
        name: "Morpho USDC Vault",
        underlyingSymbol: "USDC",
        underlyingAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        decimals: 6,
    },
};

const CLANKER_FACTORY_ABI = [
    {
        inputs: [
            {
                components: [
                    {
                        components: [
                            { internalType: "address", name: "tokenAdmin", type: "address" },
                            { internalType: "string", name: "name", type: "string" },
                            { internalType: "string", name: "symbol", type: "string" },
                            { internalType: "bytes32", name: "salt", type: "bytes32" },
                            { internalType: "string", name: "image", type: "string" },
                            { internalType: "string", name: "metadata", type: "string" },
                            { internalType: "string", name: "context", type: "string" },
                            { internalType: "uint256", name: "originatingChainId", type: "uint256" },
                        ],
                        internalType: "struct IClanker.TokenConfig",
                        name: "tokenConfig",
                        type: "tuple",
                    },
                    {
                        components: [
                            { internalType: "address", name: "hook", type: "address" },
                            { internalType: "address", name: "pairedToken", type: "address" },
                            { internalType: "int24", name: "tickIfToken0IsClanker", type: "int24" },
                            { internalType: "int24", name: "tickSpacing", type: "int24" },
                            { internalType: "bytes", name: "poolData", type: "bytes" },
                        ],
                        internalType: "struct IClanker.PoolConfig",
                        name: "poolConfig",
                        type: "tuple",
                    },
                    {
                        components: [
                            { internalType: "address", name: "locker", type: "address" },
                            { internalType: "address[]", name: "rewardAdmins", type: "address[]" },
                            { internalType: "address[]", name: "rewardRecipients", type: "address[]" },
                            { internalType: "uint16[]", name: "rewardBps", type: "uint16[]" },
                            { internalType: "int24[]", name: "tickLower", type: "int24[]" },
                            { internalType: "int24[]", name: "tickUpper", type: "int24[]" },
                            { internalType: "uint16[]", name: "positionBps", type: "uint16[]" },
                            { internalType: "bytes", name: "lockerData", type: "bytes" },
                        ],
                        internalType: "struct IClanker.LockerConfig",
                        name: "lockerConfig",
                        type: "tuple",
                    },
                    {
                        components: [
                            { internalType: "address", name: "mevModule", type: "address" },
                            { internalType: "bytes", name: "mevModuleData", type: "bytes" },
                        ],
                        internalType: "struct IClanker.MevModuleConfig",
                        name: "mevModuleConfig",
                        type: "tuple",
                    },
                    {
                        components: [
                            { internalType: "address", name: "extension", type: "address" },
                            { internalType: "uint256", name: "msgValue", type: "uint256" },
                            { internalType: "uint16", name: "extensionBps", type: "uint16" },
                            { internalType: "bytes", name: "extensionData", type: "bytes" },
                        ],
                        internalType: "struct IClanker.ExtensionConfig[]",
                        name: "extensionConfigs",
                        type: "tuple[]",
                    },
                ],
                internalType: "struct IClanker.DeploymentConfig",
                name: "deploymentConfig",
                type: "tuple",
            },
        ],
        name: "deployToken",
        outputs: [{ internalType: "address", name: "tokenAddress", type: "address" }],
        stateMutability: "payable",
        type: "function",
    },
] as const;

const CLANKER_LOCKER_INIT_ABI = [
    {
        type: "tuple",
        components: [{ type: "uint8[]", name: "feePreference" }],
    },
] as const;

const CLANKER_STATIC_FEE_INIT_ABI = [
    { type: "uint24" },
    { type: "uint24" },
] as const;

const CLANKER_MEV_INIT_ABI = [
    {
        type: "tuple",
        components: [
            { name: "startingFee", type: "uint24", internalType: "uint24" },
            { name: "endingFee", type: "uint24", internalType: "uint24" },
            { name: "secondsToDecay", type: "uint256", internalType: "uint256" },
        ],
    },
] as const;

const CLANKER_POOL_INIT_ABI = [
    {
        type: "tuple",
        components: [
            { name: "extension", type: "address", internalType: "address" },
            { name: "extensionData", type: "bytes", internalType: "bytes" },
            { name: "feeData", type: "bytes", internalType: "bytes" },
        ],
    },
] as const;

const CLANKER_NETWORKS = {
    "base-mainnet": {
        chainId: 8453,
        factory: "0xE85A59c628F7d27878ACeB4bf3b35733630083a9" as Address,
        locker: "0x63D2DfEA64b3433F4071A98665bcD7Ca14d93496" as Address,
        mevModule: "0xebB25BB797D82CB78E1bc70406b13233c0854413" as Address,
        staticFeeHook: "0xb429d62f8f3bFFb98CdB9569533eA23bF0Ba28CC" as Address,
        weth: "0x4200000000000000000000000000000000000006" as Address,
    },
    "base-sepolia": {
        chainId: 84532,
        factory: "0xE85A59c628F7d27878ACeB4bf3b35733630083a9" as Address,
        locker: "0x824bB048a5EC6e06a09aEd115E9eEA4618DC2c8f" as Address,
        mevModule: "0x261fE99C4D0D41EE8d0e594D11aec740E8354ab0" as Address,
        staticFeeHook: "0x11b51DBC2f7F683b81CeDa83DC0078D57bA328cc" as Address,
        weth: "0x4200000000000000000000000000000000000006" as Address,
    },
} as const;

const CLANKER_STANDARD_POSITIONS = [
    {
        tickLower: -230400,
        tickUpper: -120000,
        positionBps: 10_000,
    },
] as const;

const CLANKER_DEFAULT_CONTEXT = {
    interface: "Bavium Builder",
    platform: "Bavium",
} as const;

function isTruthyBoolean(value: unknown, fallback = false): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true") return true;
        if (normalized === "false") return false;
    }

    return fallback;
}

function parseStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .map((item) => String(item).trim())
            .filter((item) => item.length > 0);
    }

    if (typeof value !== "string") return [];

    return value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

function sanitizeSymbol(symbol: string): string {
    return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
}

function buildClankerMetadata(params: Record<string, unknown>): string {
    const description = String(params.description ?? "").trim();
    const website = String(params.website ?? "").trim();
    const socialLinks = parseStringArray(params.socialLinks);

    const metadata = {
        ...(description ? { description } : {}),
        ...(website ? { website } : {}),
        ...(socialLinks.length > 0 ? { socialLinks } : {}),
    };

    return JSON.stringify(metadata);
}

function buildClankerContext(params: Record<string, unknown>): string {
    const interfaceName = String(params.interface ?? CLANKER_DEFAULT_CONTEXT.interface).trim();
    const trigger = String(params.trigger ?? "builder").trim();

    return JSON.stringify({
        ...CLANKER_DEFAULT_CONTEXT,
        interface: interfaceName || CLANKER_DEFAULT_CONTEXT.interface,
        trigger,
    });
}

function ensureMorphoSupportedNetwork(networkId: keyof typeof NETWORKS): SkillResult | undefined {
    if (networkId !== "base-mainnet") {
        return {
            success: false,
            error: "Morpho vault actions are currently supported only on Base mainnet.",
        };
    }

    return undefined;
}

async function executeClankerDeployToken(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    const walletAddress = resolveWalletAddress(params, context);
    if (!walletAddress) {
        return { success: false, error: "No wallet address available. Connect your wallet first." };
    }

    try {
        const network = NETWORKS[context.networkId ?? getActiveNetwork().networkId];
        const clanker = CLANKER_NETWORKS[network.networkId];
        if (!clanker) {
            return {
                success: false,
                error: `Clanker token deployment is not configured for network "${network.networkId}".`,
            };
        }

        const name = String(params.name ?? "").trim();
        const symbol = sanitizeSymbol(String(params.symbol ?? ""));
        const image = String(params.image ?? "").trim();
        const tokenAdmin = String(params.tokenAdmin ?? walletAddress).trim();
        const quoteToken = String(params.quoteToken ?? "WETH").trim().toUpperCase();
        const includeSniperProtection = isTruthyBoolean(params.includeSniperProtection, true);

        if (!name) {
            return { success: false, error: "Token name is required." };
        }

        if (!symbol || symbol.length < 2) {
            return {
                success: false,
                error: "Token symbol must contain at least 2 alphanumeric characters.",
            };
        }

        if (!isAddress(tokenAdmin)) {
            return { success: false, error: "Token admin must be a valid 0x address." };
        }

        const ethBalance = await getETHBalance(walletAddress, network.networkId);
        if (ethBalance.balanceRaw === BigInt(0)) {
            return {
                success: false,
                error: `Your wallet has no ETH for gas on ${network.label}. Keep some ETH before preparing a Clanker deployment.`,
            };
        }

        const normalizedTokenAdmin = getAddress(tokenAdmin);

        if (quoteToken !== "WETH") {
            return {
                success: false,
                error: "This first Clanker phase only supports WETH as the quote token.",
            };
        }

        const lockerData = encodeAbiParameters(CLANKER_LOCKER_INIT_ABI, [
            {
                feePreference: [0],
            },
        ]);

        const feeData = encodeAbiParameters(CLANKER_STATIC_FEE_INIT_ABI, [100, 100]);
        const poolData = encodeAbiParameters(CLANKER_POOL_INIT_ABI, [
            {
                extension: zeroAddress,
                extensionData: "0x",
                feeData,
            },
        ]);

        const mevModuleData = includeSniperProtection
            ? encodeAbiParameters(CLANKER_MEV_INIT_ABI, [
                {
                    startingFee: 666_777,
                    endingFee: 41_673,
                    secondsToDecay: BigInt(15),
                },
            ])
            : "0x";

        const deployData = encodeFunctionData({
            abi: CLANKER_FACTORY_ABI,
            functionName: "deployToken",
            args: [
                {
                    tokenConfig: {
                        tokenAdmin: normalizedTokenAdmin,
                        name,
                        symbol,
                        salt: zeroHash,
                        image,
                        metadata: buildClankerMetadata(params),
                        context: buildClankerContext(params),
                        originatingChainId: BigInt(clanker.chainId),
                    },
                    poolConfig: {
                        hook: clanker.staticFeeHook,
                        pairedToken: clanker.weth,
                        tickIfToken0IsClanker: -230400,
                        tickSpacing: 200,
                        poolData,
                    },
                    lockerConfig: {
                        locker: clanker.locker,
                        rewardAdmins: [normalizedTokenAdmin],
                        rewardRecipients: [normalizedTokenAdmin],
                        rewardBps: [10_000],
                        tickLower: CLANKER_STANDARD_POSITIONS.map((position) => position.tickLower),
                        tickUpper: CLANKER_STANDARD_POSITIONS.map((position) => position.tickUpper),
                        positionBps: CLANKER_STANDARD_POSITIONS.map((position) => position.positionBps),
                        lockerData,
                    },
                    mevModuleConfig: {
                        mevModule: clanker.mevModule,
                        mevModuleData,
                    },
                    extensionConfigs: [],
                },
            ],
        });

        return {
            success: true,
            data: createPreparedTransactionOutput(network.networkId, {
                calls: [
                    {
                        to: clanker.factory,
                        value: "0x0",
                        data: deployData,
                    },
                ],
                description: `Deploy ${symbol} with Clanker on ${network.label}`,
                summary: `Deploy ${symbol} with Clanker on ${network.label}`,
                protocol: "clanker",
                action: "deploy_token",
                extras: {
                    chainId: clanker.chainId,
                    factory: clanker.factory,
                    quoteToken,
                    token: {
                        name,
                        symbol,
                        image,
                        admin: normalizedTokenAdmin,
                    },
                    launchConfig: {
                        sniperProtection: includeSniperProtection,
                        quoteToken,
                        positions: "standard",
                        feeMode: "static_basic",
                    },
                    compatibilityNote:
                        "This launch uses Clanker v4 pool infrastructure. The built-in swap skill currently supports only single-pool Uniswap v3 routes, so immediate swapping for newly launched tokens may require future v4 support or an external market flow.",
                },
            }),
            message: `Prepared: Deploy ${symbol} via Clanker on ${network.label}. Note: built-in swaps are still limited to Uniswap v3 single-pool routes.`,
        };
    } catch (err) {
        return {
            success: false,
            error: `Clanker deployment preparation failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

// ---------------------------------------------------------------------------
// Action Implementations
// ---------------------------------------------------------------------------

async function executeMorphoDeposit(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    const walletAddress = resolveWalletAddress(params, context);
    if (!walletAddress) {
        return { success: false, error: "No wallet address available. Connect your wallet first." };
    }

    try {
        const vaultId = String(params.vaultId ?? params.vault ?? "morpho-usdc");
        const vault = MORPHO_VAULTS[vaultId];
        const resolvedNetworkId = context.networkId ?? getActiveNetwork().networkId;
        const unsupportedNetworkResult = ensureMorphoSupportedNetwork(resolvedNetworkId);
        if (unsupportedNetworkResult) {
            return unsupportedNetworkResult;
        }
        if (!vault) {
            const available = Object.keys(MORPHO_VAULTS).join(", ");
            return {
                success: false,
                error: `Unknown vault "${vaultId}". Available: ${available}`,
            };
        }

        const amount = String(params.amount ?? "0");
        const rawAmount = parseUnits(amount, vault.decimals);
        const [tokenBalance, ethBalance] = await Promise.all([
            getBalance(vault.underlyingAddress, walletAddress, resolvedNetworkId),
            getETHBalance(walletAddress, resolvedNetworkId),
        ]);

        if (tokenBalance.balanceRaw < rawAmount) {
            return {
                success: false,
                error: `Not enough ${vault.underlyingSymbol}. Wallet balance is ${tokenBalance.balance} ${vault.underlyingSymbol} but this deposit needs ${amount} ${vault.underlyingSymbol}.`,
            };
        }

        if (ethBalance.balanceRaw === BigInt(0)) {
            return {
                success: false,
                error: "Your wallet has no ETH for gas on Base mainnet. Keep some ETH before depositing into Morpho.",
            };
        }

        // Build approve + deposit batch transaction
        // Step 1: Approve vault to spend tokens
        const approveData = encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "approve",
            args: [vault.address, rawAmount],
        });

        // Step 2: Deposit into vault
        const depositData = encodeFunctionData({
            abi: MORPHO_VAULT_ABI,
            functionName: "deposit",
            args: [rawAmount, walletAddress],
        });

        return {
            success: true,
            data: createPreparedTransactionOutput(resolvedNetworkId, {
                calls: [
                    {
                        to: vault.underlyingAddress,
                        value: "0x0",
                        data: approveData,
                    },
                    {
                        to: vault.address,
                        value: "0x0",
                        data: depositData,
                    },
                ],
                description: `Deposit ${amount} ${vault.underlyingSymbol} into ${vault.name}`,
                summary: `Deposit ${amount} ${vault.underlyingSymbol} into ${vault.name}`,
                protocol: "morpho",
                action: "deposit",
                extras: {
                    vaultId,
                    vaultName: vault.name,
                    underlyingSymbol: vault.underlyingSymbol,
                    atomic: true,
                },
            }),
            message: `Prepared: Deposit ${amount} ${vault.underlyingSymbol} → ${vault.name}`,
        };
    } catch (err) {
        return {
            success: false,
            error: `Morpho deposit failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

async function executeMorphoWithdraw(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    const walletAddress = resolveWalletAddress(params, context);
    if (!walletAddress) {
        return { success: false, error: "No wallet address available. Connect your wallet first." };
    }

    try {
        const vaultId = String(params.vaultId ?? params.vault ?? "morpho-usdc");
        const vault = MORPHO_VAULTS[vaultId];
        const resolvedNetworkId = context.networkId ?? getActiveNetwork().networkId;
        const unsupportedNetworkResult = ensureMorphoSupportedNetwork(resolvedNetworkId);
        if (unsupportedNetworkResult) {
            return unsupportedNetworkResult;
        }
        if (!vault) {
            const available = Object.keys(MORPHO_VAULTS).join(", ");
            return {
                success: false,
                error: `Unknown vault "${vaultId}". Available: ${available}`,
            };
        }

        const amount = String(params.amount ?? "0");
        const rawAmount = parseUnits(amount, vault.decimals);
        const client = getPublicClient(resolvedNetworkId);
        const [shares, ethBalance] = await Promise.all([
            client.readContract({
                address: vault.address,
                abi: MORPHO_VAULT_ABI,
                functionName: "balanceOf",
                args: [walletAddress],
            }),
            getETHBalance(walletAddress, resolvedNetworkId),
        ]);
        const assets = shares > BigInt(0)
            ? await client.readContract({
                address: vault.address,
                abi: MORPHO_VAULT_ABI,
                functionName: "convertToAssets",
                args: [shares],
            })
            : BigInt(0);

        if (assets < rawAmount) {
            return {
                success: false,
                error: `Not enough ${vault.underlyingSymbol} in ${vault.name}. Vault position is ${formatUnits(assets, vault.decimals)} ${vault.underlyingSymbol} but this withdrawal needs ${amount} ${vault.underlyingSymbol}.`,
            };
        }

        if (ethBalance.balanceRaw === BigInt(0)) {
            return {
                success: false,
                error: "Your wallet has no ETH for gas on Base mainnet. Keep some ETH before withdrawing from Morpho.",
            };
        }

        const withdrawData = encodeFunctionData({
            abi: MORPHO_VAULT_ABI,
            functionName: "withdraw",
            args: [rawAmount, walletAddress, walletAddress],
        });

        return {
            success: true,
            data: createPreparedTransactionOutput(resolvedNetworkId, {
                calls: [
                    {
                        to: vault.address,
                        value: "0x0",
                        data: withdrawData,
                    },
                ],
                description: `Withdraw ${amount} ${vault.underlyingSymbol} from ${vault.name}`,
                summary: `Withdraw ${amount} ${vault.underlyingSymbol} from ${vault.name}`,
                protocol: "morpho",
                action: "withdraw",
                extras: {
                    vaultId,
                    vaultName: vault.name,
                    underlyingSymbol: vault.underlyingSymbol,
                },
            }),
            message: `Prepared: Withdraw ${amount} ${vault.underlyingSymbol} ← ${vault.name}`,
        };
    } catch (err) {
        return {
            success: false,
            error: `Morpho withdraw failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

async function executeMorphoPortfolio(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    const walletAddress = resolveWalletAddress(params, context);
    if (!walletAddress) {
        return { success: false, error: "No wallet address available. Connect your wallet first." };
    }

    try {
        const client = getPublicClient(context.networkId);
        const positions: Array<{
            vault: string;
            shares: string;
            assets: string;
            symbol: string;
        }> = [];

        for (const [_id, vault] of Object.entries(MORPHO_VAULTS)) {
            const shares = await client.readContract({
                address: vault.address,
                abi: MORPHO_VAULT_ABI,
                functionName: "balanceOf",
                args: [walletAddress],
            });

            if (shares > BigInt(0)) {
                const assets = await client.readContract({
                    address: vault.address,
                    abi: MORPHO_VAULT_ABI,
                    functionName: "convertToAssets",
                    args: [shares],
                });

                positions.push({
                    vault: vault.name,
                    shares: formatUnits(shares, 18), // vault shares are 18 decimals
                    assets: formatUnits(assets, vault.decimals),
                    symbol: vault.underlyingSymbol,
                });
            }
        }

        if (positions.length === 0) {
            return {
                success: true,
                data: { positions: [] },
                message: "No active DeFi positions found.",
            };
        }

        const summary = positions
            .map((p) => `${p.vault}: ${p.assets} ${p.symbol}`)
            .join("\n");

        return {
            success: true,
            data: { positions },
            message: `DeFi Positions:\n${summary}`,
        };
    } catch (err) {
        return {
            success: false,
            error: `Portfolio fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}



// ---------------------------------------------------------------------------
// Skill Definition
// ---------------------------------------------------------------------------

const ACTIONS: SkillActionMeta[] = [
    {
        name: "morpho_deposit",
        label: "Morpho Deposit",
        description:
            "Deposit tokens into a Morpho vault on Base to earn yield. Handles approval automatically via batch transaction.",
        params: [
            { name: "vaultId", type: "string", required: false, description: "Vault identifier (default: morpho-usdc)", default: "morpho-usdc" },
            { name: "amount", type: "amount", required: true, description: "Amount to deposit" },
        ],
        requiresConfirmation: true,
        requiresWallet: true,
    },
    {
        name: "morpho_withdraw",
        label: "Morpho Withdraw",
        description:
            "Withdraw deposited tokens from a Morpho vault on Base.",
        params: [
            { name: "vaultId", type: "string", required: false, description: "Vault identifier (default: morpho-usdc)", default: "morpho-usdc" },
            { name: "amount", type: "amount", required: true, description: "Amount to withdraw" },
        ],
        requiresConfirmation: true,
        requiresWallet: true,
    },
    {
        name: "morpho_portfolio",
        label: "DeFi Portfolio",
        description:
            "View your DeFi positions across Morpho vaults on Base.",
        params: [],
        requiresWallet: true,
    },
    {
        name: "clanker_deploy_token",
        label: "Clanker Deploy Token",
        description:
            "Prepare a Clanker token deployment transaction on Base or Base Sepolia with the standard WETH launch configuration.",
        params: [
            { name: "name", type: "string", required: true, description: "Token name" },
            { name: "symbol", type: "string", required: true, description: "Token ticker symbol" },
            { name: "image", type: "string", required: false, description: "Optional image URL or IPFS URI" },
            { name: "description", type: "string", required: false, description: "Optional token description metadata" },
            { name: "website", type: "string", required: false, description: "Optional project website" },
            { name: "socialLinks", type: "string", required: false, description: "Optional comma-separated social links" },
            { name: "tokenAdmin", type: "address", required: false, description: "Token admin address (defaults to connected wallet)" },
            { name: "quoteToken", type: "string", required: false, description: "Quote token (currently only WETH)", default: "WETH" },
            { name: "includeSniperProtection", type: "boolean", required: false, description: "Enable default sniper fee protection", default: true },
        ],
        requiresConfirmation: true,
        requiresWallet: true,
    },
];

const defiSkill: ISkill = {
    name: "defi",
    label: "DeFi",
    category: "defi",
    description:
        "DeFi protocol interactions: Morpho vault actions and Clanker token launch preparation on Base.",
    actions: ACTIONS,

    async execute(
        action: string,
        params: Record<string, unknown>,
        context: VariableContext,
    ): Promise<SkillResult> {
        switch (action) {
            case "morpho_deposit":
                return executeMorphoDeposit(params, context);
            case "morpho_withdraw":
                return executeMorphoWithdraw(params, context);
            case "morpho_portfolio":
                return executeMorphoPortfolio(params, context);
            case "clanker_deploy_token":
                return executeClankerDeployToken(params, context);
            default:
                return { success: false, error: `Unknown defi action "${action}"` };
        }
    },
};

// Self-register
skillRegistry.register(defiSkill);

export { defiSkill };
