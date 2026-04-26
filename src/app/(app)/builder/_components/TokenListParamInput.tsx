"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, Search, X, XCircle } from "lucide-react";
import { isAddress } from "viem";
import { getRegisteredTokens, type NetworkId, type TokenInfo } from "@/lib/chain-config";
import { type TokenSearchResult, toRegistryTokenSearchResult } from "@/lib/token-search";
import { getTokenMetadata, type TokenMetadataResult } from "@/lib/viem-client";

type LookupState = "idle" | "loading" | "resolved" | "error";

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

function findKnownTokenByQuery(tokens: TokenInfo[], value: string): TokenInfo | undefined {
    const normalizedValue = value.trim().toLowerCase();
    if (!normalizedValue) return undefined;

    return tokens.find((token) =>
        token.symbol.toLowerCase() === normalizedValue ||
        token.name.toLowerCase() === normalizedValue ||
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

function parseTokenListValue(value: string): string[] {
    return value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function serializeTokenListValue(values: string[]): string {
    return values.join(",");
}

function getTokenRefKey(tokenRef: string, knownTokens: TokenInfo[]): string {
    const known = findKnownTokenByValue(knownTokens, tokenRef);
    if (known) return known.symbol.toLowerCase();
    return tokenRef.trim().toLowerCase();
}

function appendTokenRef(
    values: string[],
    tokenRef: string,
    knownTokens: TokenInfo[],
): string[] {
    const nextValue = tokenRef.trim();
    if (!nextValue) return values;

    const nextKey = getTokenRefKey(nextValue, knownTokens);
    if (values.some((value) => getTokenRefKey(value, knownTokens) === nextKey)) {
        return values;
    }

    return [...values, nextValue];
}

function truncateTokenRef(tokenRef: string): string {
    if (!isAddress(tokenRef)) return tokenRef.toUpperCase();
    return `${tokenRef.slice(0, 6)}…${tokenRef.slice(-4)}`;
}

export function TokenListParamInput({
    value,
    onChange,
    networkId,
    hint,
}: {
    value: string;
    onChange: (value: string) => void;
    networkId?: string;
    hint?: string;
}) {
    const resolvedNetworkId = networkId as NetworkId | undefined;
    const knownTokens = useMemo(
        () => getRegisteredTokens(resolvedNetworkId),
        [resolvedNetworkId],
    );
    const selectedValues = useMemo(
        () => parseTokenListValue(value),
        [value],
    );
    const selectedKeys = useMemo(
        () => new Set(selectedValues.map((entry) => getTokenRefKey(entry, knownTokens))),
        [knownTokens, selectedValues],
    );
    const [query, setQuery] = useState("");
    const deferredQuery = useDeferredValue(query.trim());
    const [isOpen, setIsOpen] = useState(false);
    const [selectedCustomTokens, setSelectedCustomTokens] =
        useState<Record<string, TokenMetadataResult>>({});
    const [addressPreview, setAddressPreview] = useState<TokenMetadataResult | null>(null);
    const [addressPreviewState, setAddressPreviewState] = useState<LookupState>("idle");
    const [addressPreviewError, setAddressPreviewError] = useState("");
    const containerRef = useRef<HTMLDivElement>(null);
    const shouldLookupAddressPreview = Boolean(
        isOpen &&
        deferredQuery &&
        !/[,\n]/.test(deferredQuery) &&
        isAddress(deferredQuery),
    );

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (containerRef.current?.contains(event.target as Node)) return;
            setIsOpen(false);
            setQuery("");
        }

        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isOpen]);

    useEffect(() => {
        const unresolvedAddresses = selectedValues.filter((tokenRef) => {
            if (!isAddress(tokenRef)) return false;
            if (findKnownTokenByValue(knownTokens, tokenRef)) return false;
            return !selectedCustomTokens[tokenRef.toLowerCase()];
        });

        if (unresolvedAddresses.length === 0) {
            return;
        }

        let cancelled = false;

        void Promise.all(
            unresolvedAddresses.map(async (address) => {
                try {
                    const token = await getTokenMetadata(address, resolvedNetworkId);
                    return [address.toLowerCase(), token] as const;
                } catch {
                    return null;
                }
            }),
        ).then((results) => {
            if (cancelled) return;
            const nextEntries = results.filter(Boolean);
            if (nextEntries.length === 0) return;

            setSelectedCustomTokens((prev) => {
                const next = { ...prev };
                for (const entry of nextEntries) {
                    if (!entry) continue;
                    const [key, token] = entry;
                    next[key] = token;
                }
                return next;
            });
        });

        return () => {
            cancelled = true;
        };
    }, [knownTokens, resolvedNetworkId, selectedCustomTokens, selectedValues]);

    useEffect(() => {
        if (!shouldLookupAddressPreview) {
            setAddressPreview(null);
            setAddressPreviewState("idle");
            setAddressPreviewError("");
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

    const localResults = useMemo(() => {
        const filtered = knownTokens
            .filter((token) => tokenMatchesQuery(token, deferredQuery))
            .filter((token) => !selectedKeys.has(getTokenRefKey(token.symbol, knownTokens)))
            .map((token) => toRegistryTokenSearchResult(token));

        if (deferredQuery) return filtered;
        return filtered.slice(0, 8);
    }, [deferredQuery, knownTokens, selectedKeys]);
    const networkLabel = resolvedNetworkId === "base-mainnet" ? "Base" : "Base Sepolia";

    function commitValues(nextValues: string[]) {
        onChange(serializeTokenListValue(nextValues));
    }

    function addTokenRef(tokenRef: string) {
        const nextValues = appendTokenRef(selectedValues, tokenRef, knownTokens);
        if (nextValues === selectedValues) return;
        commitValues(nextValues);
    }

    function removeTokenRef(tokenRef: string) {
        const targetKey = getTokenRefKey(tokenRef, knownTokens);
        const nextValues = selectedValues.filter(
            (value) => getTokenRefKey(value, knownTokens) !== targetKey,
        );
        commitValues(nextValues);
    }

    function selectToken(token: TokenSearchResult) {
        addTokenRef(resolveNextValue(token, knownTokens));
        setQuery("");
        setIsOpen(true);
    }

    function selectAddressPreview() {
        if (!addressPreview) return;
        addTokenRef(resolveNextValue(addressPreview, knownTokens));
        setQuery("");
        setIsOpen(true);
    }

    function commitQuerySelection() {
        const parts = query
            .split(/[,\n]/)
            .map((value) => value.trim())
            .filter(Boolean);

        if (parts.length === 0) return;

        let nextValues = selectedValues;
        let consumedCount = 0;

        for (const part of parts) {
            const known = findKnownTokenByQuery(knownTokens, part);
            if (known) {
                nextValues = appendTokenRef(nextValues, known.symbol, knownTokens);
                consumedCount += 1;
                continue;
            }

            if (isAddress(part)) {
                if (
                    addressPreviewState === "resolved" &&
                    addressPreview &&
                    addressPreview.address.toLowerCase() === part.toLowerCase()
                ) {
                    nextValues = appendTokenRef(
                        nextValues,
                        resolveNextValue(addressPreview, knownTokens),
                        knownTokens,
                    );
                } else {
                    nextValues = appendTokenRef(nextValues, part, knownTokens);
                }
                consumedCount += 1;
            }
        }

        if (consumedCount === 0) return;

        commitValues(nextValues);
        setQuery("");
        setIsOpen(true);
    }

    return (
        <div ref={containerRef} className="relative flex flex-col gap-2">
            {selectedValues.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                    {selectedValues.map((tokenRef) => {
                        const knownToken = findKnownTokenByValue(knownTokens, tokenRef);
                        const customToken = isAddress(tokenRef)
                            ? selectedCustomTokens[tokenRef.toLowerCase()]
                            : undefined;
                        const label = knownToken
                            ? formatTokenLabel(knownToken)
                            : customToken
                                ? formatTokenLabel(customToken)
                                : truncateTokenRef(tokenRef);

                        return (
                            <span
                                key={getTokenRefKey(tokenRef, knownTokens)}
                                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-brand/20 bg-brand-subtle px-2.5 py-1 text-xs text-brand-light"
                            >
                                <span className="truncate">{label}</span>
                                <button
                                    type="button"
                                    className="shrink-0 rounded-full text-brand-light/80 transition-colors hover:text-brand-light"
                                    onClick={() => removeTokenRef(tokenRef)}
                                    title="Remove token"
                                >
                                    <X size={12} />
                                </button>
                            </span>
                        );
                    })}
                </div>
            ) : null}

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
                    value={query}
                    onFocus={() => setIsOpen(true)}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        setIsOpen(true);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === ",") {
                            event.preventDefault();
                            commitQuerySelection();
                            return;
                        }

                        if (event.key === "Backspace" && !query && selectedValues.length > 0) {
                            event.preventDefault();
                            removeTokenRef(selectedValues[selectedValues.length - 1]);
                        }
                    }}
                    placeholder="Add token by symbol, name, or contract address"
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
                                            Add {addressPreview.symbol} · {addressPreview.name}
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

                            {localResults.length > 0 ? (
                                <div className="flex flex-col gap-1">
                                    <div className="px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-fg-muted">
                                        Known Tokens
                                    </div>
                                    {localResults.map((token) => (
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
                                            <span className="ml-3 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                                                Registry
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            ) : null}

                            {!shouldLookupAddressPreview && localResults.length === 0 ? (
                                <div className="rounded-md border border-border-subtle bg-tertiary px-3 py-2 text-xs text-fg-muted">
                                    No token matches yet. Keep typing or paste a Base token contract address.
                                </div>
                            ) : null}
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
