/* ==========================================================================
   Engine — Condition Evaluator
   Evaluates both legacy string conditions and structured ConditionExpression.
   Used by the executor for step conditions and by If/Else branching.
   ========================================================================== */

import type { ConditionOperator, StructuredCondition, VariableContext } from "./types";
import { resolveTemplate } from "./variables";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a condition that may be a legacy string or a structured expression.
 * Returns true/false.
 */
export function evaluateCondition(
    condition: string | StructuredCondition,
    ctx: VariableContext,
): boolean {
    if (typeof condition === "string") {
        return evaluateLegacyCondition(condition);
    }
    return evaluateStructuredCondition(condition, ctx);
}

export function evaluateConditionWithDetails(
    condition: string | StructuredCondition,
    ctx: VariableContext,
): { result: boolean; summary: string } {
    if (typeof condition === "string") {
        const result = evaluateLegacyCondition(condition);
        return {
            result,
            summary: `${condition} -> ${result ? "true" : "false"}`,
        };
    }

    return describeStructuredCondition(condition, ctx);
}

// ---------------------------------------------------------------------------
// Structured condition evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a structured ConditionExpression.
 * Resolves template references in inputRef and compareValue before comparing.
 */
function evaluateStructuredCondition(
    expr: StructuredCondition,
    ctx: VariableContext,
): boolean {
    if (isConditionGroup(expr)) {
        if (expr.conditions.length === 0) return true;
        if (expr.mode === "any") {
            return expr.conditions.some((condition) => evaluateStructuredCondition(condition, ctx));
        }
        return expr.conditions.every((condition) => evaluateStructuredCondition(condition, ctx));
    }

    // Resolve the left-hand side (input reference)
    const rawLeft = resolveTemplate(`{{${expr.inputRef}}}`, ctx);

    // Unary operators that don't need a right-hand side
    if (expr.operator === "is_empty") {
        return isEmpty(rawLeft);
    }
    if (expr.operator === "is_not_empty") {
        return !isEmpty(rawLeft);
    }

    // Resolve the right-hand side (compare value — may contain templates)
    const rawRight = resolveTemplate(expr.compareValue, ctx);

    const left = rawLeft === undefined || rawLeft === null ? "" : String(rawLeft);
    const right = rawRight === undefined || rawRight === null ? "" : String(rawRight);

    return applyOperator(expr.operator, left, right, expr.valueType);
}

function describeStructuredCondition(
    expr: StructuredCondition,
    ctx: VariableContext,
): { result: boolean; summary: string } {
    if (isConditionGroup(expr)) {
        if (expr.conditions.length === 0) {
            return { result: true, summary: "No conditions" };
        }

        const evaluated = expr.conditions.map((condition) => describeStructuredCondition(condition, ctx));
        const result = expr.mode === "any"
            ? evaluated.some((item) => item.result)
            : evaluated.every((item) => item.result);
        const joinLabel = expr.mode === "any" ? " OR " : " AND ";

        return {
            result,
            summary: evaluated.map((item) => item.summary).join(joinLabel),
        };
    }

    const rawLeft = resolveTemplate(`{{${expr.inputRef}}}`, ctx);
    const actualValue = rawLeft === undefined || rawLeft === null ? "" : String(rawLeft);

    if (expr.operator === "is_empty" || expr.operator === "is_not_empty") {
        const result = expr.operator === "is_empty" ? isEmpty(rawLeft) : !isEmpty(rawLeft);
        return {
            result,
            summary: `${humanizeConditionRef(expr.inputRef)} ${getOperatorLabel(expr.operator)} (actual: ${formatConditionValue(actualValue)})`,
        };
    }

    const rawRight = resolveTemplate(expr.compareValue, ctx);
    const compareValue = rawRight === undefined || rawRight === null ? "" : String(rawRight);
    const result = applyOperator(expr.operator, actualValue, compareValue, expr.valueType);

    return {
        result,
        summary: `${humanizeConditionRef(expr.inputRef)} ${getOperatorLabel(expr.operator)} ${formatConditionValue(compareValue)} (actual: ${formatConditionValue(actualValue)})`,
    };
}

function isConditionGroup(value: StructuredCondition): value is Extract<StructuredCondition, { mode: "all" | "any" }> {
    return "mode" in value && Array.isArray(value.conditions);
}

/**
 * Check if a value is "empty" — null, undefined, or empty string.
 */
function isEmpty(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === "string" && value.trim() === "") return true;
    return false;
}

/**
 * Apply a comparison operator to two string values,
 * coercing to number when valueType is "number".
 */
