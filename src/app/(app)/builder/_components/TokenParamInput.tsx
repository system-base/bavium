"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, Search, XCircle } from "lucide-react";
import { isAddress } from "viem";
import { useAccount } from "wagmi";
import { getRegisteredTokens, type NetworkId, type TokenInfo } from "@/lib/chain-config";
import { type TokenSearchResult, toRegistryTokenSearchResult } from "@/lib/token-search";
import {
    getETHBalance,
    getRegisteredTokenBalances,
    getTokenMetadata,
    type TokenMetadataResult,
} from "@/lib/viem-client";

type LookupState = "idle" | "loading" | "resolved" | "error";

interface WalletTokenBalanceEntry {
    balance: string;
    balanceRaw: bigint;
}

const WALLET_TOKEN_BALANCE_CACHE_TTL_MS = 20_000;
const walletTokenBalanceCache = new Map<
    string,
    {
        expiresAt: number;
        data?: Map<string, WalletTokenBalanceEntry>;
        promise?: Promise<Map<string, WalletTokenBalanceEntry>>;
    }
>();

async function loadWalletTokenBalances(
    walletAddress: `0x${string}`,
    networkId?: NetworkId,
): Promise<Map<string, WalletTokenBalanceEntry>> {
    const cacheKey = `${networkId ?? "active"}:${walletAddress.toLowerCase()}`;
    const now = Date.now();
    const cached = walletTokenBalanceCache.get(cacheKey);

    if (cached?.data && cached.expiresAt > now) {
        return cached.data;
    }

    if (cached?.promise) {
        return cached.promise;
    }

    const promise = (async () => {
        const [ethBalance, tokenBalances] = await Promise.all([
            getETHBalance(walletAddress, networkId),
            getRegisteredTokenBalances(walletAddress, networkId),
        ]);

        const next = new Map<string, WalletTokenBalanceEntry>();
        next.set("ETH", {
            balance: ethBalance.balance,
            balanceRaw: ethBalance.balanceRaw,
        });

        for (const tokenBalance of tokenBalances) {
            next.set(tokenBalance.symbol.toUpperCase(), {
                balance: tokenBalance.balance,
                balanceRaw: tokenBalance.balanceRaw,
            });
        }

        walletTokenBalanceCache.set(cacheKey, {
            expiresAt: Date.now() + WALLET_TOKEN_BALANCE_CACHE_TTL_MS,
            data: next,
        });

        return next;
    })();

    walletTokenBalanceCache.set(cacheKey, {
        expiresAt: now + WALLET_TOKEN_BALANCE_CACHE_TTL_MS,
        promise,
    });

    try {
        return await promise;
    } catch (error) {
        walletTokenBalanceCache.delete(cacheKey);
        throw error;
    }
}

function formatTokenLabel(token: Pick<TokenSearchResult, "symbol" | "name">): string {
    return `${token.symbol} · ${token.name}`;
}

function tokenMatchesQuery(token: TokenInfo, query: string): boolean {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return true;

    const parts = normalizedQuery
        .split(/[^a-z0-9]+/i)
        .map((part) => part.trim())
        .filter(Boolean);

    if (parts.length === 0) return true;

    const haystacks = [
        token.symbol.toLowerCase(),
        token.name.toLowerCase(),
        token.address.toLowerCase(),
        formatTokenLabel(token).toLowerCase(),
    ];

    return parts.every((part) => haystacks.some((value) => value.includes(part)));
}

function findKnownTokenByValue(tokens: TokenInfo[], value: string): TokenInfo | undefined {
    const normalizedValue = value.trim().toLowerCase();
    return tokens.find((token) =>
        token.symbol.toLowerCase() === normalizedValue ||
        token.address.toLowerCase() === normalizedValue,
    );
}

function resolveNextValue(
    token: Pick<TokenSearchResult, "address">,
    knownTokens: TokenInfo[],
): string {
    const knownToken = knownTokens.find(
        (entry) => entry.address.toLowerCase() === token.address.toLowerCase(),
    );
    return knownToken?.symbol ?? token.address;
}

