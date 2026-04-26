import type {
    ConditionExpression,
    FailureStrategy,
    InputConstraints,
    InputType,
} from "@/engine/types";
import type { NetworkId } from "@/lib/chain-config";
import { CATEGORY_META, type BlockCategory } from "@/lib/constants";
import {
    ShortcutValidationError,
    validateShortcutDefinition,
} from "@/lib/shortcut-validation";
import type { FunctionArgs } from "convex/server";
import { api } from "../../convex/_generated/api";

const CATEGORY_VALUES = new Set<BlockCategory>(
    Object.keys(CATEGORY_META) as BlockCategory[],
);
const INPUT_TYPES = new Set<InputType>([
    "address",
    "amount",
    "text",
    "token",
    "boolean",
    "select",
    "number",
]);
const NETWORK_IDS = new Set<NetworkId>(["base-mainnet", "base-sepolia"]);
const FAILURE_STRATEGIES = new Set<FailureStrategy>(["abort", "continue"]);
const CONDITION_OPERATORS = new Set<ConditionExpression["operator"]>([
    "equals",
    "not_equals",
    "greater_than",
    "less_than",
    "greater_or_equal",
    "less_or_equal",
    "contains",
    "not_contains",
    "starts_with",
    "ends_with",
    "is_empty",
    "is_not_empty",
]);
const CONDITION_VALUE_TYPES = new Set<ConditionExpression["valueType"]>([
    "number",
    "string",
    "boolean",
]);

type ParseResult<T> =
    | { ok: true; value: T }
    | { ok: false; error: string };

type ShortcutCreateArgs = Omit<
    FunctionArgs<typeof api.shortcuts.create>,
    "serverSecret" | "ownerAddress"
>;
type ShortcutUpdateArgs = Omit<
    FunctionArgs<typeof api.shortcuts.update>,
    "serverSecret" | "ownerAddress" | "shortcutId"
>;
type ShortcutInputContract = ShortcutCreateArgs["inputs"][number];
type ShortcutStepContract = ShortcutCreateArgs["steps"][number];

export interface ShortcutCreateContract {
    name: string;
    description?: string;
    category: BlockCategory;
    inputs: ShortcutCreateArgs["inputs"];
    steps: ShortcutCreateArgs["steps"];
    version?: string;
    networkId?: NetworkId;
}

