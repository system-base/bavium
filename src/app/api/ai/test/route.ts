import { type NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { requireSameOrigin } from "@/lib/api-middleware";
import {
    getLLMProviderDefinition,
    isLLMProvider,
    type LLMProvider,
} from "@/lib/llm-provider-registry";
import {
    consumeBestEffortRateLimit,
    getRequestClientKey,
} from "@/lib/server-rate-limit";
import { createAIModelFromConfig } from "@/lib/server-ai-model";

const TEST_TIMEOUT_MS = 20_000;

interface AITestRequestBody {
    provider: LLMProvider;
    model: string;
    apiKey: string;
    baseUrl?: string;
}

function validateBody(raw: unknown): AITestRequestBody | null {
    if (typeof raw !== "object" || raw === null) return null;

    const body = raw as Record<string, unknown>;
    const provider = typeof body.provider === "string" ? body.provider : "";
    const model = typeof body.model === "string" ? body.model.trim() : "";
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    const baseUrl =
        typeof body.baseUrl === "string" ? body.baseUrl.trim() : undefined;

    if (!isLLMProvider(provider)) return null;
    if (!apiKey || apiKey.length > 10_000) return null;

    const providerDef = getLLMProviderDefinition(provider);
    return {
        provider,
        model: model || providerDef.defaultModel,
        apiKey,
        baseUrl: baseUrl || providerDef.baseUrl || undefined,
    };
}

function getProviderErrorMessage(error: unknown): string {
    const message =
        error instanceof Error ? error.message : "AI provider test failed.";

    if (message.includes("fetch failed") || message.includes("network")) {
        return "Failed to reach the AI provider. Check the provider URL and try again.";
    }

    if (message.length > 320) {
        return `${message.slice(0, 320)}...`;
    }

    return message;
}

export async function POST(request: NextRequest) {
    const originCheck = requireSameOrigin(request);
    if (originCheck) return originCheck;

    const clientKey = getRequestClientKey(request);
    const { allowed, retryAfterSeconds } = consumeBestEffortRateLimit({
        bucket: "ai-test",
        key: clientKey,
        windowMs: 60_000,
        max: 10,
    });

    if (!allowed) {
        return NextResponse.json(
            {
                error: `Too many key tests. Try again in ${retryAfterSeconds}s.`,
            },
            { status: 429 },
        );
    }

    let body: AITestRequestBody;
    try {
        const validated = validateBody(await request.json());
        if (!validated) {
            return NextResponse.json(
                { error: "Invalid request. Provide provider and apiKey." },
                { status: 400 },
            );
        }
        body = validated;
    } catch {
        return NextResponse.json(
            { error: "Invalid JSON body." },
            { status: 400 },
        );
    }

    const providerDef = getLLMProviderDefinition(body.provider);

    try {
        const { text } = await generateText({
            model: createAIModelFromConfig(
                body.provider,
                body.model,
                body.apiKey,
                body.baseUrl,
            ),
            system:
                "You are a provider connectivity test. Respond with exactly ok.",
            prompt: "Reply with ok.",
            temperature: 0,
            maxOutputTokens: 8,
            timeout: TEST_TIMEOUT_MS,
        });

        return NextResponse.json({
            ok: true,
            provider: body.provider,
            providerLabel: providerDef.label,
            model: body.model,
            text: text.trim().slice(0, 120),
        });
    } catch (error) {
        return NextResponse.json(
            {
                ok: false,
                provider: body.provider,
                providerLabel: providerDef.label,
                model: body.model,
                error: getProviderErrorMessage(error),
            },
            { status: 502 },
        );
    }
}

