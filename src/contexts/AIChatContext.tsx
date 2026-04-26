"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useAccount } from "wagmi";
import { useLLMConfig } from "@/hooks/useLLMConfig";
import { useAuthSession, type AuthSessionState } from "@/hooks/useAuthSession";
import { isShortcutDraftOutput } from "@/lib/builder-ai-handoff";
import type { BuilderAIContextSnapshot } from "@/lib/builder-ai-context";
import type { LLMConfig } from "@/lib/llm";

const AI_CHAT_STORAGE_PREFIX = "bavium:ai-chat:v2";
const LEGACY_AI_CHAT_STORAGE_PREFIX = "bavium:ai-chat:v1";
const LEGACY_SIDEBAR_CHAT_STORAGE_PREFIX = "bavium:sidebar-chat:v1";
const MAX_STORED_MESSAGES = 40;
const MAX_STORED_TOOL_OUTPUT_CHARS = 1200;
const CHAT_STORAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface SendAIChatMessageOptions {
    builderContext?: BuilderAIContextSnapshot | null;
}

interface AIChatContextValue {
    config: LLMConfig | null;
    configLoading: boolean;
    settingsLocked: boolean;
    authState: AuthSessionState;
    walletAddress: string | null;
    messages: UIMessage[];
    setMessages: (
        messages: UIMessage[] | ((messages: UIMessage[]) => UIMessage[]),
    ) => void;
    status: "submitted" | "streaming" | "ready" | "error";
    error: Error | undefined;
    isStreaming: boolean;
    sendTextMessage: (
        text: string,
        options?: SendAIChatMessageOptions,
    ) => Promise<void>;
    clearChat: () => void;
    stop: () => void;
}

const AIChatContext = createContext<AIChatContextValue | null>(null);

function buildChatStorageKey(prefix: string, address: string | undefined): string {
    const normalizedAddress = address?.trim().toLowerCase();
    return normalizedAddress
        ? `${prefix}:wallet:${normalizedAddress}`
        : `${prefix}:anonymous`;
}

function isCreateShortcutOutput(
    value: unknown,
): value is { success: boolean; shortcutId?: string; message: string } {
    return (
        typeof value === "object" &&
        value !== null &&
        "success" in value &&
        "message" in value &&
        !("steps" in value)
    );
}

function isStoredUIMessage(value: unknown): value is UIMessage {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as { id?: unknown }).id === "string" &&
        typeof (value as { role?: unknown }).role === "string" &&
        Array.isArray((value as { parts?: unknown }).parts)
    );
}

function summarizeToolOutput(output: unknown): unknown {
    if (output == null) return output;
    if (typeof output === "string") {
        return output.slice(0, MAX_STORED_TOOL_OUTPUT_CHARS);
    }

    try {
        const serialized = JSON.stringify(output);
        if (serialized.length <= MAX_STORED_TOOL_OUTPUT_CHARS) {
            return output;
        }
        return {
            summary: `${serialized.slice(0, MAX_STORED_TOOL_OUTPUT_CHARS)}...`,
        };
    } catch {
        return { summary: "Tool output could not be serialized." };
    }
}

function sanitizeMessageForStorage(message: UIMessage): UIMessage {
    return {
        ...message,
        parts: message.parts.map((part) => {
            if (!part.type.startsWith("tool-")) return part;

            const toolPart = part as {
                type: string;
                output?: unknown;
                [key: string]: unknown;
            };
            const toolName = toolPart.type.replace(/^tool-/, "");

            if (
                toolName === "generateShortcutDraft" &&
                isShortcutDraftOutput(toolPart.output)
            ) {
                return part;
            }

            if (
                toolName === "createShortcut" &&
                isCreateShortcutOutput(toolPart.output)
            ) {
                return part;
            }

            return {
                ...toolPart,
                output: summarizeToolOutput(toolPart.output),
            } as UIMessage["parts"][number];
        }),
    };
}

function readMessagesFromStorage(
    storage: Storage | undefined,
    storageKey: string,
): { messages: UIMessage[]; expired: boolean } {
    if (!storage) return { messages: [], expired: false };

    try {
        const raw = storage.getItem(storageKey);
        if (!raw) return { messages: [], expired: false };

        const parsed: unknown = JSON.parse(raw);
        if (
            typeof parsed !== "object" ||
            parsed === null ||
            !Array.isArray((parsed as { messages?: unknown }).messages)
        ) {
            return { messages: [], expired: false };
        }

        const version = (parsed as { version?: unknown }).version;
        if (version !== 1 && version !== 2) {
            return { messages: [], expired: false };
        }

        if (version === 2) {
            const expiresAt = (parsed as { expiresAt?: unknown }).expiresAt;
            if (typeof expiresAt === "number" && expiresAt <= Date.now()) {
                storage.removeItem(storageKey);
                return { messages: [], expired: true };
            }
        }

        const messages = (parsed as { messages: unknown[] }).messages
            .filter(isStoredUIMessage)
            .slice(-MAX_STORED_MESSAGES);
        return { messages, expired: false };
    } catch {
        return { messages: [], expired: false };
    }
}