export interface ShortcutPatchContract {
    name?: string;
    description?: string;
    category?: BlockCategory;
    inputs?: ShortcutUpdateArgs["inputs"];
    steps?: ShortcutUpdateArgs["steps"];
    archivedAt?: ShortcutUpdateArgs["archivedAt"];
    networkId?: NetworkId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStepParamValue(value: unknown): boolean {
    if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
    ) {
        return true;
    }
    return false;
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isFailureStrategy(value: unknown): value is FailureStrategy {
    return (
        typeof value === "string" &&
        (FAILURE_STRATEGIES.has(value as FailureStrategy) || /^retry\(\d+\)$/.test(value))
    );
}

function isConditionExpression(value: unknown): value is ConditionExpression {
    if (!isRecord(value)) return false;
    if (typeof value.inputRef !== "string" || value.inputRef.trim().length === 0) return false;
    if (typeof value.operator !== "string" || !CONDITION_OPERATORS.has(value.operator as ConditionExpression["operator"])) {
        return false;
    }
    if (typeof value.valueType !== "string" || !CONDITION_VALUE_TYPES.has(value.valueType as ConditionExpression["valueType"])) {
        return false;
    }
    if (value.operator === "is_empty" || value.operator === "is_not_empty") {
        return value.compareValue === undefined || typeof value.compareValue === "string";
    }
    return typeof value.compareValue === "string";
}

function isInputConstraints(value: unknown): value is InputConstraints {
    if (!isRecord(value)) return false;
    if (value.min !== undefined && typeof value.min !== "string") return false;
    if (value.max !== undefined && typeof value.max !== "string") return false;
    if (value.token !== undefined && typeof value.token !== "string") return false;
    if (value.options !== undefined) {
        if (!Array.isArray(value.options)) return false;
        if (!value.options.every((option) =>
            isRecord(option) &&
            typeof option.label === "string" &&
            typeof option.value === "string"
        )) {
            return false;
        }
    }
    return true;
}

function isShortcutInput(value: unknown): value is ShortcutInputContract {
    return (
        isRecord(value) &&
        typeof value.id === "string" &&
        value.id.trim().length > 0 &&
        typeof value.label === "string" &&
        value.label.trim().length > 0 &&
        typeof value.type === "string" &&
        INPUT_TYPES.has(value.type as InputType) &&
        typeof value.required === "boolean" &&
        (value.placeholder === undefined || typeof value.placeholder === "string") &&
        (value.default === undefined || typeof value.default === "string") &&
        (value.constraints === undefined || isInputConstraints(value.constraints))
    );
}

function isStepOutput(value: unknown): value is { as: string } {
    return isRecord(value) && typeof value.as === "string" && value.as.trim().length > 0;
}

function isShortcutStep(value: unknown): value is ShortcutStepContract {
    if (!isRecord(value)) return false;
    if (typeof value.id !== "string" || value.id.trim().length === 0) return false;
    if (typeof value.skill !== "string" || value.skill.trim().length === 0) return false;
    if (typeof value.action !== "string" || value.action.trim().length === 0) return false;
    if (!isRecord(value.params) || !Object.values(value.params).every(isStepParamValue)) return false;
    if (value.dependsOn !== undefined && !isStringArray(value.dependsOn)) return false;
    if (value.confirm !== undefined && typeof value.confirm !== "boolean") return false;
    if (value.output !== undefined && !isStepOutput(value.output)) return false;
    if (value.onFailure !== undefined && !isFailureStrategy(value.onFailure)) return false;
    if (
        value.condition !== undefined &&
        typeof value.condition !== "string" &&
        !isConditionExpression(value.condition)
    ) {
        return false;
    }
    if (
        value.thenSteps !== undefined &&
        (!Array.isArray(value.thenSteps) || !value.thenSteps.every(isShortcutStep))
    ) {
        return false;
    }
    if (
        value.elseSteps !== undefined &&
        (!Array.isArray(value.elseSteps) || !value.elseSteps.every(isShortcutStep))
    ) {
        return false;
    }
    if (
        value.repeatSteps !== undefined &&
        (!Array.isArray(value.repeatSteps) || !value.repeatSteps.every(isShortcutStep))
    ) {
        return false;
    }
    return true;
}

function normalizeNetworkId(value: unknown): NetworkId | undefined {
    if (typeof value === "string" && NETWORK_IDS.has(value as NetworkId)) {
        return value as NetworkId;
    }
    return undefined;
}

function formatValidationError(error: unknown, fallback: string): string {
    if (error instanceof ShortcutValidationError) {
        return error.issues[0] ?? fallback;
    }
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return fallback;
}

export function parseShortcutCreateBody(body: unknown): ParseResult<ShortcutCreateContract> {
    if (!isRecord(body)) {
        return { ok: false, error: "Shortcut payload must be an object." };
    }

    if (typeof body.name !== "string" || body.name.trim().length === 0) {
        return { ok: false, error: "Shortcut name is required." };
    }

    if (typeof body.category !== "string" || !CATEGORY_VALUES.has(body.category as BlockCategory)) {
        return { ok: false, error: "Shortcut category is invalid." };
    }

    if (!Array.isArray(body.steps) || body.steps.length === 0 || !body.steps.every(isShortcutStep)) {
        return { ok: false, error: "Shortcut steps are invalid." };
    }

    if (body.inputs !== undefined && (!Array.isArray(body.inputs) || !body.inputs.every(isShortcutInput))) {
        return { ok: false, error: "Shortcut inputs are invalid." };
    }

    if (body.description !== undefined && typeof body.description !== "string") {
        return { ok: false, error: "Shortcut description must be a string." };
    }

    if (body.version !== undefined && (typeof body.version !== "string" || body.version.trim().length === 0)) {
        return { ok: false, error: "Shortcut version must be a non-empty string." };
    }

    const value: ShortcutCreateContract = {
        name: body.name.trim(),
        description: typeof body.description === "string" ? body.description.trim() : undefined,
        category: body.category as BlockCategory,
        inputs: (body.inputs as ShortcutCreateArgs["inputs"] | undefined) ?? [],
        steps: body.steps as ShortcutCreateArgs["steps"],
        version: typeof body.version === "string" ? body.version.trim() : undefined,
        networkId: normalizeNetworkId(body.networkId),
    };

    try {
        validateShortcutDefinition(
            {
                steps: value.steps as unknown as Parameters<typeof validateShortcutDefinition>[0]["steps"],
            },
            { networkId: value.networkId, enforceChainSupport: value.networkId !== undefined },
        );
    } catch (error) {
        return {
            ok: false,
            error: formatValidationError(error, "Shortcut steps failed validation."),
        };
    }

    return { ok: true, value };
}

export function parseShortcutPatchBody(body: unknown): ParseResult<ShortcutPatchContract> {
    if (!isRecord(body)) {
        return { ok: false, error: "Shortcut update payload must be an object." };
    }

    const value: ShortcutPatchContract = {
        networkId: normalizeNetworkId(body.networkId),
    };

    if (body.name !== undefined) {
        if (typeof body.name !== "string" || body.name.trim().length === 0) {
            return { ok: false, error: "Shortcut name must be a non-empty string." };
        }
        value.name = body.name.trim();
    }

    if (body.description !== undefined) {
        if (typeof body.description !== "string") {
            return { ok: false, error: "Shortcut description must be a string." };
        }
        value.description = body.description.trim();
    }

    if (body.category !== undefined) {
        if (typeof body.category !== "string" || !CATEGORY_VALUES.has(body.category as BlockCategory)) {
            return { ok: false, error: "Shortcut category is invalid." };
        }
        value.category = body.category as BlockCategory;
    }

    if (body.inputs !== undefined) {
        if (!Array.isArray(body.inputs) || !body.inputs.every(isShortcutInput)) {
            return { ok: false, error: "Shortcut inputs are invalid." };
        }
        value.inputs = body.inputs as ShortcutUpdateArgs["inputs"];
    }

    if (body.steps !== undefined) {
        if (!Array.isArray(body.steps) || body.steps.length === 0 || !body.steps.every(isShortcutStep)) {
            return { ok: false, error: "Shortcut steps are invalid." };
        }
        value.steps = body.steps as ShortcutUpdateArgs["steps"];
        try {
            validateShortcutDefinition(
                {
                    steps: value.steps as unknown as Parameters<typeof validateShortcutDefinition>[0]["steps"],
                },
                { networkId: value.networkId, enforceChainSupport: value.networkId !== undefined },
            );
        } catch (error) {
            return {
                ok: false,
                error: formatValidationError(error, "Shortcut steps failed validation."),
            };
        }
    }

    if (body.archivedAt !== undefined) {
        if (body.archivedAt !== null && typeof body.archivedAt !== "string") {
            return { ok: false, error: "archivedAt must be a string or null." };
        }
        value.archivedAt = body.archivedAt as string | null;
    }

    const hasWritableField = Object.keys(value).some((key) => key !== "networkId");
    if (!hasWritableField) {
        return { ok: false, error: "No valid shortcut fields were provided." };
    }

    return { ok: true, value };
}
