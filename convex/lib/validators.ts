import { v, type Validator } from "convex/values";

export const shortcutInputTypeValidator = v.union(
    v.literal("address"),
    v.literal("amount"),
    v.literal("text"),
    v.literal("token"),
    v.literal("boolean"),
    v.literal("select"),
    v.literal("number"),
);

const shortcutCategoryValues = [
    "wallet",
    "swap",
    "bridge",
    "defi",
    "nft",
    "social",
    "data",
    "x402",
    "logic",
] as const;

export type ShortcutCategory = typeof shortcutCategoryValues[number];

export const shortcutCategoryValidator = v.union(
    v.literal("wallet"),
    v.literal("swap"),
    v.literal("bridge"),
    v.literal("defi"),
    v.literal("nft"),
    v.literal("social"),
    v.literal("data"),
    v.literal("x402"),
    v.literal("logic"),
);

export function isShortcutCategoryValue(value: string): value is ShortcutCategory {
    return (shortcutCategoryValues as readonly string[]).includes(value);
}

export const shortcutConditionOperatorValidator = v.union(
    v.literal("equals"),
    v.literal("not_equals"),
    v.literal("greater_than"),
    v.literal("less_than"),
    v.literal("greater_or_equal"),
    v.literal("less_or_equal"),
    v.literal("contains"),
    v.literal("not_contains"),
    v.literal("starts_with"),
    v.literal("ends_with"),
    v.literal("is_empty"),
    v.literal("is_not_empty"),
);

export const shortcutConditionValueTypeValidator = v.union(
    v.literal("number"),
    v.literal("string"),
    v.literal("boolean"),
);

export const shortcutConditionValidator = v.union(
    v.string(),
    v.object({
        inputRef: v.string(),
        operator: shortcutConditionOperatorValidator,
        compareValue: v.string(),
        valueType: shortcutConditionValueTypeValidator,
    }),
);

export const shortcutFailureStrategyValidator = v.union(
    v.literal("abort"),
    v.literal("continue"),
    v.string(),
);

export const shortcutStepOutputValidator = v.object({
    as: v.string(),
});

const jsonPrimitiveValidator: Validator<unknown, "required", string> = v.union(
    v.string(),
    v.number(),
    v.boolean(),
    v.null(),
);

const jsonValueDepth0Validator: Validator<unknown, "required", string> = jsonPrimitiveValidator;
const jsonValueDepth1Validator: Validator<unknown, "required", string> = v.union(
    jsonPrimitiveValidator,
    v.array(jsonValueDepth0Validator),
    v.record(v.string(), jsonValueDepth0Validator),
);
const jsonValueDepth2Validator: Validator<unknown, "required", string> = v.union(
    jsonPrimitiveValidator,
    v.array(jsonValueDepth1Validator),
    v.record(v.string(), jsonValueDepth1Validator),
);
const jsonValueDepth3Validator: Validator<unknown, "required", string> = v.union(
    jsonPrimitiveValidator,
    v.array(jsonValueDepth2Validator),
    v.record(v.string(), jsonValueDepth2Validator),
);
const jsonValueDepth4Validator: Validator<unknown, "required", string> = v.union(
    jsonPrimitiveValidator,
    v.array(jsonValueDepth3Validator),
    v.record(v.string(), jsonValueDepth3Validator),
);
const jsonValueDepth5Validator: Validator<unknown, "required", string> = v.union(
    jsonPrimitiveValidator,
    v.array(jsonValueDepth4Validator),
    v.record(v.string(), jsonValueDepth4Validator),
);
const jsonValueDepth6Validator: Validator<unknown, "required", string> = v.union(
    jsonPrimitiveValidator,
    v.array(jsonValueDepth5Validator),
    v.record(v.string(), jsonValueDepth5Validator),
);
const jsonValueDepth7Validator: Validator<unknown, "required", string> = v.union(
    jsonPrimitiveValidator,
    v.array(jsonValueDepth6Validator),
    v.record(v.string(), jsonValueDepth6Validator),
);
const jsonValueDepth8Validator: Validator<unknown, "required", string> = v.union(
    jsonPrimitiveValidator,
    v.array(jsonValueDepth7Validator),
    v.record(v.string(), jsonValueDepth7Validator),
);

