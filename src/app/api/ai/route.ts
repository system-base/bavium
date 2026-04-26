/* ==========================================================================
   API Route: /api/ai
   Streaming AI chat endpoint powered by Vercel AI SDK.

   - Uses streamText for SSE streaming responses
   - BYOK: user's API key arrives in request body, used in memory only
   - System prompt built server-side from skill-manifest
   - Compatible with useChat hook via DefaultChatTransport
   - Tools: skill catalog, shortcut search (auth-gated)
   ========================================================================== */

import { type NextRequest, NextResponse } from "next/server";
import {
    streamText,
    convertToModelMessages,
    type UIMessage,
    type Tool,
} from "ai";
import { z } from "zod/v4";
import { requireSameOrigin, getSessionFromRequest } from "@/lib/api-middleware";
import { buildPlannerSystemPrompt } from "@/lib/skill-manifest";
import { SKILL_PALETTE, type BlockCategory, type SkillDefinition } from "@/lib/constants";
import {
    isLLMProvider,
    type LLMProvider,
} from "@/lib/llm-provider-registry";
import {
    consumeBestEffortRateLimit,
    getRequestClientKey,
} from "@/lib/server-rate-limit";
import {
    listSavedShortcutsPaginatedFromConvex,
    getSavedShortcutFromConvex,
    createSavedShortcutInConvex,
    hasConvexBackend,
    type Id,
} from "@/lib/convex-server";
import type { FailureStrategy, ShortcutInput } from "@/engine/types";
import {
    sanitizeBuilderAIContextSnapshot,
    summarizeBuilderAIContextForPrompt,
    type BuilderAIContextSnapshot,
} from "@/lib/builder-ai-context";
import { createAIModelFromConfig } from "@/lib/server-ai-model";

const SYSTEM_PROMPT = buildPlannerSystemPrompt();

type SavedShortcutCreatePayload = Parameters<typeof createSavedShortcutInConvex>[0];
type SavedShortcutCreateStep = SavedShortcutCreatePayload["steps"][number];
type AIClientAuthState =
    | "loading"
    | "disconnected"
    | "connected_unauthenticated"
    | "authenticated"
    | "error";

interface AIClientAuthContext {
    state: AIClientAuthState;
    walletConnected: boolean;
}

function buildAIChatSystemPrompt(
    builderContext: BuilderAIContextSnapshot | null,
    authContext: AIClientAuthContext,
    ownerAddress: string | null,
): string {
    const toolRules = `Chat endpoint rules:
- You have tools. For "create", "build", "generate", "draft", "add steps", "modify", or "update shortcut" requests, call generateShortcutDraft instead of printing raw JSON.
- Treat the JSON structure in the planner instructions as the content shape for generateShortcutDraft tool input, not as a user-visible final answer.
- Use createShortcut only when the user explicitly asks to save directly without Builder review.
- If current Builder draft context is present and the user asks to modify, add, remove, or continue, base the generated draft on that current draft.
- Return a complete draft through generateShortcutDraft. The client applies it only after the user reviews it in Builder.
- For generateShortcutDraft, say the draft is prepared for review. Do not claim it is saved, created in the database, or loaded in Builder.
- Do not say a shortcut is saved unless createShortcut returns success.
- Ask a concise follow-up when required addresses, amounts, tokens, or conditions are missing and cannot safely be represented as shortcut inputs.
 - Keep product boundaries explicit: swap is currently a single-pool Uniswap v3 flow, bridge is currently read-only Across planning/tracking, Morpho is limited to the supported Base mainnet USDC vault, Clanker is the preset WETH path, Base share tools only prepare copy/links, and x402 is currently Bazaar discovery only.`;

    const authRules = `Wallet/session context:
- Client wallet state: ${authContext.state}. Wallet connected in the client: ${authContext.walletConnected ? "yes" : "no"}.
- Server-authenticated wallet for private tools: ${ownerAddress ? "yes" : "no"}.
- General chat and draft generation can work without a wallet.
- Saving, running, searching saved shortcuts, and loading private shortcut details require a connected and signed-in wallet.
- If the user asks to save or run while disconnected, tell them to connect a wallet from the header.
- If the user asks to save or run while connected but not server-authenticated, tell them to sign in from the header.
- Treat the server-authenticated wallet state as the source of truth for private tools.`;

    if (!builderContext || builderContext.blocks.length === 0) {
        return `${SYSTEM_PROMPT}\n\n${toolRules}\n\n${authRules}`;
    }

    const currentDraft = JSON.stringify(
        summarizeBuilderAIContextForPrompt(builderContext),
        null,
        2,
    );

    return `${SYSTEM_PROMPT}\n\n${toolRules}\n\n${authRules}\n\nCurrent Builder draft context:\n${currentDraft}`;
}

