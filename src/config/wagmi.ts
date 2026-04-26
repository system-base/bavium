/* ==========================================================================
   Wagmi + RainbowKit Configuration
   ─────────────────────────────────
   Central config for wallet connection.
   
   Strategy:
   - Primary wallet: Base Account (Coinbase Smart Wallet) — no WalletConnect needed
   - Secondary: WalletConnect-based wallets (MetaMask mobile, Rainbow, etc.)
   
   Chains:
   - Base Sepolia (default for development / testnet)
   - Base Mainnet (production)
   ========================================================================== */

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import {
    coinbaseWallet,
    metaMaskWallet,
    rainbowWallet,
    walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { base, baseSepolia } from "wagmi/chains";

/**
 * WalletConnect / Reown Project ID
 * ─────────────────────────────────
 * Get yours free at: https://dashboard.reown.com
 *
 * - Not required for Base Account (Coinbase Smart Wallet)
 * - Required for WalletConnect-based wallets (MetaMask mobile, Rainbow, etc.)
 * - If set to "YOUR_PROJECT_ID", RainbowKit uses its own demo fallback (dev-only)
 */
const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "YOUR_PROJECT_ID";

/**
 * Enable Coinbase Smart Wallet (Base Account) as the primary option.
 * https://www.coinbase.com/wallet/smart-wallet
 */
coinbaseWallet.preference = "smartWalletOnly";

export const wagmiConfig = getDefaultConfig({
    appName: "Bavium",
    projectId,

    // Base Sepolia first → becomes the default chain.
    chains: [baseSepolia, base],

    // Wallet list: Base Account (Coinbase Smart Wallet) first, then others
    wallets: [
        {
            groupName: "Recommended",
            wallets: [coinbaseWallet], // Base Account / Smart Wallet
        },
        {
            groupName: "Other Wallets",
            wallets: [metaMaskWallet, rainbowWallet, walletConnectWallet],
        },
    ],

    // Required for Next.js App Router (prevents SSR hydration mismatch)
    ssr: true,
});
