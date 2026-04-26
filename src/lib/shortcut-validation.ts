import type { Shortcut, ShortcutStep } from "@/engine/types";
import { getActiveNetwork, getTokenInfo, type NetworkId } from "@/lib/chain-config";
import type { SkillParamDef } from "@/lib/constants";
import {
    getPlannerSkillManifestEntry,
    type PlannerSkillManifestEntry,
    type SupportedChain,
} from "@/lib/skill-manifest";
import { isAddress } from "viem";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class ShortcutValidationError extends Error {
    issues: string[];

    constructor(issues: string[]) {
        super(issues.join(" | "));
        this.name = "ShortcutValidationError";
        this.issues = issues;
    }
}

const CONDITION_OPERATORS = new Set([
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

const CONDITION_VALUE_TYPES = new Set(["number", "string", "boolean"]);
const MATH_OPERATORS = new Set(["+", "-", "*", "/", "%"]);
const SAVED_VARIABLE_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

function getCurrentSupportedChain(networkId?: NetworkId): SupportedChain {
    const resolvedNetworkId = networkId ?? getActiveNetwork().networkId;
    return resolvedNetworkId === "base-mainnet" ? "base" : "base-sepolia";
}

function hasWalletContext(
    step: ShortcutStep,
    inputValues: Record<string, unknown>,
): boolean {
    const inputWalletAddress = inputValues.walletAddress;
    if (typeof inputWalletAddress === "string" && inputWalletAddress.startsWith("0x")) {
        return true;
    }

    const legacyWalletAddress = inputValues["wallet.address"];
    if (typeof legacyWalletAddress === "string" && legacyWalletAddress.startsWith("0x")) {
        return true;
    }

    const nestedWallet = inputValues.wallet;
    if (
        isRecord(nestedWallet) &&
        "address" in nestedWallet &&
        typeof nestedWallet.address === "string" &&
        nestedWallet.address.startsWith("0x")
    ) {
        return true;
    }

    const stepWalletAddress = step.params.address ?? step.params.wallet ?? step.params.walletAddress;
    return typeof stepWalletAddress === "string" && stepWalletAddress.startsWith("0x");
}

function getNestedInputValue(
    inputValues: Record<string, unknown>,
    path: string,
): unknown {
    const direct = inputValues[path];
    if (direct !== undefined) return direct;

    const parts = path.split(".");
    let current: unknown = inputValues;

    for (const part of parts) {
        if (!isRecord(current)) return undefined;
        current = current[part];
    }

    return current;
}

function tryResolveExactInputTemplate(
    value: unknown,
    inputValues: Record<string, unknown>,
): { resolved: boolean; value: unknown } | null {
    if (typeof value !== "string") return null;

    const match = value.match(/^\{\{\s*input\.([^}]+)\s*\}\}$/);
    if (!match) return null;

    return {
        resolved: true,
        value: getNestedInputValue(inputValues, match[1].trim()),
    };
}

function containsDynamicTemplate(value: unknown): boolean {
    return typeof value === "string" && value.includes("{{") && value.includes("}}");
}

function extractSingleTemplateExpression(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const match = value.match(/^\{\{\s*([^}]+)\s*\}\}$/);
    return match ? match[1].trim() : null;
}

function isSavedVariableName(value: string): boolean {
    return SAVED_VARIABLE_NAME.test(value);
}

function isSavedVariableTemplateReference(value: unknown): boolean {
    const expr = extractSingleTemplateExpression(value);
    if (!expr) return false;
    if (expr.includes(".")) return false;
    if (expr === "input" || expr === "wallet" || expr === "env") return false;
    if (/^step-\d+$/.test(expr)) return false;
    return isSavedVariableName(expr);
}

function parseDelimitedOptions(value: unknown): string[] {
    if (typeof value !== "string") return [];

    return value
        .split(/\r?\n|,/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}

function extractInputTemplatePaths(value: unknown): string[] {
    if (typeof value !== "string") return [];

    const refs = new Set<string>();
    for (const match of value.matchAll(/\{\{\s*input\.([^}]+)\s*\}\}/g)) {
        const path = match[1]?.trim();
        if (path) {
            refs.add(path);
        }
    }

    return Array.from(refs);
}

