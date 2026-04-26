/* ==========================================================================
   LLM Service — Legacy AI-Powered Shortcut/Automation Generation
   ─────────────────────────────────────────────
   Uses the user's own API key (stored in localStorage, never on server).
   Legacy planner calls are proxied through /api/chat (server-side) so that:
     - API keys don't appear in browser network traces to third-party origins
     - Provider transport stays server-side through the AI SDK model factory
     - System prompt stays server-side only
   ========================================================================== */

import type { BlockCategory } from "@/lib/constants";
import { SKILL_PALETTE } from "@/lib/constants";
import type {
    ConditionGroup,
    StructuredCondition,
    ConditionOperator,
    ConditionValueType,
    FailureStrategy,
    ShortcutInput,
} from "@/engine/types";
import { loadStoredSettings } from "@/lib/secure-storage";
import {
    LLM_FALLBACK_ORDER,
    getLLMProviderDefinition,
    isLLMProvider,
    type LLMProvider,
} from "@/lib/llm-provider-registry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { LLMProvider } from "@/lib/llm-provider-registry";

export interface LLMConfig {
    provider: LLMProvider;
    apiKey: string;
    model?: string;
    baseUrl?: string;
    fallbacks?: LLMConfig[];
}

interface GeneratedStep {
    id: string;
    skill: string;
    action: string;
    params: Record<string, string | number | boolean | null>;
    dependsOn?: string[];
    confirm?: boolean;
    output?: { as: string };
    onFailure?: FailureStrategy;
    condition?: string | StructuredCondition;
    thenSteps?: GeneratedStep[];
    elseSteps?: GeneratedStep[];
    repeatSteps?: GeneratedStep[];
}

export interface GeneratedShortcut {
    name: string;
    description: string;
    category: BlockCategory;
    steps: GeneratedStep[];
    inputs: ShortcutInput[];
}

export interface GeneratedAutomation {
    name: string;
    trigger:
    | { type: "price_below" | "price_above"; token: string; priceUsd: number }
    | { type: "scheduled"; cron: string; cronDescription?: string };
    /** Intended workflow behavior; UI still asks the user to link a saved shortcut. */
    action:
    | { type: "swap"; fromToken: string; toToken: string; amount: string }
    | { type: "send"; token: string; amount: string; to: string }
    | { type: "notify"; channel: "email" | "webhook"; target: string; message: string };
    maxExecutions?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Legacy server-side planner proxy (/api/chat)
// ---------------------------------------------------------------------------

async function callProvider(config: LLMConfig, userPrompt: string): Promise<string> {
    const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            userPrompt,
            provider: config.provider,
            model: config.model,
            apiKey: config.apiKey,
            baseUrl: config.baseUrl,
        }),
    });

    if (!res.ok) {
        const err: unknown = await res.json().catch(() => ({ error: "Unknown error" }));
        const errObj = err as { error?: string };
        throw new Error(errObj?.error ?? `Server error (${res.status})`);
    }

    const data = (await res.json()) as { text?: string };
    return data.text ?? "";
}

function parseStructuredJSON(rawResponse: string, label: string): unknown {
    const trimmed = rawResponse.trim();
    const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    const objectStart = trimmed.indexOf("{");
    const objectEnd = trimmed.lastIndexOf("}");
    const candidates = [
        jsonMatch ? jsonMatch[1].trim() : "",
        trimmed,
        objectStart >= 0 && objectEnd > objectStart ? trimmed.slice(objectStart, objectEnd + 1) : "",
    ].filter(Boolean);

    let parsed: unknown;
    let parseError: unknown;
    for (const candidate of candidates) {
        try {
            parsed = JSON.parse(candidate);
            parseError = null;
            break;
        } catch (error) {
            parseError = error;
        }
    }

    if (parseError) {
        throw new Error(`Invalid ${label} JSON response`);
    }

    if (!isRecord(parsed)) {
        throw new Error(`Invalid ${label} response structure`);
    }

    return parsed;
}

async function requestStructuredOutput<T>(
    config: LLMConfig,
    userPrompt: string,
    validate: (value: unknown) => value is T,
    label: string,
): Promise<T> {
    const attempts = [config, ...(config.fallbacks ?? [])];
    const errors: string[] = [];

    for (const candidate of attempts) {
        try {
            const rawResponse = await callProvider(candidate, userPrompt);
            const parsed = parseStructuredJSON(rawResponse, label);
            if (!validate(parsed)) {
                throw new Error(`Invalid ${label} response structure`);
            }
            return parsed;
        } catch (err) {
            const providerLabel = getLLMProviderDefinition(candidate.provider).label;
            const message = err instanceof Error ? err.message : String(err);
            errors.push(`${providerLabel}: ${message}`);
        }
    }

    throw new Error(
        `All configured AI providers failed for ${label} generation. ${errors.join(" | ")}`,
    );
}