export const jsonValueValidator = jsonValueDepth8Validator;
export const runInputValuesValidator = v.record(v.string(), jsonValueValidator);

export const shortcutInputConstraintsValidator = v.object({
    min: v.optional(v.string()),
    max: v.optional(v.string()),
    token: v.optional(v.string()),
    options: v.optional(v.array(v.object({
        label: v.string(),
        value: v.string(),
    }))),
});

export const shortcutInputValidator = v.object({
    id: v.string(),
    label: v.string(),
    type: shortcutInputTypeValidator,
    required: v.boolean(),
    placeholder: v.optional(v.string()),
    default: v.optional(v.string()),
    constraints: v.optional(shortcutInputConstraintsValidator),
});

const nestedShortcutStepValidator = v.record(v.string(), jsonValueValidator);

export const shortcutStepValidator = v.object({
    id: v.string(),
    skill: v.string(),
    action: v.string(),
    dependsOn: v.optional(v.array(v.string())),
    params: v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.null())),
    confirm: v.optional(v.boolean()),
    output: v.optional(shortcutStepOutputValidator),
    onFailure: v.optional(shortcutFailureStrategyValidator),
    condition: v.optional(shortcutConditionValidator),
    // Convex does not provide a lightweight recursive validator here. Runtime
    // mutations still call assertShortcutStepsDeeplyValid for exact step-tree
    // validation; the schema keeps nested branches JSON-compatible and bounded.
    thenSteps: v.optional(v.array(nestedShortcutStepValidator)),
    elseSteps: v.optional(v.array(nestedShortcutStepValidator)),
    repeatSteps: v.optional(v.array(nestedShortcutStepValidator)),
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidParamValue(value: unknown): boolean {
    return (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null
    );
}

function isValidConditionValue(value: unknown): boolean {
    if (typeof value === "string") return true;
    if (!isPlainObject(value)) return false;

    return (
        typeof value.inputRef === "string" &&
        typeof value.operator === "string" &&
        typeof value.compareValue === "string" &&
        (value.valueType === "number" || value.valueType === "string" || value.valueType === "boolean")
    );
}

function validateShortcutStepNode(
    step: unknown,
    path: string,
): string[] {
    const issues: string[] = [];

    if (!isPlainObject(step)) {
        return [`${path} must be an object`];
    }

    if (typeof step.id !== "string" || step.id.trim().length === 0) {
        issues.push(`${path}.id must be a non-empty string`);
    }
    if (typeof step.skill !== "string" || step.skill.trim().length === 0) {
        issues.push(`${path}.skill must be a non-empty string`);
    }
    if (typeof step.action !== "string" || step.action.trim().length === 0) {
        issues.push(`${path}.action must be a non-empty string`);
    }

    if (!isPlainObject(step.params)) {
        issues.push(`${path}.params must be an object`);
    } else {
        for (const [key, value] of Object.entries(step.params)) {
            if (!isValidParamValue(value)) {
                issues.push(`${path}.params.${key} must be string, number, boolean, or null`);
            }
        }
    }

    if (step.dependsOn !== undefined) {
        if (!Array.isArray(step.dependsOn) || !step.dependsOn.every((value) => typeof value === "string")) {
            issues.push(`${path}.dependsOn must be an array of strings`);
        }
    }

    if (step.confirm !== undefined && typeof step.confirm !== "boolean") {
        issues.push(`${path}.confirm must be a boolean`);
    }

    if (step.output !== undefined) {
        if (!isPlainObject(step.output) || typeof step.output.as !== "string" || step.output.as.trim().length === 0) {
            issues.push(`${path}.output.as must be a non-empty string`);
        }
    }

    if (step.onFailure !== undefined && typeof step.onFailure !== "string") {
        issues.push(`${path}.onFailure must be a string`);
    }

    if (step.condition !== undefined && !isValidConditionValue(step.condition)) {
        issues.push(`${path}.condition must be a string or structured condition object`);
    }

    if (step.thenSteps !== undefined) {
        if (!Array.isArray(step.thenSteps)) {
            issues.push(`${path}.thenSteps must be an array`);
        } else {
            step.thenSteps.forEach((child, index) => {
                issues.push(...validateShortcutStepNode(child, `${path}.thenSteps[${index}]`));
            });
        }
    }

    if (step.elseSteps !== undefined) {
        if (!Array.isArray(step.elseSteps)) {
            issues.push(`${path}.elseSteps must be an array`);
        } else {
            step.elseSteps.forEach((child, index) => {
                issues.push(...validateShortcutStepNode(child, `${path}.elseSteps[${index}]`));
            });
        }
    }

    if (step.repeatSteps !== undefined) {
        if (!Array.isArray(step.repeatSteps)) {
            issues.push(`${path}.repeatSteps must be an array`);
        } else {
            step.repeatSteps.forEach((child, index) => {
                issues.push(...validateShortcutStepNode(child, `${path}.repeatSteps[${index}]`));
            });
        }
    }

    return issues;
}

