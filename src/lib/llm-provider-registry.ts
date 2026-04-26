export type LLMApiKind = "openai" | "anthropic" | "google";

export const LLM_PROVIDERS = [
    "openai",
    "anthropic",
    "google",
    "openrouter",
    "groq",
    "together",
    "deepseek",
    "mistral",
    "xai",
    "fireworks",
    "perplexity",
    "cerebras",
    "opencode",
    "bankr",
    "vercel-ai-gateway",
] as const;

export type LLMProvider = (typeof LLM_PROVIDERS)[number];

export interface LLMModelOption {
    label: string;
    value: string;
}

export interface LLMProviderDefinition {
    id: LLMProvider;
    label: string;
    apiKind: LLMApiKind;
    defaultModel: string;
    apiKeyPlaceholder: string;
    baseUrl?: string;
    supportsBaseUrlOverride?: boolean;
    description: string;
    models: LLMModelOption[];
}

export const CUSTOM_MODEL_VALUE = "__custom__";

export const LLM_PROVIDER_REGISTRY: Record<LLMProvider, LLMProviderDefinition> = {
    openai: {
        id: "openai",
        label: "OpenAI",
        apiKind: "openai",
        defaultModel: "gpt-4o-mini",
        apiKeyPlaceholder: "sk-...",
        baseUrl: "https://api.openai.com/v1",
        supportsBaseUrlOverride: true,
        description: "Native OpenAI API",
        models: [
            { label: "GPT-5", value: "gpt-5" },
            { label: "GPT-5.2", value: "gpt-5.2" },
            { label: "GPT-5.2 Codex", value: "gpt-5.2-codex" },
            { label: "GPT-5 mini", value: "gpt-5-mini" },
            { label: "GPT-5 nano", value: "gpt-5-nano" },
            { label: "GPT-4o", value: "gpt-4o" },
            { label: "GPT-4o mini", value: "gpt-4o-mini" },
            { label: "GPT-4.1", value: "gpt-4.1" },
            { label: "GPT-4.1 mini", value: "gpt-4.1-mini" },
            { label: "o4-mini", value: "o4-mini" },
            { label: "o3-mini", value: "o3-mini" },
            { label: "Custom model...", value: CUSTOM_MODEL_VALUE },
        ],
    },
    anthropic: {
        id: "anthropic",
        label: "Anthropic",
        apiKind: "anthropic",
        defaultModel: "claude-sonnet-4-20250514",
        apiKeyPlaceholder: "sk-ant-...",
        baseUrl: "https://api.anthropic.com/v1",
        supportsBaseUrlOverride: true,
        description: "Native Anthropic Messages API",
        models: [
            { label: "Claude Sonnet 4", value: "claude-sonnet-4-20250514" },
            { label: "Claude Opus 4", value: "claude-opus-4-20250514" },
            { label: "Claude 3.5 Sonnet", value: "claude-3-5-sonnet-latest" },
            { label: "Claude 3.5 Haiku", value: "claude-3-5-haiku-latest" },
            { label: "Claude 3 Opus", value: "claude-3-opus-latest" },
            { label: "Custom model...", value: CUSTOM_MODEL_VALUE },
        ],
    },
    google: {
        id: "google",
        label: "Google Gemini",
        apiKind: "google",
        defaultModel: "gemini-2.5-flash",
        apiKeyPlaceholder: "AIza...",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        description: "Native Google Gemini API",
        models: [
            { label: "Gemini 3.1 Pro", value: "gemini-3.1-pro" },
            { label: "Gemini 3.1 Flash", value: "gemini-3.1-flash" },
            { label: "Gemini 3 Pro", value: "gemini-3-pro" },
            { label: "Gemini 3 Flash", value: "gemini-3-flash" },
            { label: "Gemini 3 Pro Preview", value: "gemini-3-pro-preview" },
            { label: "Gemini 3 Flash Preview", value: "gemini-3-flash-preview" },
            { label: "Gemini 2.5 Pro", value: "gemini-2.5-pro" },
            { label: "Gemini 2.5 Flash", value: "gemini-2.5-flash" },
            { label: "Gemini 2.5 Flash Lite", value: "gemini-2.5-flash-lite" },
            { label: "Gemini 2.0 Flash", value: "gemini-2.0-flash" },
            { label: "Gemini 2.0 Flash Thinking", value: "gemini-2.0-flash-thinking-exp" },
            { label: "Gemini 1.5 Pro", value: "gemini-1.5-pro" },
            { label: "Gemini 1.5 Flash", value: "gemini-1.5-flash" },
            { label: "Custom model...", value: CUSTOM_MODEL_VALUE },
        ],
    },
    openrouter: {
        id: "openrouter",
        label: "OpenRouter",
        apiKind: "openai",
        defaultModel: "anthropic/claude-sonnet-4.5",
        apiKeyPlaceholder: "sk-or-...",
        baseUrl: "https://openrouter.ai/api/v1",
        supportsBaseUrlOverride: true,
        description: "Multi-model gateway via one OpenAI-compatible key",
        models: [
            { label: "Claude Sonnet 4.5", value: "anthropic/claude-sonnet-4.5" },
            { label: "GPT-5", value: "openai/gpt-5" },
            { label: "GPT-5.2", value: "openai/gpt-5.2" },
            { label: "GPT-5.2 Codex", value: "openai/gpt-5.2-codex" },
            { label: "Gemini 3 Pro", value: "google/gemini-3-pro" },
            { label: "Gemini 3 Flash", value: "google/gemini-3-flash" },
            { label: "Gemini 2.5 Pro", value: "google/gemini-2.5-pro" },
            { label: "DeepSeek R1", value: "deepseek/deepseek-r1" },
            { label: "Llama 3.3 70B", value: "meta-llama/llama-3.3-70b-instruct" },
            { label: "Auto Router", value: "auto" },
            { label: "Custom model...", value: CUSTOM_MODEL_VALUE },
        ],
    },
    groq: {
        id: "groq",
        label: "Groq",
        apiKind: "openai",
        defaultModel: "llama-3.3-70b-versatile",
        apiKeyPlaceholder: "gsk_...",
        baseUrl: "https://api.groq.com/openai/v1",
        supportsBaseUrlOverride: true,
        description: "Low-latency OpenAI-compatible inference",
        models: [
            { label: "Llama 3.3 70B Versatile", value: "llama-3.3-70b-versatile" },
            { label: "Llama 3.1 8B Instant", value: "llama-3.1-8b-instant" },
            { label: "DeepSeek R1 Distill 70B", value: "deepseek-r1-distill-llama-70b" },
            { label: "Qwen 3 32B", value: "qwen/qwen3-32b" },
            { label: "Custom model...", value: CUSTOM_MODEL_VALUE },
        ],
    },
    together: {
        id: "together",
        label: "Together AI",
        apiKind: "openai",
        defaultModel: "moonshotai/Kimi-K2.5",
        apiKeyPlaceholder: "together-...",
        baseUrl: "https://api.together.xyz/v1",
        supportsBaseUrlOverride: true,
        description: "OpenAI-compatible access to open-source models",
        models: [
            { label: "Kimi K2.5", value: "moonshotai/Kimi-K2.5" },
            { label: "DeepSeek R1", value: "deepseek-ai/DeepSeek-R1" },
            { label: "Qwen 2.5 Coder 32B", value: "Qwen/Qwen2.5-Coder-32B-Instruct" },
            { label: "Llama 3.1 70B Turbo", value: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo" },
            { label: "Custom model...", value: CUSTOM_MODEL_VALUE },
        ],
    },
    deepseek: {
        id: "deepseek",
        label: "DeepSeek",
        apiKind: "openai",
        defaultModel: "deepseek-chat",
        apiKeyPlaceholder: "sk-...",
        baseUrl: "https://api.deepseek.com/v1",
        supportsBaseUrlOverride: true,
        description: "Native DeepSeek OpenAI-compatible API",
        models: [
            { label: "DeepSeek Chat", value: "deepseek-chat" },
            { label: "DeepSeek Reasoner", value: "deepseek-reasoner" },
            { label: "Custom model...", value: CUSTOM_MODEL_VALUE },
        ],
    },
    mistral: {
        id: "mistral",
        label: "Mistral",
        apiKind: "openai",
        defaultModel: "mistral-large-latest",
        apiKeyPlaceholder: "sk-...",
        baseUrl: "https://api.mistral.ai/v1",
        supportsBaseUrlOverride: true,
        description: "Native Mistral OpenAI-compatible API",
        models: [
            { label: "Mistral Large", value: "mistral-large-latest" },
            { label: "Mistral Medium", value: "mistral-medium-latest" },
            { label: "Codestral", value: "codestral-latest" },
            { label: "Ministral 8B", value: "ministral-8b-latest" },
            { label: "Custom model...", value: CUSTOM_MODEL_VALUE },
        ],
    },
    xai: {
        id: "xai",
        label: "xAI",
        apiKind: "openai",
        defaultModel: "grok-3",
        apiKeyPlaceholder: "xai-...",
        baseUrl: "https://api.x.ai/v1",
        supportsBaseUrlOverride: true,
        description: "OpenAI-compatible Grok endpoints",
        models: [
            { label: "Grok 3", value: "grok-3" },
            { label: "Grok 3 Mini", value: "grok-3-mini" },
            { label: "Custom model...", value: CUSTOM_MODEL_VALUE },
        ],
    },
    fireworks: {
        id: "fireworks",
        label: "Fireworks AI",
        apiKind: "openai",
        defaultModel: "accounts/fireworks/models/llama-v3p1-70b-instruct",
        apiKeyPlaceholder: "fw_...",
        baseUrl: "https://api.fireworks.ai/inference/v1",
        supportsBaseUrlOverride: true,
        description: "OpenAI-compatible hosted inference",
        models: [
            { label: "Llama 3.1 70B Instruct", value: "accounts/fireworks/models/llama-v3p1-70b-instruct" },
            { label: "DeepSeek R1", value: "accounts/fireworks/models/deepseek-r1" },
            { label: "Qwen 3 Coder 480B", value: "accounts/fireworks/models/qwen3-coder-480b-a35b-instruct" },
            { label: "Custom model...", value: CUSTOM_MODEL_VALUE },
        ],
    },
    perplexity: {
        id: "perplexity",
        label: "Perplexity",
        apiKind: "openai",
        defaultModel: "sonar-pro",
        apiKeyPlaceholder: "pplx-...",
        baseUrl: "https://api.perplexity.ai",
        supportsBaseUrlOverride: true,
        description: "Search-augmented OpenAI-compatible API",
        models: [
            { label: "Sonar Pro", value: "sonar-pro" },
            { label: "Sonar", value: "sonar" },
            { label: "Sonar Reasoning Pro", value: "sonar-reasoning-pro" },
            { label: "Custom model...", value: CUSTOM_MODEL_VALUE },
        ],
    },
    cerebras: {
        id: "cerebras",
        label: "Cerebras",
        apiKind: "openai",
        defaultModel: "llama-3.3-70b",
        apiKeyPlaceholder: "csk-...",
        baseUrl: "https://api.cerebras.ai/v1",
        supportsBaseUrlOverride: true,
        description: "High-speed OpenAI-compatible inference",
        models: [
            { label: "Llama 3.3 70B", value: "llama-3.3-70b" },
            { label: "Qwen 3 Coder 480B", value: "qwen-3-coder-480b" },
            { label: "Custom model...", value: CUSTOM_MODEL_VALUE },
        ],
    },
    opencode: {
        id: "opencode",
        label: "OpenCode Zen",
        apiKind: "openai",
        defaultModel: "claude-opus-4-6",
        apiKeyPlaceholder: "sk-...",
        baseUrl: "https://opencode.ai/zen/v1",
        supportsBaseUrlOverride: true,
        description: "Curated coding-oriented model gateway",
        models: [
            { label: "Claude Opus 4.6", value: "claude-opus-4-6" },
            { label: "GPT-5.2", value: "gpt-5.2" },
            { label: "GPT-5.1 Codex", value: "gpt-5.1-codex" },
            { label: "Gemini 3 Pro", value: "gemini-3-pro" },
            { label: "Gemini 3 Flash", value: "gemini-3-flash" },
            { label: "GLM 4.7", value: "glm-4.7" },
            { label: "Custom model...", value: CUSTOM_MODEL_VALUE },
        ],
    },
    bankr: {
        id: "bankr",
        label: "Bankr Gateway",
        apiKind: "openai",
        defaultModel: "claude-sonnet-4.6",
        apiKeyPlaceholder: "bankr_...",
        baseUrl: "https://llm.bankr.bot/v1",
        supportsBaseUrlOverride: true,
        description: "Unified multi-provider LLM gateway",
        models: [
            { label: "Claude Opus 4.6", value: "claude-opus-4.6" },
            { label: "Claude Sonnet 4.6", value: "claude-sonnet-4.6" },
            { label: "Claude Sonnet 4.5", value: "claude-sonnet-4.5" },
            { label: "Claude Haiku 4.5", value: "claude-haiku-4.5" },
            { label: "Gemini 3 Pro", value: "gemini-3-pro" },
            { label: "Gemini 3 Flash", value: "gemini-3-flash" },
            { label: "GPT-5.2", value: "gpt-5.2" },
            { label: "GPT-5.2 Codex", value: "gpt-5.2-codex" },
            { label: "GPT-5 mini", value: "gpt-5-mini" },
            { label: "GPT-5 nano", value: "gpt-5-nano" },
            { label: "Kimi K2.5", value: "kimi-k2.5" },
            { label: "Qwen3 Coder", value: "qwen3-coder" },
            { label: "Custom model...", value: CUSTOM_MODEL_VALUE },
        ],
    },
    "vercel-ai-gateway": {
        id: "vercel-ai-gateway",
        label: "Vercel AI Gateway",
        apiKind: "anthropic",
        defaultModel: "anthropic/claude-opus-4.6",
        apiKeyPlaceholder: "aigw_...",
        baseUrl: "https://ai-gateway.vercel.sh",
        supportsBaseUrlOverride: true,
        description: "Anthropic-compatible multi-model gateway",
        models: [
            { label: "Claude Opus 4.6", value: "anthropic/claude-opus-4.6" },
            { label: "Claude Sonnet 4.6", value: "anthropic/claude-sonnet-4.6" },
            { label: "GPT-5", value: "openai/gpt-5" },
            { label: "GPT-5.2", value: "openai/gpt-5.2" },
            { label: "Gemini 3 Pro", value: "google/gemini-3-pro" },
            { label: "Gemini 2.5 Pro", value: "google/gemini-2.5-pro" },
            { label: "DeepSeek R1", value: "deepseek/deepseek-r1" },
            { label: "Custom model...", value: CUSTOM_MODEL_VALUE },
        ],
    },
};

export const LLM_PROVIDER_OPTIONS = LLM_PROVIDERS.map((provider) => ({
    label: LLM_PROVIDER_REGISTRY[provider].label,
    value: provider,
}));

export const LLM_FALLBACK_ORDER: LLMProvider[] = [
    "anthropic",
    "openai",
    "google",
    "openrouter",
    "opencode",
    "bankr",
    "groq",
    "deepseek",
    "together",
    "mistral",
    "xai",
    "fireworks",
    "perplexity",
    "cerebras",
    "vercel-ai-gateway",
];

export function getLLMProviderDefinition(provider: LLMProvider): LLMProviderDefinition {
    return LLM_PROVIDER_REGISTRY[provider];
}

export function isLLMProvider(value: unknown): value is LLMProvider {
    return typeof value === "string" && LLM_PROVIDERS.includes(value as LLMProvider);
}

export function createDefaultLLMProviderSettings(): Record<
    LLMProvider,
    { apiKey: string; model: string; baseUrl?: string }
> {
    return Object.fromEntries(
        LLM_PROVIDERS.map((provider) => {
            const def = getLLMProviderDefinition(provider);
            return [
                provider,
                {
                    apiKey: "",
                    model: def.defaultModel,
                    baseUrl: "",
                },
            ];
        }),
    ) as Record<LLMProvider, { apiKey: string; model: string; baseUrl?: string }>;
}