function isMissingValue(value: unknown): boolean {
    return (
        value === undefined ||
        value === null ||
        (typeof value === "string" && value.trim().length === 0)
    );
}

function isFiniteNumericValue(value: unknown): boolean {
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value !== "string") return false;

    const trimmed = value.trim();
    if (trimmed.length === 0) return false;

    return Number.isFinite(Number(trimmed));
}

function hasResolvableInputPath(
    inputValues: Record<string, unknown>,
    path: string,
): boolean {
    return getNestedInputValue(inputValues, path) !== undefined;
}

function isValidConditionExpression(value: unknown): boolean {
    if (!isRecord(value)) return false;

    const inputRef = value.inputRef;
    const operator = value.operator;
    const valueType = value.valueType;
    const compareValue = value.compareValue;

    if (typeof inputRef !== "string" || inputRef.trim().length === 0) return false;
    if (typeof operator !== "string" || !CONDITION_OPERATORS.has(operator)) return false;
    if (typeof valueType !== "string" || !CONDITION_VALUE_TYPES.has(valueType)) return false;

    if (operator === "is_empty" || operator === "is_not_empty") {
        return compareValue === undefined || typeof compareValue === "string";
    }

    return typeof compareValue === "string";
}

function isValidConditionGroup(value: unknown): boolean {
    if (!isRecord(value)) return false;
    if (value.mode !== "all" && value.mode !== "any") return false;
    if (!Array.isArray(value.conditions)) return false;
    return value.conditions.every((condition) =>
        isValidConditionExpression(condition) || isValidConditionGroup(condition),
    );
}

function validateConditionValue(value: unknown): boolean {
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed.length === 0) return false;

        if (trimmed.startsWith("{")) {
            try {
                const parsed = JSON.parse(trimmed);
                return isValidConditionExpression(parsed) || isValidConditionGroup(parsed);
            } catch {
                return false;
            }
        }

        return true;
    }

    return isValidConditionExpression(value) || isValidConditionGroup(value);
}

function validateParamType(
    paramDef: SkillParamDef,
    value: unknown,
    networkId?: NetworkId,
): string | null {
    switch (paramDef.type) {
        case "address":
            if (typeof value !== "string" || !isAddress(value.trim())) {
                return "must be a valid 0x address";
            }
            return null;
        case "amount":
        case "number":
            if (!isFiniteNumericValue(value)) {
                return "must be a valid number";
            }
            return null;
        case "token":
            if (typeof value !== "string") {
                return "must be a token symbol or token address";
            }
            if (isAddress(value.trim())) return null;
            if (!getTokenInfo(value.trim(), networkId)) {
                return "must be a known token symbol or a valid token address";
            }
            return null;
        case "select":
            if (typeof value !== "string" || !paramDef.options?.some((option) => option.value === value)) {
                return "must be one of the allowed options";
            }
            return null;
        case "operator":
            if (typeof value !== "string" || !MATH_OPERATORS.has(value)) {
                return "must be a supported math operator";
            }
            return null;
        case "boolean":
            if (
                typeof value !== "boolean" &&
                value !== "true" &&
                value !== "false"
            ) {
                return "must be a boolean value";
            }
            return null;
        case "condition":
            if (!validateConditionValue(value)) {
                return "must be a valid condition expression";
            }
            return null;
        case "text":
        default:
            return null;
    }
}

function validateInputTemplateAvailability(
    value: unknown,
    fieldPath: string,
    inputValues: Record<string, unknown>,
    issues: string[],
): void {
    for (const inputPath of extractInputTemplatePaths(value)) {
        if (!hasResolvableInputPath(inputValues, inputPath)) {
            issues.push(
                `${fieldPath}: references {{input.${inputPath}}}, but this execution mode does not provide that input value`,
            );
        }
    }
}

