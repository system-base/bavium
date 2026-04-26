/* ==========================================================================
   Engine — Core Types
   The canonical type definitions for shortcuts, steps, inputs, and execution.
   These match the JSON schema defined in MASTER-PLAN.
   ========================================================================== */

import type { BlockCategory } from "@/lib/constants";
import type { NetworkId } from "@/lib/chain-config";

// ---------------------------------------------------------------------------
// Input types — what the user provides when running a shortcut
// ---------------------------------------------------------------------------

export type InputType =
    | "address"   // Ethereum address or ENS/Basename
    | "amount"    // Token amount (with optional constraints)
    | "text"      // Free-form text
    | "token"     // Token selector dropdown
    | "boolean"   // Toggle switch
    | "select"    // Dropdown with options
    | "number";   // Numeric value

export interface InputConstraints {
    min?: string;
    max?: string;
    token?: string;
    options?: { label: string; value: string }[];
}

export interface ShortcutInput {
    id: string;
    label: string;
    type: InputType;
    required: boolean;
    placeholder?: string;
    default?: string;
    constraints?: InputConstraints;
}

// ---------------------------------------------------------------------------
// Condition types — structured condition for Apple Shortcuts-style UX
// ---------------------------------------------------------------------------

/** Comparison operators supported by the condition builder */
export type ConditionOperator =
    | "equals"            // ==
    | "not_equals"        // !=
    | "greater_than"      // >
    | "less_than"         // <
    | "greater_or_equal"  // >=
    | "less_or_equal"     // <=
    | "contains"          // string contains substring
    | "not_contains"      // string does not contain substring
    | "starts_with"       // string starts with prefix
    | "ends_with"         // string ends with suffix
    | "is_empty"          // value is empty/null/undefined
    | "is_not_empty";     // value is not empty

/** Value type hint — determines which operators are available in the UI */
export type ConditionValueType = "number" | "string" | "boolean";
export type ConditionGroupMode = "all" | "any";

/**
 * Structured condition expression.
 * The UI builds this object via dropdowns instead of free-text.
 *
 * Example: { inputRef: "step-1.balance", operator: "greater_than",
 *            compareValue: "2000", valueType: "number" }
 */
export interface ConditionExpression {
    /** Reference to a step output or input field (e.g. "step-1.balance", "input.amount") */
    inputRef: string;
    /** Comparison operator */
    operator: ConditionOperator;
    /** Value to compare against (may be a literal or a {{template}} reference) */
    compareValue: string;
    /** Hint about the value type — controls which operators are offered */
    valueType: ConditionValueType;
}

export interface ConditionGroup {
    /** How child conditions are combined: all=AND, any=OR */
    mode: ConditionGroupMode;
    /** Child conditions evaluated recursively */
    conditions: StructuredCondition[];
}

export type StructuredCondition = ConditionExpression | ConditionGroup;

// ---------------------------------------------------------------------------
// Step types — individual operations in a shortcut
// ---------------------------------------------------------------------------

export type FailureStrategy = "abort" | "continue" | `retry(${number})`;

export interface StepOutput {
    /** Variable name to store the result as */
    as: string;
}

export interface ShortcutStep {
    /** Unique step identifier within the shortcut */
    id: string;
    /** Skill namespace (e.g. "wallet", "defi", "logic") */
    skill: string;
    /** Action within the skill (e.g. "get_balance", "supply") */
    action: string;
    /** Step IDs this step depends on (executed after all deps complete) */
    dependsOn?: string[];
    /** Parameters passed to the skill action */
    params: Record<string, unknown>;
    /** If true, requires explicit user approval before executing */
    confirm?: boolean;
    /** How to store the result for downstream steps */
    output?: StepOutput;
    /** What to do if this step fails */
    onFailure?: FailureStrategy;
    /**
     * Conditional expression — step only runs if this evaluates to true.
     * Legacy string format ("100 >= 50") is still supported.
     * New structured format (ConditionExpression) is preferred.
     */
    condition?: string | StructuredCondition;
    /** Steps to execute when an if_else condition is true */
    thenSteps?: ShortcutStep[];
    /** Steps to execute when an if_else condition is false */
    elseSteps?: ShortcutStep[];
    /** Steps to execute for each loop iteration in repeat-style blocks */
    repeatSteps?: ShortcutStep[];
}

// ---------------------------------------------------------------------------
// Shortcut — the complete workflow definition
// ---------------------------------------------------------------------------

export interface Shortcut {
    id: string;
    name: string;
    description: string;
    version: string;
    author: string;
    icon: string;
    color: string;
    category: BlockCategory;
    tags: string[];
    inputs: ShortcutInput[];
    steps: ShortcutStep[];
    createdAt: string;
    updatedAt: string;
}

// ---------------------------------------------------------------------------
// Execution types — runtime state and results
// ---------------------------------------------------------------------------

export type StepStatus =
    | "pending"
    | "running"
    | "waiting_confirmation"
    | "waiting_input"
    | "waiting_signature"
    | "success"
    | "error"
    | "skipped";

export interface StepResult {
    stepId: string;
    status: StepStatus;
    /** The data output of this step (stored in variable store) */
    output?: unknown;
    /** Error message if status is "error" */
    error?: string;
    /** Execution duration in ms */
    durationMs: number;
    /** ISO timestamp when step started */
    startedAt: string;
    /** ISO timestamp when step completed */
    completedAt?: string;
}

export interface RunResult {
    /** Unique run identifier */
    runId: string;
    /** The shortcut that was executed */
    shortcutId: string;
    /** Overall run status */
    status: "running" | "success" | "error" | "aborted" | "waiting_confirmation" | "waiting_input" | "waiting_signature";
    /** User-provided input values */
    inputValues: Record<string, unknown>;
    /** Results for each step, in execution order */
    steps: StepResult[];
    /** Pending interactive request when execution pauses for user input or approval */
    pendingInteraction?: unknown;
    /** Total execution duration in ms */
    totalDurationMs: number;
    /** ISO timestamp */
    startedAt: string;
    completedAt?: string;
}

// ---------------------------------------------------------------------------
// Variable store — template resolution context
// ---------------------------------------------------------------------------

export interface VariableContext {
    /** User-provided inputs: {{input.fieldId}} */
    input: Record<string, unknown>;
    /** Step outputs: {{stepId.outputField}} or {{stepId}} */
    steps: Record<string, unknown>;
    /** Wallet info: {{wallet.address}}, {{wallet.balance.TOKEN}} */
    wallet: {
        address?: string;
        basename?: string;
        balance?: Record<string, string>;
    };
    /** Environment: {{env.TIMESTAMP}}, {{env.NETWORK}} */
    env: Record<string, string>;
    /**
     * Resolved network ID for this execution context.
     * Derived from wallet chain when connected, env fallback otherwise.
     * Skills should use this rather than calling getActiveNetwork() directly.
     */
    networkId?: NetworkId;
}