function applyOperator(
    operator: ConditionOperator,
    left: string,
    right: string,
    valueType: string,
): boolean {
    // Numeric comparisons
    if (valueType === "number") {
        const numLeft = Number(left);
        const numRight = Number(right);
        if (!isNaN(numLeft) && !isNaN(numRight)) {
            switch (operator) {
                case "equals": return numLeft === numRight;
                case "not_equals": return numLeft !== numRight;
                case "greater_than": return numLeft > numRight;
                case "less_than": return numLeft < numRight;
                case "greater_or_equal": return numLeft >= numRight;
                case "less_or_equal": return numLeft <= numRight;
                default: break;
            }
        }
    }

    // Boolean comparisons
    if (valueType === "boolean") {
        const boolLeft = toBool(left);
        const boolRight = toBool(right);
        switch (operator) {
            case "equals": return boolLeft === boolRight;
            case "not_equals": return boolLeft !== boolRight;
            default: break;
        }
    }

    // Safety net: for math operators (>, <, >=, <=), always attempt numeric
    // coercion even if valueType is not "number". This prevents the critical
    // lexicographic bug where "2000" > "19999" returns true as a string compare.
    if (valueType !== "number") {
        const mathOps = new Set(["greater_than", "less_than", "greater_or_equal", "less_or_equal"]);
        if (mathOps.has(operator)) {
            const numLeft = Number(left);
            const numRight = Number(right);
            if (!isNaN(numLeft) && !isNaN(numRight)) {
                switch (operator) {
                    case "greater_than": return numLeft > numRight;
                    case "less_than": return numLeft < numRight;
                    case "greater_or_equal": return numLeft >= numRight;
                    case "less_or_equal": return numLeft <= numRight;
                }
            }
        }
    }

    // String comparisons (default fallback for all types too)
    switch (operator) {
        case "equals": return left === right;
        case "not_equals": return left !== right;
        case "greater_than": return left > right;
        case "less_than": return left < right;
        case "greater_or_equal": return left >= right;
        case "less_or_equal": return left <= right;
        case "contains": return left.includes(right);
        case "not_contains": return !left.includes(right);
        case "starts_with": return left.startsWith(right);
        case "ends_with": return left.endsWith(right);
        case "is_empty": return isEmpty(left);
        case "is_not_empty": return !isEmpty(left);
        default: return false;
    }
}

function toBool(value: string): boolean {
    const lower = value.toLowerCase().trim();
    return lower !== "" && lower !== "0" && lower !== "false" && lower !== "null";
}

function humanizeConditionRef(inputRef: string): string {
    return inputRef
        .replace(/\./g, " ")
        .replace(/-/g, " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/\s+/g, " ")
        .trim();
}

function formatConditionValue(value: string): string {
    return value === "" ? "empty" : value;
}

function getOperatorLabel(operator: ConditionOperator): string {
    switch (operator) {
        case "equals": return "is equal to";
        case "not_equals": return "is not equal to";
        case "greater_than": return "is greater than";
        case "less_than": return "is less than";
        case "greater_or_equal": return "is greater than or equal to";
        case "less_or_equal": return "is less than or equal to";
        case "contains": return "contains";
        case "not_contains": return "does not contain";
        case "starts_with": return "starts with";
        case "ends_with": return "ends with";
        case "is_empty": return "is empty";
        case "is_not_empty": return "is not empty";
    }
}

// ---------------------------------------------------------------------------
// Legacy string condition evaluation (backward compatible)
// ---------------------------------------------------------------------------

/**
 * Evaluate a plain string condition.
 * Supports: "value >= threshold", "value == expected", "value != bad"
 * Falls back to truthy check if no operator is found.
 */
export function evaluateLegacyCondition(condition: string): boolean {
    // Try comparison operators in order of specificity: >=, <=, !=, ==, >, <
    const comparisons: Array<{
        op: string;
        fn: (a: number, b: number) => boolean;
        stringFn?: (a: string, b: string) => boolean;
    }> = [
            { op: ">=", fn: (a, b) => a >= b },
            { op: "<=", fn: (a, b) => a <= b },
            { op: "!=", fn: (a, b) => a !== b, stringFn: (a, b) => a !== b },
            { op: "==", fn: (a, b) => a === b, stringFn: (a, b) => a === b },
            { op: ">", fn: (a, b) => a > b },
            { op: "<", fn: (a, b) => a < b },
        ];

    for (const { op, fn, stringFn } of comparisons) {
        const parts = condition.split(op).map((s) => s.trim());
        if (parts.length === 2) {
            const left = parts[0];
            const right = parts[1];

            // Try numeric comparison first
            const numLeft = Number(left);
            const numRight = Number(right);
            if (!isNaN(numLeft) && !isNaN(numRight)) {
                return fn(numLeft, numRight);
            }

            // Fall back to string comparison for == and !=
            if (stringFn) {
                return stringFn(left, right);
            }
        }
    }

    // Truthy check: non-empty, non-zero, non-"false"
    const trimmed = condition.trim().toLowerCase();
    return trimmed !== "" && trimmed !== "0" && trimmed !== "false" && trimmed !== "null";
}

// ---------------------------------------------------------------------------
// Constants for UI — available operators per value type
// ---------------------------------------------------------------------------

interface OperatorOption {
    value: ConditionOperator;
    label: string;
}

const NUMERIC_OPERATORS: OperatorOption[] = [
    { value: "equals", label: "is equal to" },
    { value: "not_equals", label: "is not equal to" },
    { value: "greater_than", label: "is greater than" },
    { value: "less_than", label: "is less than" },
    { value: "greater_or_equal", label: "is greater or equal to" },
    { value: "less_or_equal", label: "is less or equal to" },
    { value: "is_empty", label: "has no value" },
    { value: "is_not_empty", label: "has any value" },
];

const STRING_OPERATORS: OperatorOption[] = [
    { value: "equals", label: "is" },
    { value: "not_equals", label: "is not" },
    { value: "contains", label: "contains" },
    { value: "not_contains", label: "does not contain" },
    { value: "starts_with", label: "starts with" },
    { value: "ends_with", label: "ends with" },
    { value: "is_empty", label: "has no value" },
    { value: "is_not_empty", label: "has any value" },
];

const BOOLEAN_OPERATORS: OperatorOption[] = [
    { value: "equals", label: "is" },
    { value: "not_equals", label: "is not" },
];

/**
 * Get the available operators for a given value type.
 * Used by the condition builder UI to populate the operator dropdown.
 */
export function getOperatorsForType(valueType: string): OperatorOption[] {
    switch (valueType) {
        case "number": return NUMERIC_OPERATORS;
        case "boolean": return BOOLEAN_OPERATORS;
        case "string":
        default: return STRING_OPERATORS;
    }
}
