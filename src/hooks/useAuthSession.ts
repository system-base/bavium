"use client";

import { useAccount, useAccountEffect } from "wagmi";
import {
    createElement,
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";

interface SessionResponse {
    authenticated?: boolean;
    address?: string;
    chainId?: number;
    reason?: string;
    error?: string;
}

export interface AuthSessionSnapshot {
    authenticated: boolean;
    address: string | null;
    chainId: number | null;
    reason?: string;
    error?: string;
}

export type AuthSessionState =
    | "loading"
    | "disconnected"
    | "connected_unauthenticated"
    | "authenticated"
    | "error";

interface AuthSessionContextValue {
    isConnected: boolean;
    sessionAuthenticated: boolean;
    sessionAddress: string | null;
    sessionChainId: number | null;
    sessionLoading: boolean;
    sessionError: boolean;
    authState: AuthSessionState;
    refreshSession: () => Promise<AuthSessionSnapshot>;
    signOutSession: (reason?: string) => Promise<AuthSessionSnapshot>;
}

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

export function AuthSessionProvider({ children }: { children: ReactNode }) {
    const { isConnected, address, status } = useAccount();
    const [sessionAuthenticated, setSessionAuthenticated] = useState(false);
    const [sessionAddress, setSessionAddress] = useState<string | null>(null);
    const [sessionChainId, setSessionChainId] = useState<number | null>(null);
    const [sessionLoading, setSessionLoading] = useState(true);
    const [sessionError, setSessionError] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);
    const requestIdRef = useRef(0);

    const normalizedAddress = useMemo(
        () => address?.toLowerCase() ?? null,
        [address],
    );

    const invalidateSessionRequest = useCallback(() => {
        requestIdRef.current += 1;
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
    }, []);

    /** Destroy the server-side session cookie. */
    const destroySession = useCallback(async (
        options: { invalidateRequests?: boolean; reason?: string } = {},
    ): Promise<AuthSessionSnapshot> => {
        if (options.invalidateRequests !== false) {
            invalidateSessionRequest();
        }
        try {
            await fetch("/api/auth/session", {
                method: "DELETE",
                credentials: "include",
            });
        } catch {
            // Best-effort — cookie may already be gone
        }
        setSessionAuthenticated(false);
        setSessionAddress(null);
        setSessionChainId(null);
        return {
            authenticated: false,
            address: null,
            chainId: null,
            reason: options.reason ?? "signed_out",
        };
    }, [invalidateSessionRequest]);

    const handleWalletDisconnect = useCallback(() => {
        void destroySession({ reason: "wallet_disconnected" });
        setSessionError(false);
        setSessionLoading(false);
    }, [destroySession]);

    useAccountEffect({
        onDisconnect: handleWalletDisconnect,
    });

    const loadSession = useCallback(async (): Promise<AuthSessionSnapshot> => {
        requestIdRef.current += 1;
        const requestId = requestIdRef.current;
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;

        if (status === "connecting" || status === "reconnecting") {
            setSessionError(false);
            setSessionLoading(true);
            return {
                authenticated: false,
                address: null,
                chainId: null,
                reason: "wallet_reconnecting",
            };
        }

        if (!isConnected) {
            setSessionAuthenticated(false);
            setSessionAddress(null);
            setSessionChainId(null);
            setSessionError(false);
            setSessionLoading(false);
            return {
                authenticated: false,
                address: null,
                chainId: null,
                reason: "wallet_disconnected",
            };
        }

        const controller = new AbortController();
        abortControllerRef.current = controller;
        setSessionLoading(true);
        setSessionError(false);

        try {
            const res = await fetch("/api/auth/session", {
                credentials: "include",
                signal: controller.signal,
            });

            if (!res.ok) {
                throw new Error("Failed to load auth session");
            }

            const data = await res.json() as SessionResponse;
            if (requestId !== requestIdRef.current || controller.signal.aborted) {
                return {
                    authenticated: false,
                    address: null,
                    chainId: null,
                    reason: "request_aborted",
                };
            }

            // If the session belongs to a different wallet, invalidate it
            if (
                data.authenticated &&
                typeof data.address === "string" &&
                normalizedAddress &&
                data.address.toLowerCase() !== normalizedAddress
            ) {
                await destroySession({
                    invalidateRequests: false,
                    reason: "wallet_mismatch",
                });
                setSessionError(false);
                return {
                    authenticated: false,
                    address: null,
                    chainId: null,
                    reason: "wallet_mismatch",
                };
            }

            const authenticated = Boolean(data.authenticated);
            const nextAddress =
                data.authenticated && typeof data.address === "string" && data.address.length > 0
                    ? data.address
                    : null;
            const nextChainId =
                data.authenticated && typeof data.chainId === "number"
                    ? data.chainId
                    : null;

            setSessionAuthenticated(authenticated);
            setSessionAddress(nextAddress);
            setSessionChainId(nextChainId);
            return {
                authenticated,
                address: nextAddress,
                chainId: nextChainId,
                reason: data.reason,
                error: data.error,
            };
        } catch (error) {
            if (
                controller.signal.aborted
                || requestId !== requestIdRef.current
                || (error instanceof DOMException && error.name === "AbortError")
            ) {
                return {
                    authenticated: false,
                    address: null,
                    chainId: null,
                    reason: "request_aborted",
                };
            }
            setSessionAuthenticated(false);
            setSessionAddress(null);
            setSessionChainId(null);
            setSessionError(true);
            return {
                authenticated: false,
                address: null,
                chainId: null,
                error: "Failed to load auth session",
            };
        } finally {
            if (requestId === requestIdRef.current && !controller.signal.aborted) {
                setSessionLoading(false);
            }
        }
    }, [destroySession, isConnected, normalizedAddress, status]);

    useEffect(() => {
        void loadSession();

        return () => {
            invalidateSessionRequest();
        };
    }, [invalidateSessionRequest, loadSession]);

    const authState: AuthSessionState = useMemo(() => (
        sessionLoading || status === "connecting" || status === "reconnecting"
            ? "loading"
            : !isConnected
                ? "disconnected"
                : sessionAuthenticated
                    ? "authenticated"
                    : sessionError
                        ? "error"
                        : "connected_unauthenticated"
    ), [isConnected, sessionAuthenticated, sessionError, sessionLoading, status]);

    const value = useMemo<AuthSessionContextValue>(() => ({
        isConnected,
        sessionAuthenticated,
        sessionAddress,
        sessionChainId,
        sessionLoading,
        sessionError,
        authState,
        refreshSession: loadSession,
        signOutSession: (reason?: string) => destroySession({ reason }),
    }), [
        authState,
        destroySession,
        isConnected,
        loadSession,
        sessionAddress,
        sessionAuthenticated,
        sessionChainId,
        sessionError,
        sessionLoading,
    ]);

    return createElement(AuthSessionContext.Provider, { value }, children);
}

export function useAuthSession() {
    const context = useContext(AuthSessionContext);
    if (!context) {
        throw new Error("useAuthSession must be used within AuthSessionProvider.");
    }
    return context;
}
