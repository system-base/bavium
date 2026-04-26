/* ==========================================================================
   Engine — Parser
   Validates and normalizes a raw JSON object into a typed Shortcut.
   No external schema library — simple structural validation.
   ========================================================================== */

import type {
    Shortcut,
    ShortcutStep,
    ShortcutInput,
    ConditionExpression,
    ConditionGroup,
    StructuredCondition,
    ConditionOperator,
    ConditionValueType,
} from "./types";

export class ParseError extends Error {
    constructor(
        message: string,
        public path: string,
    ) {
        super(`ParseError at "${path}": ${message}`);
        this.name = "ParseError";
    }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function assertString(value: unknown, path: string): string {
    if (typeof value !== "string" || value.length === 0) {
        throw new ParseError("expected non-empty string", path);
    }
    return value;
}

function assertOptionalString(value: unknown, path: string): string | undefined {
    if (value === undefined || value === null) return undefined;
    return assertString(value, path);
}

function assertBoolean(value: unknown, path: string): boolean {
    if (typeof value !== "boolean") {
        throw new ParseError("expected boolean", path);
    }
    return value;
}

function assertArray(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value)) {
        throw new ParseError("expected array", path);
    }
    return value;
}

function assertObject(value: unknown, path: string): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new ParseError("expected object", path);
    }
    return value as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const VALID_INPUT_TYPES = new Set([
    "address",
    "amount",
    "text",
    "token",
    "boolean",
    "select",
    "number",
]);

function parseInput(raw: unknown, index: number): ShortcutInput {
    const path = `inputs[${index}]`;
    const obj = assertObject(raw, path);

    const type = assertString(obj.type, `${path}.type`);
    if (!VALID_INPUT_TYPES.has(type)) {
        throw new ParseError(
            `invalid input type "${type}", expected one of: ${[...VALID_INPUT_TYPES].join(", ")}`,
            `${path}.type`,
        );
    }

    return {
        id: assertString(obj.id, `${path}.id`),
        label: assertString(obj.label, `${path}.label`),
        type: type as ShortcutInput["type"],
        required: obj.required !== undefined
            ? assertBoolean(obj.required, `${path}.required`)
            : true,
        placeholder: assertOptionalString(obj.placeholder, `${path}.placeholder`),
        default: assertOptionalString(obj.default, `${path}.default`),
        constraints: obj.constraints
            ? (assertObject(obj.constraints, `${path}.constraints`) as ShortcutInput["constraints"])
            : undefined,
    };
}

// ---------------------------------------------------------------------------
// Condition field parsing
// ---------------------------------------------------------------------------

const VALID_CONDITION_OPERATORS = new Set<string>([
    "equals", "not_equals", "greater_than", "less_than",
    "greater_or_equal", "less_or_equal",
    "contains", "not_contains", "starts_with", "ends_with",
    "is_empty", "is_not_empty",
]);

const VALID_CONDITION_VALUE_TYPES = new Set<string>([
    "number", "string", "boolean",
]);

/**
 * Parse a condition field that may be a legacy string or a structured object.
 */
function parseConditionField(
    value: unknown,
    path: string,
): string | StructuredCondition {
    // Legacy string format
    if (typeof value === "string") {
        return value;
    }

    // Structured condition object
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        return parseStructuredConditionObject(value as Record<string, unknown>, path);
    }

    throw new ParseError("expected string or ConditionExpression object", path);
}

function parseStructuredConditionObject(
    value: Record<string, unknown>,
    path: string,
): StructuredCondition {
    const obj = assertObject(value, path);

    if ("mode" in obj || "conditions" in obj) {
        const mode = assertString(obj.mode, `${path}.mode`);
        if (mode !== "all" && mode !== "any") {
            throw new ParseError(`invalid condition group mode "${mode}"`, `${path}.mode`);
        }

        const rawConditions = assertArray(obj.conditions, `${path}.conditions`);
        const conditions = rawConditions.map((item, index) => {
            if (typeof item !== "object" || item === null || Array.isArray(item)) {
                throw new ParseError("expected condition object", `${path}.conditions[${index}]`);
            }
            return parseStructuredConditionObject(
                item as Record<string, unknown>,
                `${path}.conditions[${index}]`,
            );
        });

        const group: ConditionGroup = {
            mode,
            conditions,
        };
        return group;
    }

    const inputRef = assertString(obj.inputRef, `${path}.inputRef`);
    const operator = assertString(obj.operator, `${path}.operator`);
    const valueType = typeof obj.valueType === "string" ? obj.valueType : "string";

    if (!VALID_CONDITION_OPERATORS.has(operator)) {
        throw new ParseError(
            `invalid condition operator "${operator}"`,
            `${path}.operator`,
        );
    }
    if (!VALID_CONDITION_VALUE_TYPES.has(valueType)) {
        throw new ParseError(
            `invalid condition value type "${valueType}"`,
            `${path}.valueType`,
        );
    }

    const compareValue = typeof obj.compareValue === "string"
        ? obj.compareValue
        : "";

    const expression: ConditionExpression = {
        inputRef,
        operator: assertConditionOperator(operator),
        compareValue,
        valueType: assertConditionValueType(valueType),
    };

    return expression;
}

function assertConditionOperator(value: string): ConditionOperator {
    // VALID_CONDITION_OPERATORS check was done before calling this
    const valid: ConditionOperator[] = [
        "equals", "not_equals", "greater_than", "less_than",
        "greater_or_equal", "less_or_equal",
        "contains", "not_contains", "starts_with", "ends_with",
        "is_empty", "is_not_empty",
    ];
    for (const op of valid) {
        if (op === value) return op;
    }
    return "equals";
}