function isGeneratedShortcut(value: unknown): value is GeneratedShortcut {
    if (!isRecord(value)) return false;
    return "name" in value && "steps" in value && Array.isArray(value.steps);
}

function isGeneratedAutomation(value: unknown): value is GeneratedAutomation {
    return (
        typeof value === "object" &&
        value !== null &&
        "name" in value &&
        "trigger" in value &&
        "action" in value
    );
}

function normalizeAutomationToken(value: unknown, fallback: string): string {
    const token = typeof value === "string" ? value.trim().toUpperCase() : "";
    return token || fallback;
}

function normalizeAutomationAmount(value: unknown): string {
    const amount = typeof value === "string" || typeof value === "number"
        ? String(value).trim()
        : "";
    return amount || "an amount";
}

function validateAndRepairGeneratedAutomation(raw: GeneratedAutomation): GeneratedAutomation {
    const trigger = isRecord(raw.trigger as unknown)
        ? raw.trigger as Record<string, unknown>
        : null;
    const triggerType = typeof trigger?.type === "string" ? trigger.type : "";
    let normalizedTrigger: GeneratedAutomation["trigger"];

    if (triggerType === "scheduled") {
        const cron = typeof trigger?.cron === "string" ? trigger.cron.trim() : "";
        normalizedTrigger = {
            type: "scheduled",
            cron: cron.split(/\s+/).length === 5 ? cron : "0 9 * * *",
            ...(typeof trigger?.cronDescription === "string" && trigger.cronDescription.trim()
                ? { cronDescription: trigger.cronDescription.trim() }
                : {}),
        };
    } else if (triggerType === "price_below" || triggerType === "price_above") {
        const priceUsd = typeof trigger?.priceUsd === "number"
            ? trigger.priceUsd
            : Number(trigger?.priceUsd);
        if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
            throw new Error("Invalid automation response structure");
        }
        normalizedTrigger = {
            type: triggerType,
            token: normalizeAutomationToken(trigger?.token, "ETH"),
            priceUsd,
        };
    } else {
        throw new Error("Invalid automation response structure");
    }

    const action = isRecord(raw.action as unknown)
        ? raw.action as Record<string, unknown>
        : {};
    const actionType = typeof action.type === "string" ? action.type : "";
    let normalizedAction: GeneratedAutomation["action"];

    if (actionType === "swap") {
        normalizedAction = {
            type: "swap",
            fromToken: normalizeAutomationToken(action.fromToken, "ETH"),
            toToken: normalizeAutomationToken(action.toToken, "USDC"),
            amount: normalizeAutomationAmount(action.amount),
        };
    } else if (actionType === "send") {
        normalizedAction = {
            type: "send",
            token: normalizeAutomationToken(action.token, "USDC"),
            amount: normalizeAutomationAmount(action.amount),
            to: typeof action.to === "string" && action.to.trim()
                ? action.to.trim()
                : "recipient",
        };
    } else {
        normalizedAction = {
            type: "notify",
            channel: action.channel === "email" ? "email" : "webhook",
            target: typeof action.target === "string" && action.target.trim()
                ? action.target.trim()
                : "linked-shortcut",
            message: typeof action.message === "string" && action.message.trim()
                ? action.message.trim()
                : "Review the linked workflow when this automation triggers.",
        };
    }

    const maxExecutions = typeof raw.maxExecutions === "number"
        ? Math.max(0, Math.floor(raw.maxExecutions))
        : undefined;

    return {
        name: typeof raw.name === "string" && raw.name.trim()
            ? raw.name.trim()
            : "AI Automation",
        trigger: normalizedTrigger,
        action: normalizedAction,
        ...(maxExecutions !== undefined ? { maxExecutions } : {}),
    };
}

const SKILL_ID_SET = new Set(SKILL_PALETTE.map((s) => s.id));

const STEP_ACTION_ALIASES: Record<string, string> = {
    "wallet.balance": "wallet.get_balance",
    "logic.if": "logic.if_else",
};

const VALID_INPUT_TYPES = new Set<ShortcutInput["type"]>([
    "address",
    "amount",
    "text",
    "token",
    "boolean",
    "select",
    "number",
]);