// ---------------------------------------------------------------------------
// Tools — server-executed, results streamed back to client
// ---------------------------------------------------------------------------

type SkillCatalogInput = {
    category?:
        | "wallet"
        | "swap"
        | "bridge"
        | "defi"
        | "nft"
        | "social"
        | "data"
        | "x402"
        | "logic"
        | "all";
};

type SkillSummary = {
    id: string;
    label: string;
    description: string;
    category: string;
    tier: string;
    params: { key: string; label: string; type: string; required: boolean }[];
};

const listSkillsTool: Tool<SkillCatalogInput, SkillSummary[]> = {
    description:
        "List available Bavium skills/actions that can be used in shortcuts. " +
        "Call when the user asks what actions are available or what the builder can do.",
    inputSchema: z.object({
        category: z
            .enum([
                "wallet",
                "swap",
                "bridge",
                "defi",
                "nft",
                "social",
                "data",
                "x402",
                "logic",
                "all",
            ])
            .optional()
            .describe(
                "Filter by skill category. Omit or use 'all' for everything.",
            ),
    }),
    execute: async ({ category }) => {
        const filtered =
            !category || category === "all"
                ? SKILL_PALETTE
                : SKILL_PALETTE.filter((s) => s.category === category);

        return filtered.map((s) => ({
            id: s.id,
            label: s.label,
            description: s.description,
            category: s.category,
            tier: s.tier,
            params: s.params.map((p) => ({
                key: p.key,
                label: p.label,
                type: p.type,
                required: p.required,
            })),
        }));
    },
};

type ShortcutSearchInput = {
    query?: string;
};

type ShortcutSummary = {
    id: string;
    name: string;
    description: string;
    category: string;
    stepCount: number;
};

function buildSearchShortcutsTool(
    ownerAddress: string | null,
): Tool<ShortcutSearchInput, ShortcutSummary[]> {
    return {
        description:
            "Search the user's saved shortcuts by name or keyword. " +
            "Use when the user mentions an existing shortcut with @ or asks to edit/view one. " +
            "Returns a list of matching shortcuts with their IDs.",
        inputSchema: z.object({
            query: z
                .string()
                .optional()
                .describe(
                    "Search term to filter shortcuts by name. Leave empty to list recent shortcuts.",
                ),
        }),
        execute: async ({ query }) => {
            if (!ownerAddress || !hasConvexBackend()) {
                return [];
            }

            try {
                const result = await listSavedShortcutsPaginatedFromConvex(
                    ownerAddress,
                    { numItems: 20, cursor: null },
                );

                type PageItem = (typeof result.page)[number];
                let items: PageItem[] = result.page;

                if (query) {
                    const lower = query.toLowerCase();
                    items = items.filter(
                        (s) =>
                            s.name.toLowerCase().includes(lower) ||
                            (s.description ?? "").toLowerCase().includes(lower),
                    );
                }

                return items.map((s) => ({
                    id: s._id as string,
                    name: s.name,
                    description: s.description ?? "",
                    category: s.category,
                    stepCount: Array.isArray(s.steps) ? s.steps.length : 0,
                }));
            } catch {
                return [];
            }
        },
    };
}

type ShortcutDetailInput = {
    shortcutId: string;
};

type ShortcutDetail = {
    id: string;
    name: string;
    description: string;
    category: string;
    steps: unknown[];
    inputs: unknown[];
};

function buildGetShortcutDetailTool(
    ownerAddress: string | null,
): Tool<ShortcutDetailInput, ShortcutDetail | null> {
    return {
        description:
            "Get the full details of a saved shortcut by ID, including all steps and inputs. " +
            "Use after searchShortcuts to inspect a specific shortcut the user wants to edit or understand.",
        inputSchema: z.object({
            shortcutId: z
                .string()
                .describe("The ID of the shortcut to retrieve."),
        }),
        execute: async ({ shortcutId }) => {
            if (!ownerAddress || !hasConvexBackend()) {
                return null;
            }

            try {
                const shortcut = await getSavedShortcutFromConvex(
                    ownerAddress,
                    shortcutId as Id<"saved_shortcuts">,
                );
                if (!shortcut) return null;

                return {
                    id: shortcut._id as string,
                    name: shortcut.name,
                    description: shortcut.description ?? "",
                    category: shortcut.category,
                    steps: shortcut.steps as unknown[],
                    inputs: (shortcut.inputs ?? []) as unknown[],
                };
            } catch {
                return null;
            }
        },
    };
}