function validateConditionInputAvailability(
    condition: unknown,
    fieldPath: string,
    inputValues: Record<string, unknown>,
    issues: string[],
): void {
    if (!condition) return;

    if (typeof condition === "string") {
        validateInputTemplateAvailability(condition, fieldPath, inputValues, issues);
        return;
    }

    if (!isRecord(condition)) {
        return;
    }

    if (Array.isArray(condition.conditions)) {
        condition.conditions.forEach((child, index) => {
            validateConditionInputAvailability(
                child,
                `${fieldPath}.conditions[${index}]`,
                inputValues,
                issues,
            );
        });
    }

    if (typeof condition.inputRef === "string" && condition.inputRef.startsWith("input.")) {
        const inputPath = condition.inputRef.slice("input.".length).trim();
        if (inputPath && !hasResolvableInputPath(inputValues, inputPath)) {
            issues.push(
                `${fieldPath}.inputRef: references input.${inputPath}, but this execution mode does not provide that input value`,
            );
        }
    }

    if ("compareValue" in condition) {
        validateInputTemplateAvailability(
            condition.compareValue,
            `${fieldPath}.compareValue`,
            inputValues,
            issues,
        );
    }
}

function validateStepParams(
    step: ShortcutStep,
    manifest: PlannerSkillManifestEntry,
    path: string,
    inputValues: Record<string, unknown>,
    issues: string[],
    networkId?: NetworkId,
): void {
    for (const paramDef of manifest.params) {
        const rawValue = step.params[paramDef.key];
        const resolvedInputTemplate = tryResolveExactInputTemplate(rawValue, inputValues);
        const valueForValidation =
            resolvedInputTemplate?.resolved ? resolvedInputTemplate.value : rawValue;

        if (isMissingValue(valueForValidation)) {
            if (paramDef.required && paramDef.defaultValue === undefined) {
                issues.push(`${path}.params.${paramDef.key}: required value is missing`);
            }
            continue;
        }

        if (containsDynamicTemplate(rawValue) && !resolvedInputTemplate?.resolved) {
            continue;
        }

        const typeError = validateParamType(paramDef, valueForValidation, networkId);
        if (typeError) {
            issues.push(`${path}.params.${paramDef.key}: ${typeError}`);
        }
    }
}

interface ValidationMode {
    enforceChainSupport: boolean;
    enforceWalletContext: boolean;
    networkId?: NetworkId;
    allowInteractiveInput: boolean;
    allowShortcutInputs: boolean;
}

export type ShortcutWithOptionalInputs = Pick<Shortcut, "steps"> & {
    inputs?: Shortcut["inputs"];
};

export interface ShortcutAutomationCompatibility {
    compatible: boolean;
    issues: string[];
}