export function TokenParamInput({
    value,
    onChange,
    networkId,
    hint,
    allowedSymbols,
    allowCustomAddress = true,
    placeholder = "Search by name, symbol, or paste token address",
    emptyMessage,
}: {
    value: string;
    onChange: (value: string) => void;
    networkId?: string;
    hint?: string;
    allowedSymbols?: readonly string[];
    allowCustomAddress?: boolean;
    placeholder?: string;
    emptyMessage?: string;
}) {
    const resolvedNetworkId = networkId as NetworkId | undefined;
    const { address: walletAddress, isConnected } = useAccount();
    const allowedSymbolSet = useMemo(
        () => allowedSymbols
            ? new Set(allowedSymbols.map((symbol) => symbol.toUpperCase()))
            : null,
        [allowedSymbols],
    );
    const knownTokens = useMemo(
        () => getRegisteredTokens(resolvedNetworkId).filter((token) =>
            !allowedSymbolSet || allowedSymbolSet.has(token.symbol.toUpperCase()),
        ),
        [allowedSymbolSet, resolvedNetworkId],
    );
    const knownSelection = useMemo(
        () => findKnownTokenByValue(knownTokens, value),
        [knownTokens, value],
    );
    const selectedLabel = knownSelection ? formatTokenLabel(knownSelection) : value;
    const [query, setQuery] = useState(
        () => selectedLabel,
    );
    const deferredQuery = useDeferredValue(query.trim());
    const [isOpen, setIsOpen] = useState(false);
    const [selectedCustomToken, setSelectedCustomToken] =
        useState<TokenMetadataResult | null>(null);
    const [selectedCustomTokenState, setSelectedCustomTokenState] =
        useState<LookupState>("idle");
    const [selectedCustomTokenError, setSelectedCustomTokenError] = useState("");
    const [addressPreview, setAddressPreview] = useState<TokenMetadataResult | null>(null);
    const [addressPreviewState, setAddressPreviewState] = useState<LookupState>("idle");
    const [addressPreviewError, setAddressPreviewError] = useState("");
    const [walletBalances, setWalletBalances] = useState<Map<string, WalletTokenBalanceEntry> | null>(null);
    const [walletBalancesState, setWalletBalancesState] = useState<LookupState>("idle");
    const containerRef = useRef<HTMLDivElement>(null);
    const shouldLookupSelectedCustomToken = Boolean(
        allowCustomAddress && value && !knownSelection && isAddress(value),
    );
    const shouldLookupAddressPreview = Boolean(
        allowCustomAddress && isOpen && deferredQuery && isAddress(deferredQuery),
    );

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (containerRef.current?.contains(event.target as Node)) return;
            setIsOpen(false);
            setQuery(selectedLabel);
        }

        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isOpen, selectedLabel]);

    useEffect(() => {
        if (!shouldLookupSelectedCustomToken) {
            return;
        }

        let cancelled = false;
        queueMicrotask(() => {
            if (cancelled) return;
            setSelectedCustomTokenState("loading");
            setSelectedCustomTokenError("");
        });

        void getTokenMetadata(value, resolvedNetworkId)
            .then((token) => {
                if (cancelled) return;
                setSelectedCustomToken(token);
                setSelectedCustomTokenState("resolved");
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                setSelectedCustomToken(null);
                setSelectedCustomTokenState("error");
                setSelectedCustomTokenError(
                    error instanceof Error ? error.message : "Could not load token metadata.",
                );
            });

        return () => {
            cancelled = true;
        };
    }, [resolvedNetworkId, shouldLookupSelectedCustomToken, value]);

    useEffect(() => {
        if (!shouldLookupAddressPreview) {
            return;
        }

        let cancelled = false;
        queueMicrotask(() => {
            if (cancelled) return;
            setAddressPreviewState("loading");
            setAddressPreviewError("");
        });

        void getTokenMetadata(deferredQuery, resolvedNetworkId)
            .then((token) => {
                if (cancelled) return;
                setAddressPreview(token);
                setAddressPreviewState("resolved");
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                setAddressPreview(null);
                setAddressPreviewState("error");
                setAddressPreviewError(
                    error instanceof Error ? error.message : "Could not load token metadata.",
                );
            });

        return () => {
            cancelled = true;
        };
    }, [deferredQuery, resolvedNetworkId, shouldLookupAddressPreview]);

    useEffect(() => {
        if (!isOpen || !walletAddress || !isConnected) {
            return;
        }

        let cancelled = false;
        setWalletBalancesState((current) => (current === "resolved" ? current : "loading"));

        void loadWalletTokenBalances(walletAddress, resolvedNetworkId)
            .then((balances) => {
                if (cancelled) return;
                setWalletBalances(balances);
                setWalletBalancesState("resolved");
            })
            .catch(() => {
                if (cancelled) return;
                setWalletBalances(null);
                setWalletBalancesState("error");
            });

        return () => {
            cancelled = true;
        };
    }, [isConnected, isOpen, resolvedNetworkId, walletAddress]);

    const localResults = useMemo(() => {
        const filtered = knownTokens
            .filter((token) => tokenMatchesQuery(token, deferredQuery))
            .map((token) => toRegistryTokenSearchResult(token));

        if (deferredQuery) return filtered;
        return filtered.slice(0, 8);
    }, [deferredQuery, knownTokens]);
    const [ownedResults, otherResults] = useMemo(() => {
        if (!walletBalances || walletBalances.size === 0) {
            return [[], localResults] as const;
        }

        const owned: TokenSearchResult[] = [];
        const other: TokenSearchResult[] = [];

        for (const token of localResults) {
            const balanceEntry = walletBalances.get(token.symbol.toUpperCase());
            if (balanceEntry && balanceEntry.balanceRaw > BigInt(0)) {
                owned.push(token);
            } else {
                other.push(token);
            }
        }

        owned.sort((left, right) => {
            const leftBalance = walletBalances.get(left.symbol.toUpperCase())?.balanceRaw ?? BigInt(0);
            const rightBalance = walletBalances.get(right.symbol.toUpperCase())?.balanceRaw ?? BigInt(0);
            if (leftBalance > rightBalance) return -1;
            if (leftBalance < rightBalance) return 1;

            const leftRegistryIndex = knownTokens.findIndex((token) => token.symbol === left.symbol);
            const rightRegistryIndex = knownTokens.findIndex((token) => token.symbol === right.symbol);
            return leftRegistryIndex - rightRegistryIndex;
        });

        return [owned, other] as const;
    }, [knownTokens, localResults, walletBalances]);
    const networkLabel = resolvedNetworkId === "base-mainnet" ? "Base" : "Base Sepolia";

    function renderKnownTokenButton(token: TokenSearchResult) {
        const walletBalance = walletBalances?.get(token.symbol.toUpperCase());
        const balanceLabel = walletBalance && walletBalance.balanceRaw > BigInt(0)
            ? walletBalance.balance
            : null;

        return (
            <button
                key={`${token.chainId}:${token.address}`}
                type="button"
                className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-fg transition-colors hover:bg-tertiary"
                onClick={() => selectToken(token)}
            >
                <div className="min-w-0">
                    <div className="truncate font-medium">{formatTokenLabel(token)}</div>
                    <div className="truncate text-[11px] text-fg-muted">
                        {token.address}
                    </div>
                </div>
                <div className="ml-3 shrink-0 text-right">
                    {balanceLabel ? (
                        <div className="text-[11px] font-semibold text-fg">
                            {balanceLabel}
                        </div>
                    ) : null}
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                        Registry
                    </div>
                </div>
            </button>
        );
    }

    function selectToken(token: TokenSearchResult) {
        onChange(resolveNextValue(token, knownTokens));
        setQuery(formatTokenLabel(token));
        setIsOpen(false);
    }

    function selectAddressPreview() {
        if (!addressPreview) return;
        onChange(resolveNextValue(addressPreview, knownTokens));
        setQuery(formatTokenLabel(addressPreview));
        setIsOpen(false);
    }

    return (
        <div ref={containerRef} className="relative flex flex-col gap-1.5">
            <div className="relative">
                <Search
                    size={14}
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted"
                />
                <input
                    type="text"
                    className={`h-9 w-full min-w-0 rounded-md border pl-8 pr-3 text-sm text-fg outline-none transition-colors placeholder:text-fg-muted ${
                        isOpen
                            ? "border-border-strong bg-elevated"
                            : "border-border-subtle bg-tertiary hover:border-border-default"
                    } focus:border-border-strong focus:bg-elevated`}
                    value={isOpen ? query : selectedLabel}
                    onFocus={() => {
                        setQuery(selectedLabel);
                        setIsOpen(true);
                    }}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        setIsOpen(true);
                    }}
                    placeholder={placeholder}
                    spellCheck={false}
                    title={hint}
                />
                {isOpen ? (
                    <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-border-default bg-secondary p-2 shadow-card">
                        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
                            {shouldLookupAddressPreview && addressPreviewState === "loading" ? (
                                <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-tertiary px-3 py-2 text-xs text-fg-secondary">
                                    <Loader2 size={14} className="animate-spin text-brand-light" />
                                    <span>Checking token contract on {networkLabel}…</span>
                                </div>
                            ) : null}

                            {shouldLookupAddressPreview && addressPreviewState === "resolved" && addressPreview ? (
                                <button
                                    type="button"
                                    className="flex w-full items-start gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-left transition-colors hover:border-emerald-400/40 hover:bg-emerald-500/15"
                                    onClick={selectAddressPreview}
                                >
                                    <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-300" />
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium text-fg">
                                            Import {addressPreview.symbol} · {addressPreview.name}
                                        </div>
                                        <div className="mt-1 truncate text-[11px] text-fg-secondary">
                                            {addressPreview.address}
                                        </div>
                                        <div className="mt-1 text-[11px] text-fg-muted">
                                            {addressPreview.source === "registry"
                                                ? "Known token in the current Base registry."
                                                : "Verified directly from the token contract."}
                                        </div>
                                    </div>
                                </button>
                            ) : null}

                            {shouldLookupAddressPreview && addressPreviewState === "error" && addressPreviewError ? (
                                <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                                    <XCircle size={14} />
                                    <span>{addressPreviewError}</span>
                                </div>
                            ) : null}

                            {walletAddress && walletBalancesState === "loading" && !deferredQuery ? (
                                <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-tertiary px-3 py-2 text-xs text-fg-secondary">
                                    <Loader2 size={14} className="animate-spin text-brand-light" />
                                    <span>Loading tokens from your connected wallet…</span>
                                </div>
                            ) : null}

                            {ownedResults.length > 0 ? (
                                <div className="flex flex-col gap-1">
                                    <div className="px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-fg-muted">
                                        Your Tokens
                                    </div>
                                    {ownedResults.map(renderKnownTokenButton)}
                                </div>
                            ) : null}

                            {otherResults.length > 0 ? (
                                <div className="flex flex-col gap-1">
                                    <div className="px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-fg-muted">
                                        {ownedResults.length > 0 ? "More Tokens" : "Known Tokens"}
                                    </div>
                                    {otherResults.map(renderKnownTokenButton)}
                                </div>
                            ) : null}

                            {!shouldLookupAddressPreview &&
                            ownedResults.length === 0 &&
                            otherResults.length === 0 &&
                            !(shouldLookupAddressPreview && addressPreviewState === "resolved" && addressPreview) ? (
                                <div className="rounded-md border border-border-subtle bg-tertiary px-3 py-2 text-xs text-fg-muted">
                                    {emptyMessage ?? (
                                        allowCustomAddress
                                            ? "No token matches yet. Keep typing or paste a Base token contract address."
                                            : "No supported token matches yet."
                                    )}
                                </div>
                            ) : null}
                        </div>
                    </div>
                ) : null}
            </div>

            {shouldLookupSelectedCustomToken && selectedCustomTokenState === "resolved" && selectedCustomToken ? (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-fg">
                    <div className="flex items-center gap-2 text-emerald-300">
                        <CheckCircle2 size={14} />
                        <span className="font-medium">
                            Selected {selectedCustomToken.symbol} · {selectedCustomToken.name}
                        </span>
                    </div>
                    <div className="mt-1 text-fg-secondary">
                        {selectedCustomToken.address}
                    </div>
                </div>
            ) : null}

            {shouldLookupSelectedCustomToken && selectedCustomTokenState === "error" && selectedCustomTokenError ? (
                <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                    <XCircle size={14} />
                    <span>{selectedCustomTokenError}</span>
                </div>
            ) : null}
        </div>
    );
}