// ---------------------------------------------------------------------------
// Write tool: Generate shortcut draft for Builder
// ---------------------------------------------------------------------------

type ShortcutStepParamValue = string | number | boolean | null;

type ShortcutStepInput = {
    id?: string;
    skill: string;
    action: string;
    dependsOn?: string[];
    params: Record<string, ShortcutStepParamValue>;
    confirm?: boolean;
    output?: { as?: string };
    outputAs?: string;
    onFailure?: FailureStrategy;
    condition?: string | Record<string, unknown>;
    thenSteps?: ShortcutStepInput[];
    elseSteps?: ShortcutStepInput[];
    repeatSteps?: ShortcutStepInput[];
};

type ShortcutDraftInput = {
    name: string;
    description: string;
    category: BlockCategory;
    inputs?: ShortcutInput[];
    steps: ShortcutStepInput[];
};

type ShortcutDraftOutput = {
    success: boolean;
    name: string;
    category?: BlockCategory;
    stepCount: number;
    steps: ShortcutStepInput[];
    inputs?: ShortcutInput[];
    message: string;
};

const MAX_SHORTCUT_DRAFT_DEPTH = 8;
const MAX_SHORTCUT_DRAFT_STEPS = 80;

interface ShortcutStepNormalizationState {
    count: number;
    depthWarningAdded: boolean;
    countWarningAdded: boolean;
    usedStepIds: Set<string>;
}

function createShortcutStepNormalizationState(): ShortcutStepNormalizationState {
    return {
        count: 0,
        depthWarningAdded: false,
        countWarningAdded: false,
        usedStepIds: new Set<string>(),
    };
}

const blockCategorySchema = z.enum([
    "wallet",
    "swap",
    "bridge",
    "defi",
    "nft",
    "social",
    "data",
    "x402",
    "logic",
]);

const shortcutInputSchema = z.object({
    id: z.string(),
    label: z.string(),
    type: z.enum([
        "address",
        "amount",
        "text",
        "token",
        "boolean",
        "select",
        "number",
    ]),
    required: z.boolean(),
    placeholder: z.string().optional(),
    default: z.string().optional(),
    constraints: z.object({
        min: z.string().optional(),
        max: z.string().optional(),
        token: z.string().optional(),
        options: z
            .array(z.object({ label: z.string(), value: z.string() }))
            .optional(),
    }).optional(),
});

const failureStrategySchema = z.union([
    z.literal("abort"),
    z.literal("continue"),
    z.string().regex(/^retry\(\d+\)$/),
]) as z.ZodType<FailureStrategy>;

const conditionSchema = z.union([
    z.string(),
    z.record(z.string(), z.unknown()),
]);

const shortcutStepInputSchema: z.ZodType<ShortcutStepInput> = z.lazy(() =>
    z.object({
        id: z.string().optional(),
        skill: z.string(),
        action: z.string(),
        dependsOn: z.array(z.string()).optional(),
        params: z.record(
            z.string(),
            z.union([z.string(), z.number(), z.boolean(), z.null()]),
        ),
        confirm: z.boolean().optional(),
        output: z.object({ as: z.string().optional() }).optional(),
        outputAs: z.string().optional(),
        onFailure: failureStrategySchema.optional(),
        condition: conditionSchema.optional(),
        thenSteps: z.array(shortcutStepInputSchema).max(MAX_SHORTCUT_DRAFT_STEPS).optional(),
        elseSteps: z.array(shortcutStepInputSchema).max(MAX_SHORTCUT_DRAFT_STEPS).optional(),
        repeatSteps: z.array(shortcutStepInputSchema).max(MAX_SHORTCUT_DRAFT_STEPS).optional(),
    }),
);

function findSkillDefinition(skillId: string): SkillDefinition | undefined {
    return SKILL_PALETTE.find((skill) => skill.id === skillId);
}

function readOutputAs(step: ShortcutStepInput): string | undefined {
    const outputAs = step.output?.as?.trim() || step.outputAs?.trim();
    return outputAs ? outputAs.slice(0, 80) : undefined;
}

