/* ==========================================================================
   Skills — Interface & Types
   Every skill action implements this interface.
   ========================================================================== */

import type { BlockCategory } from "@/lib/constants";
import type { VariableContext } from "@/engine/types";

/**
 * The result of executing a skill action.
 */
export interface SkillResult {
    /** Whether the action succeeded */
    success: boolean;
    /** Output data (stored in variable context if step has `output.as`) */
    data?: unknown;
    /** Human-readable message */
    message?: string;
    /** Error details if success is false */
    error?: string;
}

/**
 * Parameter definition for a skill action (used for UI form generation).
 */
export interface SkillParamDef {
    name: string;
    type: "string" | "number" | "boolean" | "address" | "amount";
    required: boolean;
    description: string;
    default?: unknown;
}

/**
 * Metadata describing a skill action (used by LLM and UI).
 */
export interface SkillActionMeta {
    /** Action name within the skill (e.g. "get_balance") */
    name: string;
    /** Human-readable label (e.g. "Get Token Balance") */
    label: string;
    /** Description for LLM and UI tooltips */
    description: string;
    /** Parameter definitions */
    params: SkillParamDef[];
    /** Whether this action requires user confirmation */
    requiresConfirmation?: boolean;
    /** Whether this action requires a wallet connection */
    requiresWallet?: boolean;
}

/**
 * A skill is a namespaced group of related actions.
 * e.g. "wallet" skill has actions: get_balance, send_eth, send_token
 */
export interface ISkill {
    /** Skill namespace (e.g. "wallet", "defi", "logic") */
    name: string;
    /** Human-readable label */
    label: string;
    /** Category for UI grouping and coloring */
    category: BlockCategory;
    /** Description */
    description: string;
    /** Available actions in this skill */
    actions: SkillActionMeta[];

    /**
     * Execute an action with the given parameters.
     *
     * @param action  — The action name to execute
     * @param params  — Resolved parameters (templates already substituted)
     * @param context — Variable context for accessing wallet/env info
     * @returns SkillResult
     */
    execute(
        action: string,
        params: Record<string, unknown>,
        context: VariableContext,
    ): Promise<SkillResult>;
}
