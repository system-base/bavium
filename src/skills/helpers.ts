/* ==========================================================================
   Skill Helpers — Shared utilities for skill implementations.
   ========================================================================== */

import type { VariableContext } from "@/engine/types";

/**
 * Extract wallet address from skill params or variable context.
 *
 * Priority:
 *   1. params.address (explicit parameter)
 *   2. params.wallet  (alternative key)
 *   3. context.wallet.address (injected by engine from connected wallet)
 *
 * Used by wallet, defi, and any future skills that need the active wallet.
 */
export function resolveWalletAddress(
    params: Record<string, unknown>,
    context: VariableContext,
): `0x${string}` | undefined {
    const fromParams = params.address ?? params.wallet;
    if (typeof fromParams === "string" && fromParams.startsWith("0x")) {
        return fromParams as `0x${string}`;
    }

    const fromContext = context.wallet?.address;
    if (typeof fromContext === "string" && fromContext.startsWith("0x")) {
        return fromContext as `0x${string}`;
    }

    return undefined;
}