function assertConditionValueType(value: string): ConditionValueType {
    const valid: ConditionValueType[] = ["number", "string", "boolean"];
    for (const vt of valid) {
        if (vt === value) return vt;
    }
    return "string";
}

// ---------------------------------------------------------------------------
// Step ID collection (recursive for nested branches)
// ---------------------------------------------------------------------------

/**
 * Recursively collect all step IDs, throwing on duplicates.
 */
function collectStepIds(steps: ShortcutStep[], ids: Set<string>): void {
    for (const step of steps) {
        if (ids.has(step.id)) {
            throw new ParseError(`duplicate step id "${step.id}"`, "steps");
        }
        ids.add(step.id);
        if (step.thenSteps) {
            collectStepIds(step.thenSteps, ids);
        }
        if (step.elseSteps) {
            collectStepIds(step.elseSteps, ids);
        }
        if (step.repeatSteps) {
            collectStepIds(step.repeatSteps, ids);
        }
    }
}

// ---------------------------------------------------------------------------
// Step validation
// ---------------------------------------------------------------------------

const VALID_FAILURE_STRATEGIES = /^(abort|continue|retry\(\d+\))$/;

function parseStep(raw: unknown, index: number, parentPath = "steps"): ShortcutStep {
    const path = `${parentPath}[${index}]`;
    const obj = assertObject(raw, path);

    const step: ShortcutStep = {
        id: assertString(obj.id, `${path}.id`),
        skill: assertString(obj.skill, `${path}.skill`),
        action: assertString(obj.action, `${path}.action`),
        params: obj.params
            ? assertObject(obj.params, `${path}.params`)
            : {},
    };

    if (obj.dependsOn !== undefined) {
        step.dependsOn = assertArray(obj.dependsOn, `${path}.dependsOn`).map(
            (dep, i) => assertString(dep, `${path}.dependsOn[${i}]`),
        );
    }

    if (obj.confirm !== undefined) {
        step.confirm = assertBoolean(obj.confirm, `${path}.confirm`);
    }

    if (obj.output !== undefined) {
        const out = assertObject(obj.output, `${path}.output`);
        step.output = {
            as: assertString(out.as, `${path}.output.as`),
        };
    }

    if (obj.onFailure !== undefined) {
        const strategy = assertString(obj.onFailure, `${path}.onFailure`);
        if (!VALID_FAILURE_STRATEGIES.test(strategy)) {
            throw new ParseError(
                `invalid failure strategy "${strategy}", expected "abort", "continue", or "retry(N)"`,
                `${path}.onFailure`,
            );
        }
        step.onFailure = strategy as ShortcutStep["onFailure"];
    }

    if (obj.condition !== undefined) {
        step.condition = parseConditionField(obj.condition, `${path}.condition`);
    }

    // Nested branches for if_else
    if (obj.thenSteps !== undefined) {
        const thenRaw = assertArray(obj.thenSteps, `${path}.thenSteps`);
        step.thenSteps = thenRaw.map((s, i) => parseStep(s, i, `${path}.thenSteps`));
    }
    if (obj.elseSteps !== undefined) {
        const elseRaw = assertArray(obj.elseSteps, `${path}.elseSteps`);
        step.elseSteps = elseRaw.map((s, i) => parseStep(s, i, `${path}.elseSteps`));
    }
    if (obj.repeatSteps !== undefined) {
        const repeatRaw = assertArray(obj.repeatSteps, `${path}.repeatSteps`);
        step.repeatSteps = repeatRaw.map((s, i) => parseStep(s, i, `${path}.repeatSteps`));
    }

    return step;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = new Set([
    "wallet", "swap", "bridge", "defi", "nft", "social", "data", "x402", "logic",
]);

/**
 * Parse and validate a raw JSON object into a Shortcut.
 * Throws ParseError with precise path for any validation failure.
 */
export function parseShortcut(raw: unknown): Shortcut {
    const obj = assertObject(raw, "root");

    const category = assertString(obj.category, "category");
    if (!VALID_CATEGORIES.has(category)) {
        throw new ParseError(
            `invalid category "${category}"`,
            "category",
        );
    }

    const inputs = obj.inputs
        ? assertArray(obj.inputs, "inputs").map(parseInput)
        : [];

    const steps = assertArray(obj.steps, "steps");
    if (steps.length === 0) {
        throw new ParseError("shortcut must have at least one step", "steps");
    }
    const parsedSteps = steps.map((s, i) => parseStep(s, i));

    // Validate step ID uniqueness (including nested steps)
    const stepIds = new Set<string>();
    collectStepIds(parsedSteps, stepIds);

    // Validate dependsOn references (top-level only — nested steps
    // are scoped to their branch)
    for (const step of parsedSteps) {
        if (step.dependsOn) {
            for (const dep of step.dependsOn) {
                if (!stepIds.has(dep)) {
                    throw new ParseError(
                        `step "${step.id}" depends on unknown step "${dep}"`,
                        `steps`,
                    );
                }
            }
        }
    }

    const now = new Date().toISOString();

    return {
        id: assertString(obj.id, "id"),
        name: assertString(obj.name, "name"),
        description: typeof obj.description === "string" ? obj.description : "",
        version: typeof obj.version === "string" ? obj.version : "1.0.0",
        author: typeof obj.author === "string" ? obj.author : "anonymous",
        icon: typeof obj.icon === "string" ? obj.icon : "⚡",
        color: typeof obj.color === "string" ? obj.color : "#0052FF",
        category: category as Shortcut["category"],
        tags: Array.isArray(obj.tags)
            ? obj.tags.filter((t): t is string => typeof t === "string")
            : [],
        inputs,
        steps: parsedSteps,
        createdAt: typeof obj.createdAt === "string" ? obj.createdAt : now,
        updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : now,
    };
}