function readStoredChatMessages(address: string | undefined): UIMessage[] {
    if (typeof window === "undefined") return [];

    const key = buildChatStorageKey(AI_CHAT_STORAGE_PREFIX, address);
    const current = readMessagesFromStorage(window.localStorage, key);
    if (current.messages.length > 0) return current.messages;

    const legacyMessages = [
        buildChatStorageKey(LEGACY_AI_CHAT_STORAGE_PREFIX, address),
        buildChatStorageKey(LEGACY_SIDEBAR_CHAT_STORAGE_PREFIX, address),
    ]
        .map((legacyKey) => readMessagesFromStorage(window.sessionStorage, legacyKey).messages)
        .find((messages) => messages.length > 0) ?? [];

    if (legacyMessages.length > 0) {
        writeStoredChatMessages(key, legacyMessages);
    }

    return legacyMessages;
}

function writeStoredChatMessages(
    storageKey: string,
    messages: UIMessage[],
): void {
    if (typeof window === "undefined") return;

    try {
        if (messages.length === 0) {
            window.localStorage.removeItem(storageKey);
            return;
        }

        const now = Date.now();
        const payload = {
            version: 2,
            updatedAt: new Date(now).toISOString(),
            expiresAt: now + CHAT_STORAGE_TTL_MS,
            messages: messages
                .slice(-MAX_STORED_MESSAGES)
                .map(sanitizeMessageForStorage),
        };

        window.localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
        // Storage may be unavailable or full; chat should continue in memory.
    }
}

function clearStoredChatMessages(address: string | undefined): void {
    if (typeof window === "undefined") return;

    window.localStorage.removeItem(
        buildChatStorageKey(AI_CHAT_STORAGE_PREFIX, address),
    );
    window.sessionStorage.removeItem(
        buildChatStorageKey(LEGACY_AI_CHAT_STORAGE_PREFIX, address),
    );
    window.sessionStorage.removeItem(
        buildChatStorageKey(LEGACY_SIDEBAR_CHAT_STORAGE_PREFIX, address),
    );
}

export function AIChatProvider({ children }: { children: ReactNode }) {
    const { address } = useAccount();
    const { authState, sessionAddress } = useAuthSession();
    const { config, loading: configLoading, locked: settingsLocked } = useLLMConfig();
    const walletAddress = sessionAddress ?? address ?? null;
    const storageKey = useMemo(
        () => buildChatStorageKey(AI_CHAT_STORAGE_PREFIX, address),
        [address],
    );
    const [initialMessages] = useState<UIMessage[]>(() =>
        readStoredChatMessages(address),
    );
    const [loadedStorageKey, setLoadedStorageKey] = useState(storageKey);

    const transport = useMemo(() => new DefaultChatTransport({ api: "/api/ai" }), []);
    const {
        messages,
        setMessages,
        sendMessage,
        status,
        error,
        stop,
        clearError,
    } = useChat({
        id: "bavium-ai-chat",
        transport,
        messages: initialMessages,
        experimental_throttle: 250,
    });

    const isStreaming = status === "streaming" || status === "submitted";

    useEffect(() => {
        stop();
        clearError();
        setMessages(readStoredChatMessages(address));
        setLoadedStorageKey(storageKey);
    }, [address, clearError, setMessages, stop, storageKey]);

    useEffect(() => {
        if (isStreaming) return;
        if (loadedStorageKey !== storageKey) return;
        writeStoredChatMessages(storageKey, messages);
    }, [isStreaming, loadedStorageKey, messages, storageKey]);

    const clearChat = useCallback(() => {
        stop();
        clearError();
        setMessages([]);
        clearStoredChatMessages(address);
    }, [address, clearError, setMessages, stop]);

    const sendTextMessage = useCallback(
        async (text: string, options?: SendAIChatMessageOptions) => {
            const trimmed = text.trim();
            if (!trimmed || isStreaming || !config) return;

            await sendMessage(
                { text: trimmed },
                {
                    body: {
                        provider: config.provider,
                        model: config.model,
                        apiKey: config.apiKey,
                        baseUrl: config.baseUrl,
                        authContext: {
                            state: authState,
                            walletConnected: Boolean(walletAddress),
                        },
                        ...(options?.builderContext
                            ? { builderContext: options.builderContext }
                            : {}),
                    },
                },
            );
        },
        [authState, config, isStreaming, sendMessage, walletAddress],
    );

    const value = useMemo<AIChatContextValue>(
        () => ({
            config,
            configLoading,
            settingsLocked,
            authState,
            walletAddress,
            messages,
            setMessages,
            status,
            error,
            isStreaming,
            sendTextMessage,
            clearChat,
            stop,
        }),
        [
            clearChat,
            config,
            configLoading,
            authState,
            error,
            isStreaming,
            messages,
            sendTextMessage,
            setMessages,
            settingsLocked,
            status,
            stop,
            walletAddress,
        ],
    );

    return (
        <AIChatContext.Provider value={value}>
            {children}
        </AIChatContext.Provider>
    );
}

export function useAIChat(): AIChatContextValue {
    const value = useContext(AIChatContext);
    if (!value) {
        throw new Error("useAIChat must be used within AIChatProvider");
    }
    return value;
}