function normalizeCondition(
    condition: ShortcutStepInput["condition"],
): ShortcutStepInput["condition"] | undefined {
    if (typeof condition === "string") {
        const trimmed = condition.trim();
        return trimmed ? trimmed : undefined;
    }

    return condition;
}

function normalizeStepParams(
    skill: SkillDefinition,
    params: Record<string, ShortcutStepParamValue>,
    stepId: string,
    warnings: string[],
): Record<string, ShortcutStepParamValue> {
    const allowedKeys = new Set(skill.params.map((param) => param.key));
    const normalized: Record<string, ShortcutStepParamValue> = {};
    const invalidKeys: string[] = [];

    for (const [key, value] of Object.entries(params)) {
        if (!allowedKeys.has(key)) {
            invalidKeys.push(key);
            continue;
        }

        normalized[key] = value;
    }

    if (invalidKeys.length > 0) {
        warnings.push(
            `${stepId}: ignored unsupported param keys ${invalidKeys.join(", ")}.`,
        );
    }

    const missingRequired = skill.params
        .filter((param) => param.required && normalized[param.key] === undefined)
        .map((param) => param.key);

    if (missingRequired.length > 0) {
        warnings.push(
            `${stepId}: missing required params ${missingRequired.join(", ")}.`,
        );
    }

    return normalized;
}

function allocateShortcutStepId(
    requestedId: string | undefined,
    fallbackId: string,
    warnings: string[],
    state: ShortcutStepNormalizationState,
): string {
    const baseId = requestedId?.trim() || fallbackId;
    if (!state.usedStepIds.has(baseId)) {
        state.usedStepIds.add(baseId);
        return baseId;
    }

    let counter = 2;
    let candidate = `${baseId}-${counter}`;
    while (state.usedStepIds.has(candidate)) {
        counter += 1;
        candidate = `${baseId}-${counter}`;
    }

    state.usedStepIds.add(candidate);
    warnings.push(`${baseId}: duplicate step id was renamed to ${candidate}.`);
    return candidate;
}

function normalizeShortcutStep(
    step: ShortcutStepInput,
    fallbackId: string,
    warnings: string[],
    depth: number,
    state: ShortcutStepNormalizationState,
): ShortcutStepInput | null {
    if (depth > MAX_SHORTCUT_DRAFT_DEPTH) {
        if (!state.depthWarningAdded) {
            warnings.push(
                `Nested steps deeper than ${MAX_SHORTCUT_DRAFT_DEPTH} levels were ignored.`,
            );
            state.depthWarningAdded = true;
        }
        return null;
    }

    if (state.count >= MAX_SHORTCUT_DRAFT_STEPS) {
        if (!state.countWarningAdded) {
            warnings.push(
                `Only the first ${MAX_SHORTCUT_DRAFT_STEPS} generated steps were kept.`,
            );
            state.countWarningAdded = true;
        }
        return null;
    }

    const skillId = `${step.skill}.${step.action}`;
    const skill = findSkillDefinition(skillId);
    if (!skill) {
        warnings.push(`${fallbackId}: unsupported skill ${skillId}.`);
        return null;
    }

    state.count += 1;

    const id = allocateShortcutStepId(step.id, fallbackId, warnings, state);
    const outputAs = readOutputAs(step);
    const condition = normalizeCondition(step.condition);
    const thenSteps = normalizeShortcutSteps(step.thenSteps ?? [], `${id}-then`, warnings, depth + 1, state);
    const elseSteps = normalizeShortcutSteps(step.elseSteps ?? [], `${id}-else`, warnings, depth + 1, state);
    const repeatSteps = normalizeShortcutSteps(step.repeatSteps ?? [], `${id}-repeat`, warnings, depth + 1, state);
    const dependsOn = (step.dependsOn ?? [])
        .map((dependency) => dependency.trim())
        .filter(Boolean);

    return {
        id,
        skill: step.skill,
        action: step.action,
        ...(dependsOn.length ? { dependsOn } : {}),
        params: normalizeStepParams(skill, step.params, id, warnings),
        ...(typeof step.confirm === "boolean" ? { confirm: step.confirm } : {}),
        ...(outputAs ? { output: { as: outputAs } } : {}),
        ...(step.onFailure ? { onFailure: step.onFailure } : {}),
        ...(condition !== undefined ? { condition } : {}),
        ...(thenSteps.length ? { thenSteps } : {}),
        ...(elseSteps.length ? { elseSteps } : {}),
        ...(repeatSteps.length ? { repeatSteps } : {}),
    };
}