function validateStepAgainstManifest(
    step: ShortcutStep,
    manifest: PlannerSkillManifestEntry | undefined,
    path: string,
    currentChain: SupportedChain,
    inputValues: Record<string, unknown>,
    issues: string[],
    mode: ValidationMode,
): void {
    const skillId = `${step.skill}.${step.action}`;

    if (!manifest) {
        issues.push(`${path}: unsupported skill "${skillId}"`);
        return;
    }

    const chainSupported =
        manifest.supportedChains.includes("offchain") ||
        manifest.supportedChains.includes(currentChain);

    if (mode.enforceChainSupport && !chainSupported) {
        issues.push(
            `${path}: "${skillId}" is not supported on ${currentChain}. Supported: ${manifest.supportedChains.join(", ")}`,
        );
    }

    if (manifest.requiresConfirmation && step.confirm !== true) {
        issues.push(`${path}: "${skillId}" requires confirmation`);
    }

    if (!mode.allowInteractiveInput) {
        if (manifest.requiresConfirmation) {
            issues.push(
                `${path}: "${skillId}" requires wallet confirmation and cannot run inside automations`,
            );
        } else if (manifest.producesTransaction) {
            issues.push(
                `${path}: "${skillId}" produces an unsigned transaction and cannot run inside automations`,
            );
        }
    }

    if (mode.enforceWalletContext && manifest.requiresWallet && !hasWalletContext(step, inputValues)) {
        issues.push(`${path}: "${skillId}" requires a connected wallet or wallet address context`);
    }

    validateStepParams(step, manifest, path, inputValues, issues, mode.networkId);
    validateVariableStepContract(step, skillId, path, issues);
    validateExecutionModeContract(step, skillId, path, inputValues, issues, mode);

    if (step.thenSteps) {
        for (const [index, nestedStep] of step.thenSteps.entries()) {
            validateStepTree(
                nestedStep,
                `${path}.thenSteps[${index}]`,
                currentChain,
                inputValues,
                issues,
                mode,
            );
        }
    }

    if (step.elseSteps) {
        for (const [index, nestedStep] of step.elseSteps.entries()) {
            validateStepTree(
                nestedStep,
                `${path}.elseSteps[${index}]`,
                currentChain,
                inputValues,
                issues,
                mode,
            );
        }
    }

    if (step.repeatSteps) {
        for (const [index, nestedStep] of step.repeatSteps.entries()) {
            validateStepTree(
                nestedStep,
                `${path}.repeatSteps[${index}]`,
                currentChain,
                inputValues,
                issues,
                mode,
            );
        }
    }
}

function validateVariableStepContract(
    step: ShortcutStep,
    skillId: string,
    path: string,
    issues: string[],
): void {
    const savedName = step.output?.as?.trim();

    if (savedName && !isSavedVariableName(savedName)) {
        issues.push(`${path}.output.as: variable names must start with a letter and use only letters, numbers, hyphens, or underscores`);
    }

    if (skillId === "logic.set_variable" && !savedName) {
        issues.push(`${path}: "logic.set_variable" requires output.as because this block only makes sense when the value is explicitly saved`);
    }

    if (skillId === "logic.get_variable") {
        const variableRef = step.params.variable;
        if (!isSavedVariableTemplateReference(variableRef)) {
            issues.push(`${path}.params.variable: "logic.get_variable" must reference a saved variable like {{latestPrice}}`);
        }
    }

    if (skillId === "logic.choose_menu") {
        const options = parseDelimitedOptions(step.params.options);
        if (options.length === 0) {
            issues.push(`${path}.params.options: "logic.choose_menu" requires at least one menu option`);
        }

        const defaultValue = step.params.defaultValue;
        if (
            typeof defaultValue === "string" &&
            defaultValue.trim().length > 0 &&
            options.length > 0 &&
            !options.includes(defaultValue.trim())
        ) {
            issues.push(`${path}.params.defaultValue: default option must match one of the declared menu options`);
        }
    }

    if (skillId === "logic.if_else") {
        if ((step.thenSteps?.length ?? 0) === 0 && (step.elseSteps?.length ?? 0) === 0) {
            issues.push(`${path}: "logic.if_else" should include at least one nested step in thenSteps or elseSteps`);
        }
    } else if (step.thenSteps || step.elseSteps) {
        issues.push(`${path}: only "logic.if_else" can contain thenSteps or elseSteps`);
    }

    if (skillId === "logic.repeat" || skillId === "logic.repeat_each") {
        if ((step.repeatSteps?.length ?? 0) === 0) {
            issues.push(`${path}: "${skillId}" requires at least one nested step in repeatSteps`);
        }
    } else if (step.repeatSteps) {
        issues.push(`${path}: only repeat blocks can contain repeatSteps`);
    }
}

