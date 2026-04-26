"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Wallet, Brain, CheckCircle2, Lock, Unlock, Eye, EyeOff, Trash2, Zap, KeyRound, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { Button, Combobox, type ComboboxOption } from "@/components/ui";
import { useAccount, useSwitchChain } from "wagmi";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useActiveChain } from "@/hooks/useActiveChain";
import {
    clearUnlockSecret,
    isEncryptedSettingsEnabled,
    loadStoredSettings,
    saveStoredSettings,
    unlockSettings,
} from "@/lib/secure-storage";
import { NETWORKS, type NetworkId } from "@/lib/chain-config";
import {
    getStoredPreferredNetwork,
    setStoredPreferredNetwork,
} from "@/lib/network-preference";
import {
    CUSTOM_MODEL_VALUE,
    createDefaultLLMProviderSettings,
    getLLMProviderDefinition,
    isLLMProvider,
    LLM_PROVIDERS,
    LLM_PROVIDER_OPTIONS,
    type LLMProvider,
} from "@/lib/llm-provider-registry";

const SUPPORTED_NETWORK_OPTIONS: Array<{ value: NetworkId; label: string }> = [
    { value: "base-sepolia", label: "Base Sepolia" },
    { value: "base-mainnet", label: "Base" },
];

function isNetworkId(value: string): value is NetworkId {
    return value === "base-mainnet" || value === "base-sepolia";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface SectionProps {
    icon: typeof Wallet;
    title: string;
    description: string;
    children: React.ReactNode;
}

function Section({ icon: Icon, title, description, children }: SectionProps) {
    return (
        <div className="p-5 bg-secondary border border-border-subtle rounded-xl">
            <div className="flex items-center gap-3 mb-4 pb-4 border-b border-border-subtle">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-tertiary text-fg-secondary shrink-0">
                    <Icon size={16} />
                </div>
                <div>
                    <div className="text-base font-semibold text-fg">
                        {title}
                    </div>
                    <div className="text-sm text-fg-muted">
                        {description}
                    </div>
                </div>
            </div>
            {children}
        </div>
    );
}

interface SettingsState {
    llm: {
        defaultProvider: LLMProvider;
        providers: Record<LLMProvider, { apiKey: string; model: string; baseUrl?: string }>;
    };
    requireApproval: boolean;
    showGasEstimates: boolean;
    allowTestnetOnMainnet: boolean;
    showCompletionToasts: boolean;
    showErrorDetails: boolean;
}

type EncryptionStatus = "plaintext" | "encrypted_locked" | "encrypted_unlocked";
type ModelDiscoveryStatus = "idle" | "loading" | "success" | "error";

interface DiscoveredModelOption {
    label: string;
    value: string;
}

interface ModelDiscoveryState {
    status: ModelDiscoveryStatus;
    available: DiscoveredModelOption[];
    fetchedAt?: string;
    error?: string;
    cacheHit?: boolean;
    signature?: string;
    ttlMs?: number;
}

interface ModelDiscoveryApiResponse {
    available?: unknown;
    fetchedAt?: unknown;
    cacheHit?: unknown;
    ttlMs?: unknown;
    error?: unknown;
}

const MODEL_DISCOVERY_SUPPORTED_PROVIDERS = new Set<LLMProvider>(["google", "openai"]);
const MODEL_DISCOVERY_AUTO_DELAY_MS = 1200;
const MODEL_DISCOVERY_CLIENT_TTL_MS = 5 * 60_000;

const INITIAL_SETTINGS: SettingsState = {
    llm: {
        defaultProvider: "openai",
        providers: createDefaultLLMProviderSettings(),
    },
    requireApproval: true,
    showGasEstimates: true,
    allowTestnetOnMainnet: false,
    showCompletionToasts: true,
    showErrorDetails: true,
};

function isPresetModel(provider: LLMProvider, model: string): boolean {
    const options = getLLMProviderDefinition(provider).models;
    return options.some((opt) => opt.value !== CUSTOM_MODEL_VALUE && opt.value === model);
}

function supportsModelDiscovery(provider: LLMProvider): boolean {
    return MODEL_DISCOVERY_SUPPORTED_PROVIDERS.has(provider);
}

function isDiscoveredModel(discovery: ModelDiscoveryState | undefined, model: string): boolean {
    return discovery?.available.some((option) => option.value === model) ?? false;
}

function isKnownModel(
    provider: LLMProvider,
    model: string,
    discovery: ModelDiscoveryState | undefined,
): boolean {
    return isPresetModel(provider, model) || isDiscoveredModel(discovery, model);
}

function sanitizeDiscoveredModels(value: unknown): DiscoveredModelOption[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const models: DiscoveredModelOption[] = [];

    for (const item of value) {
        if (!isRecord(item)) continue;
        if (typeof item.label !== "string" || typeof item.value !== "string") continue;

        const label = item.label.trim();
        const modelValue = item.value.trim();
        if (!label || !modelValue || seen.has(modelValue)) continue;
        seen.add(modelValue);
        models.push({ label, value: modelValue });
    }

    return models;
}

function buildModelComboOptions(
    provider: LLMProvider,
    discovery: ModelDiscoveryState | undefined,
): ComboboxOption[] {
    const providerDef = getLLMProviderDefinition(provider);
    const customOption = providerDef.models.find((option) => option.value === CUSTOM_MODEL_VALUE) ?? {
        label: "Custom model...",
        value: CUSTOM_MODEL_VALUE,
    };
    const curatedModels = providerDef.models.filter((option) => option.value !== CUSTOM_MODEL_VALUE);
    const discoverySucceeded = discovery?.status === "success";
    const availableModels = discoverySucceeded ? discovery.available : [];
    const availableSet = new Set(availableModels.map((option) => option.value));

    const recommendedModels =
        discoverySucceeded && availableModels.length > 0
            ? curatedModels.filter((option) => availableSet.has(option.value))
            : curatedModels;
    const recommendedSet = new Set(recommendedModels.map((option) => option.value));
    const availableOnlyModels = availableModels.filter((option) => !recommendedSet.has(option.value));

    return [
        ...recommendedModels.map((option) => ({
            ...option,
            group: "Recommended",
        })),
        ...availableOnlyModels.map((option) => ({
            ...option,
            group: "Available for this key",
        })),
        {
            ...customOption,
            group: "Custom",
        },
    ];
}

function buildDiscoverySignature(
    provider: LLMProvider,
    apiKey: string,
    baseUrl: string,
): string {
    let keyFingerprint = 2166136261;
    for (let index = 0; index < apiKey.length; index += 1) {
        keyFingerprint ^= apiKey.charCodeAt(index);
        keyFingerprint = Math.imul(keyFingerprint, 16777619);
    }

    return `${provider}:${baseUrl}:${apiKey.length}:${(keyFingerprint >>> 0).toString(16)}`;
}

function parseSettingsObject(parsed: Record<string, unknown>): SettingsState {
    const next: SettingsState = {
        ...INITIAL_SETTINGS,
        llm: {
            ...INITIAL_SETTINGS.llm,
            providers: createDefaultLLMProviderSettings(),
        },
    };

    if (typeof parsed.requireApproval === "boolean") next.requireApproval = parsed.requireApproval;
    if (typeof parsed.showGasEstimates === "boolean") next.showGasEstimates = parsed.showGasEstimates;
    if (typeof parsed.allowTestnetOnMainnet === "boolean") next.allowTestnetOnMainnet = parsed.allowTestnetOnMainnet;
    if (typeof parsed.showCompletionToasts === "boolean") next.showCompletionToasts = parsed.showCompletionToasts;
    if (typeof parsed.showErrorDetails === "boolean") next.showErrorDetails = parsed.showErrorDetails;

    // New schema: llm.defaultProvider + llm.providers
    const llm = parsed.llm;
    if (isRecord(llm)) {
        const defaultProvider = llm.defaultProvider;
        if (isLLMProvider(defaultProvider)) {
            next.llm.defaultProvider = defaultProvider;
        }

        const providers = llm.providers;
        if (isRecord(providers)) {
            for (const provider of LLM_PROVIDERS) {
                const conf = providers[provider];
                if (!isRecord(conf)) continue;
                if (typeof conf.apiKey === "string") next.llm.providers[provider].apiKey = conf.apiKey;
                if (typeof conf.model === "string") next.llm.providers[provider].model = conf.model;
                if (typeof conf.baseUrl === "string") {
                    next.llm.providers[provider].baseUrl = conf.baseUrl;
                }
            }
        }
        return next;
    }

    // Legacy schema fallback
    const legacyProvider = parsed.llmProvider;
    const legacyApiKey = parsed.llmApiKey;
    if (
        isLLMProvider(legacyProvider) &&
        typeof legacyApiKey === "string" &&
        legacyApiKey.trim().length > 0
    ) {
        next.llm.defaultProvider = legacyProvider;
        next.llm.providers[legacyProvider].apiKey = legacyApiKey;
    }

    return next;
}

// ---------------------------------------------------------------------------
// Configured API Keys Summary
// ---------------------------------------------------------------------------

interface ConfiguredKeysSummaryProps {
    settings: SettingsState;
    selectedProvider: LLMProvider;
    onDeleteKey: (provider: LLMProvider) => void;
    isLocked: boolean;
}

function ConfiguredKeysSummary({
    settings,
    selectedProvider,
    onDeleteKey,
    isLocked,
}: ConfiguredKeysSummaryProps) {
    const [testingProvider, setTestingProvider] = useState<LLMProvider | null>(null);
    const [pendingDeleteProvider, setPendingDeleteProvider] = useState<LLMProvider | null>(null);
    const [testResults, setTestResults] = useState<
        Record<string, { status: "success" | "error"; message: string }>
    >({});

    const configuredProviders = LLM_PROVIDERS.filter(
        (p) => settings.llm.providers[p].apiKey.trim().length > 0,
    );

    if (configuredProviders.length === 0) return null;

    function maskKey(key: string): string {
        if (key.length <= 8) return "••••";
        return `${key.slice(0, 4)}••••${key.slice(-4)}`;
    }

    async function handleTestKey(provider: LLMProvider) {
        setTestingProvider(provider);
        setTestResults((prev) => {
            const next = { ...prev };
            delete next[provider];
            return next;
        });

        try {
            const def = getLLMProviderDefinition(provider);
            const conf = settings.llm.providers[provider];
            const baseUrl = conf.baseUrl?.trim() || def.baseUrl || "";

            const res = await fetch("/api/ai/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    provider,
                    model: conf.model || def.defaultModel,
                    apiKey: conf.apiKey,
                    baseUrl: baseUrl || undefined,
                }),
            });

            let ok = res.ok;
            let errorMessage = "Unknown error";
            if (!ok) {
                const body = await res.json().catch(() => ({ error: "Connection failed" }));
                errorMessage = (body as { error?: string }).error ?? `${res.status}`;
            }

            setTestResults((prev) => ({
                ...prev,
                [provider]: ok
                    ? {
                        status: "success",
                        message: `Key is valid for ${def.label} · ${conf.model || def.defaultModel}`,
                    }
                    : {
                        status: "error",
                        message: `${def.label} · ${conf.model || def.defaultModel}: ${errorMessage}`,
                    },
            }));
        } catch (err) {
            const def = getLLMProviderDefinition(provider);
            const conf = settings.llm.providers[provider];
            setTestResults((prev) => ({
                ...prev,
                [provider]: {
                    status: "error",
                    message: `${def.label} · ${conf.model || def.defaultModel}: ${err instanceof Error ? err.message : "Connection failed"}`,
                },
            }));
        } finally {
            setTestingProvider(null);
        }
    }

    return (
        <div className="mt-5 pt-4 border-t border-border-subtle">
            <div className="flex items-center gap-2 mb-3">
                <KeyRound size={14} className="text-fg-muted" />
                <span className="text-sm font-semibold text-fg-secondary">
                    Configured Keys
                </span>
                <span className="text-[12px] text-fg-muted">
                    ({configuredProviders.length})
                </span>
            </div>

            <div className="flex flex-col gap-2">
                {configuredProviders.map((provider) => {
                    const def = getLLMProviderDefinition(provider);
                    const conf = settings.llm.providers[provider];
                    const isActive = provider === selectedProvider;
                    const testResult = testResults[provider];
                    const isTesting = testingProvider === provider;
                    const isConfirmingDelete = pendingDeleteProvider === provider;

                    return (
                        <div
                            key={provider}
                            className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${isConfirmingDelete
                                ? "bg-status-error/5 border-status-error/20"
                                : isActive
                                ? "bg-brand-subtle/30 border-brand/15"
                                : "bg-tertiary border-border-subtle"
                                }`}
                        >
                            {/* Provider info */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-fg">
                                        {def.label}
                                    </span>
                                    <span
                                        className={`inline-flex items-center h-5 px-1.5 text-[11px] font-semibold tracking-wide uppercase rounded ${isActive
                                            ? "bg-brand/10 text-brand"
                                            : "bg-tertiary text-fg-muted border border-border-subtle"
                                            }`}
                                    >
                                        {isActive ? "Active" : "Fallback"}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[12px] text-fg-muted font-mono">
                                        {maskKey(conf.apiKey)}
                                    </span>
                                    <span className="text-[11px] text-fg-muted">
                                        · {conf.model || def.defaultModel}
                                    </span>
                                </div>
                                {testResult && (
                                    <span
                                        className={`text-[12px] mt-1 block ${testResult.status === "success"
                                            ? "text-status-success"
                                            : "text-status-error"
                                            }`}
                                    >
                                        {testResult.status === "success" ? "✓" : "✗"}{" "}
                                        {testResult.message}
                                    </span>
                                )}
                                {isConfirmingDelete && (
                                    <span className="text-[12px] mt-1 block text-status-error">
                                        Remove this key from this browser?
                                    </span>
                                )}
                            </div>

                            {/* Actions */}
                            {isConfirmingDelete ? (
                                <div className="flex items-center gap-2 shrink-0">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setPendingDeleteProvider(null)}
                                    >
                                        Keep
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="danger"
                                        size="sm"
                                        onClick={() => {
                                            onDeleteKey(provider);
                                            setPendingDeleteProvider(null);
                                        }}
                                    >
                                        Remove Key
                                    </Button>
                                </div>
                            ) : (
                                <div className="flex items-center gap-1 shrink-0">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        disabled={isLocked || isTesting}
                                        isLoading={isTesting}
                                        onClick={() => void handleTestKey(provider)}
                                        aria-label={`Test ${def.label} key`}
                                        title="Test key"
                                    >
                                        <Zap size={14} />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        disabled={isLocked}
                                        onClick={() => setPendingDeleteProvider(provider)}
                                        aria-label={`Delete ${def.label} key`}
                                        title="Delete key"
                                        className="hover:text-status-error"
                                    >
                                        <Trash2 size={14} />
                                    </Button>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default function SettingsPage() {
    const { address, isConnected } = useAccount();
    const { authState } = useAuthSession();
    const {
        networkId: activeNetworkId,
        label: activeNetworkLabel,
        isUnsupportedChain,
    } = useActiveChain();
    const { switchChainAsync, isPending: isSwitchingNetwork, variables: switchChainVariables } = useSwitchChain();
    const [settings, setSettings] = useState<SettingsState>(INITIAL_SETTINGS);
    const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [encryptionStatus, setEncryptionStatus] = useState<EncryptionStatus>("plaintext");
    const [localSecret, setLocalSecret] = useState("");
    const [secureMessage, setSecureMessage] = useState<string | null>(null);
    const [showApiKeyByProvider, setShowApiKeyByProvider] = useState<
        Record<LLMProvider, boolean>
    >(() =>
        Object.fromEntries(LLM_PROVIDERS.map((provider) => [provider, false])) as Record<
            LLMProvider,
            boolean
        >,
    );
    const [customModelByProvider, setCustomModelByProvider] = useState<
        Record<LLMProvider, boolean>
    >(() =>
        Object.fromEntries(LLM_PROVIDERS.map((provider) => [provider, false])) as Record<
            LLMProvider,
            boolean
        >,
    );
    const [modelDiscoveryByProvider, setModelDiscoveryByProvider] = useState<
        Partial<Record<LLMProvider, ModelDiscoveryState>>
    >({});
    const didHydrateRef = useRef(false);
    const settingsVersionRef = useRef(0);
    const modelDiscoveryRequestRef = useRef(0);
    const isLocked = encryptionStatus === "encrypted_locked";

    useEffect(() => {
        let alive = true;
        (async () => {
            const loaded = await loadStoredSettings();
            if (!alive) return;

            const storedPreferredNetwork = getStoredPreferredNetwork();

            if (loaded.settings) {
                const parsed = parseSettingsObject(loaded.settings);
                if (typeof loaded.settings.network === "string" && isNetworkId(loaded.settings.network)) {
                    setStoredPreferredNetwork(loaded.settings.network);
                } else if (storedPreferredNetwork) {
                    setStoredPreferredNetwork(storedPreferredNetwork);
                }
                setSettings(parsed);
            }

            if (loaded.source === "encrypted") {
                setEncryptionStatus(loaded.locked ? "encrypted_locked" : "encrypted_unlocked");
            } else if (isEncryptedSettingsEnabled()) {
                setEncryptionStatus("encrypted_locked");
            } else {
                setEncryptionStatus("plaintext");
            }

            if (loaded.error) setSecureMessage(loaded.error);
            didHydrateRef.current = true;
        })();

        return () => {
            alive = false;
        };
    }, []);

    useEffect(() => {
        if (isConnected && !isUnsupportedChain) {
            setStoredPreferredNetwork(activeNetworkId);
        }
    }, [activeNetworkId, isConnected, isUnsupportedChain]);

    const markDirty = useCallback(() => {
        settingsVersionRef.current += 1;
        setHasUnsavedChanges(true);
        setSaveState("idle");
    }, []);

    const update = useCallback(<K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
        setSettings((prev) => ({ ...prev, [key]: value }));
        markDirty();
    }, [markDirty]);

    const updatePreferredNetwork = useCallback((networkId: NetworkId) => {
        setStoredPreferredNetwork(networkId);
        markDirty();
    }, [markDirty]);

    const updateLLMProvider = useCallback(
        (
            provider: LLMProvider,
            key: "apiKey" | "model" | "baseUrl",
            value: string,
        ) => {
            setSettings((prev) => ({
                ...prev,
                llm: {
                    ...prev.llm,
                    providers: {
                        ...prev.llm.providers,
                        [provider]: {
                            ...prev.llm.providers[provider],
                            [key]: value,
                        },
                    },
                },
            }));
            markDirty();
        },
        [markDirty],
    );

    const discoverModels = useCallback(
        async (provider: LLMProvider, mode: "auto" | "manual" = "manual") => {
            if (isLocked || !supportsModelDiscovery(provider)) return;

            const providerDef = getLLMProviderDefinition(provider);
            const conf = settings.llm.providers[provider];
            const apiKey = conf.apiKey.trim();
            if (!apiKey) {
                setModelDiscoveryByProvider((prev) => ({
                    ...prev,
                    [provider]: {
                        status: "idle",
                        available: [],
                        error: "Enter an API key to load available models.",
                    },
                }));
                return;
            }

            const baseUrl = conf.baseUrl?.trim() || providerDef.baseUrl || "";
            const signature = buildDiscoverySignature(provider, apiKey, baseUrl);
            const existing = modelDiscoveryByProvider[provider];
            const fetchedAtMs = existing?.fetchedAt ? Date.parse(existing.fetchedAt) : 0;
            const ttlMs = existing?.ttlMs ?? MODEL_DISCOVERY_CLIENT_TTL_MS;
            const isFresh =
                existing?.status === "success" &&
                existing.signature === signature &&
                fetchedAtMs > 0 &&
                Date.now() - fetchedAtMs < ttlMs;

            if (mode === "auto" && isFresh) return;

            const requestId = (modelDiscoveryRequestRef.current += 1);
            setModelDiscoveryByProvider((prev) => ({
                ...prev,
                [provider]: {
                    status: "loading",
                    available: prev[provider]?.available ?? [],
                    signature,
                    fetchedAt: prev[provider]?.fetchedAt,
                    ttlMs: prev[provider]?.ttlMs,
                },
            }));

            try {
                const response = await fetch("/api/ai/models", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        provider,
                        apiKey,
                        baseUrl: baseUrl || undefined,
                    }),
                });

                const data = (await response.json().catch(() => ({}))) as ModelDiscoveryApiResponse;
                if (!response.ok) {
                    const errorMessage =
                        typeof data.error === "string" && data.error.trim()
                            ? data.error.trim()
                            : "Model discovery failed.";
                    throw new Error(errorMessage);
                }

                if (requestId !== modelDiscoveryRequestRef.current) return;

                setModelDiscoveryByProvider((prev) => ({
                    ...prev,
                    [provider]: {
                        status: "success",
                        available: sanitizeDiscoveredModels(data.available),
                        fetchedAt:
                            typeof data.fetchedAt === "string"
                                ? data.fetchedAt
                                : new Date().toISOString(),
                        cacheHit: data.cacheHit === true,
                        ttlMs:
                            typeof data.ttlMs === "number" && Number.isFinite(data.ttlMs)
                                ? data.ttlMs
                                : MODEL_DISCOVERY_CLIENT_TTL_MS,
                        signature,
                    },
                }));
            } catch (error) {
                if (requestId !== modelDiscoveryRequestRef.current) return;

                setModelDiscoveryByProvider((prev) => ({
                    ...prev,
                    [provider]: {
                        status: "error",
                        available: prev[provider]?.available ?? [],
                        fetchedAt: prev[provider]?.fetchedAt,
                        signature,
                        error:
                            error instanceof Error
                                ? error.message
                                : "Model discovery failed.",
                    },
                }));
            }
        },
        [isLocked, modelDiscoveryByProvider, settings.llm.providers],
    );

    const persistSettings = useCallback(async (nextSettings: SettingsState, version: number) => {
        setSaveState("saving");
        try {
            await saveStoredSettings(nextSettings);
            if (version !== settingsVersionRef.current) {
                return;
            }
            setHasUnsavedChanges(false);
            setSaveState("saved");
            setSecureMessage(null);
        } catch (err) {
            if (version !== settingsVersionRef.current) {
                return;
            }
            const msg = err instanceof Error ? err.message : "Failed to save settings";
            setSaveState("error");
            setSecureMessage(msg);
            console.error(msg);
        }
    }, []);

    const handleSave = useCallback(async () => {
        await persistSettings(settings, settingsVersionRef.current);
    }, [persistSettings, settings]);

    useEffect(() => {
        if (!didHydrateRef.current || isLocked || !hasUnsavedChanges) {
            return;
        }

        const version = settingsVersionRef.current;
        const timeoutId = window.setTimeout(() => {
            void persistSettings(settings, version);
        }, 900);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [hasUnsavedChanges, isLocked, persistSettings, settings]);

    useEffect(() => {
        if (!didHydrateRef.current) return;

        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            if (!hasUnsavedChanges && saveState !== "saving") return;
            event.preventDefault();
            event.returnValue = "";
        };

        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload);
        };
    }, [hasUnsavedChanges, saveState]);

    const handleUnlockEncrypted = useCallback(async () => {
        const secret = localSecret.trim();
        if (!secret) {
            setSecureMessage("Enter your local secret to unlock settings.");
            return;
        }
        try {
            const parsed = await unlockSettings(secret);
            if (!parsed) {
                setSecureMessage("Encrypted settings not found.");
                return;
            }
            if (typeof parsed.network === "string" && isNetworkId(parsed.network)) {
                setStoredPreferredNetwork(parsed.network);
            }
            setSettings(parseSettingsObject(parsed));
            setEncryptionStatus("encrypted_unlocked");
            setHasUnsavedChanges(false);
            setSaveState("idle");
            setSecureMessage("Settings unlocked for this session.");
        } catch {
            setSecureMessage("Invalid secret or encrypted data could not be decrypted.");
        }
    }, [localSecret]);

    const handleLockSession = useCallback(() => {
        clearUnlockSecret();
        setEncryptionStatus("encrypted_locked");
        setHasUnsavedChanges(false);
        setSaveState("idle");
        setSecureMessage("Session lock active. Unlock required for edits.");
    }, []);

    const handleSwitchNetwork = useCallback(async (networkId: NetworkId) => {
        try {
            await switchChainAsync({ chainId: NETWORKS[networkId].chain.id });
            updatePreferredNetwork(networkId);
            setSecureMessage(null);
        } catch (error) {
            setSecureMessage(
                error instanceof Error
                    ? error.message
                    : "Network switch was rejected or failed.",
            );
        }
    }, [switchChainAsync, updatePreferredNetwork]);

    const selectedProvider = settings.llm.defaultProvider;
    const selectedProviderDefinition = getLLMProviderDefinition(selectedProvider);
    const selectedProviderConfig = settings.llm.providers[selectedProvider];
    const selectedProviderModelDiscovery = modelDiscoveryByProvider[selectedProvider];
    const providerModelOptions = buildModelComboOptions(
        selectedProvider,
        selectedProviderModelDiscovery,
    );
    const customModelActive =
        customModelByProvider[selectedProvider] ||
        !isKnownModel(
            selectedProvider,
            selectedProviderConfig.model,
            selectedProviderModelDiscovery,
        );
    const modelComboValue = customModelActive ? CUSTOM_MODEL_VALUE : selectedProviderConfig.model;
    const canDiscoverModels =
        supportsModelDiscovery(selectedProvider) &&
        selectedProviderConfig.apiKey.trim().length > 0 &&
        !isLocked;
    const selectedModelMissingFromDiscovery =
        selectedProviderModelDiscovery?.status === "success" &&
        selectedProviderModelDiscovery.available.length > 0 &&
        selectedProviderConfig.model.trim().length > 0 &&
        !isDiscoveredModel(selectedProviderModelDiscovery, selectedProviderConfig.model);

    useEffect(() => {
        if (!canDiscoverModels) return;

        const timeoutId = window.setTimeout(() => {
            void discoverModels(selectedProvider, "auto");
        }, MODEL_DISCOVERY_AUTO_DELAY_MS);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [
        canDiscoverModels,
        discoverModels,
        selectedProvider,
        selectedProviderConfig.apiKey,
        selectedProviderConfig.baseUrl,
    ]);

    const showAutosaveStatus = saveState !== "idle" || hasUnsavedChanges;
    const autosaveTone =
        saveState === "error"
            ? "bg-status-error/10 text-status-error border border-status-error/20"
            : !hasUnsavedChanges && saveState === "saved"
                ? "bg-status-success/10 text-status-success border border-status-success/20"
                : saveState === "saving" || hasUnsavedChanges
                    ? "bg-status-warning/10 text-status-warning border border-status-warning/20"
                    : "bg-tertiary text-fg-muted border border-border-subtle";
    const autosaveLabel =
        saveState === "error"
            ? "Autosave paused"
            : saveState === "saving"
                ? "Saving changes…"
                : hasUnsavedChanges
                    ? "Saving soon…"
                    : saveState === "saved"
                        ? "All changes saved"
                        : "Autosave ready";

    return (
        <div className="w-full max-w-5xl mx-auto pb-12 pt-2 animate-fade-in">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between mb-8 gap-4">
                <div>
                    <h1 className="text-[24px] font-bold tracking-tight text-fg mb-2">
                        Settings
                    </h1>
                    <p className="text-[15px] text-fg-secondary leading-relaxed">
                        Configure wallet, LLM provider, and application preferences.
                    </p>
                    <p className="mt-2 text-[13px] text-fg-muted">
                        Changes save automatically in this browser after a short pause.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {showAutosaveStatus && (
                        <span className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm font-semibold ${autosaveTone}`}>
                            {saveState === "error" ? (
                                <AlertCircle size={14} />
                            ) : saveState === "saving" || hasUnsavedChanges ? (
                                <Loader2 size={14} className="animate-spin" />
                            ) : (
                                <CheckCircle2 size={14} />
                            )}
                            {autosaveLabel}
                        </span>
                    )}
                    {saveState === "error" && !isLocked && (
                        <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            onClick={() => void handleSave()}
                        >
                            Retry now
                        </Button>
                    )}
                </div>
            </div>

            <div className="flex flex-col gap-5">
                <Section
                    icon={Wallet}
                    title="Wallet"
                    description="Wallet connection managed by RainbowKit"
                >
                    <p className="text-sm text-fg-secondary leading-relaxed mb-4">
                        Bavium supports only <strong className="text-fg">Base</strong> and{" "}
                        <strong className="text-fg">Base Sepolia</strong>. When your wallet is connected,
                        the wallet chain is authoritative. When disconnected, the app uses your preferred
                        Base network below.
                    </p>
                    <div className="mb-4 p-3 rounded-md border border-border-subtle bg-primary/40">
                        {!isConnected ? (
                            <div className="flex flex-col gap-3">
                                <div>
                                    <div className="text-sm font-semibold text-fg">
                                        Preferred network while disconnected
                                    </div>
                                    <p className="mt-1 text-sm text-fg-secondary leading-relaxed">
                                        This controls read-only app context before a wallet is connected.
                                    </p>
                                </div>
                                <Combobox
                                    options={SUPPORTED_NETWORK_OPTIONS}
                                    value={activeNetworkId}
                                    onChange={(value) => {
                                        if (!isNetworkId(value)) return;
                                        updatePreferredNetwork(value);
                                    }}
                                    disabled={isLocked}
                                />
                                <p className="text-xs text-fg-muted">
                                    Current app fallback: <span className="text-fg">{activeNetworkLabel}</span>
                                </p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="inline-flex items-center h-6 px-2 rounded-md text-xs font-semibold bg-brand/10 text-brand border border-brand/20">
                                        Wallet network: {activeNetworkLabel}
                                    </span>
                                    {isUnsupportedChain && (
                                        <span className="inline-flex items-center h-6 px-2 rounded-md text-xs font-semibold bg-status-error/10 text-status-error border border-status-error/20">
                                            Unsupported wallet network
                                        </span>
                                    )}
                                </div>
                                <p className="text-sm text-fg-secondary leading-relaxed">
                                    Change network explicitly from here or from the header. The app will not switch
                                    your wallet silently in the background.
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {SUPPORTED_NETWORK_OPTIONS.map((option) => {
                                        const targetChainId = NETWORKS[option.value].chain.id;
                                        const isActive = !isUnsupportedChain && activeNetworkId === option.value;
                                        const isSwitching = isSwitchingNetwork && switchChainVariables?.chainId === targetChainId;

                                        return (
                                            <Button
                                                key={option.value}
                                                type="button"
                                                variant={isActive ? "primary" : "ghost"}
                                                size="sm"
                                                disabled={isActive || isSwitching}
                                                onClick={() => void handleSwitchNetwork(option.value)}
                                            >
                                                {isSwitching ? "Switching…" : isActive ? `${option.label} Active` : `Switch to ${option.label}`}
                                            </Button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="mb-4 p-3 rounded-md border border-border-subtle bg-primary/40">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                            <span
                                className={`inline-flex items-center h-6 px-2 rounded-md text-xs font-semibold ${authState === "authenticated"
                                    ? "bg-status-success/10 text-status-success border border-status-success/20"
                                    : authState === "connected_unauthenticated"
                                        ? "bg-status-warning/10 text-status-warning border border-status-warning/20"
                                        : "bg-tertiary text-fg-muted border border-border-subtle"
                                    }`}
                            >
                                {authState === "authenticated"
                                    ? "Signed In"
                                    : authState === "connected_unauthenticated"
                                        ? "Wallet Connected"
                                        : authState === "loading"
                                            ? "Checking Session"
                                            : "Not Connected"}
                            </span>
                            {address && (
                                <span className="text-xs text-fg-muted font-mono">
                                    {address.slice(0, 6)}…{address.slice(-4)}
                                </span>
                            )}
                        </div>
                        <p className="text-sm text-fg-secondary leading-relaxed">
                            {authState === "authenticated"
                                ? "Your wallet is connected and your Bavium session is active."
                                : authState === "connected_unauthenticated"
                                    ? "Your wallet is connected, but sign-in is not complete yet. Use the header to finish signing in."
                                    : authState === "loading"
                                        ? "Checking your current wallet session."
                                        : "Connect your wallet from the header to use protected features like runs, automations, and shortcut saving."}
                        </p>
                    </div>
                </Section>

                <Section
                    icon={Brain}
                    title="LLM Provider"
                    description="Select provider, model, and API key"
                >
                    {encryptionStatus !== "plaintext" && (
                        <div className="mb-4 p-3 rounded-md border border-border-subtle bg-primary/40">
                            <div className="flex items-center justify-between gap-2 mb-2">
                                <div className="text-xs text-fg-muted">
                                    Local encryption:{" "}
                                    <span className="text-fg">
                                        {isLocked ? "locked" : "unlocked"}
                                    </span>
                                </div>
                                {!isLocked && (
                                    <Button type="button" variant="ghost" size="sm" onClick={handleLockSession}>
                                        <Lock size={14} />
                                        Lock
                                    </Button>
                                )}
                            </div>
                            {isLocked && (
                                <div className="flex flex-col sm:flex-row gap-2">
                                    <input
                                        type="password"
                                        className="h-9 flex-1 px-3 text-[14px] text-fg bg-tertiary border border-border-default rounded-md outline-none placeholder:text-fg-muted focus:border-brand transition-colors"
                                        placeholder="Enter local secret to unlock"
                                        value={localSecret}
                                        onChange={(e) => setLocalSecret(e.target.value)}
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => void handleUnlockEncrypted()}
                                    >
                                        <Unlock size={14} />
                                        Unlock
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="flex flex-col gap-1.5 mb-5">
                        <label className="text-sm font-semibold text-fg-secondary">
                            Provider
                        </label>
                        <Combobox
                            options={LLM_PROVIDER_OPTIONS}
                            value={settings.llm.defaultProvider}
                            onChange={(v) =>
                                isLLMProvider(v) &&
                                update("llm", {
                                    ...settings.llm,
                                    defaultProvider: v,
                                })
                            }
                            disabled={isLocked}
                        />
                        <span className="text-[12px] text-fg-muted">
                            {selectedProviderDefinition.description}
                        </span>
                    </div>

                    <div className="flex flex-col gap-1.5 mb-3">
                        <div className="flex items-center justify-between gap-2">
                            <label className="text-sm font-semibold text-fg-secondary">
                                Model
                            </label>
                            {supportsModelDiscovery(selectedProvider) && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={!canDiscoverModels}
                                    isLoading={selectedProviderModelDiscovery?.status === "loading"}
                                    onClick={() => void discoverModels(selectedProvider, "manual")}
                                >
                                    <RefreshCw size={13} />
                                    Refresh models
                                </Button>
                            )}
                        </div>
                        <Combobox
                            options={providerModelOptions}
                            value={modelComboValue}
                            onChange={(v) => {
                                if (v === CUSTOM_MODEL_VALUE) {
                                    setCustomModelByProvider((prev) => ({
                                        ...prev,
                                        [selectedProvider]: true,
                                    }));
                                    if (
                                        isKnownModel(
                                            selectedProvider,
                                            selectedProviderConfig.model,
                                            selectedProviderModelDiscovery,
                                        )
                                    ) {
                                        updateLLMProvider(selectedProvider, "model", "");
                                    }
                                    return;
                                }
                                setCustomModelByProvider((prev) => ({
                                    ...prev,
                                    [selectedProvider]: false,
                                }));
                                updateLLMProvider(selectedProvider, "model", v);
                            }}
                            disabled={isLocked}
                        />
                        {supportsModelDiscovery(selectedProvider) ? (
                            <div className="text-[12px] text-fg-muted leading-relaxed">
                                {selectedProviderModelDiscovery?.status === "loading" ? (
                                    <span>Checking models available for this key…</span>
                                ) : selectedProviderModelDiscovery?.status === "success" ? (
                                    <span>
                                        {selectedProviderModelDiscovery.available.length} chat models found
                                        {selectedProviderModelDiscovery.cacheHit ? " from cache" : ""}.
                                        {selectedModelMissingFromDiscovery
                                            ? " Current model was not returned by the provider; choose an available model or use Custom."
                                            : " Image, audio, video, and embedding models are filtered out."}
                                    </span>
                                ) : selectedProviderModelDiscovery?.status === "error" ? (
                                    <span className="text-status-warning">
                                        {selectedProviderModelDiscovery.error} Curated models and custom model id remain available.
                                    </span>
                                ) : selectedProviderConfig.apiKey.trim() ? (
                                    <span>Models load automatically after your key is entered. Non-chat models are filtered out; curated models and custom id remain available.</span>
                                ) : (
                                    <span>Enter an API key to load chat models available for this account. Curated models and custom id remain available.</span>
                                )}
                            </div>
                        ) : (
                            <span className="text-[12px] text-fg-muted">
                                Curated model list with a custom model id option for advanced use.
                            </span>
                        )}
                    </div>
                    {customModelActive && (
                        <div className="flex flex-col gap-1.5 mb-3">
                            <label className="text-xs font-semibold text-fg-secondary uppercase tracking-wider">
                                Custom model id
                            </label>
                            <input
                                type="text"
                                className="h-9 px-3 text-[14px] text-fg bg-primary border border-border-default rounded-md outline-none placeholder:text-fg-muted focus:border-brand transition-colors"
                                placeholder="Enter model id"
                                value={selectedProviderConfig.model}
                                onChange={(e) =>
                                    updateLLMProvider(selectedProvider, "model", e.target.value)
                                }
                                disabled={isLocked}
                            />
                        </div>
                    )}

                    <div className="flex flex-col gap-1.5 mb-3">
                        <label className="text-sm font-semibold text-fg-secondary">
                            API Key
                        </label>
                        <div className="relative">
                            <input
                                type={showApiKeyByProvider[selectedProvider] ? "text" : "password"}
                                className="h-9 w-full px-3 pr-10 text-[14px] text-fg bg-primary border border-border-default rounded-md outline-none placeholder:text-fg-muted focus:border-brand transition-colors"
                                placeholder={selectedProviderDefinition.apiKeyPlaceholder}
                                value={selectedProviderConfig.apiKey}
                                onChange={(e) =>
                                    updateLLMProvider(selectedProvider, "apiKey", e.target.value)
                                }
                                disabled={isLocked}
                            />
                            <button
                                type="button"
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg transition-colors disabled:opacity-40"
                                onClick={() =>
                                    setShowApiKeyByProvider((prev) => ({
                                        ...prev,
                                        [selectedProvider]: !prev[selectedProvider],
                                    }))
                                }
                                disabled={isLocked}
                                aria-label={
                                    showApiKeyByProvider[selectedProvider]
                                        ? "Hide API key"
                                        : "Show API key"
                                }
                            >
                                {showApiKeyByProvider[selectedProvider] ? (
                                    <EyeOff size={16} />
                                ) : (
                                    <Eye size={16} />
                                )}
                            </button>
                        </div>
                    </div>

                    <span className="text-[13px] text-fg-muted leading-relaxed mt-1">
                        You can save keys for multiple providers. Chat and Builder use the selected provider first, then try other configured providers as fallbacks.
                    </span>

                    {/* ── Configured API Keys Summary ─────────────────── */}
                    <ConfiguredKeysSummary
                        settings={settings}
                        selectedProvider={selectedProvider}
                        onDeleteKey={(provider) => {
                            updateLLMProvider(provider, "apiKey", "");
                        }}
                        isLocked={isLocked}
                    />

                    {secureMessage && (
                        <span className="text-[12px] text-fg-muted mt-2 block">
                            {secureMessage}
                        </span>
                    )}
                </Section>
            </div>
        </div>
    );
}
