"use client";

/* ==========================================================================
   App Providers — WagmiProvider + RainbowKit + React Query
   RainbowKit auto-switches between dark/light theme via useEffect.
   ========================================================================== */

import { useState, useEffect, useMemo, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import {
    RainbowKitProvider,
    RainbowKitAuthenticationProvider,
    createAuthenticationAdapter,
    darkTheme,
    lightTheme,
    type AuthenticationStatus,
    type Theme,
} from "@rainbow-me/rainbowkit";

import { wagmiConfig } from "@/config/wagmi";
import { AIChatProvider } from "@/contexts/AIChatContext";
import { AuthSessionProvider, useAuthSession } from "@/hooks/useAuthSession";

const queryClient = new QueryClient();

function buildDarkTheme(): Theme {
    const t = darkTheme({
        accentColor: "#30D5C8",
        accentColorForeground: "#000000",
        borderRadius: "medium",
        fontStack: "system",
        overlayBlur: "small",
    });
    t.colors.connectButtonBackground = "transparent";
    t.colors.connectButtonInnerBackground = "transparent";
    return t;
}

function buildLightTheme(): Theme {
    const t = lightTheme({
        accentColor: "#A91101",
        accentColorForeground: "#ffffff",
        borderRadius: "medium",
        fontStack: "system",
        overlayBlur: "small",
    });
    t.colors.connectButtonBackground = "transparent";
    t.colors.connectButtonInnerBackground = "transparent";
    t.colors.connectButtonText = "#1a1a1a";
    return t;
}

function buildSIWEMessage({
    address,
    chainId,
    nonce,
}: {
    address: string;
    chainId: number;
    nonce: string;
}): string {
    const domain = window.location.host;
    const uri = window.location.origin;
    const issuedAt = new Date().toISOString();

    return [
        `${domain} wants you to sign in with your Ethereum account:`,
        address,
        "",
        "Sign in to Bavium",
        "",
        `URI: ${uri}`,
        "Version: 1",
        `Chain ID: ${chainId}`,
        `Nonce: ${nonce}`,
        `Issued At: ${issuedAt}`,
    ].join("\n");
}

function readSIWEField(message: string, prefix: string): string | null {
    const line = message.split("\n").find((item) => item.startsWith(prefix));
    return line ? line.slice(prefix.length).trim() : null;
}

function parseSIWEMessageForVerify(message: string): {
    address: string;
    nonce: string;
    chainId: number;
} | null {
    const lines = message.split("\n");
    const address = lines[1]?.trim();
    const nonce = readSIWEField(message, "Nonce: ");
    const chainId = Number(readSIWEField(message, "Chain ID: "));

    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) return null;
    if (!nonce || !/^[a-f0-9]{64}$/i.test(nonce)) return null;
    if (!Number.isInteger(chainId)) return null;

    return { address, nonce, chainId };
}

function authStateToRainbowKitStatus(
    authState: ReturnType<typeof useAuthSession>["authState"],
): AuthenticationStatus {
    if (authState === "loading") return "loading";
    return authState === "authenticated" ? "authenticated" : "unauthenticated";
}

function RainbowKitAuthBridge({
    children,
    theme,
}: {
    children: ReactNode;
    theme: Theme;
}) {
    const { authState, refreshSession, signOutSession } = useAuthSession();
    const authenticationStatus = authStateToRainbowKitStatus(authState);

    const authAdapter = useMemo(
        () => createAuthenticationAdapter<string>({
            getNonce: async () => {
                const response = await fetch("/api/auth/rainbowkit/nonce", {
                    credentials: "include",
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok || typeof data.nonce !== "string") {
                    throw new Error("Failed to prepare sign-in nonce.");
                }
                return data.nonce;
            },
            createMessage: ({ address, chainId, nonce }) =>
                buildSIWEMessage({ address, chainId, nonce }),
            verify: async ({ message, signature }) => {
                const parsed = parseSIWEMessageForVerify(message);
                if (!parsed) return false;

                const response = await fetch("/api/auth/verify", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({
                        message,
                        signature,
                        address: parsed.address,
                        nonce: parsed.nonce,
                        chainId: parsed.chainId,
                    }),
                });

                if (!response.ok) return false;
                const session = await refreshSession();
                return session.authenticated;
            },
            signOut: async () => {
                await signOutSession("rainbowkit_sign_out");
            },
        }),
        [refreshSession, signOutSession],
    );

    return (
        <RainbowKitAuthenticationProvider
            adapter={authAdapter}
            status={authenticationStatus}
        >
            <RainbowKitProvider
                modalSize="compact"
                theme={theme}
                coolMode
            >
                {children}
            </RainbowKitProvider>
        </RainbowKitAuthenticationProvider>
    );
}

export function Providers({ children }: { children: ReactNode }) {
    const [rkTheme, setRkTheme] = useState<Theme>(buildDarkTheme());

    // Watch data-theme attribute on <html> for changes
    useEffect(() => {
        function syncTheme() {
            const current = document.documentElement.getAttribute("data-theme");
            setRkTheme(current === "light" ? buildLightTheme() : buildDarkTheme());
        }

        syncTheme();

        const observer = new MutationObserver(syncTheme);
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["data-theme"],
        });

        return () => observer.disconnect();
    }, []);

    return (
        <WagmiProvider config={wagmiConfig}>
            <QueryClientProvider client={queryClient}>
                <AuthSessionProvider>
                    <RainbowKitAuthBridge theme={rkTheme}>
                        <AIChatProvider>
                            {children}
                        </AIChatProvider>
                    </RainbowKitAuthBridge>
                </AuthSessionProvider>
            </QueryClientProvider>
        </WagmiProvider>
    );
}