function normalizeStepId(value: unknown, index: number): string {
    const raw = typeof value === "string" ? value.trim() : "";
    return raw.length > 0 ? raw : `step-${index + 1}`;
}

function normalizeStepParams(value: unknown): Record<string, string | number | boolean | null> {
    if (!isRecord(value)) return {};
    const out: Record<string, string | number | boolean | null> = {};
    for (const [key, param] of Object.entries(value)) {
        if (
            typeof param === "string" ||
            typeof param === "number" ||
            typeof param === "boolean" ||
            param === null
        ) {
            out[key] = param;
        } else {
            out[key] = JSON.stringify(param ?? null);
        }
    }
    return out;
}

function normalizeStepCondition(value: unknown): string | StructuredCondition | undefined {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    if (!isRecord(value)) return undefined;

    if ((value.mode === "all" || value.mode === "any") && Array.isArray(value.conditions)) {
        const conditions = value.conditions
            .map((item) => normalizeStepCondition(item))
            .filter((item): item is StructuredCondition => item !== undefined && typeof item !== "string");

        if (conditions.length === 0) return undefined;

        const group: ConditionGroup = {
            mode: value.mode,
            conditions,
        };
        return group;
    }

    if (
        typeof value.inputRef !== "string" ||
        typeof value.operator !== "string" ||
        typeof value.compareValue !== "string" ||
        (
            value.valueType !== "number" &&
            value.valueType !== "string" &&
            value.valueType !== "boolean"
        )
    ) {
        return undefined;
    }

    return {
        inputRef: value.inputRef,
        operator: value.operator as ConditionOperator,
        compareValue: value.compareValue,
        valueType: value.valueType as ConditionValueType,
    };
}

function normalizeFailureStrategy(value: unknown): FailureStrategy | undefined {
    if (typeof value !== "string") return undefined;
    if (value === "abort" || value === "continue") return value;
    if (/^retry\(\d+\)$/.test(value)) return value as FailureStrategy;
    return undefined;
}

function normalizeGeneratedInputs(rawInputs: unknown): ShortcutInput[] {
    if (!Array.isArray(rawInputs)) return [];

    const inputs: ShortcutInput[] = [];
    const invalidInputs: string[] = [];

    rawInputs.forEach((rawInput, index) => {
        if (!isRecord(rawInput)) {
            invalidInputs.push(`input-${index + 1}: invalid object`);
            return;
        }

        const id = typeof rawInput.id === "string" ? rawInput.id.trim() : "";
        const label = typeof rawInput.label === "string" ? rawInput.label.trim() : "";
        const type = typeof rawInput.type === "string" ? rawInput.type.trim() as ShortcutInput["type"] : null;
        const required = typeof rawInput.required === "boolean" ? rawInput.required : null;

        if (!id || !label || !type || required === null || !VALID_INPUT_TYPES.has(type)) {
            invalidInputs.push(`input-${index + 1}: invalid id/label/type/required`);
            return;
        }

        const constraints = isRecord(rawInput.constraints)
            ? {
                ...(typeof rawInput.constraints.min === "string" ? { min: rawInput.constraints.min } : {}),
                ...(typeof rawInput.constraints.max === "string" ? { max: rawInput.constraints.max } : {}),
                ...(typeof rawInput.constraints.token === "string" ? { token: rawInput.constraints.token } : {}),
                ...(Array.isArray(rawInput.constraints.options)
                    ? {
                        options: rawInput.constraints.options
                            .filter((option): option is { label: string; value: string } =>
                                isRecord(option) &&
                                typeof option.label === "string" &&
                                typeof option.value === "string",
                            )
                            .map((option) => ({
                                label: option.label,
                                value: option.value,
                            })),
                    }
                    : {}),
            }
            : undefined;

        inputs.push({
            id,
            label,
            type,
            required,
            ...(typeof rawInput.placeholder === "string" ? { placeholder: rawInput.placeholder } : {}),
            ...(typeof rawInput.default === "string" ? { default: rawInput.default } : {}),
            ...(constraints && Object.keys(constraints).length > 0 ? { constraints } : {}),
        });
    });

    if (invalidInputs.length > 0) {
        throw new Error(`AI generated invalid shortcut inputs. Invalid: ${invalidInputs.join(", ")}`);
    }

    return inputs;
}

