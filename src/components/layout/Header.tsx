"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useSignMessage, useSwitchChain } from "wagmi";
import { Menu, ChevronDown, Loader2, ShieldAlert } from "lucide-react";
import { Combobox } from "@/components/ui";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { BaviumLogo } from "@/components/ui/BaviumLogo";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useActiveChain } from "@/hooks/useActiveChain";
import { getNetworkByChainId, NETWORKS, type NetworkId } from "@/lib/chain-config";
import { setStoredPreferredNetwork } from "@/lib/network-preference";

const SUPPORTED_NETWORK_OPTIONS = [
    { value: "base-sepolia", label: "Base Sepolia" },
    { value: "base-mainnet", label: "Base" },
];

function isNetworkId(value: string): value is NetworkId {
    return value === "base-mainnet" || value === "base-sepolia";
}

interface WalletProvider {
    request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

interface BaseWalletConnectAccount {
    address: string;
    capabilities?: {
        signInWithEthereum?: {
            message: string;
            signature: `0x${string}`;
        };
    };
}

interface BaseWalletConnectResponse {
    accounts: BaseWalletConnectAccount[];
}

function isWalletProvider(value: unknown): value is WalletProvider {
    return typeof value === "object" && value !== null && "request" in value;
}

function isBaseWalletConnectResponse(value: unknown): value is BaseWalletConnectResponse {
    if (typeof value !== "object" || value === null || !("accounts" in value) || !Array.isArray(value.accounts)) {
        return false;
    }

    return value.accounts.every((account) =>
        typeof account === "object" &&
        account !== null &&
        "address" in account &&
        typeof account.address === "string",
    );
}

function isBaseAccountConnector(
    connector: { id?: string; type?: string } | null | undefined,
): boolean {
    return connector?.type === "baseAccount" ||
        connector?.type === "coinbaseWallet" ||
        connector?.id === "baseAccount" ||
        connector?.id === "coinbaseWalletSDK";
}

function shouldFallbackFromBaseFastPath(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    const message = error.message.toLowerCase();
    return (
        message.includes("wallet_connect") ||
        message.includes("method not found") ||
        message.includes("unsupported method") ||
        message.includes("not supported")
    );
}

export function Header({
    onMenuToggle,
}: {
    onMenuToggle?: () => void;
}) {
    const { address, isConnected, chain: walletChain, connector } = useAccount();
    const { authState, refreshSession } = useAuthSession();
    const { signMessageAsync } = useSignMessage();
    const { chainId: activeChainId, networkId: activeNetworkId, label: activeNetworkLabel } = useActiveChain();
    const { switchChainAsync, isPending, variables: switchChainVariables } = useSwitchChain();
    const [authBusy, setAuthBusy] = useState(false);
    const [authMessage, setAuthMessage] = useState<string | null>(null);
    const [showRetrySignIn, setShowRetrySignIn] = useState(false);

    const normalizedAddress = useMemo(
        () => address?.toLowerCase() ?? null,
        [address],
    );
    const connectedChainId = walletChain?.id ?? activeChainId;
    const walletSupportsSignInWithBase = useMemo(
        () => isBaseAccountConnector(connector),
        [connector],
    );
    const walletOnSupportedBaseChain = useMemo(
        () => Boolean(getNetworkByChainId(connectedChainId)),
        [connectedChainId],
    );

    const handleNetworkSelect = useCallback(async (value: string) => {
        if (!isNetworkId(value)) return;

        setStoredPreferredNetwork(value);
        const nextChainId = NETWORKS[value].chain.id;
        if (!isConnected || connectedChainId === nextChainId) return;

        try {
            await switchChainAsync({ chainId: nextChainId });
            setAuthMessage(null);
        } catch (error) {
            setAuthMessage(
                error instanceof Error
                    ? error.message
                    : `Could not switch to ${NETWORKS[value].label}.`,
            );
        }
    }, [connectedChainId, isConnected, switchChainAsync]);

    const performSignIn = useCallback(async () => {
        if (!normalizedAddress) return false;
        if (!walletOnSupportedBaseChain) {
            setAuthMessage(`Switch to ${activeNetworkLabel} before signing in.`);
            setShowRetrySignIn(false);
            return false;
        }

        setAuthBusy(true);
        setAuthMessage(null);

        try {
            const chainParam = connectedChainId ? `&chainId=${connectedChainId}` : "";
            const nonceRes = await fetch(
                `/api/auth/nonce?address=${encodeURIComponent(normalizedAddress)}${chainParam}`,
                { credentials: "include" },
            );

            if (!nonceRes.ok) {
                const nonceData = await nonceRes.json().catch(() => ({}));
                throw new Error(
                    typeof nonceData.error === "string"
                        ? nonceData.error
                        : "Failed to prepare sign-in message.",
                );
            }

            const nonceData = await nonceRes.json() as {
                nonce: string;
                message: string;
                chainId: number;
            };
            const targetChainId = nonceData.chainId ?? connectedChainId;
            let signedMessage = nonceData.message;
            let signedAddress = normalizedAddress;
            let signature: `0x${string}`;

            if (walletSupportsSignInWithBase && connector?.getProvider) {
                try {
                    const provider = await connector.getProvider();
                    if (isWalletProvider(provider)) {
                        const response = await provider.request({
                            method: "wallet_connect",
                            params: [
                                {
                                    version: "1",
                                    capabilities: {
                                        signInWithEthereum: {
                                            nonce: nonceData.nonce,
                                            chainId: `0x${targetChainId.toString(16)}`,
                                        },
                                    },
                                },
                            ],
                        });

                        if (isBaseWalletConnectResponse(response)) {
                            const baseAccount = response.accounts[0];
                            const baseAuth = baseAccount?.capabilities?.signInWithEthereum;
                            if (baseAccount?.address && baseAuth?.message && baseAuth.signature) {
                                signedAddress = baseAccount.address;
                                signedMessage = baseAuth.message;
                                signature = baseAuth.signature;
                            } else {
                                throw new Error("Base auth response did not include a SIWE payload.");
                            }
                        } else {
                            throw new Error("Unexpected Base auth response.");
                        }
                    } else {
                        throw new Error("Wallet provider is unavailable.");
                    }
                } catch (error) {
                    if (!shouldFallbackFromBaseFastPath(error)) {
                        throw error;
                    }

                    signature = await signMessageAsync({
                        message: nonceData.message,
                    });
                }
            } else {
                signature = await signMessageAsync({
                    message: nonceData.message,
                });
            }

            const verifyRes = await fetch("/api/auth/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    message: signedMessage,
                    signature,
                    address: signedAddress,
                    nonce: nonceData.nonce,
                    chainId: targetChainId,
                }),
            });

            if (!verifyRes.ok) {
                const verifyData = await verifyRes.json().catch(() => ({}));
                throw new Error(
                    typeof verifyData.error === "string"
                        ? verifyData.error
                        : "Sign-in could not be completed.",
                );
            }

            await refreshSession();
            setAuthMessage("Signed in");
            setShowRetrySignIn(false);
            return true;
        } catch (error) {
            setAuthMessage(
                error instanceof Error
                    ? error.message
                    : "Sign-in failed. Please try again.",
            );
            setShowRetrySignIn(true);
            return false;
        } finally {
            setAuthBusy(false);
        }
    }, [
        activeNetworkLabel,
        connectedChainId,
        connector,
        normalizedAddress,
        refreshSession,
        signMessageAsync,
        walletOnSupportedBaseChain,
        walletSupportsSignInWithBase,
    ]);

    // When connected but not authenticated, show the sign-in button.
    // We do NOT auto-trigger performSignIn() — this follows RainbowKit's
    // design philosophy where sign-in is always user-initiated.
    useEffect(() => {
        if (!isConnected) {
            setShowRetrySignIn(false);
            setAuthMessage(null);
            return;
        }

        if (authState === "authenticated") {
            setShowRetrySignIn(false);
            return;
        }

        if (authState === "connected_unauthenticated" && !authBusy) {
            setShowRetrySignIn(true);
        }
    }, [
        authBusy,
        authState,
        isConnected,
    ]);

    return (
        <header className="sticky top-0 z-50 flex items-center justify-between h-[var(--height-header)] px-3 sm:px-10 bg-primary/80 backdrop-blur-md border-b border-border-subtle">
            {/* Left: mobile menu + logo */}
            <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                <button
                    type="button"
                    className="flex sm:hidden items-center justify-center w-10 h-10 text-fg-secondary hover:text-fg transition-colors"
                    aria-label="Toggle navigation"
                    onClick={onMenuToggle}
                >
                    <Menu size={24} />
                </button>

                <Link
                    href="/"
                    className="flex items-center gap-2 sm:gap-4 no-underline group min-w-0"
                >
                    <BaviumLogo className="h-10 sm:h-14 w-auto text-fg shrink-0 transition-opacity group-hover:opacity-70" />
                    <span className="hidden min-[381px]:inline text-fg text-[20px] sm:text-[22px] tracking-wide truncate">
                        Bavium
                    </span>
                </Link>
            </div>

            {/* Right: theme + wallet */}
            <div className="flex items-center gap-2 sm:gap-4 shrink-0">
                <ThemeToggle />
                <ConnectButton.Custom>
                    {({
                        account,
                        chain,
                        openAccountModal,
                        openChainModal,
                        openConnectModal,
                        authenticationStatus,
                        mounted,
                    }) => {
                        const ready = mounted && authenticationStatus !== "loading";
                        const walletConnected = ready && account && chain;
                        const maybeOpenAccountModal = openAccountModal as (() => void) | undefined;
                        const maybeOpenChainModal = openChainModal as (() => void) | undefined;
                        const isSwitchingToActiveNetwork =
                            isPending && switchChainVariables?.chainId === activeChainId;

                        async function handleRetrySignIn() {
                            await performSignIn();
                        }

                        async function handleSwitchToActiveNetwork() {
                            try {
                                await switchChainAsync({ chainId: activeChainId });
                            } catch {
                                maybeOpenChainModal?.();
                            }
                        }

                        return (
                            <div
                                {...(!ready && {
                                    "aria-hidden": true,
                                    style: {
                                        opacity: 0,
                                        pointerEvents: "none",
                                        userSelect: "none",
                                    },
                                })}
                            >
                                {(() => {
                                    if (!walletConnected) {
                                        return (
                                            <div className="flex items-center gap-2">
                                                <div className="hidden sm:block w-[148px]">
                                                    <Combobox
                                                        options={SUPPORTED_NETWORK_OPTIONS}
                                                        value={activeNetworkId}
                                                        onChange={(value) => void handleNetworkSelect(value)}
                                                        hint="Preferred Base network before wallet connection"
                                                    />
                                                </div>
                                                <button
                                                    onClick={openConnectModal}
                                                    type="button"
                                                    className="h-9 px-3 sm:px-4 inline-flex items-center justify-center font-semibold text-xs sm:text-sm gap-2 rounded-md bg-brand text-white hover:bg-brand-light transition-colors whitespace-nowrap"
                                                >
                                                    <span className="sm:hidden">Connect</span>
                                                    <span className="hidden sm:inline">Connect Wallet</span>
                                                </button>
                                            </div>
                                        );
                                    }

                                    if (chain.unsupported) {
                                        return (
                                            <button
                                                onClick={() => void handleSwitchToActiveNetwork()}
                                                type="button"
                                                disabled={isSwitchingToActiveNetwork}
                                                className="h-9 px-4 inline-flex items-center justify-center font-semibold text-sm gap-2 rounded-md bg-status-error/10 text-status-error border border-status-error/20 hover:bg-status-error/20 transition-colors"
                                            >
                                                {isSwitchingToActiveNetwork ? (
                                                    <Loader2 size={14} className="animate-spin" />
                                                ) : (
                                                    <ShieldAlert size={14} />
                                                )}
                                                Switch to {activeNetworkLabel}
                                            </button>
                                        );
                                    }

                                    return (
                                        <div className="flex items-center gap-2 min-w-0">
                                            {authState === "connected_unauthenticated" && authBusy ? (
                                                <div
                                                    className="h-9 px-3 inline-flex items-center justify-center font-semibold text-xs sm:text-sm gap-2 rounded-md bg-status-warning/12 text-status-warning border border-status-warning/20 whitespace-nowrap"
                                                    title="Signing in with your wallet"
                                                >
                                                    <Loader2 size={14} className="animate-spin" />
                                                    <span className="sm:hidden">Signing…</span>
                                                    <span className="hidden sm:inline">Signing In…</span>
                                                </div>
                                            ) : authState === "connected_unauthenticated" && showRetrySignIn ? (
                                                <button
                                                    type="button"
                                                    onClick={() => void handleRetrySignIn()}
                                                    disabled={authBusy}
                                                    className="h-9 px-3 inline-flex items-center justify-center font-semibold text-xs sm:text-sm gap-2 rounded-md bg-status-warning/12 text-status-warning border border-status-warning/20 hover:bg-status-warning/20 transition-colors disabled:opacity-60 whitespace-nowrap"
                                                    title={authMessage ?? "Try signing in again"}
                                                >
                                                    <ShieldAlert size={14} />
                                                    <span className="sm:hidden">Sign In</span>
                                                    <span className="hidden sm:inline">
                                                        {walletSupportsSignInWithBase ? "Sign in with Base" : "Sign In"}
                                                    </span>
                                                </button>
                                            ) : null}

                                            <div className="flex items-center p-0.5 bg-tertiary border border-border-subtle rounded-lg min-w-0">
                                                <button
                                                    onClick={() => {
                                                        if (maybeOpenChainModal) {
                                                            maybeOpenChainModal();
                                                            return;
                                                        }
                                                        void handleSwitchToActiveNetwork();
                                                    }}
                                                    style={{ display: "flex", alignItems: "center" }}
                                                    type="button"
                                                    disabled={isSwitchingToActiveNetwork}
                                                    className="h-8 px-2 sm:px-3 flex items-center justify-center text-[12px] sm:text-[13px] font-medium rounded-md text-fg hover:bg-secondary transition-all gap-1.5 shrink-0 disabled:opacity-60"
                                                    title="Switch Base network"
                                                >
                                                    {isSwitchingToActiveNetwork ? (
                                                        <Loader2 size={14} className="animate-spin" />
                                                    ) : chain.hasIcon ? (
                                                        <div
                                                            style={{
                                                                background: chain.iconBackground,
                                                                width: 14,
                                                                height: 14,
                                                                borderRadius: 999,
                                                                overflow: "hidden",
                                                            }}
                                                        >
                                                            {chain.iconUrl && (
                                                                /* eslint-disable-next-line @next/next/no-img-element */
                                                                <img
                                                                    alt={chain.name ?? "Chain icon"}
                                                                    src={chain.iconUrl}
                                                                    style={{ width: 14, height: 14 }}
                                                                />
                                                            )}
                                                        </div>
                                                    ) : null}
                                                    <span className="hidden sm:inline truncate max-w-[112px]">
                                                        {chain.name}
                                                    </span>
                                                    <ChevronDown size={14} className="text-fg-muted" />
                                                </button>

                                                <div className="w-px h-4 bg-border-subtle mx-0.5" />

                                                <button
                                                    onClick={() => maybeOpenAccountModal?.()}
                                                    type="button"
                                                    className="h-8 px-2 sm:px-3 flex items-center justify-center text-[12px] sm:text-[13px] font-medium rounded-md text-fg hover:bg-secondary transition-all gap-1.5 min-w-0"
                                                    title="Open wallet details"
                                                >
                                                    <span className="truncate max-w-[84px] sm:max-w-none">
                                                        {account.displayName}
                                                    </span>
                                                    <ChevronDown size={14} className="text-fg-muted" />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        );
                    }}
                </ConnectButton.Custom>
            </div>
        </header>
    );
}