function validateExecutionModeContract(
    step: ShortcutStep,
    skillId: string,
    path: string,
    inputValues: Record<string, unknown>,
    issues: string[],
    mode: ValidationMode,
): void {
    if (!mode.allowInteractiveInput && (skillId === "logic.ask_input" || skillId === "logic.choose_menu")) {
        issues.push(
            `${path}: "${skillId}" pauses for mid-flow user input and cannot run inside automations`,
        );
    }

    if (mode.allowShortcutInputs) {
        return;
    }

    for (const [paramKey, paramValue] of Object.entries(step.params)) {
        validateInputTemplateAvailability(
            paramValue,
            `${path}.params.${paramKey}`,
            inputValues,
            issues,
        );
    }

    validateConditionInputAvailability(
        step.condition,
        `${path}.condition`,
        inputValues,
        issues,
    );
}

function validateStepTree(
    step: ShortcutStep,
    path: string,
    currentChain: SupportedChain,
    inputValues: Record<string, unknown>,
    issues: string[],
    mode: ValidationMode,
): void {
    const manifest = getPlannerSkillManifestEntry(`${step.skill}.${step.action}`);
    validateStepAgainstManifest(step, manifest, path, currentChain, inputValues, issues, mode);
}

export function validateShortcutDefinition(
    shortcut: Pick<Shortcut, "steps">,
    options: {
        inputValues?: Record<string, unknown>;
        networkId?: NetworkId;
        enforceChainSupport?: boolean;
    } = {},
): void {
    const currentChain = getCurrentSupportedChain(options.networkId);
    const issues: string[] = [];
    const mode: ValidationMode = {
        enforceChainSupport: options.enforceChainSupport ?? false,
        enforceWalletContext: false,
        networkId: options.networkId,
        allowInteractiveInput: true,
        allowShortcutInputs: true,
    };

    for (const [index, step] of shortcut.steps.entries()) {
        validateStepTree(
            step,
            `steps[${index}]`,
            currentChain,
            options.inputValues ?? {},
            issues,
            mode,
        );
    }

    if (issues.length > 0) {
        throw new ShortcutValidationError(issues);
    }
}

export function validateShortcutForExecution(
    shortcut: Shortcut,
    inputValues: Record<string, unknown> = {},
    networkId?: NetworkId,
): void {
    const currentChain = getCurrentSupportedChain(networkId);
    const issues: string[] = [];
    const mode: ValidationMode = {
        enforceChainSupport: true,
        enforceWalletContext: true,
        networkId,
        allowInteractiveInput: true,
        allowShortcutInputs: true,
    };

    for (const [index, step] of shortcut.steps.entries()) {
        validateStepTree(step, `steps[${index}]`, currentChain, inputValues, issues, mode);
    }

    if (issues.length > 0) {
        throw new ShortcutValidationError(issues);
    }
}

export function validateShortcutForAutomation(
    shortcut: ShortcutWithOptionalInputs,
    inputValues: Record<string, unknown> = {},
    networkId?: NetworkId,
): void {
    const currentChain = getCurrentSupportedChain(networkId);
    const issues: string[] = [];
    const mode: ValidationMode = {
        enforceChainSupport: true,
        enforceWalletContext: true,
        networkId,
        allowInteractiveInput: false,
        allowShortcutInputs: false,
    };

    if ((shortcut.inputs ?? []).length > 0) {
        issues.push(
            "shortcut.inputs: automations cannot wait for values asked at start; replace Ask Each Time fields with fixed values or automation-provided context",
        );
    }

    for (const [index, step] of shortcut.steps.entries()) {
        validateStepTree(step, `steps[${index}]`, currentChain, inputValues, issues, mode);
    }

    if (issues.length > 0) {
        throw new ShortcutValidationError(issues);
    }
}

export function getShortcutAutomationCompatibility(
    shortcut: ShortcutWithOptionalInputs,
    inputValues: Record<string, unknown> = {},
    networkId?: NetworkId,
): ShortcutAutomationCompatibility {
    try {
        validateShortcutForAutomation(shortcut, inputValues, networkId);
        return {
            compatible: true,
            issues: [],
        };
    } catch (error) {
        if (error instanceof ShortcutValidationError) {
            return {
                compatible: false,
                issues: error.issues,
            };
        }

        return {
            compatible: false,
            issues: ["Selected shortcut is not automation-compatible."],
        };
    }
}