function repairGeneratedStepTree(
    stepsRaw: unknown[],
    path: string,
): { steps: GeneratedStep[]; invalidSteps: string[] } {
    const repairedSteps: GeneratedStep[] = [];
    const invalidSteps: string[] = [];

    for (let i = 0; i < stepsRaw.length; i++) {
        const rawStep = stepsRaw[i];
        const stepPath = `${path}[${i}]`;
        const step = isRecord(rawStep) ? rawStep : ({} satisfies Record<string, unknown>);
        const skill = typeof step.skill === "string" ? step.skill.trim() : "";
        const action = typeof step.action === "string" ? step.action.trim() : "";
        const directSkillId = `${skill}.${action}`;
        const aliasedSkillId = STEP_ACTION_ALIASES[directSkillId] ?? directSkillId;

        if (!SKILL_ID_SET.has(aliasedSkillId)) {
            invalidSteps.push(`${stepPath}: "${directSkillId || "unknown"}"`);
            continue;
        }

        const thenTree = Array.isArray(step.thenSteps)
            ? repairGeneratedStepTree(step.thenSteps, `${stepPath}.thenSteps`)
            : { steps: undefined, invalidSteps: [] as string[] };
        const elseTree = Array.isArray(step.elseSteps)
            ? repairGeneratedStepTree(step.elseSteps, `${stepPath}.elseSteps`)
            : { steps: undefined, invalidSteps: [] as string[] };
        const repeatTree = Array.isArray(step.repeatSteps)
            ? repairGeneratedStepTree(step.repeatSteps, `${stepPath}.repeatSteps`)
            : { steps: undefined, invalidSteps: [] as string[] };

        invalidSteps.push(...thenTree.invalidSteps, ...elseTree.invalidSteps, ...repeatTree.invalidSteps);

        const [finalSkill, ...actionParts] = aliasedSkillId.split(".");
        repairedSteps.push({
            id: normalizeStepId(step.id, i),
            skill: finalSkill,
            action: actionParts.join("."),
            params: normalizeStepParams(step.params),
            dependsOn: Array.isArray(step.dependsOn)
                ? (step.dependsOn as unknown[]).filter((x): x is string => typeof x === "string")
                : undefined,
            confirm: typeof step.confirm === "boolean" ? step.confirm : undefined,
            output:
                isRecord(step.output) &&
                    "as" in step.output &&
                    typeof step.output.as === "string"
                    ? { as: step.output.as }
                    : undefined,
            onFailure: normalizeFailureStrategy(step.onFailure),
            condition: normalizeStepCondition(step.condition),
            ...(thenTree.steps && thenTree.steps.length > 0 ? { thenSteps: thenTree.steps } : {}),
            ...(elseTree.steps && elseTree.steps.length > 0 ? { elseSteps: elseTree.steps } : {}),
            ...(repeatTree.steps && repeatTree.steps.length > 0 ? { repeatSteps: repeatTree.steps } : {}),
        });
    }

    return { steps: repairedSteps, invalidSteps };
}

function validateAndRepairGeneratedShortcut(
    raw: GeneratedShortcut,
): GeneratedShortcut {
    const stepsRaw: unknown[] = Array.isArray(raw.steps) ? raw.steps : [];
    const { steps: repairedSteps, invalidSteps } = repairGeneratedStepTree(stepsRaw, "steps");

    if (repairedSteps.length === 0) {
        throw new Error(
            `AI generated unsupported steps only. Unsupported: ${invalidSteps.join(", ")}`,
        );
    }
    if (invalidSteps.length > 0) {
        throw new Error(
            `AI generated unsupported steps. Unsupported: ${invalidSteps.join(", ")}`,
        );
    }

    return {
        ...raw,
        name: String(raw.name ?? "AI Generated Shortcut").trim() || "AI Generated Shortcut",
        description: String(raw.description ?? "").trim(),
        steps: repairedSteps,
        inputs: normalizeGeneratedInputs(raw.inputs),
    };
}

/**
 * Generate a shortcut from natural language description.
 *
 * Flow:
 *   1. User types "Send USDC to someone with balance check"
 *   2. Client POSTs to /api/chat with provider config
 *   3. Server calls the LLM through the shared AI SDK model factory
 *   4. Client receives raw text, parses JSON, validates/repairs
 */
