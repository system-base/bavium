/* ==========================================================================
   API Route: /api/chat
   Legacy server-side LLM proxy for planner/generator helpers.
   Receives the user's prompt and provider config, calls the provider through
   the shared AI SDK model factory, and returns raw text.

   Key properties:
     - API key arrives in the request body, used in memory, never persisted
     - System prompt built server-side from skill-manifest (never sent over wire)
     - Shares provider transport with /api/ai and /api/ai/test
     - Same-origin protection against CSRF
     - Memory-based rate limiting (no Convex overhead)
   ========================================================================== */

import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { requireSameOrigin } from "@/lib/api-middleware";
import { buildPlannerSystemPrompt } from "@/lib/skill-manifest";
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

const SYSTEM_PROMPT = buildPlannerSystemPrompt();
const REQUEST_TIMEOUT_MS = 45_000;

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

interface ChatRequestBody {
    userPrompt: string;
    provider: LLMProvider;
    model: string;
    apiKey: string;
    baseUrl?: string;
    testMode?: boolean;
}

const TEST_SYSTEM_PROMPT = "You are a helpful assistant. Respond concisely.";

function validateBody(body: unknown): ChatRequestBody | null {
    if (typeof body !== "object" || body === null) return null;
    const b = body as Record<string, unknown>;

    const userPrompt = typeof b.userPrompt === "string" ? b.userPrompt.trim() : "";
    const provider = typeof b.provider === "string" ? b.provider : "";
    const model = typeof b.model === "string" ? b.model.trim() : "";
    const apiKey = typeof b.apiKey === "string" ? b.apiKey.trim() : "";
    const baseUrl = typeof b.baseUrl === "string" ? b.baseUrl.trim() : undefined;
    const testMode = b.testMode === true;

    if (!userPrompt || !provider || !apiKey) return null;
    if (!isLLMProvider(provider)) return null;

    const providerDef = getLLMProviderDefinition(provider);
    return {
        userPrompt,
        provider,
        model: model || providerDef.defaultModel,
        apiKey,
        baseUrl: baseUrl || providerDef.baseUrl || undefined,
        testMode,
    };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
    const originCheck = requireSameOrigin(request);
    if (originCheck) return originCheck;

    const clientKey = getRequestClientKey(request);
    const { allowed, retryAfterSeconds } = consumeBestEffortRateLimit({
        bucket: "ai-chat",
        key: clientKey,
        windowMs: 60_000,
        max: 20,
    });

    if (!allowed) {
        return NextResponse.json(
            { error: `Too many requests. Try again in ${retryAfterSeconds}s.` },
            { status: 429 },
        );
    }

    let body: ChatRequestBody;
    try {
        const raw: unknown = await request.json();
        const validated = validateBody(raw);
        if (!validated) {
            return NextResponse.json(
                { error: "Invalid request. Provide userPrompt, provider, and apiKey." },
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
    const baseUrl = body.baseUrl || providerDef.baseUrl || "";

    const systemPrompt = body.testMode ? TEST_SYSTEM_PROMPT : SYSTEM_PROMPT;

    try {
        const { text } = await generateText({
            model: createAIModelFromConfig(
                body.provider,
                body.model,
                body.apiKey,
                baseUrl,
            ),
            system: systemPrompt,
            prompt: body.userPrompt,
            temperature: 0.3,
            maxOutputTokens: body.testMode ? 128 : 2048,
            timeout: REQUEST_TIMEOUT_MS,
        });

        return NextResponse.json({ text });
    } catch (err) {
        const message =
            err instanceof Error ? err.message : "An unexpected error occurred.";

        if (message.toLowerCase().includes("timeout")) {
            return NextResponse.json(
                { error: "LLM request timed out. Please try again." },
                { status: 504 },
            );
        }

        if (message.length > 200 || message.includes("fetch failed")) {
            return NextResponse.json(
                { error: "Failed to reach the AI provider. Check your API key and try again." },
                { status: 502 },
            );
        }

        return NextResponse.json({ error: message }, { status: 502 });
    }
}