function normalizeShortcutSteps(
    steps: ShortcutStepInput[],
    idPrefix: string,
    warnings: string[],
    depth = 0,
    state = createShortcutStepNormalizationState(),
): ShortcutStepInput[] {
    const normalized: ShortcutStepInput[] = [];

    for (const [index, step] of steps.entries()) {
        const nextStep = normalizeShortcutStep(
            step,
            `${idPrefix}-${index + 1}`,
            warnings,
            depth,
            state,
        );

        if (nextStep) {
            normalized.push(nextStep);
        }

        if (state.count >= MAX_SHORTCUT_DRAFT_STEPS) {
            if (!state.countWarningAdded) {
                warnings.push(
                    `Only the first ${MAX_SHORTCUT_DRAFT_STEPS} generated steps were kept.`,
                );
                state.countWarningAdded = true;
            }
            break;
        }
    }

    return normalized;
}

function collectShortcutStepIds(
    steps: ShortcutStepInput[],
    ids = new Set<string>(),
): Set<string> {
    for (const step of steps) {
        if (step.id) ids.add(step.id);
        if (step.thenSteps) collectShortcutStepIds(step.thenSteps, ids);
        if (step.elseSteps) collectShortcutStepIds(step.elseSteps, ids);
        if (step.repeatSteps) collectShortcutStepIds(step.repeatSteps, ids);
    }
    return ids;
}

function validateShortcutStepDependencies(
    steps: ShortcutStepInput[],
    warnings: string[],
    knownIds = collectShortcutStepIds(steps),
): ShortcutStepInput[] {
    return steps.map((step) => {
        const invalidDependencies: string[] = [];
        const dependsOn = (step.dependsOn ?? [])
            .map((dependency) => dependency.trim())
            .filter((dependency) => {
                const valid =
                    dependency.length > 0 &&
                    dependency !== step.id &&
                    knownIds.has(dependency);
                if (!valid && dependency.length > 0) {
                    invalidDependencies.push(dependency);
                }
                return valid;
            });

        if (invalidDependencies.length > 0) {
            warnings.push(
                `${step.id ?? "step"}: ignored unknown dependencies ${invalidDependencies.join(", ")}.`,
            );
        }

        const nextStep: ShortcutStepInput = { ...step };
        if (dependsOn.length) {
            nextStep.dependsOn = dependsOn;
        } else {
            delete nextStep.dependsOn;
        }

        if (step.thenSteps?.length) {
            nextStep.thenSteps = validateShortcutStepDependencies(step.thenSteps, warnings, knownIds);
        }
        if (step.elseSteps?.length) {
            nextStep.elseSteps = validateShortcutStepDependencies(step.elseSteps, warnings, knownIds);
        }
        if (step.repeatSteps?.length) {
            nextStep.repeatSteps = validateShortcutStepDependencies(step.repeatSteps, warnings, knownIds);
        }

        return nextStep;
    });
}

function normalizeAndValidateShortcutSteps(
    steps: ShortcutStepInput[],
    idPrefix: string,
    warnings: string[],
): ShortcutStepInput[] {
    const normalizedSteps = normalizeShortcutSteps(steps, idPrefix, warnings);
    return validateShortcutStepDependencies(normalizedSteps, warnings);
}

function buildDraftReadyMessage(
    name: string,
    stepCount: number,
    warnings: string[],
): string {
    const warningText = warnings.length
        ? ` Review notes: ${warnings.slice(0, 3).join(" ")}`
        : "";

    return `Shortcut "${name}" with ${stepCount} steps is ready. Click "Open in Builder" to review and save.${warningText}`;
}

const generateShortcutDraftTool: Tool<
    ShortcutDraftInput,
    ShortcutDraftOutput
