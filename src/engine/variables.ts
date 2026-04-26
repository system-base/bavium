/* ==========================================================================
   Engine — Variable Store & Template Resolution
   Resolves {{input.x}}, {{stepId.field}}, {{wallet.address}}, {{env.X}}
   ========================================================================== */

import type { VariableContext } from "./types";
import { getActiveNetwork, type NetworkId } from "@/lib/chain-config";

/** Type guard: narrows unknown to a plain object with string keys */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Create an empty variable context with defaults.
 * If networkId is provided, it will be stored so skills can
 * use the correct chain instead of falling back to env.
 */
export function createVariableContext(
    inputValues: Record<string, unknown> = {},
    networkId?: NetworkId,
): VariableContext {
    const walletAddress = resolveWalletAddress(inputValues);
    const network = getActiveNetwork();
    const nestedWallet = isRecord(inputValues.wallet) ? inputValues.wallet : undefined;
    const walletBalance =
        nestedWallet && isRecord(nestedWallet.balance)
            ? Object.fromEntries(
                Object.entries(nestedWallet.balance).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
            )
            : undefined;
    const walletBasename =
        nestedWallet && typeof nestedWallet.basename === "string"
            ? nestedWallet.basename
            : undefined;

    return {
        input: inputValues,
        steps: {},
        wallet: walletAddress
            ? {
                address: walletAddress,
                ...(walletBalance ? { balance: walletBalance } : {}),
                ...(walletBasename ? { basename: walletBasename } : {}),
            }
            : {},
        env: {
            TIMESTAMP: new Date().toISOString(),
            NETWORK: networkId ?? network.networkId,
        },
        networkId: networkId ?? network.networkId,
    };
}

function resolveWalletAddress(inputValues: Record<string, unknown>): string | undefined {
    // Preferred key from API route
    const direct = inputValues.walletAddress;
    if (typeof direct === "string" && direct.startsWith("0x")) {
        return direct;
    }

    // Backward compatibility for old payload shape: input["wallet.address"]
    const legacy = inputValues["wallet.address"];
    if (typeof legacy === "string" && legacy.startsWith("0x")) {
        return legacy;
    }

    // Optional nested shape: input.wallet.address
    const nestedWallet = inputValues.wallet;
    if (isRecord(nestedWallet) && "address" in nestedWallet) {
        const nestedAddress = nestedWallet.address;
        if (typeof nestedAddress === "string" && nestedAddress.startsWith("0x")) {
            return nestedAddress;
        }
    }

    return undefined;
}

/**
 * Store a step's output in the variable context.
 */
export function setStepOutput(
    ctx: VariableContext,
    stepId: string,
    output: unknown,
): void {
    ctx.steps[stepId] = output;
}

function unwrapWholeStepReference(output: unknown): unknown {
    if (!isRecord(output)) return output;
    if (typeof output.text === "string") return output.text;
    if (typeof output.result === "number") return output.result;
    return output;
}

/**
 * Resolve all `{{...}}` template expressions in a value.
 *
 * Supported patterns:
 *   {{input.fieldId}}          → ctx.input[fieldId]
 *   {{stepId}}                 → ctx.steps[stepId] (the whole output)
 *   {{stepId.field}}           → ctx.steps[stepId][field]
 *   {{wallet.address}}         → ctx.wallet.address
 *   {{wallet.balance.TOKEN}}   → ctx.wallet.balance[TOKEN]
 *   {{env.TIMESTAMP}}          → ctx.env[TIMESTAMP]
 */
export function resolveTemplate(
    template: unknown,
    ctx: VariableContext,
): unknown {
    // Non-string values pass through
    if (typeof template !== "string") return template;

    // If the entire string is a single expression, return the raw value
    // (preserves non-string types like numbers, objects)
    // Note: [^}]+ prevents greedy expansion across multiple }} pairs
    const singleExprMatch = template.match(/^\{\{([^}]+)\}\}$/);
    if (singleExprMatch) {
        return resolveExpression(singleExprMatch[1].trim(), ctx);
    }

    // Otherwise, interpolate all expressions into the string
    return template.replace(/\{\{([^}]+)\}\}/g, (_match, expr: string) => {
        const value = resolveExpression(expr.trim(), ctx);
        return value === undefined || value === null ? "" : String(value);
    });
}

/**
 * Resolve a single dotted expression like "input.amount" or "stepId.field".
 */
function resolveExpression(
    expr: string,
    ctx: VariableContext,
): unknown {
    const parts = expr.split(".");

    if (parts.length === 0) return undefined;

    const root = parts[0];

    // {{input.fieldId}}
    if (root === "input") {
        return getNestedValue(ctx.input, parts.slice(1));
    }

    // {{wallet.address}} or {{wallet.balance.TOKEN}}
    if (root === "wallet") {
        return getNestedValue(ctx.wallet, parts.slice(1));
    }

    // {{env.TIMESTAMP}}
    if (root === "env") {
        return getNestedValue(ctx.env, parts.slice(1));
    }

    // {{stepId}} or {{stepId.field}}
    if (parts.length === 1) {
        return unwrapWholeStepReference(ctx.steps[root]);
    }
    return getNestedValue(ctx.steps[root], parts.slice(1));
}

/**
 * Safely traverse a nested object by an array of keys.
 */
function getNestedValue(
    obj: unknown,
    keys: string[],
): unknown {
    let current = obj;
    for (const key of keys) {
        if (Array.isArray(current)) {
            const index = Number.parseInt(key, 10);
            if (!Number.isInteger(index) || index < 0 || index >= current.length) {
                return undefined;
            }
            current = current[index];
            continue;
        }
        if (!isRecord(current)) return undefined;
        current = current[key];
    }
    return current;
}

/**
 * Resolve all template expressions in a params object (deep).
 * Returns a new object with all {{...}} replaced.
 */
export function resolveParams(
    params: Record<string, unknown>,
    ctx: VariableContext,
): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
        if (typeof value === "string") {
            resolved[key] = resolveTemplate(value, ctx);
        } else if (Array.isArray(value)) {
            resolved[key] = value.map((item) =>
                typeof item === "string" ? resolveTemplate(item, ctx) : item,
            );
        } else if (isRecord(value)) {
            resolved[key] = resolveParams(
                value,
                ctx,
            );
        } else {
            resolved[key] = value;
        }
    }
    return resolved;
}
