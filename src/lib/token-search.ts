import type { TokenInfo } from "@/lib/chain-config";

export type TokenSearchSource = "registry" | "chain";

export interface TokenSearchResult {
    address: string;
    chainId: number;
    symbol: string;
    name: string;
    decimals?: number;
    image?: string;
    source: TokenSearchSource;
}

export function toRegistryTokenSearchResult(token: TokenInfo): TokenSearchResult {
    return {
        address: token.address,
        chainId: token.chainId,
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        image: token.image || undefined,
        source: "registry",
    };
}
