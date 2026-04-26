import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import {
    getLLMProviderDefinition,
    type LLMProvider,
} from "@/lib/llm-provider-registry";

export function createAIModelFromConfig(
    provider: LLMProvider,
    model: string,
    apiKey: string,
    baseUrl?: string,
) {
    const providerDef = getLLMProviderDefinition(provider);
    const resolvedModel = model || providerDef.defaultModel;
    const resolvedBaseUrl = baseUrl || providerDef.baseUrl;

    switch (providerDef.apiKind) {
        case "openai": {
            const openai = createOpenAI({
                apiKey,
                baseURL: resolvedBaseUrl || "https://api.openai.com/v1",
            });
            return openai(resolvedModel);
        }
        case "anthropic": {
            const anthropic = createAnthropic({
                apiKey,
                baseURL: resolvedBaseUrl || "https://api.anthropic.com/v1",
            });
            return anthropic(resolvedModel);
        }
        case "google": {
            const google = createGoogleGenerativeAI({
                apiKey,
                baseURL:
                    resolvedBaseUrl ||
                    "https://generativelanguage.googleapis.com/v1beta",
            });
            return google(resolvedModel);
        }
        default:
            throw new Error(`Unsupported API kind: ${providerDef.apiKind}`);
    }
}