export function assertShortcutStepsDeeplyValid(steps: unknown[]): void {
    const issues = steps.flatMap((step, index) =>
        validateShortcutStepNode(step, `steps[${index}]`),
    );

    if (issues.length > 0) {
        throw new Error(`Invalid shortcut step tree: ${issues.join(" | ")}`);
    }
}

export const automationStatusValidator = v.union(
    v.literal("active"),
    v.literal("paused"),
    v.literal("completed"),
    v.literal("error"),
);

export const publishedShortcutStatusValidator = v.union(
    v.literal("published"),
    v.literal("archived"),
);

export const shortcutVisibilityValidator = v.union(
    v.literal("private"),
    v.literal("public"),
);

export const automationTriggerValidator = v.union(
    v.object({
        type: v.literal("price_below"),
        token: v.string(),
        priceUsd: v.number(),
    }),
    v.object({
        type: v.literal("price_above"),
        token: v.string(),
        priceUsd: v.number(),
    }),
    v.object({
        type: v.literal("scheduled"),
        cron: v.string(),
        cronDescription: v.optional(v.string()),
    }),
);

export const automationActionValidator = v.union(
    v.object({
        type: v.literal("swap"),
        fromToken: v.string(),
        toToken: v.string(),
        amount: v.string(),
    }),
    v.object({
        type: v.literal("send"),
        token: v.string(),
        amount: v.string(),
        to: v.string(),
    }),
    v.object({
        type: v.literal("notify"),
        channel: v.union(v.literal("email"), v.literal("webhook")),
        target: v.string(),
        message: v.string(),
    }),
);

export const runSourceTypeValidator = v.union(
    v.literal("manual"),
    v.literal("automation"),
);

export const runStatusValidator = v.union(
    v.literal("queued"),
    v.literal("running"),
    v.literal("awaiting_signature"),
    v.literal("succeeded"),
    v.literal("failed"),
    v.literal("canceled"),
);

export const runStepStatusValidator = v.union(
    v.literal("pending"),
    v.literal("running"),
    v.literal("waiting_confirmation"),
    v.literal("waiting_input"),
    v.literal("waiting_signature"),
    v.literal("success"),
    v.literal("error"),
    v.literal("skipped"),
);

export const runDefinitionSnapshotValidator = v.object({
    name: v.string(),
    description: v.optional(v.string()),
    category: shortcutCategoryValidator,
    inputs: v.array(shortcutInputValidator),
    steps: v.array(shortcutStepValidator),
    networkId: v.optional(v.string()),
    capturedAt: v.string(),
});

