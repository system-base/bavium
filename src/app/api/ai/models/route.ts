import { createHash } from "crypto";
import { type NextRequest, NextResponse } from "next/server";
import { applyNoStoreHeaders, requireSameOrigin } from "@/lib/api-middleware";
import {
    CUSTOM_MODEL_VALUE,
    getLLMProviderDefinition,
    isLLMProvider,
    type LLMProvider,
} from "@/lib/llm-provider-registry";
import {
    consumeBestEffortRateLimit,
    getRequestClientKey,
} from "@/lib/server-rate-limit";

const REQUEST_TIMEOUT_MS = 15_000;
const MODEL_DISCOVERY_CACHE_TTL_MS = 5 * 60_000;
const MAX_MODEL_COUNT = 200;
const MODEL_DISCOVERY_FILTER_VERSION = "chat-filter-v2";
const DISCOVERABLE_PROVIDERS = new Set<LLMProvider>(["google", "openai"]);

type ModelDiscoverySource = "recommended" | "available";

interface ModelDiscoveryOption {
    label: string;
    value: string;
    source: ModelDiscoverySource;
}

interface ModelDiscoveryResponse {
    provider: LLMProvider;
    recommended: ModelDiscoveryOption[];
    available: ModelDiscoveryOption[];
    models: ModelDiscoveryOption[];
    fetchedAt: string;
    cacheHit: boolean;
    ttlMs: number;
}

interface ModelDiscoveryRequestBody {
    provider: LLMProvider;
    apiKey: string;
    baseUrl?: string;
}

interface GoogleModelRecord {
    name?: unknown;
    displayName?: unknown;
    description?: unknown;
    supportedGenerationMethods?: unknown;
    supportedActions?: unknown;
    supported_actions?: unknown;
}

interface OpenAIModelRecord {
    id?: unknown;
    owned_by?: unknown;
}

const discoveryCache = new Map<string, { expiresAt: number; response: ModelDiscoveryResponse }>();