> = {
    description:
        "Generate a shortcut draft that the user can open in the Builder to review, edit, and save. " +
        "Use this when the user asks you to create, build, or generate a shortcut. " +
        "Each step must use a valid skill ID from the Bavium skill catalog. " +
        "The result will be shown as a preview card with an 'Open in Builder' button.",
    inputSchema: z.object({
        name: z.string().describe("A descriptive name for the shortcut"),
        description: z
            .string()
            .describe("Brief description of what the shortcut does"),
        category: blockCategorySchema
            .describe("Primary category of the shortcut"),
        inputs: z
            .array(shortcutInputSchema)
            .optional()
            .describe("Run-start inputs referenced as {{input.id}} in step params."),
        steps: z
            .array(shortcutStepInputSchema)
            .max(MAX_SHORTCUT_DRAFT_STEPS)
            .describe("Ordered list of steps in the shortcut"),
    }),
    execute: async ({ name, category, inputs, steps }) => {
        const warnings: string[] = [];
        const validSteps = normalizeAndValidateShortcutSteps(steps, "step", warnings);

        if (validSteps.length === 0) {
            return {
                success: false,
                name,
                category,
                stepCount: 0,
                steps: [],
                inputs: inputs ?? [],
                message:
                    "No valid steps could be generated. The skill IDs did not match the catalog.",
            };
        }

        return {
            success: true,
            name,
            category,
            stepCount: validSteps.length,
            steps: validSteps,
            inputs: inputs ?? [],
            message: buildDraftReadyMessage(name, validSteps.length, warnings),
        };
    },
};

// ---------------------------------------------------------------------------
// Write tool: Save shortcut directly to Convex (auth-gated)
// ---------------------------------------------------------------------------

type CreateShortcutInput = {
    name: string;
    description: string;
    category: BlockCategory;
    inputs?: ShortcutInput[];
    steps: ShortcutStepInput[];
};

type CreateShortcutOutput = {
    success: boolean;
    shortcutId?: string;
    message: string;
};

