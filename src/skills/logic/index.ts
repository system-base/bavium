/* ==========================================================================
   Skills — Logic (Built-in)
   assert, if_else, ask_input, wait, format, notify, math
   These require no wallet or external dependencies.
   ========================================================================== */

import type { ISkill, SkillResult, SkillActionMeta } from "../types";
import type { ConditionExpression, ConditionGroup, StructuredCondition, VariableContext } from "@/engine/types";
import { evaluateConditionWithDetails } from "@/engine/condition";
import { resolveTemplate } from "@/engine/variables";
import { MAX_REPEAT_ITERATIONS } from "@/lib/runtime-limits";
import { skillRegistry } from "../registry";

// ---------------------------------------------------------------------------
// Action implementations
// ---------------------------------------------------------------------------

async function executeAssert(
    params: Record<string, unknown>,
    ctx: VariableContext,
): Promise<SkillResult> {
    const errorMessage = String(
        params.errorMessage ?? "Assertion failed",
    );

    // Support structured condition or legacy string
    const conditionParam = params.condition;
    if (!conditionParam) {
        return { success: false, error: "No condition provided" };
    }

    const { result, summary } = resolveAndDescribe(conditionParam, ctx);

    if (result) {
        return {
            success: true,
            data: {
                description: "Assertion passed",
                result: true,
                summary,
            },
            message: `Assertion passed — ${summary}`,
        };
    }
    return { success: false, error: errorMessage };
}

async function executeIfElse(
    params: Record<string, unknown>,
    ctx: VariableContext,
): Promise<SkillResult> {
    const conditionParam = params.condition;
    if (!conditionParam) {
        return {
            success: true,
            data: { branch: "then", value: true },
            message: "No condition provided — defaulting to then",
        };
    }

    const { result, summary } = resolveAndDescribe(conditionParam, ctx);

    return {
        success: true,
        data: {
            description: `${result ? "Then" : "Else"} branch selected`,
            branch: result ? "then" : "else",
            value: result,
            summary,
        },
        message: `${result ? "Then" : "Else"} branch selected — ${summary}`,
    };
}

function resolveAndDescribe(
    conditionParam: unknown,
    ctx: VariableContext,
): { result: boolean; summary: string } {
    if (isConditionExpression(conditionParam)) {
        return evaluateConditionWithDetails(conditionParam, ctx);
    }

    if (typeof conditionParam === "string") {
        const parsed = tryParseConditionJSON(conditionParam);
        if (parsed) {
            return evaluateConditionWithDetails(parsed, ctx);
        }

        return evaluateConditionWithDetails(conditionParam, ctx);
    }

    const result = Boolean(conditionParam);
    return {
        result,
        summary: `Condition resolved to ${result ? "true" : "false"}`,
    };
}

/**
 * Type guard for ConditionExpression objects.
 */
function isConditionExpression(val: unknown): val is ConditionExpression {
    if (typeof val !== "object" || val === null) return false;
    if (!("inputRef" in val) || !("operator" in val)) return false;
    const record: Record<string, unknown> = val;
    return typeof record["inputRef"] === "string" && typeof record["operator"] === "string";
}

function isConditionGroup(val: unknown): val is ConditionGroup {
    if (typeof val !== "object" || val === null) return false;
    if (!("mode" in val) || !("conditions" in val)) return false;
    const record: Record<string, unknown> = val;
    return (
        (record["mode"] === "all" || record["mode"] === "any") &&
        Array.isArray(record["conditions"])
    );
}

/**
 * Try to parse a JSON string as a ConditionExpression.
 * Returns null if the string is not valid JSON or not a valid expression.
 */
function tryParseConditionJSON(value: string): StructuredCondition | null {
    try {
        const parsed: unknown = JSON.parse(value);
        if (isConditionExpression(parsed) || isConditionGroup(parsed)) {
            return parsed;
        }
    } catch {
        // Not JSON — treat as legacy
    }
    return null;
}

