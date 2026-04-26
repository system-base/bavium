import { getRegisteredTokens, type NetworkId } from "@/lib/chain-config";
import { getBalance, getRegisteredTokenBalances } from "@/lib/viem-client";

export async function hydrateWalletExecutionContext(
    walletAddress: string,
    networkId?: NetworkId,
): Promise<Record<string, unknown>> {
    try {
        const tokens = getRegisteredTokens(networkId);
        const [ethBalance, tokenBalances] = await Promise.all([
            getBalance("ETH", walletAddress as `0x${string}`, networkId),
            getRegisteredTokenBalances(walletAddress as `0x${string}`, networkId),
        ]);
        const balanceEntries = new Map<string, string>([
            ["ETH", ethBalance.balance],
            ...tokenBalances.map((token) => [token.symbol, token.balance] as const),
        ]);

        return {
            wallet: {
                address: walletAddress,
                balance: Object.fromEntries(
                    tokens.map((token) => [token.symbol, balanceEntries.get(token.symbol) ?? "0"]),
                ),
            },
        };
    } catch {
        return {
            wallet: {
                address: walletAddress,
            },
        };
    }
}
