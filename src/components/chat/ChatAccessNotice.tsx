"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { AuthSessionState } from "@/hooks/useAuthSession";

function formatAddress(address: string | null | undefined): string {
    if (!address) return "";
    return address.length > 12
        ? `${address.slice(0, 6)}...${address.slice(-4)}`
        : address;
}

export function ChatAccessNotice({
    authState,
    walletAddress,
    compact = false,
}: {
    authState: AuthSessionState;
    walletAddress: string | null;
    compact?: boolean;
}) {
    const addressLabel = formatAddress(walletAddress);
    const noticeKey = useMemo(
        () => `${authState}:${walletAddress ?? "none"}`,
        [authState, walletAddress],
    );
    const [dismissedNoticeKey, setDismissedNoticeKey] = useState<string | null>(null);

    useEffect(() => {
        if (dismissedNoticeKey && dismissedNoticeKey !== noticeKey) {
            setDismissedNoticeKey(null);
        }
    }, [dismissedNoticeKey, noticeKey]);

    const copy =
        authState === "authenticated"
            ? `Wallet ready${addressLabel ? `: ${addressLabel}` : ""}. Save and run are available.`
            : authState === "connected_unauthenticated"
                ? "Wallet connected. Sign in from the header to save and run workflows."
                : authState === "loading"
                    ? "Checking wallet session..."
                    : authState === "error"
                        ? "Wallet session could not be checked. Chat still works; save and run may need sign-in."
                        : "AI chat works without a wallet. Connect wallet to save and run workflows.";

    const tone =
        authState === "authenticated"
            ? "border-status-success/20 bg-status-success/5 text-status-success"
            : authState === "loading"
                ? "border-border-subtle bg-tertiary text-fg-muted"
                : "border-status-warning/20 bg-status-warning/5 text-status-warning";

    const dot =
        authState === "authenticated"
            ? "bg-status-success"
            : authState === "loading"
                ? "bg-fg-muted"
                : "bg-status-warning";

    if (dismissedNoticeKey === noticeKey) {
        return null;
    }

    return (
        <div
            className={`mb-2 flex items-start gap-2 rounded-lg border px-2.5 ${
                compact ? "py-1.5 text-[11px]" : "py-2 text-xs"
            } ${tone}`}
        >
            <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
            <span className="min-w-0 flex-1 leading-relaxed">{copy}</span>
            <button
                type="button"
                onClick={() => setDismissedNoticeKey(noticeKey)}
                className="-mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-current"
                aria-label="Dismiss wallet status message"
            >
                <X size={compact ? 12 : 14} />
            </button>
        </div>
    );
}