function buildCreateShortcutTool(
    ownerAddress: string | null,
    authContext: AIClientAuthContext,
): Tool<CreateShortcutInput, CreateShortcutOutput> {
    return {
        description:
            "Save a shortcut directly to the user's account in the database. " +
            "Use this ONLY when the user explicitly asks to save/create a shortcut immediately, " +
            "without wanting to review it first in the Builder. " +
            "Each step must use a valid skill ID from the Bavium skill catalog.",
        inputSchema: z.object({
            name: z.string().describe("A descriptive name for the shortcut"),
            description: z
                .string()
                .describe("Brief description of what the shortcut does"),
            category: blockCategorySchema
                .describe("Primary category of the shortcut"),
            inputs: z
                .array(shortcutInputSchema)
                .optional()
                .describe("Run-start inputs referenced as {{input.id}} in step params."),
            steps: z
                .array(shortcutStepInputSchema)
                .max(MAX_SHORTCUT_DRAFT_STEPS)
                .describe("Ordered list of steps"),
        }),
        execute: async ({ name, description, category, inputs, steps }) => {
            if (!ownerAddress) {
                return {
                    success: false,
                    message:
                        authContext.state === "connected_unauthenticated"
                            ? "Your wallet is connected, but you need to sign in from the header before saving workflows."
                            : "You need to connect your wallet and sign in before saving workflows.",
                };
            }

            if (!hasConvexBackend()) {
                return {
                    success: false,
                    message: "Backend is not configured.",
                };
            }

            const warnings: string[] = [];
            const validSteps = normalizeAndValidateShortcutSteps(steps, "step", warnings);

            if (validSteps.length === 0) {
                return {
                    success: false,
                    message:
                        "No valid steps could be created. The skill IDs did not match the catalog.",
                };
            }

            const toConvexStep = (s: ShortcutStepInput, i: number): SavedShortcutCreateStep => ({
                id: s.id ?? `step-${i + 1}`,
                skill: s.skill,
                action: s.action,
                params: s.params,
                ...(s.dependsOn?.length ? { dependsOn: s.dependsOn } : {}),
                ...(s.confirm !== undefined ? { confirm: s.confirm } : {}),
                ...(s.output?.as ? { output: { as: s.output.as } } : {}),
                ...(s.onFailure ? { onFailure: s.onFailure } : {}),
                ...(s.condition ? { condition: s.condition as SavedShortcutCreateStep["condition"] } : {}),
                ...(s.thenSteps?.length
                    ? { thenSteps: s.thenSteps.map(toConvexStep) }
                    : {}),
                ...(s.elseSteps?.length
                    ? { elseSteps: s.elseSteps.map(toConvexStep) }
                    : {}),
                ...(s.repeatSteps?.length
                    ? { repeatSteps: s.repeatSteps.map(toConvexStep) }
                    : {}),
            });

            const convexSteps = validSteps.map(toConvexStep);

            try {
                const shortcutId = await createSavedShortcutInConvex({
                    ownerAddress,
                    name,
                    description,
                    category,
                    inputs: inputs ?? [],
                    steps: convexSteps,
                });

                return {
                    success: true,
                    shortcutId: shortcutId as string,
                    message: `Shortcut "${name}" saved successfully with ${convexSteps.length} steps. You can find it in your Shortcuts page.${warnings.length ? ` Review notes: ${warnings.slice(0, 3).join(" ")}` : ""}`,
                };
            } catch (err) {
                const msg =
                    err instanceof Error ? err.message : "Save failed.";
                return {
                    success: false,
                    message: `Failed to save shortcut: ${msg}`,
                };
            }
        },
    };
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

interface AIRequestBody {
    messages: UIMessage[];
    provider: LLMProvider;
    model: string;
    apiKey: string;
    baseUrl?: string;
    builderContext: BuilderAIContextSnapshot | null;
    authContext: AIClientAuthContext;
}

const AI_CLIENT_AUTH_STATES: AIClientAuthState[] = [
    "loading",
    "disconnected",
    "connected_unauthenticated",
    "authenticated",
    "error",
];

function validateAuthContext(raw: unknown): AIClientAuthContext {
    if (typeof raw !== "object" || raw === null) {
        return { state: "disconnected", walletConnected: false };
    }

    const record = raw as Record<string, unknown>;
    const rawState = record.state;
    const state: AIClientAuthState = typeof rawState === "string" &&
        AI_CLIENT_AUTH_STATES.includes(rawState as AIClientAuthState)
        ? rawState as AIClientAuthState
        : "disconnected";

    return {
        state,
        walletConnected: record.walletConnected === true,
    };
}

function validateBody(raw: unknown): AIRequestBody | null {
    if (typeof raw !== "object" || raw === null) return null;
    const b = raw as Record<string, unknown>;

    const messages = b.messages;
    if (!Array.isArray(messages) || messages.length === 0) return null;

    const provider = typeof b.provider === "string" ? b.provider : "";
    const model = typeof b.model === "string" ? b.model.trim() : "";
    const apiKey = typeof b.apiKey === "string" ? b.apiKey.trim() : "";
    const baseUrl =
        typeof b.baseUrl === "string" ? b.baseUrl.trim() : undefined;
    const builderContext = sanitizeBuilderAIContextSnapshot(b.builderContext);
    const authContext = validateAuthContext(b.authContext);

    if (!provider || !apiKey) return null;
    if (!isLLMProvider(provider)) return null;

    return {
        messages: messages as UIMessage[],
        provider,
        model,
        apiKey,
        baseUrl,
        builderContext,
        authContext,
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
        bucket: "ai-stream",
        key: clientKey,
        windowMs: 60_000,
        max: 15,
    });

    if (!allowed) {
        return NextResponse.json(
            {
                error: `Too many requests. Try again in ${retryAfterSeconds}s.`,
            },
            { status: 429 },
        );
    }

    let body: AIRequestBody;
    try {
        const raw: unknown = await request.json();
        const validated = validateBody(raw);
        if (!validated) {
            return NextResponse.json(
                {
                    error: "Invalid request. Provide messages, provider, and apiKey.",
                },
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

    const session = getSessionFromRequest(request);
    const ownerAddress = session?.address ?? null;

    try {
        const aiModel = createAIModelFromConfig(
            body.provider,
            body.model,
            body.apiKey,
            body.baseUrl,
        );

        const modelMessages = await convertToModelMessages(body.messages);

        const result = streamText({
            model: aiModel,
            system: buildAIChatSystemPrompt(
                body.builderContext,
                body.authContext,
                ownerAddress,
            ),
            messages: modelMessages,
            tools: {
                listSkills: listSkillsTool,
                searchShortcuts: buildSearchShortcutsTool(ownerAddress),
                getShortcutDetail: buildGetShortcutDetailTool(ownerAddress),
                generateShortcutDraft: generateShortcutDraftTool,
                createShortcut: buildCreateShortcutTool(ownerAddress, body.authContext),
            },
            maxOutputTokens: 2048,
            abortSignal: request.signal,
        });

        return result.toUIMessageStreamResponse({
            originalMessages: body.messages,
        });
    } catch (err) {
        const message =
            err instanceof Error ? err.message : "AI generation failed.";
        return NextResponse.json({ error: message }, { status: 502 });
    }
}