export function paginatedResultValidator(itemValidator: Validator<unknown, "required", string>) {
    return v.object({
        page: v.array(itemValidator),
        isDone: v.boolean(),
        continueCursor: v.string(),
        splitCursor: v.optional(v.union(v.string(), v.null())),
        pageStatus: v.optional(v.union(
            v.literal("SplitRecommended"),
            v.literal("SplitRequired"),
            v.literal("Complete"),
            v.null(),
        )),
    });
}

export const savedShortcutDocValidator = v.object({
    _id: v.id("saved_shortcuts"),
    _creationTime: v.number(),
    ownerAddress: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    category: shortcutCategoryValidator,
    inputs: v.array(shortcutInputValidator),
    steps: v.array(shortcutStepValidator),
    originShortcutId: v.optional(v.id("saved_shortcuts")),
    version: v.string(),
    visibility: v.optional(shortcutVisibilityValidator),
    slug: v.optional(v.string()),
    publicName: v.optional(v.string()),
    publicDescription: v.optional(v.string()),
    publicCategory: v.optional(shortcutCategoryValidator),
    publishedAt: v.optional(v.string()),
    publishVersion: v.optional(v.number()),
    remixCount: v.optional(v.number()),
    createdAt: v.string(),
    updatedAt: v.string(),
    archivedAt: v.optional(v.string()),
});

export const publicShortcutSnapshotValidator = v.object({
    _id: v.id("saved_shortcuts"),
    slug: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    category: shortcutCategoryValidator,
    creatorAddress: v.string(),
    inputs: v.array(shortcutInputValidator),
    steps: v.array(shortcutStepValidator),
    remixCount: v.number(),
    publishVersion: v.number(),
    publishedAt: v.string(),
    updatedAt: v.string(),
    version: v.string(),
});

export const shortcutPublicationValidator = v.object({
    slug: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    category: shortcutCategoryValidator,
    status: publishedShortcutStatusValidator,
    publishVersion: v.number(),
});

export const automationDocValidator = v.object({
    _id: v.id("automations"),
    _creationTime: v.number(),
    ownerAddress: v.string(),
    accountAddress: v.string(),
    networkId: v.optional(v.string()),
    name: v.string(),
    description: v.optional(v.string()),
    trigger: automationTriggerValidator,
    action: automationActionValidator,
    status: automationStatusValidator,
    maxExecutions: v.number(),
    executionCount: v.number(),
    targetShortcutId: v.id("saved_shortcuts"),
    lastEvaluatedAt: v.optional(v.string()),
    lastTriggeredAt: v.optional(v.string()),
    lastExecutedAt: v.optional(v.string()),
    lastError: v.optional(v.string()),
    lastRunId: v.optional(v.id("runs")),
    nextRunAt: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
});

export const runDocValidator = v.object({
    _id: v.id("runs"),
    _creationTime: v.number(),
    ownerAddress: v.string(),
    name: v.string(),
    sourceType: runSourceTypeValidator,
    sourceId: v.string(),
    shortcutId: v.optional(v.id("saved_shortcuts")),
    status: runStatusValidator,
    inputValues: runInputValuesValidator,
    definitionSnapshot: v.optional(runDefinitionSnapshotValidator),
    error: v.optional(v.string()),
    scheduledFunctionId: v.optional(v.string()),
    createdAt: v.string(),
    startedAt: v.string(),
    completedAt: v.optional(v.string()),
});

export const runStepDocValidator = v.object({
    _id: v.id("run_steps"),
    _creationTime: v.number(),
    runId: v.id("runs"),
    stepId: v.string(),
    label: v.string(),
    status: runStepStatusValidator,
    outputSummary: v.optional(v.string()),
    error: v.optional(v.string()),
    startedAt: v.string(),
    completedAt: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    sequence: v.number(),
});

export const siweNonceDocValidator = v.object({
    _id: v.id("siwe_nonces"),
    _creationTime: v.number(),
    sessionKey: v.string(),
    nonce: v.string(),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
});