async function executeWait(
    params: Record<string, unknown>,
): Promise<SkillResult> {
    const seconds = Number(params.seconds ?? params.duration ?? 1);

    if (isNaN(seconds) || seconds < 0) {
        return { success: false, error: "Invalid duration" };
    }

    // Cap at 60 seconds for safety
    const capped = Math.min(seconds, 60);

    await new Promise((resolve) => setTimeout(resolve, capped * 1000));

    return {
        success: true,
        data: { waited: capped },
        message: `Waited ${capped} seconds`,
    };
}

async function executeAskInput(
    params: Record<string, unknown>,
): Promise<SkillResult> {
    const prompt = String(params.prompt ?? "Enter a value");
    const inputType = String(params.inputType ?? "text");
    const value = params.value ?? params.defaultValue ?? "";

    return {
        success: true,
        data: {
            prompt,
            inputType,
            value,
            summary: typeof value === "string" ? value : "Input captured",
        },
        message: typeof value === "string" ? value : "Input captured",
    };
}

function parseMenuOptions(params: Record<string, unknown>): string[] {
    const raw = params.options;
    if (typeof raw !== "string") return [];

    return raw
        .split(/\r?\n|,/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}

function parseRepeatItems(raw: unknown): unknown[] {
    if (Array.isArray(raw)) {
        return raw.filter((item) => item !== undefined && item !== null);
    }

    if (typeof raw !== "string") {
        return [];
    }

    const trimmed = raw.trim();
    if (trimmed.length === 0) {
        return [];
    }

    if (trimmed.startsWith("[")) {
        try {
            const parsed: unknown = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed.filter((item) => item !== undefined && item !== null);
            }
        } catch {
            // Fall through to delimited parsing.
        }
    }

    return trimmed
        .split(/\r?\n|,/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}

async function executeChooseMenu(
    params: Record<string, unknown>,
): Promise<SkillResult> {
    const prompt = String(params.prompt ?? "Choose an option");
    const options = parseMenuOptions(params);

    if (options.length === 0) {
        return { success: false, error: "Choose Menu requires at least one option" };
    }

    const selected = String(params.value ?? params.defaultValue ?? options[0]);
    const matched = options.find((option) => option === selected) ?? selected;

    return {
        success: true,
        data: {
            prompt,
            value: matched,
            label: matched,
            summary: matched,
        },
        message: matched,
    };
}

async function executeRepeat(
    params: Record<string, unknown>,
): Promise<SkillResult> {
    const count = Number(params.count ?? params.times ?? 0);
    if (!Number.isFinite(count) || count < 1) {
        return { success: false, error: "Repeat requires a count of at least 1" };
    }

    const normalizedCount = Math.floor(count);
    if (normalizedCount > MAX_REPEAT_ITERATIONS) {
        return {
            success: false,
            error: `Repeat is limited to ${MAX_REPEAT_ITERATIONS} iterations per run`,
        };
    }

    return {
        success: true,
        data: {
            mode: "count",
            count: normalizedCount,
            totalIterations: normalizedCount,
            summary: `Repeat ${normalizedCount} time${normalizedCount === 1 ? "" : "s"}`,
        },
        message: `Repeat ${normalizedCount} time${normalizedCount === 1 ? "" : "s"}`,
    };
}

async function executeRepeatEach(
    params: Record<string, unknown>,
): Promise<SkillResult> {
    const items = parseRepeatItems(params.items ?? params.value);
    if (items.length === 0) {
        return { success: false, error: "Repeat with Each requires at least one item" };
    }
    if (items.length > MAX_REPEAT_ITERATIONS) {
        return {
            success: false,
            error: `Repeat with Each is limited to ${MAX_REPEAT_ITERATIONS} items per run`,
        };
    }

    return {
        success: true,
        data: {
            mode: "each",
            items,
            count: items.length,
            totalIterations: items.length,
            summary: `Repeat with ${items.length} item${items.length === 1 ? "" : "s"}`,
        },
        message: `Repeat with ${items.length} item${items.length === 1 ? "" : "s"}`,
    };
}

async function executeFormat(
    params: Record<string, unknown>,
    ctx: VariableContext,
): Promise<SkillResult> {
    const template = String(params.template ?? params.message ?? "");
    const resolved = resolveTemplate(template, ctx);
    const text = typeof resolved === "string" ? resolved : String(resolved ?? "");

    return {
        success: true,
        data: {
            text,
            summary: text,
        },
        message: text,
    };
}

async function executeNotify(
    params: Record<string, unknown>,
): Promise<SkillResult> {
    const message = String(params.message ?? "");
    const level = String(params.level ?? "info");

    return {
        success: true,
        data: { message, level },
        message,
    };
}

async function executeMath(
    params: Record<string, unknown>,
): Promise<SkillResult> {
    const a = Number(params.a ?? params.left ?? 0);
    const b = Number(params.b ?? params.right ?? 0);
    const op = String(params.op ?? params.operation ?? "+");

    if (isNaN(a) || isNaN(b)) {
        return { success: false, error: "Invalid numeric operands" };
    }

    let result: number;
    switch (op) {
        case "+": result = a + b; break;
        case "-": result = a - b; break;
        case "*": result = a * b; break;
        case "/":
            if (b === 0) return { success: false, error: "Division by zero" };
            result = a / b;
            break;
        case "%":
            if (b === 0) return { success: false, error: "Modulo by zero" };
            result = a % b;
            break;
        default:
            return { success: false, error: `Unknown operator "${op}"` };
    }

    return {
        success: true,
        data: {
            result,
            summary: `${a} ${op} ${b} = ${result}`,
        },
        message: `${a} ${op} ${b} = ${result}`,
    };
}

async function executeStop(
    params: Record<string, unknown>,
): Promise<SkillResult> {
    const message = String(params.message ?? "Shortcut stopped");

    return {
        success: true,
        data: {
            stopped: true,
            message,
        },
        message,
    };
}

async function executeSetVariable(
    params: Record<string, unknown>,
): Promise<SkillResult> {
    const value = params.value ?? params.input ?? "";

    return {
        success: true,
        data: value,
        message: typeof value === "string" ? value : "Variable prepared",
    };
}

async function executeGetVariable(
    params: Record<string, unknown>,
): Promise<SkillResult> {
    const value = params.variable ?? params.value ?? "";

    return {
        success: true,
        data: value,
        message: typeof value === "string" ? value : "Variable loaded",
    };
}

// Note: evaluateSimpleCondition has been replaced by the centralized
// evaluateCondition / evaluateLegacyCondition from engine/condition.ts

// ---------------------------------------------------------------------------
// Skill definition
// ---------------------------------------------------------------------------

const ACTIONS: SkillActionMeta[] = [
    {
        name: "assert",
        label: "Assert",
        description: "Validate a condition. Aborts the shortcut if condition is false.",
        params: [
            { name: "condition", type: "string", required: true, description: "Condition expression (e.g. '100 >= 50')" },
            { name: "errorMessage", type: "string", required: false, description: "Error message if assertion fails", default: "Assertion failed" },
        ],
    },
    {
        name: "if_else",
        label: "If / Else",
        description: "Evaluate a condition and branch.",
        params: [
            { name: "condition", type: "string", required: true, description: "Condition to evaluate" },
        ],
    },
    {
        name: "ask_input",
        label: "Ask Input",
        description: "Pause the shortcut and collect a runtime value from the user.",
        params: [
            { name: "prompt", type: "string", required: true, description: "Question shown to the user" },
            { name: "inputType", type: "string", required: false, description: "Expected input type: text, number, amount, or address", default: "text" },
            { name: "defaultValue", type: "string", required: false, description: "Optional default value shown in the prompt" },
            { name: "placeholder", type: "string", required: false, description: "Optional UI hint for the requested value" },
        ],
    },
    {
        name: "choose_menu",
        label: "Choose Menu",
        description: "Pause the shortcut and let the user pick from a fixed list of options.",
        params: [
            { name: "prompt", type: "string", required: true, description: "Question shown above the menu" },
            { name: "options", type: "string", required: true, description: "Comma-separated or line-separated menu options" },
            { name: "defaultValue", type: "string", required: false, description: "Optional default selected option" },
        ],
    },
    {
        name: "repeat",
        label: "Repeat",
        description: "Run nested steps a fixed number of times.",
        params: [
            { name: "count", type: "number", required: true, description: "How many times to repeat" },
        ],
    },
    {
        name: "repeat_each",
        label: "Repeat with Each",
        description: "Run nested steps once for each item in a list.",
        params: [
            { name: "items", type: "string", required: true, description: "Comma-separated, line-separated, JSON array, or template-resolved list of items" },
        ],
    },
    {
        name: "wait",
        label: "Wait",
        description: "Pause execution for a specified duration.",
        params: [
            { name: "seconds", type: "number", required: true, description: "Seconds to wait (max 60)", default: 1 },
        ],
    },
    {
        name: "stop",
        label: "Stop Shortcut",
        description: "Stop execution in a controlled way.",
        params: [
            { name: "message", type: "string", required: false, description: "Optional stop message", default: "Shortcut stopped" },
        ],
    },
    {
        name: "set_variable",
        label: "Set Variable",
        description: "Give a value a readable name when direct step references would be awkward.",
        params: [
            { name: "value", type: "string", required: true, description: "Literal or template value to expose under a readable name" },
        ],
    },
    {
        name: "get_variable",
        label: "Get Variable",
        description: "Read a saved variable and expose it as the current step result when readability matters.",
        params: [
            { name: "variable", type: "string", required: true, description: "Saved variable reference to load" },
        ],
    },
    {
        name: "format",
        label: "Format Text",
        description: "Build a string from template variables.",
        params: [
            { name: "template", type: "string", required: true, description: "Template string with {{variables}}" },
        ],
    },
    {
        name: "notify",
        label: "Notification",
        description: "Display a notification message.",
        params: [
            { name: "message", type: "string", required: true, description: "Notification message" },
            { name: "level", type: "string", required: false, description: "Level: info, success, warning, error", default: "info" },
        ],
    },
    {
        name: "math",
        label: "Math",
        description: "Perform arithmetic: +, -, *, /, %",
        params: [
            { name: "a", type: "number", required: true, description: "Left operand" },
            { name: "b", type: "number", required: true, description: "Right operand" },
            { name: "op", type: "string", required: true, description: "Operator: +, -, *, /, %" },
        ],
    },
];

const logicSkill: ISkill = {
    name: "logic",
    label: "Logic",
    category: "logic",
    description: "Built-in control flow and utility actions.",
    actions: ACTIONS,

    async execute(
        action: string,
        params: Record<string, unknown>,
        context: VariableContext,
    ): Promise<SkillResult> {
        switch (action) {
            case "assert":
                return executeAssert(params, context);
            case "if_else":
                return executeIfElse(params, context);
            case "ask_input":
                return executeAskInput(params);
            case "choose_menu":
                return executeChooseMenu(params);
            case "repeat":
                return executeRepeat(params);
            case "repeat_each":
                return executeRepeatEach(params);
            case "wait":
                return executeWait(params);
            case "stop":
                return executeStop(params);
            case "set_variable":
                return executeSetVariable(params);
            case "get_variable":
                return executeGetVariable(params);
            case "format":
                return executeFormat(params, context);
            case "notify":
                return executeNotify(params);
            case "math":
                return executeMath(params);
            default:
                return {
                    success: false,
                    error: `Unknown logic action "${action}"`,
                };
        }
    },
};

// Self-register
skillRegistry.register(logicSkill);

export { logicSkill };