export async function generateShortcut(
    config: LLMConfig,
    prompt: string,
): Promise<GeneratedShortcut> {
    const userPrompt = `Generate a Bavium shortcut graph for: "${prompt}"

Include appropriate inputs, validation steps, confirmations, and branching when needed.
Use structured condition objects and nested thenSteps/elseSteps for logic.if_else flows.
Use repeatSteps for logic.repeat and logic.repeat_each flows.
Keep product boundaries explicit: swap is currently a single-pool Uniswap v3 flow on Base, bridge is currently read-only Across planning/tracking, Morpho is limited to the supported Base mainnet USDC vault, Clanker is the preset WETH launch path, Base share tools only prepare copy/links, and x402 is currently Bazaar discovery only.`;
    const raw = await requestStructuredOutput(
        config,
        userPrompt,
        isGeneratedShortcut,
        "shortcut",
    );
    return validateAndRepairGeneratedShortcut(raw);
}

/**
 * Generate an automation draft (trigger + action) from natural language.
 */
export async function generateAutomation(
    config: LLMConfig,
    prompt: string,
): Promise<GeneratedAutomation> {
    const userPrompt = `Generate one Bavium automation JSON object for this request: "${prompt}".

Rules:
- Trigger types: "price_below", "price_above", "scheduled"
- Action types: "swap", "send", "notify"
- The action describes the intended linked shortcut behavior. The app will still ask the user to choose a saved shortcut that performs it.
- For scheduled trigger, use valid 5-field cron (e.g. "0 9 * * *")
- Token symbols should be Base-oriented and uppercase (ETH, USDC, WETH, DAI, AERO, DEGEN)
- Prefer a notify action when the requested workflow is unclear.
- Do not imply unsupported execution paths such as bridge submission, multi-DEX swap routing, or non-Morpho Base vault actions.
- Return only valid JSON. Do not use Markdown.

Required shape:
{
  "name": "Short human label",
  "trigger": { "type": "price_below", "token": "ETH", "priceUsd": 2000 },
  "action": { "type": "notify", "channel": "webhook", "target": "linked-shortcut", "message": "What the linked shortcut should do" },
  "maxExecutions": 10
}`;
    const raw = await requestStructuredOutput(
        config,
        userPrompt,
        isGeneratedAutomation,
        "automation",
    );
    return validateAndRepairGeneratedAutomation(raw);
}

function buildStoredProviderConfig(
    provider: LLMProvider,
    providers: Record<string, unknown> | undefined,
): LLMConfig | null {
    const raw = providers?.[provider];
    if (!isRecord(raw)) return null;

    const apiKey = String(raw.apiKey ?? "").trim();
    if (!apiKey) return null;

    const providerDef = getLLMProviderDefinition(provider);
    const model = String(raw.model ?? "").trim() || providerDef.defaultModel;
    const baseUrl = String(raw.baseUrl ?? "").trim() || providerDef.baseUrl || "";

    return {
        provider,
        apiKey,
        model,
        baseUrl: baseUrl || undefined,
    };
}

/**
 * Get LLM config from localStorage.
 * Returns null if not configured.
 */
export async function getLLMConfig(): Promise<LLMConfig | null> {
    if (typeof window === "undefined") return null;

    try {
        const loaded = await loadStoredSettings();
        const settings = loaded.settings;
        if (!settings) return null;
        if (!isRecord(settings)) return null;

        // New structure: settings.llm.defaultProvider + settings.llm.providers
        const llm = settings.llm;
        if (isRecord(llm)) {
            const defaultProviderRaw = llm.defaultProvider;
            const defaultProvider: LLMProvider = isLLMProvider(defaultProviderRaw)
                ? defaultProviderRaw
                : "openai";

            const providers = llm.providers;
            if (!isRecord(providers)) return null;

            const providerPriority: LLMProvider[] = [
                defaultProvider,
                ...LLM_FALLBACK_ORDER.filter((provider) => provider !== defaultProvider),
            ];
            const configuredProviders = providerPriority
                .map((provider) => buildStoredProviderConfig(provider, providers))
                .filter((candidate): candidate is LLMConfig => Boolean(candidate));
            const primary = configuredProviders[0];
            if (!primary) return null;

            primary.fallbacks = configuredProviders.slice(1);

            return primary;
        }

        // Legacy structure fallback: llmProvider + llmApiKey
        if ("llmProvider" in settings && "llmApiKey" in settings) {
            const provider = String(settings.llmProvider);
            const apiKey = String(settings.llmApiKey).trim();
            if (!provider || !apiKey) return null;
            return {
                provider: isLLMProvider(provider) ? provider : "openai",
                apiKey,
            };
        }
        return null;
    } catch {
        return null;
    }
}