function createAbortController(): { signal: AbortSignal; clear: () => void } {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function validateBody(body: unknown): ModelDiscoveryRequestBody | null {
    if (typeof body !== "object" || body === null) return null;
    const record = body as Record<string, unknown>;
    const provider = record.provider;
    const apiKey = typeof record.apiKey === "string" ? record.apiKey.trim() : "";
    const baseUrl = typeof record.baseUrl === "string" ? record.baseUrl.trim() : undefined;

    if (!isLLMProvider(provider)) return null;
    if (!DISCOVERABLE_PROVIDERS.has(provider)) return null;
    if (!apiKey || apiKey.length > 10_000) return null;

    return {
        provider,
        apiKey,
        baseUrl,
    };
}

function resolveBaseUrl(provider: LLMProvider, baseUrl?: string): string {
    const providerDef = getLLMProviderDefinition(provider);
    const rawBaseUrl =
        baseUrl && providerDef.supportsBaseUrlOverride
            ? baseUrl
            : providerDef.baseUrl;

    if (!rawBaseUrl) {
        throw new Error("Provider base URL is not configured.");
    }

    let url: URL;
    try {
        url = new URL(rawBaseUrl);
    } catch {
        throw new Error("Provider base URL is invalid.");
    }

    if (url.protocol !== "https:") {
        throw new Error("Provider base URL must use HTTPS.");
    }

    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function buildCacheKey(provider: LLMProvider, apiKey: string, baseUrl: string): string {
    const keyFingerprint = createHash("sha256")
        .update(apiKey)
        .digest("hex")
        .slice(0, 16);

    return `${provider}:${MODEL_DISCOVERY_FILTER_VERSION}:${baseUrl}:${keyFingerprint}`;
}

function isSafeModelId(value: string): boolean {
    return (
        value.length > 0 &&
        value.length <= 220 &&
        /^[A-Za-z0-9_.:/@-]+$/.test(value)
    );
}

function humanizeModelId(value: string): string {
    return value
        .replace(/^models\//, "")
        .replace(/^ft:/, "Fine-tuned ")
        .replace(/[-_/]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function getStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
}

function getProviderErrorMessage(body: unknown, fallback: string): string {
    if (typeof body !== "object" || body === null) return fallback;
    const record = body as Record<string, unknown>;
    const error = record.error;

    if (typeof error === "string") return error;
    if (typeof error === "object" && error !== null) {
        const errorRecord = error as Record<string, unknown>;
        if (typeof errorRecord.message === "string") return errorRecord.message;
    }

    if (typeof record.message === "string") return record.message;
    return fallback;
}

function buildRecommendedModels(provider: LLMProvider): ModelDiscoveryOption[] {
    return getLLMProviderDefinition(provider).models
        .filter((model) => model.value !== CUSTOM_MODEL_VALUE)
        .map((model) => ({
            label: model.label,
            value: model.value,
            source: "recommended" as const,
        }));
}

function mergeModelOptions(
    recommended: ModelDiscoveryOption[],
    available: ModelDiscoveryOption[],
): ModelDiscoveryOption[] {
    const seen = new Set<string>();
    const merged: ModelDiscoveryOption[] = [];

    for (const model of [...recommended, ...available]) {
        if (seen.has(model.value)) continue;
        seen.add(model.value);
        merged.push(model);
    }

    return merged;
}

function normalizeGoogleModel(record: GoogleModelRecord): ModelDiscoveryOption | null {
    if (typeof record.name !== "string") return null;
    if (!record.name.startsWith("models/")) return null;

    const methods = [
        ...getStringArray(record.supportedGenerationMethods),
        ...getStringArray(record.supportedActions),
        ...getStringArray(record.supported_actions),
    ];

    if (!methods.includes("generateContent")) return null;

    const value = record.name.replace(/^models\//, "");
    if (!isSafeModelId(value)) return null;
    if (!isGoogleChatModel(record, value)) return null;

    const label =
        typeof record.displayName === "string" && record.displayName.trim()
            ? record.displayName.trim()
            : humanizeModelId(value);

    return {
        label,
        value,
        source: "available",
    };
}

function isGoogleChatModel(record: GoogleModelRecord, modelId: string): boolean {
    const id = modelId.toLowerCase();
    const allowedChatPrefixes = [
        "gemini-",
        "gemma-",
        "learnlm-",
    ];
    const blockedIdParts = [
        "image",
        "imagen",
        "nano-banana",
        "banana",
        "embedding",
        "tts",
        "audio",
        "native-audio",
        "speech",
        "video",
        "veo",
        "lyria",
        "lyric",
        "music",
        "song",
        "chirp",
    ];

    if (!allowedChatPrefixes.some((prefix) => id.startsWith(prefix))) {
        return false;
    }

    if (blockedIdParts.some((part) => id.includes(part))) {
        return false;
    }

    const metadataText = [
        typeof record.displayName === "string" ? record.displayName : "",
        typeof record.description === "string" ? record.description : "",
    ]
        .join(" ")
        .toLowerCase();

    const blockedMetadataPhrases = [
        "image generation",
        "generate images",
        "generating images",
        "text-to-image",
        "imagen",
        "nano banana",
        "banana pro",
        "image model",
        "image editing",
        "photo generation",
        "photo editing",
        "embedding",
        "text embedding",
        "speech generation",
        "audio generation",
        "music generation",
        "generate music",
        "generate songs",
        "song generation",
        "lyria",
        "mp3",
        "video generation",
        "text-to-speech",
        "text-to-music",
    ];

    return !blockedMetadataPhrases.some((phrase) => metadataText.includes(phrase));
}

async function discoverGoogleModels(
    apiKey: string,
    baseUrl: string,
    signal: AbortSignal,
): Promise<ModelDiscoveryOption[]> {
    const models: ModelDiscoveryOption[] = [];
    let pageToken = "";

    for (let page = 0; page < 4; page += 1) {
        const url = new URL(`${baseUrl}/models`);
        url.searchParams.set("pageSize", "1000");
        if (pageToken) url.searchParams.set("pageToken", pageToken);

        const response = await fetch(url, {
            method: "GET",
            headers: {
                "x-goog-api-key": apiKey,
            },
            signal,
        });

        const data: unknown = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(
                getProviderErrorMessage(data, `Google model discovery failed (${response.status}).`),
            );
        }

        const record = data as { models?: unknown; nextPageToken?: unknown };
        if (Array.isArray(record.models)) {
            for (const item of record.models) {
                const model = normalizeGoogleModel(item as GoogleModelRecord);
                if (model) models.push(model);
                if (models.length >= MAX_MODEL_COUNT) break;
            }
        }

        if (models.length >= MAX_MODEL_COUNT) break;
        pageToken = typeof record.nextPageToken === "string" ? record.nextPageToken : "";
        if (!pageToken) break;
    }

    return dedupeAndSort(models);
}

function isOpenAIGenerationModel(id: string): boolean {
    const lower = id.toLowerCase();
    const blockedSubstrings = [
        "embedding",
        "moderation",
        "whisper",
        "tts",
        "dall-e",
        "image",
        "audio",
        "transcribe",
        "realtime",
        "search",
        "rerank",
    ];

    if (blockedSubstrings.some((part) => lower.includes(part))) return false;

    return (
        lower.startsWith("gpt-") ||
        lower.startsWith("chatgpt-") ||
        /^o\d/.test(lower) ||
        lower.startsWith("ft:")
    );
}

async function discoverOpenAIModels(
    apiKey: string,
    baseUrl: string,
    signal: AbortSignal,
): Promise<ModelDiscoveryOption[]> {
    const response = await fetch(`${baseUrl}/models`, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
        signal,
    });

    const data: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(
            getProviderErrorMessage(data, `OpenAI model discovery failed (${response.status}).`),
        );
    }

    const record = data as { data?: unknown };
    if (!Array.isArray(record.data)) return [];

    const models = record.data
        .map((item): ModelDiscoveryOption | null => {
            const model = item as OpenAIModelRecord;
            if (typeof model.id !== "string") return null;
            if (!isSafeModelId(model.id)) return null;
            if (!isOpenAIGenerationModel(model.id)) return null;

            return {
                label: humanizeModelId(model.id),
                value: model.id,
                source: "available",
            };
        })
        .filter((model): model is ModelDiscoveryOption => model !== null)
        .slice(0, MAX_MODEL_COUNT);

    return dedupeAndSort(models);
}

function dedupeAndSort(models: ModelDiscoveryOption[]): ModelDiscoveryOption[] {
    const seen = new Set<string>();
    const unique: ModelDiscoveryOption[] = [];

    for (const model of models) {
        if (seen.has(model.value)) continue;
        seen.add(model.value);
        unique.push(model);
    }

    return unique.sort((a, b) => a.label.localeCompare(b.label));
}

function sanitizeDiscoveryError(error: unknown): string {
    const message = error instanceof Error ? error.message : "Model discovery failed.";
    if (
        message.length > 220 ||
        message.includes("fetch failed") ||
        message.includes("UND_ERR")
    ) {
        return "Failed to reach the model provider. Check your API key and try again.";
    }
    return message;
}

export async function POST(request: NextRequest) {
    const originCheck = requireSameOrigin(request);
    if (originCheck) return originCheck;

    const clientKey = getRequestClientKey(request);
    const { allowed, retryAfterSeconds } = consumeBestEffortRateLimit({
        bucket: "ai-model-discovery",
        key: clientKey,
        windowMs: 60_000,
        max: 15,
    });

    if (!allowed) {
        return applyNoStoreHeaders(
            NextResponse.json(
                { error: `Too many model discovery requests. Try again in ${retryAfterSeconds}s.` },
                { status: 429 },
            ),
        );
    }

    let body: ModelDiscoveryRequestBody;
    try {
        const parsed: unknown = await request.json();
        const validated = validateBody(parsed);
        if (!validated) {
            return applyNoStoreHeaders(
                NextResponse.json(
                    { error: "Invalid request. Provide provider and apiKey for a supported provider." },
                    { status: 400 },
                ),
            );
        }
        body = validated;
    } catch {
        return applyNoStoreHeaders(
            NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }),
        );
    }

    let baseUrl: string;
    try {
        baseUrl = resolveBaseUrl(body.provider, body.baseUrl);
    } catch (error) {
        return applyNoStoreHeaders(
            NextResponse.json(
                { error: sanitizeDiscoveryError(error) },
                { status: 400 },
            ),
        );
    }

    const cacheKey = buildCacheKey(body.provider, body.apiKey, baseUrl);
    const now = Date.now();
    const cached = discoveryCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
        return applyNoStoreHeaders(
            NextResponse.json({
                ...cached.response,
                cacheHit: true,
            }),
        );
    }

    const { signal, clear } = createAbortController();

    try {
        const available =
            body.provider === "google"
                ? await discoverGoogleModels(body.apiKey, baseUrl, signal)
                : await discoverOpenAIModels(body.apiKey, baseUrl, signal);

        const recommended = buildRecommendedModels(body.provider);
        const response: ModelDiscoveryResponse = {
            provider: body.provider,
            recommended,
            available,
            models: mergeModelOptions(recommended, available),
            fetchedAt: new Date().toISOString(),
            cacheHit: false,
            ttlMs: MODEL_DISCOVERY_CACHE_TTL_MS,
        };

        discoveryCache.set(cacheKey, {
            expiresAt: now + MODEL_DISCOVERY_CACHE_TTL_MS,
            response,
        });

        return applyNoStoreHeaders(NextResponse.json(response));
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            return applyNoStoreHeaders(
                NextResponse.json(
                    { error: "Model discovery timed out. Try again." },
                    { status: 504 },
                ),
            );
        }

        return applyNoStoreHeaders(
            NextResponse.json(
                { error: sanitizeDiscoveryError(error) },
                { status: 502 },
            ),
        );
    } finally {
        clear();
    }
}
