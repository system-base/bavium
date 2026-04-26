/* ==========================================================================
   Skills — NFT
   ERC-721 / ERC-1155 ownership checks and token metadata reads.
   ========================================================================== */

import type { ISkill, SkillActionMeta, SkillResult } from "../types";
import type { VariableContext } from "@/engine/types";
import { resolveWalletAddress } from "../helpers";
import { skillRegistry } from "../registry";
import { getPublicClient } from "@/lib/viem-client";
import { getAddress, isAddress, type Address } from "viem";
import { NETWORKS, getActiveNetwork, type NetworkId } from "@/lib/chain-config";

type NftStandard = "erc721" | "erc1155";
type RequestedStandard = NftStandard | "auto";

const nftStandardCache = new Map<string, NftStandard>();

const ERC165_ABI = [
    {
        inputs: [{ name: "interfaceId", type: "bytes4" }],
        name: "supportsInterface",
        outputs: [{ name: "", type: "bool" }],
        stateMutability: "view",
        type: "function",
    },
] as const;

const ERC721_ABI = [
    {
        inputs: [{ name: "tokenId", type: "uint256" }],
        name: "ownerOf",
        outputs: [{ name: "", type: "address" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [{ name: "tokenId", type: "uint256" }],
        name: "tokenURI",
        outputs: [{ name: "", type: "string" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [],
        name: "name",
        outputs: [{ name: "", type: "string" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [],
        name: "symbol",
        outputs: [{ name: "", type: "string" }],
        stateMutability: "view",
        type: "function",
    },
] as const;

const ERC1155_ABI = [
    {
        inputs: [
            { name: "account", type: "address" },
            { name: "id", type: "uint256" },
        ],
        name: "balanceOf",
        outputs: [{ name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [{ name: "id", type: "uint256" }],
        name: "uri",
        outputs: [{ name: "", type: "string" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [],
        name: "name",
        outputs: [{ name: "", type: "string" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [],
        name: "symbol",
        outputs: [{ name: "", type: "string" }],
        stateMutability: "view",
        type: "function",
    },
] as const;

const ERC721_INTERFACE_ID = "0x80ac58cd";
const ERC1155_INTERFACE_ID = "0xd9b67a26";

interface NftMetadataShape {
    name?: string;
    description?: string;
    image?: string;
    image_url?: string;
    imageUrl?: string;
    animation_url?: string;
    animationUrl?: string;
}

function parseContractAddress(value: unknown): Address {
    const input = String(value ?? "").trim();
    if (!isAddress(input)) {
        throw new Error("Enter a valid NFT contract address.");
    }
    return getAddress(input);
}

function parseTokenId(value: unknown): bigint {
    if (typeof value === "bigint") return value;
    const input = String(value ?? "").trim();
    if (!/^\d+$/.test(input)) {
        throw new Error("Token ID must be a non-negative integer.");
    }
    return BigInt(input);
}

function normalizeRequestedStandard(value: unknown): RequestedStandard {
    const input = String(value ?? "auto").trim().toLowerCase();
    if (input === "erc721" || input === "erc1155") return input;
    return "auto";
}

function buildNftCacheKey(contractAddress: Address, networkId: NetworkId): string {
    return `${networkId}:${contractAddress.toLowerCase()}`;
}

async function ensureNftContractExists(
    contractAddress: Address,
    networkId: VariableContext["networkId"],
): Promise<void> {
    const resolvedNetworkId = networkId ?? getActiveNetwork().networkId;
    const client = getPublicClient(resolvedNetworkId);
    const bytecode = await client.getBytecode({ address: contractAddress });
    if (bytecode && bytecode !== "0x") {
        return;
    }

    const alternateNetworkId: NetworkId =
        resolvedNetworkId === "base-mainnet"
            ? "base-sepolia"
            : "base-mainnet";
    const alternateBytecode = await getPublicClient(alternateNetworkId)
        .getBytecode({ address: contractAddress })
        .catch(() => null);

    if (alternateBytecode && alternateBytecode !== "0x") {
        throw new Error(
            `No contract found at ${contractAddress} on ${NETWORKS[resolvedNetworkId].label}. This NFT appears to be deployed on ${NETWORKS[alternateNetworkId].label}.`,
        );
    }

    throw new Error(
        `No contract found at ${contractAddress} on ${NETWORKS[resolvedNetworkId].label}. Check the NFT contract address or selected network.`,
    );
}

async function supportsInterface(
    contractAddress: Address,
    interfaceId: `0x${string}`,
    networkId: VariableContext["networkId"],
): Promise<boolean> {
    try {
        return await getPublicClient(networkId).readContract({
            address: contractAddress,
            abi: ERC165_ABI,
            functionName: "supportsInterface",
            args: [interfaceId],
        });
    } catch {
        return false;
    }
}

async function detectNftStandard(
    contractAddress: Address,
    tokenId: bigint,
    requested: RequestedStandard,
    networkId: VariableContext["networkId"],
): Promise<NftStandard> {
    const resolvedNetworkId = networkId ?? getActiveNetwork().networkId;
    if (requested !== "auto") return requested;

    const cachedStandard = nftStandardCache.get(buildNftCacheKey(contractAddress, resolvedNetworkId));
    if (cachedStandard) {
        return cachedStandard;
    }

    const [isErc721, isErc1155] = await Promise.all([
        supportsInterface(contractAddress, ERC721_INTERFACE_ID, resolvedNetworkId),
        supportsInterface(contractAddress, ERC1155_INTERFACE_ID, resolvedNetworkId),
    ]);

    if (isErc721) {
        nftStandardCache.set(buildNftCacheKey(contractAddress, resolvedNetworkId), "erc721");
        return "erc721";
    }

    if (isErc1155) {
        nftStandardCache.set(buildNftCacheKey(contractAddress, resolvedNetworkId), "erc1155");
        return "erc1155";
    }

    const client = getPublicClient(resolvedNetworkId);

    try {
        await client.readContract({
            address: contractAddress,
            abi: ERC721_ABI,
            functionName: "tokenURI",
            args: [tokenId],
        });
        nftStandardCache.set(buildNftCacheKey(contractAddress, resolvedNetworkId), "erc721");
        return "erc721";
    } catch {
        try {
            await client.readContract({
                address: contractAddress,
                abi: ERC1155_ABI,
                functionName: "uri",
                args: [tokenId],
            });
            nftStandardCache.set(buildNftCacheKey(contractAddress, resolvedNetworkId), "erc1155");
            return "erc1155";
        } catch {
            throw new Error("Could not detect whether this NFT uses ERC-721 or ERC-1155.");
        }
    }
}

function expandErc1155Uri(uri: string, tokenId: bigint): string {
    const hexId = tokenId.toString(16).padStart(64, "0");
    return uri.replace(/\{id\}/gi, hexId);
}

function normalizeAssetUrl(value: string | undefined, tokenId?: bigint): string | undefined {
    if (!value) return undefined;
    if (value.startsWith("ipfs://ipfs/")) {
        return `https://ipfs.io/ipfs/${value.slice("ipfs://ipfs/".length)}`;
    }
    if (value.startsWith("ipfs://")) {
        return `https://ipfs.io/ipfs/${value.slice("ipfs://".length)}`;
    }
    if (value.startsWith("data:")) {
        return value;
    }
    if (tokenId !== undefined && value.includes("{id}")) {
        return expandErc1155Uri(value, tokenId);
    }
    return value;
}

function decodeDataUriJson(uri: string): NftMetadataShape {
    const [, body = ""] = uri.split(",", 2);
    if (uri.includes(";base64,")) {
        const json = Buffer.from(body, "base64").toString("utf8");
        return JSON.parse(json) as NftMetadataShape;
    }
    return JSON.parse(decodeURIComponent(body)) as NftMetadataShape;
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 8000): Promise<NftMetadataShape> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: { accept: "application/json" },
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`Metadata request failed: ${response.status}`);
        }

        return await response.json() as NftMetadataShape;
    } finally {
        clearTimeout(timeout);
    }
}

async function loadBestEffortMetadata(
    tokenUri: string,
    tokenId: bigint,
): Promise<NftMetadataShape | undefined> {
    try {
        if (tokenUri.startsWith("data:application/json")) {
            return decodeDataUriJson(tokenUri);
        }

        const normalized = normalizeAssetUrl(tokenUri, tokenId);
        if (!normalized || (!normalized.startsWith("http://") && !normalized.startsWith("https://"))) {
            return undefined;
        }

        return await fetchJsonWithTimeout(normalized);
    } catch {
        return undefined;
    }
}

async function readCollectionAndTokenUri(
    contractAddress: Address,
    standard: NftStandard,
    tokenId: bigint,
    networkId: VariableContext["networkId"],
): Promise<{
    collection: { name?: string; symbol?: string };
    rawTokenUri?: string;
}> {
    const resolvedNetworkId = networkId ?? getActiveNetwork().networkId;
    const client = getPublicClient(resolvedNetworkId);
    const abi = standard === "erc721" ? ERC721_ABI : ERC1155_ABI;
    const tokenUriFunctionName = standard === "erc721" ? "tokenURI" : "uri";

    const [nameResult, symbolResult, tokenUriResult] = await client.multicall({
        allowFailure: true,
        contracts: [
            {
                address: contractAddress,
                abi,
                functionName: "name",
            },
            {
                address: contractAddress,
                abi,
                functionName: "symbol",
            },
            {
                address: contractAddress,
                abi,
                functionName: tokenUriFunctionName,
                args: [tokenId],
            },
        ],
    });

    const collection = {
        ...(nameResult.status === "success" && typeof nameResult.result === "string" && nameResult.result
            ? { name: nameResult.result }
            : {}),
        ...(symbolResult.status === "success" && typeof symbolResult.result === "string" && symbolResult.result
            ? { symbol: symbolResult.result }
            : {}),
    };

    const rawTokenUri =
        tokenUriResult.status === "success" && typeof tokenUriResult.result === "string"
            ? tokenUriResult.result
            : undefined;

    return {
        collection,
        rawTokenUri,
    };
}

async function executeCheckOwnership(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    const walletAddress = resolveWalletAddress(params, context);
    if (!walletAddress) {
        return {
            success: false,
            error: "No wallet address available. Connect your wallet or provide an address to check.",
        };
    }

    try {
        const contractAddress = parseContractAddress(params.contractAddress);
        const tokenId = parseTokenId(params.tokenId);
        await ensureNftContractExists(contractAddress, context.networkId);
        const standard = await detectNftStandard(
            contractAddress,
            tokenId,
            normalizeRequestedStandard(params.standard),
            context.networkId,
        );
        const client = getPublicClient(context.networkId);

        if (standard === "erc721") {
            const owner = await client.readContract({
                address: contractAddress,
                abi: ERC721_ABI,
                functionName: "ownerOf",
                args: [tokenId],
            });
            const isOwner = owner.toLowerCase() === walletAddress.toLowerCase();

            return {
                success: true,
                data: {
                    contractAddress,
                    tokenId: tokenId.toString(),
                    standard,
                    walletAddress,
                    owner,
                    isOwner,
                },
                message: isOwner
                    ? `${walletAddress} owns NFT #${tokenId.toString()}.`
                    : `${walletAddress} does not own NFT #${tokenId.toString()}.`,
            };
        }

        const balance = await client.readContract({
            address: contractAddress,
            abi: ERC1155_ABI,
            functionName: "balanceOf",
            args: [walletAddress, tokenId],
        });
        const isOwner = balance > BigInt(0);

        return {
            success: true,
            data: {
                contractAddress,
                tokenId: tokenId.toString(),
                standard,
                walletAddress,
                balance: balance.toString(),
                isOwner,
            },
            message: isOwner
                ? `${walletAddress} holds ERC-1155 token #${tokenId.toString()}.`
                : `${walletAddress} does not hold ERC-1155 token #${tokenId.toString()}.`,
        };
    } catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

async function executeGetTokenMetadata(
    params: Record<string, unknown>,
    context: VariableContext,
): Promise<SkillResult> {
    try {
        const contractAddress = parseContractAddress(params.contractAddress);
        const tokenId = parseTokenId(params.tokenId);
        await ensureNftContractExists(contractAddress, context.networkId);
        const standard = await detectNftStandard(
            contractAddress,
            tokenId,
            normalizeRequestedStandard(params.standard),
            context.networkId,
        );
        const { collection, rawTokenUri } = await readCollectionAndTokenUri(
            contractAddress,
            standard,
            tokenId,
            context.networkId,
        );
        if (!rawTokenUri) {
            throw new Error(
                standard === "erc721"
                    ? "Could not read tokenURI from this ERC-721 contract."
                    : "Could not read uri from this ERC-1155 contract.",
            );
        }

        const tokenUri = normalizeAssetUrl(rawTokenUri, tokenId) ?? rawTokenUri;
        const metadata = await loadBestEffortMetadata(rawTokenUri, tokenId);
        const image = normalizeAssetUrl(
            metadata?.image
            ?? metadata?.image_url
            ?? metadata?.imageUrl,
            tokenId,
        );
        const animationUrl = normalizeAssetUrl(
            metadata?.animation_url
            ?? metadata?.animationUrl,
            tokenId,
        );

        return {
            success: true,
            data: {
                contractAddress,
                tokenId: tokenId.toString(),
                standard,
                collection,
                token: {
                    tokenUri,
                    ...(metadata?.name ? { name: metadata.name } : {}),
                    ...(metadata?.description ? { description: metadata.description } : {}),
                    ...(image ? { image } : {}),
                    ...(animationUrl ? { animationUrl } : {}),
                },
                metadataAvailable: Boolean(metadata),
            },
            message: [
                collection.name || "NFT collection",
                `token #${tokenId.toString()}`,
                metadata?.name ? `(${metadata.name})` : "",
            ].filter(Boolean).join(" "),
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
        name: "check_ownership",
        label: "Check NFT Ownership",
        description: "Check whether a wallet owns a specific ERC-721 or ERC-1155 token.",
        params: [
            { name: "contractAddress", type: "address", required: true, description: "NFT contract address" },
            { name: "tokenId", type: "number", required: true, description: "NFT token ID" },
            { name: "address", type: "address", required: false, description: "Wallet address to inspect (default: connected wallet)" },
            { name: "standard", type: "string", required: false, description: "Optional standard override: auto, erc721, or erc1155", default: "auto" },
        ],
    },
    {
        name: "get_token_metadata",
        label: "Get NFT Metadata",
        description: "Read collection details, token URI, and best-effort NFT metadata for ERC-721 or ERC-1155.",
        params: [
            { name: "contractAddress", type: "address", required: true, description: "NFT contract address" },
            { name: "tokenId", type: "number", required: true, description: "NFT token ID" },
            { name: "standard", type: "string", required: false, description: "Optional standard override: auto, erc721, or erc1155", default: "auto" },
        ],
    },
];

const nftSkill: ISkill = {
    name: "nft",
    label: "NFT",
    category: "nft",
    description: "NFT reads for Base: ownership checks and token metadata.",
    actions: ACTIONS,

    async execute(
        action: string,
        params: Record<string, unknown>,
        context: VariableContext,
    ): Promise<SkillResult> {
        switch (action) {
            case "check_ownership":
                return executeCheckOwnership(params, context);
            case "get_token_metadata":
                return executeGetTokenMetadata(params, context);
            default:
                return { success: false, error: `Unknown NFT action "${action}"` };
        }
    },
};

skillRegistry.register(nftSkill);

export { nftSkill };
