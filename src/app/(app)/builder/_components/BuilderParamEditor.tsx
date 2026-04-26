"use client";

import {
    useState,
    useMemo,
    useCallback,
    useRef,
    useEffect,
    useDeferredValue,
    type ReactNode,
} from "react";
import { Combobox, Skeleton } from "@/components/ui";
import type {
    ConditionExpression,
    ConditionGroup,
    ConditionGroupMode,
    ConditionOperator,
    InputType,
    ShortcutInput,
    StructuredCondition,
    ConditionValueType,
} from "@/engine/types";
import { getOperatorsForType } from "@/engine/condition";
import { X, Info, Clock, ChevronDown } from "lucide-react";
import { useAccount } from "wagmi";
import {
    SKILL_PALETTE,
    type SkillDefinition,
    type SkillParamDef,
} from "@/lib/constants";
import { getAcrossDestinationOptionsForNetwork } from "@/lib/across-config";
import {
    getRegisteredTokens,
    getTokenInfo,
    getTokenInfoByAddress,
    type NetworkId,
} from "@/lib/chain-config";
import type {
    BuilderBlock as CanvasBlock,
    BuilderBlockParam as BlockParam,
} from "@/lib/builder-shortcut";
import {
    findBlockById,
    getAccessiblePriorBlocks,
} from "../_lib/block-utils";
import { TokenParamInput } from "./TokenParamInput";
import { TokenListParamInput } from "./TokenListParamInput";
import { ChoiceListParamInput } from "./ChoiceListParamInput";
import {
    buildUniswapExactInputPreview,
    formatFeeTierLabel,
    formatSlippageBpsLabel,
    type UniswapExactInputPreview,
} from "@/lib/uniswap-v3";

const SWAP_SLIPPAGE_OPTIONS = [
    {
        label: "Auto (Recommended)",
        value: "auto",
        description: "Bavium currently uses a 0.5% default.",
    },
    { label: "0.10%", value: "10" },
    { label: "0.50%", value: "50" },
    { label: "1.00%", value: "100" },
    { label: "3.00%", value: "300" },
    { label: "5.00%", value: "500" },
] satisfies Array<{ label: string; value: string; description?: string }>;

function getSwapSlippageOptions(currentValue: string) {
    const normalized = currentValue.trim().toLowerCase();
    const hasPreset = SWAP_SLIPPAGE_OPTIONS.some((option) => option.value === normalized);
    if (normalized === "" || hasPreset) {
        return SWAP_SLIPPAGE_OPTIONS;
    }

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return SWAP_SLIPPAGE_OPTIONS;
    }

    return [
        ...SWAP_SLIPPAGE_OPTIONS,
        {
            label: `Custom (${formatSlippageBpsLabel(parsed)})`,
            value: normalized,
            description: "Existing shortcut value. Pick a preset to return to the standard product path.",
            group: "Custom",
        },
    ];
}

function findSkillDef(skillId: string): SkillDefinition | undefined {
    return SKILL_PALETTE.find((skill) => skill.id === skillId);
}

function getNetworkScopedParamDef(
    skillId: string,
    paramDef: SkillParamDef,
    networkId?: string,
): SkillParamDef {
    if (skillId.startsWith("bridge.") && paramDef.key === "destinationChainId") {
        return {
            ...paramDef,
            options: getAcrossDestinationOptionsForNetwork(networkId),
        };
    }

    return paramDef;
}

const OPERATOR_OPTIONS = [
    { label: "+", value: "+" },
    { label: "−", value: "-" },
    { label: "×", value: "*" },
    { label: "÷", value: "/" },
    { label: "%", value: "%" },
];

function SmartParamInput({
    blockSkillId,
    paramDef,
    value,
    onChange,
    networkId,
    shortcutInputs,
}: {
    blockSkillId: string;
    paramDef: SkillParamDef;
    value: string;
    onChange: (val: string) => void;
    networkId?: string;
    shortcutInputs?: ShortcutInput[];
}) {
    const baseInputCls =
        "h-9 w-full min-w-0 rounded-md border border-border-subtle bg-tertiary px-3 text-sm text-fg outline-none transition-colors placeholder:text-fg-muted hover:border-border-default focus:border-border-strong focus:bg-elevated";
    const isTemplateValue = value.startsWith("{{") && value.endsWith("}}");

    const linkedValueChip = (
        <div className="flex items-center gap-1.5 min-w-0">
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-brand-subtle text-brand-light truncate">
                {formatTemplateDisplay(value, undefined, shortcutInputs)}
            </span>
            <button
                type="button"
                className="shrink-0 w-4 h-4 flex items-center justify-center rounded text-fg-muted hover:text-fg transition-colors"
                onClick={() => onChange("")}
                title="Clear linked value"
            >
                <X size={10} />
            </button>
        </div>
    );
    const isTokenListField =
        paramDef.key === "tokens" &&
        (blockSkillId === "data.token_prices" || blockSkillId === "data.portfolio_snapshot");
    const isChoiceListField =
        blockSkillId === "logic.choose_menu" && paramDef.key === "options";

    if (isTemplateValue && (paramDef.type === "token" || isTokenListField)) {
        return linkedValueChip;
    }

    if (isTemplateValue && blockSkillId === "swap.uniswap_prepare_swap" && paramDef.key === "slippageBps") {
        return linkedValueChip;
    }

    if (blockSkillId === "swap.uniswap_prepare_swap" && paramDef.key === "slippageBps") {
        return (
            <Combobox
                options={getSwapSlippageOptions(value)}
                value={value || "auto"}
                onChange={onChange}
                hint={paramDef.hint}
            />
        );
    }

    switch (paramDef.type) {
        case "token":
            return <TokenParamInput value={value} onChange={onChange} networkId={networkId} hint={paramDef.hint} />;

        case "select":
            return (
                <Combobox
                    options={paramDef.options ?? []}
                    value={value}
                    onChange={onChange}
                    hint={paramDef.hint}
                />
            );

        case "operator":
            return (
                <div className="flex gap-1 flex-wrap">
                    {OPERATOR_OPTIONS.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            onClick={() => onChange(option.value)}
                            className={`w-8 h-7 text-sm font-mono font-bold rounded border transition-all ${value === option.value
                                ? "bg-brand border-brand text-white"
                                : "bg-tertiary border-border-subtle text-fg-secondary hover:border-brand hover:text-brand-light"
                                }`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            );

        case "boolean":
            return (
                <button
                    type="button"
                    onClick={() => onChange(value === "true" ? "false" : "true")}
                    className={`relative h-6 w-11 rounded-full transition-colors ${value === "true" ? "bg-brand" : "bg-border-strong"
                        }`}
                    title={paramDef.hint}
                >
                    <span
                        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${value === "true" ? "translate-x-5" : ""
                            }`}
                    />
                </button>
            );

        case "amount":
        case "number":
            if (isTemplateValue) {
                return linkedValueChip;
            }
            return (
                <input
                    type="text"
                    inputMode="decimal"
                    className={baseInputCls}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    placeholder={paramDef.placeholder ?? "0"}
                    title={paramDef.hint}
                />
            );

        case "condition":
            return null;

        case "address":
        case "text":
        default: {
            if (isTokenListField) {
                return (
                    <TokenListParamInput
                        value={value}
                        onChange={onChange}
                        networkId={networkId}
                        hint={paramDef.hint}
                    />
                );
            }

            if (isChoiceListField) {
                return (
                    <ChoiceListParamInput
                        value={value}
                        onChange={onChange}
                        hint={paramDef.hint}
                    />
                );
            }

            if (isTemplateValue) {
                return linkedValueChip;
            }

            return (
                <input
                    type="text"
                    className={baseInputCls}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    placeholder={paramDef.placeholder ?? (paramDef.type === "address" ? "0x..." : "")}
                    title={paramDef.hint}
                    spellCheck={paramDef.type !== "address"}
                />
            );
        }
    }
}

function InlineInfoTip({ content }: { content: string }) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;

        function handlePointerDown(event: MouseEvent) {
            if (containerRef.current?.contains(event.target as Node)) return;
            setIsOpen(false);
        }

        document.addEventListener("mousedown", handlePointerDown);
        return () => {
            document.removeEventListener("mousedown", handlePointerDown);
        };
    }, [isOpen]);

    return (
        <div
            ref={containerRef}
            className="relative shrink-0"
            onClick={(event) => event.stopPropagation()}
        >
            <button
                type="button"
                onClick={() => setIsOpen((prev) => !prev)}
                className={`flex h-4 w-4 items-center justify-center rounded-full border transition-colors ${isOpen
                    ? "border-brand bg-brand-subtle text-brand-light"
                    : "border-border-subtle text-fg-muted hover:border-brand hover:text-brand-light"
                    }`}
                aria-label="Show field help"
                aria-expanded={isOpen}
            >
                <Info size={10} />
            </button>

            {isOpen ? (
                <div className="absolute left-0 top-6 z-20 w-64 rounded-lg border border-border-default bg-secondary p-3 text-[11px] leading-5 text-fg-secondary shadow-card">
                    {content}
                </div>
            ) : null}
        </div>
    );
}

const BUILDER_FORM_ROW_CLASS =
    "grid min-w-0 gap-y-1.5 md:grid-cols-[136px_minmax(0,1fr)] md:gap-x-4 md:gap-y-0";

function BuilderFieldRow({
    label,
    required,
    hint,
    children,
    className = "",
    labelClassName = "",
}: {
    label: string;
    required?: boolean;
    hint?: string;
    children: ReactNode;
    className?: string;
    labelClassName?: string;
}) {
    return (
        <div className={`${BUILDER_FORM_ROW_CLASS} ${className}`.trim()}>
            <div
                className={`flex items-start gap-1 md:min-h-9 md:pt-[7px] ${labelClassName}`.trim()}
            >
                <span className="text-sm leading-5 text-fg-secondary whitespace-normal break-words">
                    {label}
                </span>
                {required ? (
                    <span className="text-status-error text-[10px] leading-none">*</span>
                ) : null}
                {hint ? <InlineInfoTip content={hint} /> : null}
            </div>

            <div className="min-w-0">
                {children}
            </div>
        </div>
    );
}

interface InputSourceOption {
    label: string;
    value: string;
    group: string;
    suggestedType?: "number" | "string" | "boolean";
}

interface InputSourceGroupOption {
    label: string;
    value: string;
}

type ValueSourceMode = "fixed" | "input" | "wallet" | "variable" | "step";

function supportsVariableBinding(
    block: CanvasBlock,
    paramDef: SkillParamDef,
): boolean {
    if (paramDef.type === "condition" || paramDef.type === "select" || paramDef.type === "operator" || paramDef.type === "boolean") {
        return false;
    }

    if (block.skillId === "logic.wait" && paramDef.key === "seconds") {
        return false;
    }

    return true;
}

function supportsSavedVariableOnlyBinding(
    block: CanvasBlock,
    paramDef: SkillParamDef,
): boolean {
    return block.skillId === "logic.get_variable" && paramDef.key === "variable";
}

function requiresStringBinding(
    block: CanvasBlock,
    paramDef: SkillParamDef,
): boolean {
    if (paramDef.type === "address" || paramDef.type === "token") {
        return true;
    }

    return (
        paramDef.key === "tokens" &&
        (block.skillId === "data.portfolio_snapshot" || block.skillId === "data.token_prices")
    );
}

function canBindSuggestedType(
    block: CanvasBlock,
    paramDef: SkillParamDef,
    suggestedType?: "number" | "string" | "boolean",
): boolean {
    if (!suggestedType) return true;

    if (paramDef.type === "amount" || paramDef.type === "number") {
        return suggestedType === "number";
    }

    if (requiresStringBinding(block, paramDef)) {
        return suggestedType === "string";
    }

    return true;
}

function getValueSourceModeForGroup(group: string): Exclude<ValueSourceMode, "fixed"> | "" {
    if (!group) return "";
    if (group === "Asked at Start") return "input";
    if (group === "Connected Wallet") return "wallet";
    if (group === "Saved Variables") return "variable";
    if (group.startsWith("Step ")) return "step";
    return "";
}

function getValueSourceMode(
    value: string,
    sources: InputSourceOption[],
): ValueSourceMode {
    const linkedRef = extractTemplateReference(value);
    if (!linkedRef) return "fixed";

    if (linkedRef.startsWith("input.")) return "input";

    const matchedGroup = getSourceGroupForInputRef(linkedRef, sources);
    const matchedMode = getValueSourceModeForGroup(matchedGroup);
    if (matchedMode) return matchedMode;

    if (linkedRef.startsWith("wallet.")) return "wallet";
    return "step";
}

function getValueSourceModeLabel(mode: ValueSourceMode): string {
    switch (mode) {
        case "fixed":
            return "Fixed";
        case "input":
            return "Ask Each Time";
        case "step":
            return "Previous Step";
        case "wallet":
            return "Connected Wallet";
        case "variable":
            return "Saved Variable";
        default:
            return "Source";
    }
}

function inferShortcutInputSuggestedType(
    type: InputType,
): "number" | "string" | "boolean" | undefined {
    if (type === "amount" || type === "number") return "number";
    if (type === "boolean") return "boolean";
    return "string";
}

function extractTemplateReference(value: string): string | null {
    const match = value.match(/^\{\{(.+?)\}\}$/);
    return match ? match[1] : null;
}

function buildVariableBindingSources(
    block: CanvasBlock,
    paramDef: SkillParamDef,
    allBlocks: CanvasBlock[],
    currentBlockId: string,
    networkId?: string,
): InputSourceOption[] {
    if (!supportsVariableBinding(block, paramDef)) {
        return [];
    }

    const sources: InputSourceOption[] = [];
    const seen = new Set<string>();
    const availableBlocks = getAccessiblePriorBlocks(allBlocks, currentBlockId);
    const walletTokens = getRegisteredTokens(networkId as Parameters<typeof getRegisteredTokens>[0]);
    const savedVariableOnly = supportsSavedVariableOnlyBinding(block, paramDef);

    const pushSource = (
        label: string,
        value: string,
        group: string,
        suggestedType?: "number" | "string" | "boolean",
    ) => {
        if (seen.has(value)) return;
        if (!canBindSuggestedType(block, paramDef, suggestedType)) return;
        seen.add(value);
        sources.push({ label, value, group, suggestedType });
    };

    if (!savedVariableOnly && paramDef.type !== "token") {
        pushSource("Address", "wallet.address", "Connected Wallet", "string");
        for (const token of walletTokens.slice(0, 4)) {
            pushSource(`${token.symbol} Balance`, `wallet.balance.${token.symbol}`, "Connected Wallet", "number");
        }
    }

    for (let index = 0; index < availableBlocks.length; index++) {
        const sourceBlock = availableBlocks[index];
        const sourceLabel = sourceBlock.label || findSkillDef(sourceBlock.skillId)?.label || `Step ${index + 1}`;
        const referenceRoot = sourceBlock.outputAs ?? sourceBlock.id;
        const outputFields = getOutputFields(sourceBlock, networkId);
        const resultType = inferSkillOutputType(sourceBlock.skillId);

        if (savedVariableOnly && sourceBlock.outputAs) {
            pushSource(sourceBlock.outputAs, sourceBlock.outputAs, "Saved Variables", resultType);
        }

        if (savedVariableOnly) {
            continue;
        }

        if (outputFields.length === 0) {
            pushSource(`${sourceLabel} — Result`, referenceRoot, `Step ${index + 1}: ${sourceLabel}`, resultType);
            continue;
        }

        for (const field of outputFields) {
            if (paramDef.type === "token" && !isTokenBindingField(sourceBlock.skillId, field.key)) {
                continue;
            }

            pushSource(
                field.label,
                `${referenceRoot}.${field.key}`,
                `Step ${index + 1}: ${sourceLabel}`,
                inferFieldType(sourceBlock, field.key),
            );
        }
    }

    return sources;
}

function isTokenBindingField(skillId: string, fieldKey: string): boolean {
    switch (skillId) {
        case "wallet.get_balance":
            return fieldKey === "symbol";
        case "swap.uniswap_quote":
        case "swap.uniswap_prepare_swap":
            return fieldKey === "tokenIn" || fieldKey === "tokenOut";
        case "defi.clanker_deploy_token":
            return fieldKey === "token.symbol" || fieldKey === "launchConfig.quoteToken";
        case "bridge.list_routes":
            return (
                fieldKey === "routes.0.originTokenSymbol" ||
                fieldKey === "routes.0.destinationTokenSymbol"
            );
        case "bridge.get_quote":
            return fieldKey === "inputTokenSymbol" || fieldKey === "outputTokenSymbol";
        case "data.token_prices":
            return /^symbols\.\d+$/.test(fieldKey);
        case "data.portfolio_snapshot":
            return (
                /^tokens\.\d+\.(symbol|address)$/.test(fieldKey) ||
                fieldKey === "native.0.address"
            );
        default:
            return false;
    }
}

function buildInputSources(
    allBlocks: CanvasBlock[],
    currentBlockId: string,
    shortcutInputs: ShortcutInput[],
    networkId?: string,
) {
    const sources: InputSourceOption[] = [];
    const availableBlocks = getAccessiblePriorBlocks(allBlocks, currentBlockId);

    sources.push(
        ...shortcutInputs.map((input) => ({
            label: input.label,
            value: `input.${input.id}`,
            group: "Asked at Start",
            suggestedType: inferShortcutInputSuggestedType(input.type),
        })),
    );

    const walletTokens = getRegisteredTokens(networkId as Parameters<typeof getRegisteredTokens>[0]);
    sources.push(
        { label: "Address", value: "wallet.address", group: "Connected Wallet", suggestedType: "string" },
        ...walletTokens.map((token) => ({
            label: `${token.symbol} Balance`,
            value: `wallet.balance.${token.symbol}`,
            group: "Connected Wallet",
            suggestedType: "number" as const,
        })),
    );

    for (let index = 0; index < availableBlocks.length; index++) {
        const block = availableBlocks[index];
        const skillDef = findSkillDef(block.skillId);
        const label = block.label || skillDef?.label || `Step ${index + 1}`;
        const fields = getOutputFields(block, networkId);

        if (fields.length > 0) {
            for (const field of fields) {
                sources.push({
                    label: `${label} — ${field.label}`,
                    value: `${block.id}.${field.key}`,
                    group: `Step ${index + 1}: ${label}`,
                    suggestedType: inferFieldType(block, field.key),
                });
            }
            continue;
        }

        sources.push({
            label: `${label} (result)`,
            value: block.id,
            group: `Step ${index + 1}: ${label}`,
            suggestedType: inferSkillOutputType(block.skillId),
        });
    }

    return sources;
}

function buildInputSourceGroups(inputSources: InputSourceOption[]): InputSourceGroupOption[] {
    const groups = new Set<string>();
    const orderedGroups: InputSourceGroupOption[] = [];

    for (const source of inputSources) {
        if (groups.has(source.group)) continue;
        groups.add(source.group);
        orderedGroups.push({
            label: source.group,
            value: source.group,
        });
    }

    return orderedGroups;
}

function getSourceGroupForInputRef(
    inputRef: string,
    inputSources: InputSourceOption[],
): string {
    if (!inputRef) return "";
    return inputSources.find((source) => source.value === inputRef)?.group ?? "";
}

function getTrackedPortfolioTokens(block: CanvasBlock, networkId?: string): string[] {
    const tokensParam = block.params.find((param) => param.key === "tokens")?.value ?? "";
    if (!tokensParam.trim()) {
        return getRegisteredTokens(networkId as Parameters<typeof getRegisteredTokens>[0])
            .map((token) => token.symbol)
            .filter((symbol) => symbol !== "ETH");
    }

    if (extractTemplateReference(tokensParam)) {
        return ["Tracked Token 1", "Tracked Token 2"];
    }

    return tokensParam
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => {
            if (value.startsWith("0x") && value.length === 42) {
                return getTokenInfoByAddress(
                    value,
                    networkId as Parameters<typeof getRegisteredTokens>[0],
                )?.symbol;
            }

            return getTokenInfo(
                value,
                networkId as Parameters<typeof getRegisteredTokens>[0],
            )?.symbol ?? value.toUpperCase();
        })
        .filter((value): value is string => Boolean(value));
}

function getTrackedTokenPriceSymbols(block: CanvasBlock, networkId?: string): string[] {
    const tokensParam = block.params.find((param) => param.key === "tokens")?.value ?? "";
    if (!tokensParam.trim()) {
        return ["ETH", "USDC"];
    }

    if (extractTemplateReference(tokensParam)) {
        return [];
    }

    return tokensParam
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => {
            if (value.startsWith("0x") && value.length === 42) {
                return getTokenInfoByAddress(
                    value,
                    networkId as Parameters<typeof getRegisteredTokens>[0],
                )?.symbol;
            }

            return getTokenInfo(
                value,
                networkId as Parameters<typeof getRegisteredTokens>[0],
            )?.symbol ?? value.toUpperCase();
        })
        .filter((value): value is string => Boolean(value))
        .slice(0, 4);
}

function getWalletOverviewTrackedTokens(networkId?: string): string[] {
    return getRegisteredTokens(networkId as Parameters<typeof getRegisteredTokens>[0])
        .map((token) => token.symbol)
        .filter((symbol) => symbol !== "ETH");
}

function getTrackedUniswapPositionIndexes(block: CanvasBlock): number[] {
    const maxPositionsParam = block.params.find((param) => param.key === "maxPositions")?.value ?? "5";
    const maxPositions = Number(maxPositionsParam);
    const safeCount = Number.isFinite(maxPositions)
        ? Math.max(1, Math.min(3, Math.floor(maxPositions)))
        : 3;

    return Array.from({ length: safeCount }, (_, index) => index);
}

function humanizeIdentifier(value: string): string {
    return value
        .replace(/\./g, " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function resolveInputRefLabel(
    inputRef: string,
    allBlocks?: CanvasBlock[],
    shortcutInputs?: ShortcutInput[],
): string {
    if (inputRef.startsWith("input.")) {
        const inputId = inputRef.slice(6);
        const matchedInput = shortcutInputs?.find((input) => input.id === inputId);
        return matchedInput ? matchedInput.label : humanizeIdentifier(inputId);
    }

    if (inputRef === "wallet.address") return "Address";
    if (inputRef === "wallet.basename") return "Basename";

    const walletBalanceMatch = inputRef.match(/^wallet\.balance\.(.+)$/);
    if (walletBalanceMatch) {
        return `${walletBalanceMatch[1]} Balance`;
    }

    if (inputRef.startsWith("wallet.")) {
        const field = inputRef.slice(7);
        return field.charAt(0).toUpperCase() + field.slice(1);
    }

    if (allBlocks) {
        const exactAliasBlock = allBlocks.find((block) => block.outputAs === inputRef);
        if (exactAliasBlock?.outputAs) {
            return `Variable ${exactAliasBlock.outputAs}`;
        }

        const aliasParts = inputRef.split(".");
        if (aliasParts.length > 1) {
            const [aliasRoot, ...rest] = aliasParts;
            const aliasBlock = allBlocks.find((block) => block.outputAs === aliasRoot);
            if (aliasBlock?.outputAs) {
                return `${aliasBlock.outputAs} — ${humanizeIdentifier(rest.join("."))}`;
            }
        }
    }

    const uniswapSummaryMatch = inputRef.match(/^(step-\d+)\.summary\.(positionCount|returnedPositionCount|hasActiveLiquidity)$/);
    if (uniswapSummaryMatch) {
        const [, stepId, field] = uniswapSummaryMatch;
        const fieldMap: Record<string, string> = {
            positionCount: "Position Count",
            returnedPositionCount: "Returned Position Count",
            hasActiveLiquidity: "Has Active Liquidity",
        };

        if (allBlocks) {
            const block = findBlockById(allBlocks, stepId);
            if (block) {
                const blockLabel = block.label || findSkillDef(block.skillId)?.label || stepId;
                return `${blockLabel} — ${fieldMap[field] ?? field}`;
            }
        }

        return fieldMap[field] ?? field;
    }

    const uniswapPositionMatch = inputRef.match(/^(step-\d+)\.positions\.(\d+)\.(tokenId|pairLabel|feeTier|liquidity|poolAddress|tokensOwed0|tokensOwed1)$/);
    if (uniswapPositionMatch) {
        const [, stepId, index, field] = uniswapPositionMatch;
        const fieldMap: Record<string, string> = {
            tokenId: "Token ID",
            pairLabel: "Pair",
            feeTier: "Fee Tier",
            liquidity: "Liquidity",
            poolAddress: "Pool Address",
            tokensOwed0: "Token 0 Owed",
            tokensOwed1: "Token 1 Owed",
        };

        if (allBlocks) {
            const block = findBlockById(allBlocks, stepId);
            if (block) {
                const blockLabel = block.label || findSkillDef(block.skillId)?.label || stepId;
                return `${blockLabel} — Position ${Number(index) + 1} ${fieldMap[field] ?? field}`;
            }
        }

        return `Position ${Number(index) + 1} ${fieldMap[field] ?? field}`;
    }

    const portfolioTrackedMatch = inputRef.match(/^(step-\d+)\.tracked\.([^.]+)\.(amount|usdValue)$/);
    if (portfolioTrackedMatch) {
        const [, stepId, symbol, metric] = portfolioTrackedMatch;
        const metricLabel = metric === "usdValue" ? "USD Value" : "Amount";

        if (allBlocks) {
            const block = findBlockById(allBlocks, stepId);
            if (block) {
                const blockLabel = block.label || findSkillDef(block.skillId)?.label || stepId;
                return `${blockLabel} — ${symbol} ${metricLabel}`;
            }
        }

        return `${symbol} ${metricLabel}`;
    }

    const portfolioMetaMatch = inputRef.match(/^(step-\d+)\.(wallet\.address|wallet\.basename|summary\.totalUsdValue|summary\.trackedTokenCount|native\.0\.amount|native\.0\.usdValue)$/);
    if (portfolioMetaMatch) {
        const [, stepId, field] = portfolioMetaMatch;
        const fieldMap: Record<string, string> = {
            "wallet.address": "Wallet Address",
            "wallet.basename": "Wallet Basename",
            "summary.totalUsdValue": "Total USD Value",
            "summary.trackedTokenCount": "Tracked Token Count",
            "native.0.amount": "ETH Amount",
            "native.0.usdValue": "ETH USD Value",
        };

        if (allBlocks) {
            const block = findBlockById(allBlocks, stepId);
            if (block) {
                const blockLabel = block.label || findSkillDef(block.skillId)?.label || stepId;
                return `${blockLabel} — ${fieldMap[field] ?? field}`;
            }
        }

        return fieldMap[field] ?? field;
    }

    const walletOverviewBalanceMatch = inputRef.match(/^(step-\d+)\.balances\.([^.]+)$/);
    if (walletOverviewBalanceMatch) {
        const [, stepId, symbol] = walletOverviewBalanceMatch;

        if (allBlocks) {
            const block = findBlockById(allBlocks, stepId);
            if (block) {
                const blockLabel = block.label || findSkillDef(block.skillId)?.label || stepId;
                return `${blockLabel} — ${symbol} Balance`;
            }
        }

        return `${symbol} Balance`;
    }

    const stepMatch = inputRef.match(/^step-(\d+)\.(.+)$/);
    if (stepMatch) {
        const stepId = `step-${stepMatch[1]}`;
        const field = stepMatch[2];
        const fieldLabel = humanizeIdentifier(field);

        if (allBlocks) {
            const block = findBlockById(allBlocks, stepId);
            if (block) {
                const blockLabel = block.label || findSkillDef(block.skillId)?.label || `Step ${stepMatch[1]}`;
                return `${blockLabel} — ${fieldLabel}`;
            }
        }

        return `Step ${stepMatch[1]} — ${fieldLabel}`;
    }

    const bareMatch = inputRef.match(/^step-(\d+)$/);
    if (bareMatch) {
        if (allBlocks) {
            const block = findBlockById(allBlocks, inputRef);
            if (block) {
                return block.label || findSkillDef(block.skillId)?.label || `Step ${bareMatch[1]} result`;
            }
        }

        return `Step ${bareMatch[1]} result`;
    }

    return inputRef;
}

function inferFieldType(block: CanvasBlock, fieldKey: string): "number" | "string" | "boolean" | undefined {
    const skillId = block.skillId;
    const numericFields = new Set([
        "balance", "amount", "price", "amountOut", "gasEstimate",
        "quotedAmountOut", "amountOutMinimum", "ethBalance", "latestBlock",
        "liquidity", "tokensOwed0", "tokensOwed1", "confidence",
        "summary.totalUsdValue", "summary.trackedTokenCount", "summary.positionCount",
        "summary.returnedPositionCount", "summary.morphoPositionCount",
        "summary.uniswapPositionCount", "summary.protocolPositionCount", "result",
        "originChainId", "destinationChainId", "returnedCount", "expectedFillTimeSec",
        "fillDeadline", "exclusivityDeadline", "quoteTimestamp", "depositId",
        "native.0.amount", "native.0.usdValue", "tokenTransferCount",
        "blockNumber", "transactionIndex", "gasUsed", "cumulativeGasUsed",
        "effectiveGasPrice", "confirmations", "callCount", "totalIterations",
        "currentIndex", "iteration", "completedIterations",
    ]);
    if (/^prices\.[^.]+\.(usd|change24h)$/.test(fieldKey)) return "number";
    if (/^(routes|items)\.\d+\.(originChainId|destinationChainId|tokenTransferCount)$/.test(fieldKey)) return "number";
    if (/^balances\.[^.]+$/.test(fieldKey)) return "number";
    if (/\.(amount|usdValue|feeTier|liquidity|tokensOwed[01])$/.test(fieldKey)) return "number";
    if (numericFields.has(fieldKey)) return "number";

    const boolFields = new Set(["summary.hasActiveLiquidity", "launchConfig.sniperProtection", "isAmountTooLow", "actionsSucceeded", "nextPageAvailable", "isFirst", "isLast"]);
    if (fieldKey === "isOwner" || fieldKey === "metadataAvailable") return "boolean";
    if (boolFields.has(fieldKey)) return "boolean";

    const stringFields = new Set([
        "address", "symbol", "network", "networkId", "chainId", "assetId",
        "explorerUrl", "description", "router", "recipient", "factory",
        "wallet.address", "wallet.basename", "pairLabel", "standard",
        "contractAddress", "walletAddress", "provider", "status", "depositTxnRef",
        "fillTxnRef", "depositRefundTxnRef", "inputTokenSymbol", "outputTokenSymbol",
        "inputTokenAddress", "outputTokenAddress", "inputAmount", "outputAmount",
        "totalRelayFeePct", "totalRelayFeeAmount", "relayerGasFeeAmount",
        "relayerCapitalFeeAmount", "lpFeeAmount", "spokePoolAddress", "requestedAmount",
        "hash", "timestamp", "direction", "counterparty", "primaryAsset", "filter",
        "from", "to", "explorerBaseUrl", "tokenAddress", "vaultId", "vaultName",
        "underlyingSymbol", "token",
    ]);
    if (/^(symbols|unsupported)\.\d+$/.test(fieldKey)) return "string";
    if (/^prices\.[^.]+\.timestamp$/.test(fieldKey)) return "string";
    if (/^(routes)\.\d+\.(originTokenSymbol|destinationTokenSymbol)$/.test(fieldKey)) return "string";
    if (/^(items)\.\d+\.(hash|timestamp|direction|status|primaryAsset|counterparty)$/.test(fieldKey)) return "string";
    if (/\.(address|symbol|pairLabel|poolAddress|tokenId|name|description|image|animationUrl|tokenUri|depositTxnRef|fillTxnRef|hash|timestamp|direction|counterparty|primaryAsset)$/.test(fieldKey)) return "string";
    if (stringFields.has(fieldKey)) return "string";

    if (skillId === "logic.math") return "number";
    if (skillId === "logic.format") return "string";
    if (skillId === "logic.ask_input" && fieldKey === "value") {
        const inputType = block.params.find((param) => param.key === "inputType")?.value ?? "text";
        if (inputType === "number" || inputType === "amount") return "number";
        return "string";
    }
    if (skillId === "logic.choose_menu" && (fieldKey === "value" || fieldKey === "label" || fieldKey === "prompt")) {
        return "string";
    }
    if (skillId === "logic.repeat_each" && fieldKey === "currentItem") {
        return undefined;
    }

    return undefined;
}

function inferSkillOutputType(skillId: string): "number" | "string" | "boolean" | undefined {
    switch (skillId) {
        case "logic.math":
            return "number";
        case "logic.set_variable":
        case "logic.get_variable":
        case "logic.ask_input":
        case "logic.choose_menu":
        case "logic.repeat":
        case "logic.repeat_each":
            return undefined;
        case "logic.format":
        case "logic.notify":
        case "logic.stop":
            return "string";
        case "logic.assert":
            return "boolean";
        default:
            return undefined;
    }
}

function getOutputFields(block: CanvasBlock, networkId?: string): Array<{ key: string; label: string }> {
    switch (block.skillId) {
        case "wallet.get_balance":
            return [
                { key: "walletAddress", label: "Wallet Address" },
                { key: "balance", label: "Balance" },
                { key: "symbol", label: "Symbol" },
            ];
        case "swap.uniswap_quote":
            return [
                { key: "tokenIn", label: "Pay With" },
                { key: "tokenOut", label: "Receive" },
                { key: "amountOut", label: "Estimated Receive" },
                { key: "feeTier", label: "Pool Fee" },
                { key: "gasEstimate", label: "Gas Estimate" },
            ];
        case "swap.uniswap_prepare_swap":
            return [
                { key: "status", label: "Status" },
                { key: "networkId", label: "Network ID" },
                { key: "callCount", label: "Call Count" },
                { key: "description", label: "Description" },
                { key: "tokenIn", label: "Pay With" },
                { key: "tokenOut", label: "Receive" },
                { key: "quotedAmountOut", label: "Estimated Receive" },
                { key: "amountOutMinimum", label: "Minimum Receive" },
                { key: "router", label: "Router Address" },
                { key: "explorerBaseUrl", label: "Explorer Base URL" },
            ];
        case "swap.uniswap_positions":
            return [
                { key: "summary.positionCount", label: "Position Count" },
                { key: "summary.returnedPositionCount", label: "Returned Position Count" },
                { key: "summary.hasActiveLiquidity", label: "Has Active Liquidity" },
                ...getTrackedUniswapPositionIndexes(block).flatMap((index) => ([
                    { key: `positions.${index}.tokenId`, label: `Position ${index + 1} Token ID` },
                    { key: `positions.${index}.pairLabel`, label: `Position ${index + 1} Pair` },
                    { key: `positions.${index}.feeTier`, label: `Position ${index + 1} Fee Tier` },
                    { key: `positions.${index}.liquidity`, label: `Position ${index + 1} Liquidity` },
                    { key: `positions.${index}.poolAddress`, label: `Position ${index + 1} Pool Address` },
                    { key: `positions.${index}.tokensOwed0`, label: `Position ${index + 1} Token 0 Owed` },
                    { key: `positions.${index}.tokensOwed1`, label: `Position ${index + 1} Token 1 Owed` },
                ])),
            ];
        case "swap.uniswap_collect_fees":
            return [
                { key: "status", label: "Status" },
                { key: "networkId", label: "Network ID" },
                { key: "callCount", label: "Call Count" },
                { key: "tokenId", label: "Token ID" },
                { key: "pairLabel", label: "Pair" },
                { key: "tokensOwed0", label: "Token 0 Owed" },
                { key: "tokensOwed1", label: "Token 1 Owed" },
                { key: "recipient", label: "Recipient" },
                { key: "explorerBaseUrl", label: "Explorer Base URL" },
            ];
        case "data.pyth_price":
            return [
                { key: "price", label: "Price" },
                { key: "symbol", label: "Symbol" },
            ];
        case "data.token_prices":
            return [
                { key: "symbols.0", label: "First Resolved Symbol" },
                { key: "unsupported.0", label: "First Unsupported Token" },
                ...getTrackedTokenPriceSymbols(block, networkId).flatMap((symbol) => ([
                    { key: `prices.${symbol}.usd`, label: `${symbol} Price` },
                    { key: `prices.${symbol}.change24h`, label: `${symbol} 24h Change` },
                    { key: `prices.${symbol}.timestamp`, label: `${symbol} Price Timestamp` },
                ])),
            ];
        case "data.portfolio_snapshot":
            return [
                { key: "wallet.address", label: "Wallet Address" },
                { key: "wallet.basename", label: "Wallet Basename" },
                { key: "native.0.amount", label: "ETH Amount" },
                { key: "native.0.usdValue", label: "ETH USD Value" },
                ...getTrackedPortfolioTokens(block, networkId).flatMap((symbol, index) => ([
                    { key: `tokens.${index}.symbol`, label: `${symbol} Symbol` },
                    { key: `tokens.${index}.address`, label: `${symbol} Address` },
                    { key: `tokens.${index}.assetId`, label: `${symbol} Asset ID` },
                    { key: `tokens.${index}.amount`, label: `${symbol} Amount` },
                    { key: `tokens.${index}.usdValue`, label: `${symbol} USD Value` },
                ])),
                { key: "summary.totalUsdValue", label: "Total USD Value" },
                { key: "summary.trackedTokenCount", label: "Tracked Token Count" },
                { key: "summary.morphoPositionCount", label: "Morpho Position Count" },
                { key: "summary.uniswapPositionCount", label: "Uniswap Position Count" },
                { key: "summary.protocolPositionCount", label: "Protocol Position Count" },
                { key: "summary.hasActiveLiquidity", label: "Has Active Liquidity" },
                { key: "native.0.assetId", label: "ETH Asset ID" },
                { key: "native.0.address", label: "ETH Address" },
            ];
        case "data.wallet_activity":
            return [
                { key: "provider", label: "Provider" },
                { key: "walletAddress", label: "Wallet Address" },
                { key: "networkId", label: "Network ID" },
                { key: "filter", label: "Filter" },
                { key: "returnedCount", label: "Returned Count" },
                { key: "nextPageAvailable", label: "Next Page Available" },
                { key: "items.0.hash", label: "Latest Tx Hash" },
                { key: "items.0.timestamp", label: "Latest Timestamp" },
                { key: "items.0.direction", label: "Latest Direction" },
                { key: "items.0.status", label: "Latest Status" },
                { key: "items.0.primaryAsset", label: "Latest Primary Asset" },
                { key: "items.0.counterparty", label: "Latest Counterparty" },
            ];
        case "tx.get_receipt":
            return [
                { key: "txHash", label: "Transaction Hash" },
                { key: "status", label: "Status" },
                { key: "blockNumber", label: "Block Number" },
                { key: "gasUsed", label: "Gas Used" },
                { key: "effectiveGasPrice", label: "Effective Gas Price" },
                { key: "from", label: "From" },
                { key: "to", label: "To" },
                { key: "contractAddress", label: "Contract Address" },
                { key: "explorerUrl", label: "Explorer URL" },
            ];
        case "tx.wait_confirmation":
            return [
                { key: "txHash", label: "Transaction Hash" },
                { key: "confirmations", label: "Confirmations" },
                { key: "status", label: "Status" },
                { key: "blockNumber", label: "Block Number" },
                { key: "gasUsed", label: "Gas Used" },
                { key: "effectiveGasPrice", label: "Effective Gas Price" },
                { key: "from", label: "From" },
                { key: "to", label: "To" },
                { key: "contractAddress", label: "Contract Address" },
                { key: "explorerUrl", label: "Explorer URL" },
            ];
        case "defi.clanker_deploy_token":
            return [
                { key: "status", label: "Status" },
                { key: "networkId", label: "Network ID" },
                { key: "callCount", label: "Call Count" },
                { key: "description", label: "Description" },
                { key: "factory", label: "Factory" },
                { key: "chainId", label: "Chain ID" },
                { key: "token.name", label: "Token Name" },
                { key: "token.symbol", label: "Token Symbol" },
                { key: "token.admin", label: "Token Admin" },
                { key: "launchConfig.quoteToken", label: "Quote Token" },
                { key: "launchConfig.sniperProtection", label: "Sniper Protection" },
                { key: "explorerBaseUrl", label: "Explorer Base URL" },
            ];
        case "wallet.send_eth":
            return [
                { key: "status", label: "Status" },
                { key: "networkId", label: "Network ID" },
                { key: "callCount", label: "Call Count" },
                { key: "description", label: "Description" },
                { key: "explorerBaseUrl", label: "Explorer Base URL" },
            ];
        case "wallet.send_token":
            return [
                { key: "status", label: "Status" },
                { key: "networkId", label: "Network ID" },
                { key: "callCount", label: "Call Count" },
                { key: "description", label: "Description" },
                { key: "token", label: "Token" },
                { key: "tokenAddress", label: "Token Address" },
                { key: "explorerBaseUrl", label: "Explorer Base URL" },
            ];
        case "defi.morpho_deposit":
            return [
                { key: "status", label: "Status" },
                { key: "networkId", label: "Network ID" },
                { key: "callCount", label: "Call Count" },
                { key: "description", label: "Description" },
                { key: "vaultId", label: "Vault ID" },
                { key: "vaultName", label: "Vault Name" },
                { key: "underlyingSymbol", label: "Underlying Symbol" },
                { key: "explorerBaseUrl", label: "Explorer Base URL" },
            ];
        case "defi.morpho_withdraw":
            return [
                { key: "status", label: "Status" },
                { key: "networkId", label: "Network ID" },
                { key: "callCount", label: "Call Count" },
                { key: "description", label: "Description" },
                { key: "vaultId", label: "Vault ID" },
                { key: "vaultName", label: "Vault Name" },
                { key: "underlyingSymbol", label: "Underlying Symbol" },
                { key: "explorerBaseUrl", label: "Explorer Base URL" },
            ];
        case "nft.check_ownership":
            return [
                { key: "contractAddress", label: "Contract Address" },
                { key: "tokenId", label: "Token ID" },
                { key: "standard", label: "Standard" },
                { key: "walletAddress", label: "Wallet Address" },
                { key: "owner", label: "Owner" },
                { key: "balance", label: "Balance" },
                { key: "isOwner", label: "Owns Token" },
            ];
        case "nft.get_token_metadata":
            return [
                { key: "contractAddress", label: "Contract Address" },
                { key: "tokenId", label: "Token ID" },
                { key: "standard", label: "Standard" },
                { key: "collection.name", label: "Collection Name" },
                { key: "collection.symbol", label: "Collection Symbol" },
                { key: "token.tokenUri", label: "Token URI" },
                { key: "token.name", label: "Token Name" },
                { key: "token.description", label: "Token Description" },
                { key: "token.image", label: "Token Image" },
                { key: "token.animationUrl", label: "Animation URL" },
                { key: "metadataAvailable", label: "Metadata Available" },
            ];
        case "bridge.list_routes":
            return [
                { key: "provider", label: "Provider" },
                { key: "networkId", label: "Network ID" },
                { key: "originChainId", label: "Origin Chain ID" },
                { key: "returnedCount", label: "Returned Count" },
                { key: "routes.0.destinationChainId", label: "First Destination Chain" },
                { key: "routes.0.originTokenSymbol", label: "First Origin Token" },
                { key: "routes.0.destinationTokenSymbol", label: "First Destination Token" },
            ];
        case "bridge.get_quote":
            return [
                { key: "provider", label: "Provider" },
                { key: "networkId", label: "Network ID" },
                { key: "requestedAmount", label: "Requested Amount" },
                { key: "originChainId", label: "Origin Chain ID" },
                { key: "destinationChainId", label: "Destination Chain ID" },
                { key: "inputTokenSymbol", label: "Input Token" },
                { key: "outputTokenSymbol", label: "Output Token" },
                { key: "totalRelayFeePct", label: "Relay Fee Percent" },
                { key: "totalRelayFeeAmount", label: "Relay Fee Amount" },
                { key: "expectedFillTimeSec", label: "Expected Fill Time" },
                { key: "isAmountTooLow", label: "Amount Too Low" },
            ];
        case "bridge.track_transfer":
            return [
                { key: "provider", label: "Provider" },
                { key: "networkId", label: "Network ID" },
                { key: "status", label: "Status" },
                { key: "depositTxnRef", label: "Deposit Tx Ref" },
                { key: "fillTxnRef", label: "Fill Tx Ref" },
                { key: "depositRefundTxnRef", label: "Refund Tx Ref" },
                { key: "destinationChainId", label: "Destination Chain ID" },
                { key: "actionsSucceeded", label: "Actions Succeeded" },
            ];
        case "logic.math":
            return [{ key: "result", label: "Result" }];
        case "logic.ask_input":
            return [
                { key: "value", label: "Value" },
                { key: "inputType", label: "Input Type" },
                { key: "prompt", label: "Prompt" },
            ];
        case "logic.choose_menu":
            return [
                { key: "value", label: "Value" },
                { key: "label", label: "Label" },
                { key: "prompt", label: "Prompt" },
            ];
        case "logic.repeat":
            return [
                { key: "mode", label: "Mode" },
                { key: "count", label: "Count" },
                { key: "totalIterations", label: "Total Iterations" },
                { key: "currentIndex", label: "Current Index" },
                { key: "iteration", label: "Iteration" },
                { key: "completedIterations", label: "Completed Iterations" },
                { key: "isFirst", label: "Is First" },
                { key: "isLast", label: "Is Last" },
            ];
        case "logic.repeat_each":
            return [
                { key: "mode", label: "Mode" },
                { key: "count", label: "Count" },
                { key: "totalIterations", label: "Total Iterations" },
                { key: "currentIndex", label: "Current Index" },
                { key: "iteration", label: "Iteration" },
                { key: "currentItem", label: "Current Item" },
                { key: "lastItem", label: "Last Item" },
                { key: "completedIterations", label: "Completed Iterations" },
                { key: "isFirst", label: "Is First" },
                { key: "isLast", label: "Is Last" },
            ];
        case "logic.format":
            return [{ key: "text", label: "Formatted Text" }];
        case "wallet.details":
            return [
                { key: "address", label: "Address" },
                { key: "basename", label: "Basename" },
                { key: "network", label: "Network" },
                { key: "networkId", label: "Network ID" },
                { key: "chainId", label: "Chain ID" },
                { key: "ethBalance", label: "ETH Balance" },
                ...getWalletOverviewTrackedTokens(networkId).map((symbol) => ({
                    key: `balances.${symbol}`,
                    label: `${symbol} Balance`,
                })),
                { key: "explorerUrl", label: "Explorer URL" },
                { key: "latestBlock", label: "Latest Block" },
            ];
        case "wallet.resolve_basename":
            return [
                { key: "address", label: "Address" },
                { key: "basename", label: "Basename" },
                { key: "found", label: "Found" },
            ];
        case "wallet.resolve_address":
            return [
                { key: "name", label: "Name" },
                { key: "address", label: "Address" },
                { key: "found", label: "Found" },
            ];
        case "social.prepare_base_share":
        case "social.prepare_open_profile":
        case "social.prepare_open_token":
        case "social.prepare_open_tx":
            return [
                { key: "title", label: "Title" },
                { key: "message", label: "Message" },
                { key: "summary", label: "Summary" },
                { key: "shareText", label: "Share Text" },
                { key: "shareUrl", label: "Share URL" },
                { key: "shareUrlLabel", label: "Open Label" },
                { key: "fallbackCopy", label: "Fallback Copy" },
                { key: "baseProfileUrl", label: "Base Profile URL" },
                { key: "baseTokenUrl", label: "Base Token URL" },
                { key: "walletAddress", label: "Wallet Address" },
                { key: "tokenAddress", label: "Token Address" },
                { key: "networkNote", label: "Network Note" },
            ];
        case "social.prepare_trade_share":
            return [
                { key: "title", label: "Title" },
                { key: "message", label: "Message" },
                { key: "summary", label: "Summary" },
                { key: "shareText", label: "Share Text" },
                { key: "shareUrl", label: "Share URL" },
                { key: "shareUrlLabel", label: "Open Label" },
                { key: "fallbackCopy", label: "Fallback Copy" },
                { key: "baseProfileUrl", label: "Base Profile URL" },
                { key: "baseTokenUrl", label: "Base Token URL" },
                { key: "walletAddress", label: "Wallet Address" },
                { key: "tokenAddress", label: "Token Address" },
                { key: "tradeStatus", label: "Trade Status" },
                { key: "networkNote", label: "Network Note" },
            ];
        case "social.prepare_shortcut_share":
            return [
                { key: "title", label: "Title" },
                { key: "message", label: "Message" },
                { key: "summary", label: "Summary" },
                { key: "shareText", label: "Share Text" },
                { key: "shareUrl", label: "Share URL" },
                { key: "shareUrlLabel", label: "Open Label" },
                { key: "fallbackCopy", label: "Fallback Copy" },
                { key: "shortcutSlug", label: "Published Slug" },
            ];
        case "x402.discover_services":
            return [
                { key: "facilitator", label: "Facilitator" },
                { key: "searchMode", label: "Search Mode" },
                { key: "typeFilter", label: "Type Filter" },
                { key: "networkFilter", label: "Network Filter" },
                { key: "keyword", label: "Search Query" },
                { key: "asset", label: "Asset" },
                { key: "scheme", label: "Scheme" },
                { key: "maxUsdPrice", label: "Max USD Price" },
                { key: "payTo", label: "Merchant" },
                { key: "returnedCount", label: "Returned Count" },
                { key: "services.0.resource", label: "First Resource" },
                { key: "services.0.type", label: "First Type" },
                { key: "services.0.networks.0", label: "First Network" },
                { key: "services.0.pricePreview", label: "First Price Preview" },
            ];
        default:
            return [];
    }
}

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
    return (record["mode"] === "all" || record["mode"] === "any") && Array.isArray(record["conditions"]);
}

function parseConditionValue(value: string): StructuredCondition | null {
    if (!value) return null;
    try {
        const parsed: unknown = JSON.parse(value);
        if (isConditionExpression(parsed) || isConditionGroup(parsed)) {
            return parsed;
        }
    } catch {
        // Not JSON.
    }
    return null;
}

function serializeCondition(expr: StructuredCondition): string {
    return JSON.stringify(expr);
}

const VALUE_TYPE_OPTIONS: Array<{ label: string; value: ConditionValueType }> = [
    { label: "Number", value: "number" },
    { label: "Text", value: "string" },
    { label: "Boolean", value: "boolean" },
];

const CONDITION_GROUP_MODE_OPTIONS: Array<{ label: string; value: ConditionGroupMode }> = [
    { label: "All of these (AND)", value: "all" },
    { label: "Any of these (OR)", value: "any" },
];

interface EditableConditionRow {
    id: string;
    sourceCategory: "input" | "wallet" | "step" | "";
    sourceGroup: string;
    inputRef: string;
    operator: ConditionOperator;
    compareValue: string;
    valueType: ConditionValueType;
}

function createConditionRow(): EditableConditionRow {
    return {
        id: crypto.randomUUID(),
        sourceCategory: "",
        sourceGroup: "",
        inputRef: "",
        operator: "greater_than",
        compareValue: "",
        valueType: "number",
    };
}

function getSourceCategoryForGroup(sourceGroup: string): "input" | "wallet" | "step" | "" {
    if (!sourceGroup) return "";
    if (sourceGroup === "Asked at Start") return "input";
    if (sourceGroup === "Connected Wallet") return "wallet";
    if (sourceGroup.startsWith("Step ")) return "step";
    return "";
}

type ConditionSourceCategory = Exclude<EditableConditionRow["sourceCategory"], "">;

function getDefaultConditionSourceGroup(
    sourceCategory: EditableConditionRow["sourceCategory"],
    stepSourceGroups: InputSourceGroupOption[],
): string {
    if (sourceCategory === "input") return "Asked at Start";
    if (sourceCategory === "wallet") return "Connected Wallet";
    if (sourceCategory === "step" && stepSourceGroups.length === 1) {
        return stepSourceGroups[0].value;
    }
    return "";
}

function getConditionSourceOptions(
    shortcutInputs: ShortcutInput[],
    inputSources: InputSourceOption[],
    stepSourceGroups: InputSourceGroupOption[],
): Array<{ label: string; value: ConditionSourceCategory }> {
    const options: Array<{ label: string; value: ConditionSourceCategory }> = [];

    if (shortcutInputs.length > 0) {
        options.push({ label: "Asked at Start", value: "input" });
    }

    if (inputSources.some((source) => source.group === "Connected Wallet")) {
        options.push({ label: "Connected Wallet", value: "wallet" });
    }

    if (stepSourceGroups.length > 0) {
        options.push({ label: "Previous Step", value: "step" });
    }

    return options;
}

function getConditionFieldPlaceholder(
    sourceCategory: EditableConditionRow["sourceCategory"],
    sourceGroup: string,
    scopedSources: InputSourceOption[],
): string {
    if (sourceGroup) {
        return scopedSources.length > 0 ? "Choose value…" : "No values available";
    }

    if (sourceCategory === "step") return "Choose step first…";
    if (sourceCategory === "wallet") return "Choose wallet value…";
    if (sourceCategory === "input") return "Choose asked value…";
    return "Choose source…";
}

function structuredConditionToRows(
    condition: StructuredCondition | null,
    inputSources: InputSourceOption[],
): {
    mode: ConditionGroupMode;
    rows: EditableConditionRow[];
} {
    if (!condition) {
        return { mode: "all", rows: [createConditionRow()] };
    }

    if (isConditionGroup(condition)) {
        const rows = condition.conditions
            .filter((item): item is ConditionExpression => isConditionExpression(item))
            .map((item) => ({
                id: crypto.randomUUID(),
                sourceCategory: getSourceCategoryForGroup(getSourceGroupForInputRef(item.inputRef, inputSources)),
                sourceGroup: getSourceGroupForInputRef(item.inputRef, inputSources),
                inputRef: item.inputRef,
                operator: item.operator,
                compareValue: item.compareValue,
                valueType: item.valueType,
            }));

        return {
            mode: condition.mode,
            rows: rows.length > 0 ? rows : [createConditionRow()],
        };
    }

    return {
        mode: "all",
        rows: [{
            id: crypto.randomUUID(),
            sourceCategory: getSourceCategoryForGroup(getSourceGroupForInputRef(condition.inputRef, inputSources)),
            sourceGroup: getSourceGroupForInputRef(condition.inputRef, inputSources),
            inputRef: condition.inputRef,
            operator: condition.operator,
            compareValue: condition.compareValue,
            valueType: condition.valueType,
        }],
    };
}

function rowsToStructuredCondition(
    mode: ConditionGroupMode,
    rows: EditableConditionRow[],
): StructuredCondition {
    const normalized = rows.map((row) => ({
        inputRef: row.inputRef,
        operator: row.operator,
        compareValue: row.compareValue,
        valueType: row.valueType,
    }));

    if (normalized.length === 1) {
        return normalized[0] as ConditionExpression;
    }

    return {
        mode,
        conditions: normalized,
    };
}

function getSerializableConditionRows(rows: EditableConditionRow[]): EditableConditionRow[] {
    return rows.filter((row) => row.inputRef.trim().length > 0);
}

function ConditionBuilder({
    value,
    onChange,
    allBlocks,
    currentBlockId,
    shortcutInputs,
    networkId,
}: {
    value: string;
    onChange: (val: string) => void;
    allBlocks: CanvasBlock[];
    currentBlockId: string;
    shortcutInputs: ShortcutInput[];
    networkId?: string;
}) {
    const existingCondition = parseConditionValue(value);
    const inputSources = useMemo(
        () => buildInputSources(allBlocks, currentBlockId, shortcutInputs, networkId),
        [allBlocks, currentBlockId, networkId, shortcutInputs],
    );
    const inputSourceGroups = useMemo(
        () => buildInputSourceGroups(inputSources),
        [inputSources],
    );
    const stepSourceGroups = useMemo(
        () => inputSourceGroups.filter((group) => group.value.startsWith("Step ")),
        [inputSourceGroups],
    );
    const conditionSourceOptions = useMemo(
        () => getConditionSourceOptions(shortcutInputs, inputSources, stepSourceGroups),
        [inputSources, shortcutInputs, stepSourceGroups],
    );
    const initialState = useMemo(
        () => structuredConditionToRows(existingCondition, inputSources),
        [existingCondition, inputSources],
    );
    const [groupMode, setGroupMode] = useState<ConditionGroupMode>(initialState.mode);
    const [rows, setRows] = useState<EditableConditionRow[]>(initialState.rows);
    
    // Track the last value we pushed out, to detect external changes
    const lastValueRef = useRef(value);

    // Sync external changes (e.g., Undo/Redo or loading a new shortcut)
    useEffect(() => {
        if (value !== lastValueRef.current) {
            const incomingCondition = parseConditionValue(value);
            const newState = structuredConditionToRows(incomingCondition, inputSources);
            setGroupMode(newState.mode);
            setRows(newState.rows);
            lastValueRef.current = value;
        }
    }, [value, inputSources]);

    const validOperators = new Set<string>([
        "equals", "not_equals", "greater_than", "less_than",
        "greater_or_equal", "less_or_equal",
        "contains", "not_contains", "starts_with", "ends_with",
        "is_empty", "is_not_empty",
    ]);

    const validValueTypes = new Set<string>(["number", "string", "boolean"]);

    function isConditionOperator(val: string): val is ConditionOperator {
        return validOperators.has(val);
    }

    function isConditionValueType(val: string): val is ConditionValueType {
        return validValueTypes.has(val);
    }

    const updateRows = useCallback((updater: (prev: EditableConditionRow[]) => EditableConditionRow[]) => {
        setRows((prev) => updater(prev));
    }, []);

    useEffect(() => {
        const serializableRows = getSerializableConditionRows(rows);
        if (serializableRows.length === 0) {
            if (value !== "") {
                lastValueRef.current = "";
                onChange("");
            }
            return;
        }

        const nextValue = serializeCondition(rowsToStructuredCondition(groupMode, serializableRows));
        if (nextValue !== value) {
            lastValueRef.current = nextValue;
            onChange(nextValue);
        }
    }, [groupMode, onChange, rows, value]);

    const handleInputRefChange = (rowId: string, val: string) => {
        updateRows((prev) => prev.map((row) => {
            if (row.id !== rowId) return row;
            const source = inputSources.find((item) => item.value === val);
            if (!source?.suggestedType) {
                const nextGroup = source?.group ?? row.sourceGroup;
                return {
                    ...row,
                    sourceCategory: getSourceCategoryForGroup(nextGroup),
                    sourceGroup: nextGroup,
                    inputRef: val,
                };
            }

            const newOperators = getOperatorsForType(source.suggestedType);
            const newOperator = newOperators[0]?.value ?? "equals";
            return {
                ...row,
                sourceCategory: getSourceCategoryForGroup(source.group),
                sourceGroup: source.group,
                inputRef: val,
                valueType: source.suggestedType,
                operator: isConditionOperator(newOperator) ? newOperator : row.operator,
            };
        }));
    };

    const handleSourceCategoryChange = (rowId: string, val: string) => {
        if (val !== "input" && val !== "wallet" && val !== "step" && val !== "") return;
        updateRows((prev) => prev.map((row) => {
            if (row.id !== rowId) return row;
            if (row.sourceCategory === val) return row;

            return {
                ...row,
                sourceCategory: val,
                sourceGroup: getDefaultConditionSourceGroup(val, stepSourceGroups),
                inputRef: "",
            };
        }));
    };

    const handleSourceGroupChange = (rowId: string, val: string) => {
        updateRows((prev) => prev.map((row) => {
            if (row.id !== rowId) return row;
            if (row.sourceGroup === val) return row;

            return {
                ...row,
                sourceCategory: getSourceCategoryForGroup(val),
                sourceGroup: val,
                inputRef: "",
            };
        }));
    };

    const handleOperatorChange = (rowId: string, val: string) => {
        if (!isConditionOperator(val)) return;
        updateRows((prev) => prev.map((row) => row.id === rowId ? { ...row, operator: val } : row));
    };

    const handleCompareValueChange = (rowId: string, val: string) => {
        updateRows((prev) => prev.map((row) => row.id === rowId ? { ...row, compareValue: val } : row));
    };

    const handleValueTypeChange = (rowId: string, val: string) => {
        if (!isConditionValueType(val)) return;
        updateRows((prev) => prev.map((row) => {
            if (row.id !== rowId) return row;
            const newOperators = getOperatorsForType(val);
            const newOperator = newOperators[0]?.value ?? "equals";
            return {
                ...row,
                valueType: val,
                operator: isConditionOperator(newOperator) ? newOperator : row.operator,
            };
        }));
    };

    const handleGroupModeChange = (val: string) => {
        if (val !== "all" && val !== "any") return;
        setGroupMode(val);
    };

    const addConditionRow = () => {
        const defaultCategory = conditionSourceOptions[0]?.value ?? "";
        setRows((prev) => [
            ...prev,
            {
                ...createConditionRow(),
                sourceCategory: defaultCategory,
                sourceGroup: getDefaultConditionSourceGroup(defaultCategory, stepSourceGroups),
            },
        ]);
    };

    const removeConditionRow = (rowId: string) => {
        if (rows.length <= 1) return;
        setRows((prev) => prev.filter((row) => row.id !== rowId));
    };

    const inputCls = "h-9 px-3 text-sm bg-tertiary border border-border-subtle rounded-md outline-none hover:border-border-default focus:border-border-strong focus:bg-elevated transition-colors text-fg placeholder:text-fg-muted flex-1 min-w-[96px]";

    return (
        <div className="flex flex-col gap-3 p-3 bg-[rgba(255,255,255,0.02)] border border-border-subtle rounded-lg">
            {rows.length > 1 ? (
                <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-fg-muted shrink-0">Match</span>
                    <Combobox
                        className="min-w-[170px]"
                        value={groupMode}
                        onChange={handleGroupModeChange}
                        options={CONDITION_GROUP_MODE_OPTIONS}
                    />
                </div>
            ) : null}

            <div className="flex flex-col gap-2">
                {rows.map((row, index) => {
                    const inferredGroup = row.sourceGroup || getSourceGroupForInputRef(row.inputRef, inputSources);
                    const inferredCategory = row.sourceCategory || getSourceCategoryForGroup(inferredGroup);
                    const fallbackCategory = conditionSourceOptions[0]?.value ?? "";
                    const effectiveCategory = conditionSourceOptions.some((option) => option.value === inferredCategory)
                        ? inferredCategory
                        : fallbackCategory;
                    const effectiveGroup =
                        inferredGroup && getSourceCategoryForGroup(inferredGroup) === effectiveCategory
                            ? inferredGroup
                            : getDefaultConditionSourceGroup(effectiveCategory, stepSourceGroups);
                    const scopedSources = effectiveGroup
                        ? inputSources.filter((source) => source.group === effectiveGroup)
                        : [];
                    const operators = getOperatorsForType(row.valueType);
                    const isUnary = row.operator === "is_empty" || row.operator === "is_not_empty";

                    return (
                        <div key={row.id} className="flex flex-col gap-2.5 rounded-xl border border-border-subtle bg-primary/30 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-full border border-border-subtle bg-tertiary px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.18em] text-fg-muted">
                                        {index === 0 ? "Condition" : `Condition ${index + 1}`}
                                    </span>
                                    <div className="flex items-center gap-1 rounded-full border border-border-subtle bg-secondary/70 p-1">
                                        {VALUE_TYPE_OPTIONS.map((valueTypeOption) => (
                                            <button
                                                key={valueTypeOption.value}
                                                type="button"
                                                onClick={() => handleValueTypeChange(row.id, valueTypeOption.value)}
                                                className={`px-2.5 py-1 text-xs font-medium rounded-full transition-all ${row.valueType === valueTypeOption.value
                                                    ? "bg-brand text-white"
                                                    : "text-fg-secondary hover:bg-tertiary hover:text-fg"
                                                    }`}
                                            >
                                                {valueTypeOption.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {rows.length > 1 ? (
                                    <button
                                        type="button"
                                        onClick={() => removeConditionRow(row.id)}
                                        className="text-xs text-fg-muted hover:text-status-error transition-colors"
                                    >
                                        Remove
                                    </button>
                                ) : null}
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold text-fg shrink-0">If</span>
                                {conditionSourceOptions.length > 1 ? (
                                    <Combobox
                                        className="min-w-[150px] max-w-[220px] flex-1"
                                        value={effectiveCategory}
                                        onChange={(val) => handleSourceCategoryChange(row.id, val)}
                                        options={conditionSourceOptions}
                                        placeholder="Choose source…"
                                    />
                                ) : conditionSourceOptions[0] ? (
                                    <span className="inline-flex h-9 items-center rounded-md border border-border-default bg-tertiary px-3 text-sm font-medium text-fg">
                                        {conditionSourceOptions[0].label}
                                    </span>
                                ) : null}
                                {effectiveCategory === "step" ? (
                                    <Combobox
                                        className="min-w-[180px] max-w-[320px] flex-1"
                                        value={effectiveGroup}
                                        onChange={(val) => handleSourceGroupChange(row.id, val)}
                                        options={stepSourceGroups}
                                        placeholder="Choose previous step…"
                                    />
                                ) : null}
                                <Combobox
                                    className="min-w-[150px] max-w-[240px] flex-1"
                                    value={row.inputRef}
                                    onChange={(val) => handleInputRefChange(row.id, val)}
                                    options={scopedSources}
                                    placeholder={getConditionFieldPlaceholder(effectiveCategory, effectiveGroup, scopedSources)}
                                />
                                <Combobox
                                    className="min-w-[140px] max-w-[200px]"
                                    value={row.operator}
                                    onChange={(val) => handleOperatorChange(row.id, val)}
                                    options={operators}
                                />
                                {!isUnary && row.valueType === "boolean" && (
                                    <Combobox
                                        className="min-w-[100px] max-w-[140px] flex-1"
                                        value={row.compareValue || "true"}
                                        onChange={(val) => handleCompareValueChange(row.id, val)}
                                        options={[
                                            { label: "True", value: "true" },
                                            { label: "False", value: "false" }
                                        ]}
                                    />
                                )}
                                {!isUnary && row.valueType !== "boolean" && (
                                    <input
                                        type="text"
                                        className={inputCls}
                                        value={row.compareValue}
                                        onChange={(event) => handleCompareValueChange(row.id, event.target.value)}
                                        placeholder={row.valueType === "number" ? "0" : "value"}
                                    />
                                )}
                            </div>

                            {row.inputRef ? (
                                <div className="rounded-lg border border-brand/15 bg-brand-subtle/40 px-2.5 py-1.5 text-xs text-fg-muted">
                                    <span className="text-fg-secondary">Current rule:</span>{" "}
                                    <span className="text-brand-light">
                                        {effectiveGroup && effectiveGroup !== "Asked at Start"
                                            ? `${effectiveGroup} → ${resolveInputRefLabel(row.inputRef, allBlocks, shortcutInputs)}`
                                            : resolveInputRefLabel(row.inputRef, allBlocks, shortcutInputs)}
                                    </span>
                                    {" "}
                                    <span className="text-fg-secondary">
                                        {operators.find((option) => option.value === row.operator)?.label ?? row.operator}
                                    </span>
                                    {!isUnary && row.compareValue ? (
                                        <>
                                            {" "}
                                            <span className="text-brand-light">{row.compareValue}</span>
                                        </>
                                    ) : null}
                                </div>
                            ) : effectiveGroup && scopedSources.length > 0 ? (
                                <div className="text-xs text-fg-muted px-1">
                                    Choose a value from <span className="text-brand-light">{effectiveGroup}</span>.
                                </div>
                            ) : effectiveGroup ? (
                                <div className="text-xs text-fg-muted px-1">
                                    No values are available from <span className="text-brand-light">{effectiveGroup}</span> yet.
                                </div>
                            ) : effectiveCategory === "step" ? (
                                <div className="text-xs text-fg-muted px-1">
                                    Choose which previous step to read from.
                                </div>
                            ) : effectiveCategory === "input" ? (
                                <div className="text-xs text-fg-muted px-1">
                                    Choose which value asked at the start should control this condition.
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </div>

            {rows.every((row) => !row.inputRef) ? (
                <div className="text-[11px] text-fg-muted px-1">
                    Choose a source, then pick the exact value you want to compare.
                </div>
            ) : null}

            <button
                type="button"
                onClick={addConditionRow}
                className="self-start px-2.5 py-1.5 text-xs font-medium rounded-md border border-border-subtle bg-tertiary text-fg-secondary hover:border-brand hover:text-brand-light transition-colors"
            >
                Add Condition
            </button>
        </div>
    );
}

function StandardParamField({
    block,
    paramDef,
    displayLabel,
    displayHint,
    isGetVariable,
    value,
    bindingSources,
    onUpdateParam,
    networkId,
    shortcutInputs,
    onCreateShortcutInput,
}: {
    block: CanvasBlock;
    paramDef: SkillParamDef;
    displayLabel: string;
    displayHint?: string;
    isGetVariable: boolean;
    value: string;
    bindingSources: InputSourceOption[];
    onUpdateParam: (key: string, value: string) => void;
    networkId?: string;
    shortcutInputs: ShortcutInput[];
    onCreateShortcutInput: (draft: ShortcutInput) => string;
}) {
    const linkedRef = extractTemplateReference(value);
    const hasBindingSources = bindingSources.length > 0;
    const supportsAskEachTime = supportsShortcutInputBinding(block, paramDef);
    const showAskEachTime = supportsAskEachTime || linkedRef?.startsWith("input.") === true;
    const hasBindingOptions = Boolean(linkedRef) || supportsAskEachTime || hasBindingSources;

    return (
        <BuilderFieldRow
            label={displayLabel}
            required={paramDef.required}
            hint={displayHint}
        >
            <div className="min-w-0" onClick={(event) => event.stopPropagation()}>
                <SmartParamInput
                    blockSkillId={block.skillId}
                    paramDef={{ ...paramDef, label: displayLabel, hint: displayHint }}
                    value={value}
                    onChange={(val) => onUpdateParam(paramDef.key, val)}
                    networkId={networkId}
                    shortcutInputs={shortcutInputs}
                />

                {isGetVariable && paramDef.key === "variable" && !linkedRef ? (
                    <p className="mt-1 text-[11px] leading-relaxed text-status-warning">
                        Choose a saved variable below. Plain text here is treated as literal text, not a variable lookup.
                    </p>
                ) : null}

                {hasBindingOptions && (
                    <ValueSourceControl
                        block={block}
                        paramDef={paramDef}
                        displayLabel={displayLabel}
                        value={value}
                        sources={bindingSources}
                        showAskEachTime={showAskEachTime}
                        onCreateShortcutInput={onCreateShortcutInput}
                        onSelect={(nextValue) => onUpdateParam(paramDef.key, nextValue)}
                    />
                )}
            </div>
        </BuilderFieldRow>
    );
}

function formatQuoteFreshnessLabel(quoteTimestamp: number, now: number): string {
    const ageMs = Math.max(0, now - quoteTimestamp);
    const ageSeconds = Math.floor(ageMs / 1000);

    if (ageSeconds < 3) return "Updated just now";
    if (ageSeconds < 60) return `Updated ${ageSeconds}s ago`;

    const ageMinutes = Math.floor(ageSeconds / 60);
    return `Updated ${ageMinutes}m ago`;
}

function getSwapWalletStepLabel(preview: UniswapExactInputPreview): string {
    if (preview.nativeInput && preview.requiresApproval) {
        return "Wrap ETH, approve WETH, then swap";
    }
    if (preview.nativeInput) {
        return "Wrap ETH, then swap";
    }
    if (preview.requiresApproval) {
        return `Approve ${preview.tokenInSelection.displaySymbol}, then swap`;
    }

    return "Swap only";
}

function WalletNotesCard({
    block,
}: {
    block: CanvasBlock;
}) {
    if (block.skillId === "wallet.details") {
        return (
            <div className="mt-2 rounded-lg border border-border-subtle bg-primary/40 p-3">
                <p className="text-sm font-medium text-fg">Wallet Notes</p>
                <div className="mt-3 space-y-2">
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        Wallet Overview is a read-only connected-wallet surface. It returns your address, network, native ETH, and Bavium&apos;s registered token balances for the active Base network.
                    </div>
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        Basename lookup is best-effort. The step still succeeds if no Base or ENS reverse name resolves for the wallet.
                    </div>
                </div>
            </div>
        );
    }

    if (block.skillId === "wallet.resolve_basename") {
        return (
            <div className="mt-2 rounded-lg border border-border-subtle bg-primary/40 p-3">
                <p className="text-sm font-medium text-fg">Wallet Notes</p>
                <div className="mt-3 space-y-2">
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        Resolve Basename is a read-only identity helper. It uses ENSIP-19 style Base name resolution first, then falls back to generic ENS lookup when available.
                    </div>
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        No result means found=false, not a hard failure. Use this for display, branching, or a later manual address confirmation step.
                    </div>
                </div>
            </div>
        );
    }

    if (block.skillId === "wallet.resolve_address") {
        return (
            <div className="mt-2 rounded-lg border border-border-subtle bg-primary/40 p-3">
                <p className="text-sm font-medium text-fg">Wallet Notes</p>
                <div className="mt-3 space-y-2">
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        Resolve Address is a read-only forward lookup for .base.eth and ENS names. It helps prepare later wallet actions without guessing addresses.
                    </div>
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        Resolution is best-effort. Treat missing results as found=false rather than proof that a name is invalid or unregistered.
                    </div>
                </div>
            </div>
        );
    }

    return null;
}

function NftNotesCard({
    block,
}: {
    block: CanvasBlock;
}) {
    if (block.skillId === "nft.check_ownership") {
        return (
            <div className="mt-2 rounded-lg border border-border-subtle bg-primary/40 p-3">
                <p className="text-sm font-medium text-fg">NFT Notes</p>
                <div className="mt-3 space-y-2">
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        This block is read-only. It checks ownership for a known ERC-721 or ERC-1155 token on the active Base network.
                    </div>
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        Bavium does not expose NFT mint, transfer, listing, or buy actions here. Use a manual standard override only when auto-detection cannot identify the collection correctly.
                    </div>
                </div>
            </div>
        );
    }

    if (block.skillId === "nft.get_token_metadata") {
        return (
            <div className="mt-2 rounded-lg border border-border-subtle bg-primary/40 p-3">
                <p className="text-sm font-medium text-fg">NFT Notes</p>
                <div className="mt-3 space-y-2">
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        This block reads collection fields, token URI, and best-effort off-chain metadata for a known NFT token ID.
                    </div>
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        Remote metadata can be missing or temporarily unavailable without failing the whole step. This is a display surface, not an NFT trading or transfer action.
                    </div>
                </div>
            </div>
        );
    }

    return null;
}

function DataNotesCard({
    block,
}: {
    block: CanvasBlock;
}) {
    if (block.skillId === "data.portfolio_snapshot") {
        return (
            <div className="mt-2 rounded-lg border border-border-subtle bg-primary/40 p-3">
                <p className="text-sm font-medium text-fg">Portfolio Notes</p>
                <div className="mt-3 space-y-2">
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        Wallet Portfolio is a read-only snapshot. Native balances are onchain; USD, Morpho, and Uniswap LP sections are best-effort enrichments.
                    </div>
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        Basename lookup is optional and best-effort. This is not a full Base portfolio indexer, PnL dashboard, or tax export.
                    </div>
                </div>
            </div>
        );
    }

    if (block.skillId === "data.wallet_activity") {
        return (
            <div className="mt-2 rounded-lg border border-border-subtle bg-primary/40 p-3">
                <p className="text-sm font-medium text-fg">Activity Notes</p>
                <div className="mt-3 space-y-2">
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        Wallet Activity uses the public Blockscout index for recent Base transactions. It is useful for recent context, not exhaustive accounting.
                    </div>
                </div>
            </div>
        );
    }

    if (block.skillId === "tx.get_receipt" || block.skillId === "tx.wait_confirmation") {
        return (
            <div className="mt-2 rounded-lg border border-border-subtle bg-primary/40 p-3">
                <p className="text-sm font-medium text-fg">Transaction Notes</p>
                <div className="mt-3 space-y-2">
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        These blocks inspect or wait on a transaction hash that already exists. They do not submit, replace, or speed up the transaction.
                    </div>
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        Use Get Transaction Receipt for mined transaction inspection. Use Wait for Confirmation when you already have a known Base or Base Sepolia hash and need a bounded wait.
                    </div>
                </div>
            </div>
        );
    }

    return null;
}

function BridgeNotesCard({
    block,
    networkId,
}: {
    block: CanvasBlock;
    networkId?: string;
}) {
    const showSepoliaNote = networkId === "base-sepolia";

    if (block.skillId === "bridge.list_routes") {
        return (
            <div className="mt-2 rounded-lg border border-border-subtle bg-primary/40 p-3">
                <p className="text-sm font-medium text-fg">Bridge Notes</p>
                <div className="mt-3 space-y-2">
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        This block is read-only. It lists which Across bridge routes are currently available from the active Base network and does not prepare a bridge transaction.
                    </div>
                    {showSepoliaNote ? (
                        <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs leading-relaxed text-status-warning">
                            Base Sepolia uses Across testnet routes only. Destination support and final bridge behavior can differ from Base mainnet.
                        </div>
                    ) : null}
                </div>
            </div>
        );
    }

    if (block.skillId === "bridge.get_quote") {
        return (
            <div className="mt-2 rounded-lg border border-border-subtle bg-primary/40 p-3">
                <p className="text-sm font-medium text-fg">Bridge Notes</p>
                <div className="mt-3 space-y-2">
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        This quote is read-only and indicative. Bavium does not build Across approval or deposit transactions from this block yet.
                    </div>
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        The current bridge flow supports same-symbol routes only, such as USDC to USDC. It is a planning step, not an executable bridge action.
                    </div>
                    {showSepoliaNote ? (
                        <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs leading-relaxed text-status-warning">
                            Base Sepolia quotes use Across testnet data. They help with route planning, but final testnet fills can be slower or less stable than Base mainnet.
                        </div>
                    ) : null}
                </div>
            </div>
        );
    }

    if (block.skillId === "bridge.track_transfer") {
        return (
            <div className="mt-2 rounded-lg border border-border-subtle bg-primary/40 p-3">
                <p className="text-sm font-medium text-fg">Bridge Notes</p>
                <div className="mt-3 space-y-2">
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        Track Bridge Transfer expects an Across deposit transaction reference. Generic transaction hashes from unrelated bridges will not resolve correctly.
                    </div>
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        Tracking only reports status. It does not prepare, resume, or retry the bridge transfer.
                    </div>
                </div>
            </div>
        );
    }

    return null;
}

function DefiNotesCard({
    block,
    networkId,
}: {
    block: CanvasBlock;
    networkId?: string;
}) {
    const showMainnetOnlyNote = networkId === "base-sepolia";

    if (block.skillId === "defi.morpho_deposit") {
        return (
            <div className="mt-2 rounded-lg border border-border-subtle bg-primary/40 p-3">
                <p className="text-sm font-medium text-fg">DeFi Notes</p>
                <div className="mt-3 space-y-2">
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        Morpho Deposit currently supports only the Morpho USDC vault on Base mainnet. The prepared flow is approve plus deposit.
                    </div>
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        This block prepares the wallet action only. It does not estimate yield, APR changes, or downstream portfolio performance.
                    </div>
                    {showMainnetOnlyNote ? (
                        <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs leading-relaxed text-status-warning">
                            Morpho vault actions are not exposed on Base Sepolia in Bavium. Switch to Base mainnet to use this block.
                        </div>
                    ) : null}
                </div>
            </div>
        );
    }

    if (block.skillId === "defi.morpho_withdraw") {
        return (
            <div className="mt-2 rounded-lg border border-border-subtle bg-primary/40 p-3">
                <p className="text-sm font-medium text-fg">DeFi Notes</p>
                <div className="mt-3 space-y-2">
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        Morpho Withdraw currently supports only the Morpho USDC vault on Base mainnet.
                    </div>
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        This block prepares only the withdrawal. It does not claim unrelated rewards, rebalance vault positions, or route the withdrawn funds into another action.
                    </div>
                    {showMainnetOnlyNote ? (
                        <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs leading-relaxed text-status-warning">
                            Morpho vault actions are not exposed on Base Sepolia in Bavium. Switch to Base mainnet to use this block.
                        </div>
                    ) : null}
                </div>
            </div>
        );
    }

    if (block.skillId === "defi.morpho_portfolio") {
        return (
            <div className="mt-2 rounded-lg border border-border-subtle bg-primary/40 p-3">
                <p className="text-sm font-medium text-fg">DeFi Notes</p>
                <div className="mt-3 space-y-2">
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        DeFi Portfolio is currently a read-only Morpho view for Base mainnet. It is not a full protocol indexer for all Base DeFi positions.
                    </div>
                    {showMainnetOnlyNote ? (
                        <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs leading-relaxed text-status-warning">
                            Morpho portfolio reads are intended for Base mainnet. Base Sepolia support is not a full DeFi parity surface.
                        </div>
                    ) : null}
                </div>
            </div>
        );
    }

    if (block.skillId === "defi.clanker_deploy_token") {
        return (
            <div className="mt-2 rounded-lg border border-border-subtle bg-primary/40 p-3">
                <p className="text-sm font-medium text-fg">DeFi Notes</p>
                <div className="mt-3 space-y-2">
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        Clanker Launch Token uses the standard WETH quote-token path only. Custom pool engineering, dev buys, and advanced extension flows are not exposed in Builder yet.
                    </div>
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        This block prepares the deployment transaction only. It does not guarantee immediate trading support in Bavium, because Clanker launches use v4 pool infrastructure while the built-in swap block still targets Uniswap v3 single-pool routes.
                    </div>
                </div>
            </div>
        );
    }

    return null;
}

function SocialNotesCard({
    block,
    networkId,
}: {
    block: CanvasBlock;
    networkId?: string;
}) {
    const showSepoliaTokenNote = block.skillId === "social.prepare_open_token" && networkId === "base-sepolia";

    if (block.skillId === "social.prepare_base_share" || block.skillId === "social.prepare_trade_share") {
        return (
            <div className="mt-2 rounded-lg border border-border-subtle bg-primary/40 p-3">
                <p className="text-sm font-medium text-fg">Social Notes</p>
                <div className="mt-3 space-y-2">
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        These blocks prepare share copy and openable links only. They never post automatically and they never initiate a wallet action.
                    </div>
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        Use them after a real accomplishment moment such as a confirmed swap, a published workflow, or a wallet update you want to share.
                    </div>
                </div>
            </div>
        );
    }

    if (block.skillId === "social.prepare_shortcut_share") {
        return (
            <div className="mt-2 rounded-lg border border-border-subtle bg-primary/40 p-3">
                <p className="text-sm font-medium text-fg">Social Notes</p>
                <div className="mt-3 space-y-2">
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        Workflow Share prepares copy around a published Bavium workflow. It is most useful when you already have a public <code>/p/slug</code> URL.
                    </div>
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        This is a sharing surface only. It does not publish, save, or execute the workflow.
                    </div>
                </div>
            </div>
        );
    }

    if (block.skillId === "social.prepare_open_profile" || block.skillId === "social.prepare_open_token" || block.skillId === "social.prepare_open_tx") {
        return (
            <div className="mt-2 rounded-lg border border-border-subtle bg-primary/40 p-3">
                <p className="text-sm font-medium text-fg">Social Notes</p>
                <div className="mt-3 space-y-2">
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                        These blocks prepare Base-native links you can open, copy, or pass into a later share UI. They do not submit transactions or call Base APIs.
                    </div>
                    {showSepoliaTokenNote ? (
                        <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs leading-relaxed text-status-warning">
                            Base App token deep links are mainnet-only. On Base Sepolia this block falls back to the explorer instead of claiming a Base App token page.
                        </div>
                    ) : null}
                    {block.skillId === "social.prepare_open_tx" ? (
                        <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                            Transaction links currently open the active network explorer. Bavium does not expose a Base App transaction action sheet from this block.
                        </div>
                    ) : null}
                </div>
            </div>
        );
    }

    return null;
}

function X402NotesCard({
    block,
}: {
    block: CanvasBlock;
}) {
    if (block.skillId !== "x402.discover_services") {
        return null;
    }

    return (
        <div className="mt-2 rounded-lg border border-border-subtle bg-primary/40 p-3">
            <p className="text-sm font-medium text-fg">x402 Notes</p>
            <div className="mt-3 space-y-2">
                <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                    This block is read-only Bazaar discovery. It lists candidate x402 HTTP endpoints or MCP tools from a facilitator&apos;s discovery index.
                </div>
                <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                    Coinbase uses semantic search when Search, Asset, Scheme, Max USD Price, or Merchant filters are set. PayAI currently falls back to catalog filtering.
                </div>
                <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                    Bavium does not pay for x402 resources yet. Use this to explore services and compare pricing before any future paid integration work.
                </div>
            </div>
        </div>
    );
}

function formatSwapAdvancedFeeSummary(feeTierValue: string): string {
    if (feeTierValue === "auto") {
        return "Auto fee";
    }

    const parsed = Number(feeTierValue);
    if (parsed === 500 || parsed === 3000 || parsed === 10000) {
        return `Manual fee ${formatFeeTierLabel(parsed)}`;
    }

    return `Manual fee ${feeTierValue}`;
}

function formatSwapAdvancedSlippageSummary(slippageBpsValue: string): string {
    if (slippageBpsValue === "auto") {
        return "Auto slippage (0.50%)";
    }

    const parsed = Number(slippageBpsValue);
    if (Number.isFinite(parsed)) {
        return `Custom slippage ${formatSlippageBpsLabel(parsed)}`;
    }

    return `Custom slippage ${slippageBpsValue}`;
}

function getSwapAdvancedSettingsSummary(feeTierValue: string, slippageBpsValue: string): string {
    const feeSummary = formatSwapAdvancedFeeSummary(feeTierValue);
    const slippageSummary = formatSwapAdvancedSlippageSummary(slippageBpsValue);

    return `${feeSummary} • ${slippageSummary}`;
}

function SwapReviewSkeleton() {
    return (
        <div className="mt-2 rounded-lg border border-border-subtle bg-primary/40 p-3">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="mt-2 h-3 w-44" />
                </div>
                <Skeleton className="h-7 w-24 rounded-full" />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {Array.from({ length: 4 }, (_, index) => (
                    <div
                        key={index}
                        className="rounded-lg border border-border-subtle bg-secondary/70 p-3"
                    >
                        <Skeleton className="h-3 w-20" />
                        <Skeleton className="mt-2 h-5 w-32" />
                    </div>
                ))}
            </div>
        </div>
    );
}

function SwapReviewCard({
    block,
    networkId,
}: {
    block: CanvasBlock;
    networkId?: string;
}) {
    const { address: walletAddress, isConnected } = useAccount();
    const resolvedNetworkId = networkId as NetworkId | undefined;
    const tokenInValue = block.params.find((param) => param.key === "tokenIn")?.value ?? "";
    const tokenOutValue = block.params.find((param) => param.key === "tokenOut")?.value ?? "";
    const amountInValue = block.params.find((param) => param.key === "amountIn")?.value ?? "";
    const feeTierValue = block.params.find((param) => param.key === "feeTier")?.value ?? "auto";
    const slippageBpsValue = block.params.find((param) => param.key === "slippageBps")?.value ?? "auto";
    const deferredTokenIn = useDeferredValue(tokenInValue.trim());
    const deferredTokenOut = useDeferredValue(tokenOutValue.trim());
    const deferredAmountIn = useDeferredValue(amountInValue.trim());
    const deferredFeeTier = useDeferredValue(feeTierValue);
    const deferredSlippageBps = useDeferredValue(slippageBpsValue);
    const [previewState, setPreviewState] = useState<"idle" | "loading" | "resolved" | "error">("idle");
    const [preview, setPreview] = useState<UniswapExactInputPreview | null>(null);
    const [previewError, setPreviewError] = useState("");
    const [now, setNow] = useState(() => Date.now());
    const isReady =
        deferredTokenIn.length > 0
        && deferredTokenOut.length > 0
        && deferredAmountIn.length > 0;

    useEffect(() => {
        if (!isReady) {
            setPreviewState("idle");
            setPreview(null);
            setPreviewError("");
            return;
        }

        let cancelled = false;
        setPreviewState("loading");
        setPreviewError("");

        void buildUniswapExactInputPreview({
            tokenIn: deferredTokenIn,
            tokenOut: deferredTokenOut,
            amountIn: deferredAmountIn,
            feeTier: deferredFeeTier,
            slippageBps: deferredSlippageBps,
            walletAddress: isConnected ? walletAddress : undefined,
            networkId: resolvedNetworkId,
        })
            .then((result) => {
                if (cancelled) return;
                setPreview(result);
                setPreviewState("resolved");
                setNow(Date.now());
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                setPreview(null);
                setPreviewState("error");
                setPreviewError(error instanceof Error ? error.message : "Could not preview this swap yet.");
            });

        return () => {
            cancelled = true;
        };
    }, [
        deferredAmountIn,
        deferredFeeTier,
        deferredSlippageBps,
        deferredTokenIn,
        deferredTokenOut,
        isConnected,
        isReady,
        resolvedNetworkId,
        walletAddress,
    ]);

    useEffect(() => {
        if (!preview) return;

        const intervalId = window.setInterval(() => {
            setNow(Date.now());
        }, 1000);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [preview]);

    if (!isReady) {
        return (
            <div className="mt-2 rounded-lg border border-border-subtle bg-primary/40 p-3">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <p className="text-sm font-medium text-fg">Swap Review</p>
                        <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                            Pick Pay With, Receive, and Amount to preview the route before the wallet prompt opens.
                        </p>
                    </div>
                    <span className="inline-flex items-center rounded-full border border-border-subtle bg-secondary/70 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-fg-muted">
                        Waiting
                    </span>
                </div>
            </div>
        );
    }

    if (previewState === "loading") {
        return <SwapReviewSkeleton />;
    }

    if (previewState === "error") {
        return (
            <div className="mt-2 rounded-lg border border-status-warning/30 bg-status-warning/10 p-3">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <p className="text-sm font-medium text-fg">Swap Review</p>
                        <p className="mt-1 text-xs leading-relaxed text-status-warning">
                            {previewError}
                        </p>
                    </div>
                    <span className="inline-flex items-center rounded-full border border-status-warning/30 bg-status-warning/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-status-warning">
                        Check Inputs
                    </span>
                </div>
            </div>
        );
    }

    if (!preview) {
        return null;
    }

    const approvalLabel = !isConnected
        ? "Connect wallet to check"
        : preview.requiresApproval
            ? `Approval needed for ${preview.tokenInSelection.displaySymbol}`
            : "No approval needed";
    const feeLabel = preview.requestedFeeTier === "auto"
        ? `Auto selected ${formatFeeTierLabel(preview.feeTier)}`
        : `Manual ${formatFeeTierLabel(preview.feeTier)}`;
    const slippageLabel = preview.requestedSlippage === "auto"
        ? `Auto uses ${formatSlippageBpsLabel(preview.slippageBps)}`
        : `Custom ${formatSlippageBpsLabel(preview.slippageBps)}`;
    const showSepoliaNote = preview.networkId === "base-sepolia";
    const showNativeRouteNote = preview.nativeInput || preview.nativeOutput;
    const showApprovalScopeNote = Boolean(isConnected && preview.requiresApproval);

    return (
        <div className="mt-2 rounded-lg border border-border-subtle bg-primary/40 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <p className="text-sm font-medium text-fg">Swap Review</p>
                    <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                        Review the live quote first. Leave Pool Fee and Max Slippage in Auto unless you need a manual override.
                    </p>
                </div>
                <div className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-secondary/70 px-2.5 py-1 text-[11px] font-medium text-fg-muted">
                    <Clock size={12} />
                    {formatQuoteFreshnessLabel(preview.quoteTimestamp, now)}
                </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border-subtle bg-secondary/70 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-fg-muted">
                        Estimated Receive
                    </p>
                    <p className="mt-2 text-sm font-medium text-fg">
                        {preview.quotedAmountOut} {preview.tokenOutSelection.displaySymbol}
                    </p>
                </div>

                <div className="rounded-lg border border-border-subtle bg-secondary/70 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-fg-muted">
                        Minimum Receive
                    </p>
                    <p className="mt-2 text-sm font-medium text-fg">
                        {preview.amountOutMinimum} {preview.tokenOutSelection.displaySymbol}
                    </p>
                </div>

                <div className="rounded-lg border border-border-subtle bg-secondary/70 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-fg-muted">
                        Pool Fee
                    </p>
                    <p className="mt-2 text-sm font-medium text-fg">
                        {feeLabel}
                    </p>
                </div>

                <div className="rounded-lg border border-border-subtle bg-secondary/70 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-fg-muted">
                        Max Slippage
                    </p>
                    <p className="mt-2 text-sm font-medium text-fg">
                        {slippageLabel}
                    </p>
                </div>

                <div className="rounded-lg border border-border-subtle bg-secondary/70 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-fg-muted">
                        Wallet Steps
                    </p>
                    <p className="mt-2 text-sm font-medium text-fg">
                        {getSwapWalletStepLabel(preview)}
                    </p>
                </div>
            </div>

            <div className="mt-3 rounded-lg border border-brand/15 bg-brand-subtle/25 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                <span className="font-medium text-fg">Approval:</span> {approvalLabel}
                <span className="mx-2 text-fg-muted">•</span>
                <span className="font-medium text-fg">Route:</span> Uniswap v3 single-pool on Base
            </div>

            {(showNativeRouteNote || showApprovalScopeNote || showSepoliaNote) ? (
                <div className="mt-3 space-y-2">
                    {showNativeRouteNote ? (
                        <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                            ETH routes use WETH internally on Uniswap v3. Bavium wraps or unwraps automatically when the route starts or ends with ETH.
                        </div>
                    ) : null}

                    {showApprovalScopeNote ? (
                        <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
                            Approval is scoped to the current swap amount. After that allowance is used, running the same swap again may ask for approval again.
                        </div>
                    ) : null}

                    {showSepoliaNote ? (
                        <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs leading-relaxed text-status-warning">
                            Base Sepolia is a testnet. A quote can succeed while the final swap still fails because v3 liquidity is sparse or unstable on Sepolia.
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

function BindingSourceChooser({
    mode,
    sources,
    value,
    onSelect,
}: {
    mode: Extract<ValueSourceMode, "wallet" | "variable" | "step">;
    sources: InputSourceOption[];
    value: string;
    onSelect: (nextValue: string) => void;
}) {
    const linkedRef = extractTemplateReference(value);
    const [selectedGroup, setSelectedGroup] = useState("");
    const stepSourceGroups = useMemo(
        () => buildInputSourceGroups(sources).filter((group) => group.value.startsWith("Step ")),
        [sources],
    );
    const walletSources = useMemo(
        () => sources.filter((source) => source.group === "Connected Wallet"),
        [sources],
    );
    const variableSources = useMemo(
        () => sources.filter((source) => source.group === "Saved Variables"),
        [sources],
    );
    const scopedSources = useMemo(() => {
        if (mode === "wallet") return walletSources;
        if (mode === "variable") return variableSources;
        if (mode === "step" && selectedGroup) {
            return sources.filter((source) => source.group === selectedGroup);
        }
        return [];
    }, [mode, selectedGroup, sources, variableSources, walletSources]);

    useEffect(() => {
        if (mode === "wallet") {
            setSelectedGroup("Connected Wallet");
            return;
        }

        if (mode === "variable") {
            setSelectedGroup("Saved Variables");
            return;
        }

        const linkedGroup = linkedRef ? getSourceGroupForInputRef(linkedRef, sources) : "";
        if (linkedGroup.startsWith("Step ")) {
            setSelectedGroup(linkedGroup);
            return;
        }

        if (stepSourceGroups.length === 1) {
            setSelectedGroup(stepSourceGroups[0].value);
            return;
        }

        setSelectedGroup("");
    }, [linkedRef, mode, sources, stepSourceGroups]);

    if (sources.length === 0) {
        return null;
    }

    const selectedSource =
        linkedRef &&
        getValueSourceMode(value, sources) === mode &&
        (mode !== "step" || getSourceGroupForInputRef(linkedRef, sources) === selectedGroup)
            ? linkedRef
            : "";

    return (
        <div className="mt-2 flex flex-col gap-2.5">
            {mode === "step" && (
                <Combobox
                    value={selectedGroup}
                    onChange={(nextGroup) => {
                        setSelectedGroup(nextGroup);
                    }}
                    options={stepSourceGroups}
                    placeholder="Choose previous step…"
                />
            )}

            {(mode === "wallet" || mode === "variable" || (mode === "step" && selectedGroup)) && (
                <Combobox
                    value={selectedSource}
                    onChange={(nextSource) => {
                        onSelect(`{{${nextSource}}}`);
                    }}
                    options={scopedSources.map((source) => ({
                        label:
                            source.group === "Saved Variables"
                                ? `Variable — ${source.label}`
                                : source.label,
                        value: source.value,
                    }))}
                    placeholder={
                        mode === "wallet"
                            ? "Choose wallet value…"
                            : mode === "variable"
                                ? "Choose saved variable…"
                                : "Choose field…"
                    }
                />
            )}
        </div>
    );
}

function ValueSourceControl({
    block,
    paramDef,
    displayLabel,
    value,
    sources,
    showAskEachTime,
    onCreateShortcutInput,
    onSelect,
}: {
    block: CanvasBlock;
    paramDef: SkillParamDef;
    displayLabel: string;
    value: string;
    sources: InputSourceOption[];
    showAskEachTime: boolean;
    onCreateShortcutInput: (draft: ShortcutInput) => string;
    onSelect: (nextValue: string) => void;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const currentMode = useMemo(
        () => getValueSourceMode(value, sources),
        [sources, value],
    );
    const [activeMode, setActiveMode] = useState<ValueSourceMode>(currentMode);
    const linkedRef = extractTemplateReference(value);

    const availableModes = useMemo(() => {
        const modes: ValueSourceMode[] = ["fixed"];
        if (showAskEachTime) modes.push("input");
        if (sources.some((source) => source.group.startsWith("Step "))) modes.push("step");
        if (sources.some((source) => source.group === "Connected Wallet")) modes.push("wallet");
        if (sources.some((source) => source.group === "Saved Variables")) modes.push("variable");
        return modes;
    }, [showAskEachTime, sources]);

    useEffect(() => {
        if (!isOpen) {
            setActiveMode(currentMode);
        }
    }, [currentMode, isOpen]);

    function resetToFixedValue() {
        onSelect(extractTemplateReference(value) ? paramDef.defaultValue ?? "" : value);
        setActiveMode("fixed");
        setIsOpen(false);
    }

    function activateMode(mode: ValueSourceMode) {
        if (mode === "fixed") {
            resetToFixedValue();
            return;
        }

        if (mode === "input") {
            if (!linkedRef?.startsWith("input.")) {
                const template = onCreateShortcutInput(
                    buildShortcutInputDraft(block, paramDef, displayLabel, value),
                );
                onSelect(template);
            }
            setActiveMode("input");
            setIsOpen(false);
            return;
        }

        setActiveMode(mode);
    }

    return (
        <div className="mt-1.5 flex flex-col gap-2">
            <button
                type="button"
                onClick={() => {
                    setActiveMode(currentMode);
                    setIsOpen((prev) => !prev);
                }}
                className={`inline-flex w-fit items-center gap-1 rounded-md px-1 py-0.5 text-[11px] font-medium transition-colors ${
                    isOpen
                        ? "text-brand-light"
                        : "text-fg-muted hover:text-brand-light"
                }`}
            >
                <span>Value: {getValueSourceModeLabel(currentMode)}</span>
                <ChevronDown
                    size={12}
                    className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
            </button>

            {isOpen && (
                <div className="rounded-lg border border-border-subtle bg-primary/35 px-3 py-2.5 animate-fade-in">
                    <div className="flex flex-wrap gap-1.5">
                        {availableModes.map((mode) => {
                            const isActive = activeMode === mode;
                            return (
                                <button
                                    key={mode}
                                    type="button"
                                    onClick={() => activateMode(mode)}
                                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                        isActive
                                            ? "border-brand bg-brand-subtle text-brand-light"
                                            : "border-border-subtle bg-tertiary text-fg-secondary hover:border-brand/40 hover:text-brand-light"
                                    }`}
                                >
                                    {mode === "input" ? <Clock size={11} /> : null}
                                    {getValueSourceModeLabel(mode)}
                                </button>
                            );
                        })}
                    </div>

                    {(activeMode === "wallet" || activeMode === "variable" || activeMode === "step") && (
                        <BindingSourceChooser
                            mode={activeMode}
                            sources={sources}
                            value={value}
                            onSelect={(nextValue) => {
                                onSelect(nextValue);
                                setIsOpen(false);
                            }}
                        />
                    )}

                    {activeMode === "input" && linkedRef?.startsWith("input.") ? (
                        <p className="mt-2 text-[11px] leading-relaxed text-fg-muted">
                            This field will be asked before the run starts, so the shortcut does not pause mid-flow.
                        </p>
                    ) : null}

                    {activeMode === "fixed" ? (
                        <p className="mt-2 text-[11px] leading-relaxed text-fg-muted">
                            Type a fixed value directly in the field above.
                        </p>
                    ) : null}
                </div>
            )}
        </div>
    );
}

function supportsShortcutInputBinding(
    block: CanvasBlock,
    paramDef: SkillParamDef,
): boolean {
    if (paramDef.type === "condition" || paramDef.type === "operator") {
        return false;
    }

    if (block.skillId === "logic.get_variable" && paramDef.key === "variable") {
        return false;
    }

    return true;
}

function mapParamTypeToShortcutInputType(paramDef: SkillParamDef): InputType {
    switch (paramDef.type) {
        case "address":
            return "address";
        case "token":
            return "token";
        case "amount":
            return "amount";
        case "number":
            return "number";
        case "boolean":
            return "boolean";
        case "select":
            return "select";
        default:
            return "text";
    }
}

function buildShortcutInputDraft(
    block: CanvasBlock,
    paramDef: SkillParamDef,
    label: string,
    value: string,
): ShortcutInput {
    const type = mapParamTypeToShortcutInputType(paramDef);
    const hasLiteralValue = value.trim().length > 0 && !value.includes("{{");
    const blockLabel = block.label.trim();
    const inputLabel = blockLabel && blockLabel !== label
        ? `${blockLabel}: ${label}`
        : label;

    return {
        id: `${block.id}_${paramDef.key}`,
        label: inputLabel,
        type,
        required: paramDef.required,
        placeholder: paramDef.placeholder,
        default: hasLiteralValue ? value : paramDef.defaultValue,
        constraints: type === "select" && paramDef.options?.length
            ? {
                options: paramDef.options.map((option) => ({
                    label: option.label,
                    value: option.value,
                })),
            }
            : undefined,
    };
}

export function SkillParamEditor({
    block,
    onUpdateParam,
    onUpdateOutputAs,
    allBlocks,
    currentBlockId,
    networkId,
    shortcutInputs,
    onCreateShortcutInput,
}: {
    block: CanvasBlock;
    onUpdateParam: (key: string, value: string) => void;
    onUpdateOutputAs: (value: string) => void;
    allBlocks: CanvasBlock[];
    currentBlockId: string;
    networkId?: string;
    shortcutInputs: ShortcutInput[];
    onCreateShortcutInput: (draft: ShortcutInput) => string;
}) {
    const skillDef = findSkillDef(block.skillId);
    const isSetVariable = block.skillId === "logic.set_variable";
    const isGetVariable = block.skillId === "logic.get_variable";
    const isFormatText = block.skillId === "logic.format";
    const isMath = block.skillId === "logic.math";
    const isSwapSkill = block.skillId === "swap.uniswap_prepare_swap" || block.skillId === "swap.uniswap_quote";
    const paramDefs = skillDef?.params ?? [];
    const primaryParamDefs = paramDefs.filter((paramDef) => !paramDef.advanced);
    const advancedParamDefs = paramDefs.filter((paramDef) => paramDef.advanced);
    const hasSavedVariableName = Boolean(block.outputAs?.trim());
    const feeTierValue = block.params.find((param) => param.key === "feeTier")?.value ?? "auto";
    const slippageBpsValue = block.params.find((param) => param.key === "slippageBps")?.value ?? "auto";

    function getEffectiveParamHint(paramDef: SkillParamDef): string | undefined {
        const isTokenListField =
            paramDef.key === "tokens" &&
            (block.skillId === "data.token_prices" || block.skillId === "data.portfolio_snapshot");

        if (isTokenListField) {
            const baseHint = paramDef.hint ? `${paramDef.hint}. ` : "";
            return `${baseHint}You can also use the Source menu to bind a comma-separated token list from an earlier step.`;
        }

        if (paramDef.type !== "token") {
            return paramDef.hint;
        }

        const networkLabel = networkId === "base-mainnet" ? "Base" : "Base Sepolia";
        const baseHint = paramDef.hint ? `${paramDef.hint}. ` : "";
        return `${baseHint}Search known ${networkLabel} tokens instantly, paste a token contract address to import it, or use the Source menu to bind a token selected earlier.`;
    }

    if (paramDefs.length === 0) {
        return (
            <p className="text-sm text-fg-muted italic px-1">
                No parameters required
            </p>
        );
    }

    function renderParamField(paramDef: SkillParamDef) {
        const effectiveParamDef = getNetworkScopedParamDef(block.skillId, paramDef, networkId);
        const current = block.params.find((param) => param.key === effectiveParamDef.key);
        const value = current?.value ?? effectiveParamDef.defaultValue ?? "";
        const bindingSources = buildVariableBindingSources(
            block,
            effectiveParamDef,
            allBlocks,
            currentBlockId,
            networkId,
        );
        const effectiveHint = getEffectiveParamHint(effectiveParamDef);
        const displayLabel = isSetVariable && effectiveParamDef.key === "value" ? "Value to Save" : effectiveParamDef.label;
        const displayHint = isSetVariable && effectiveParamDef.key === "value"
            ? "Most flows can reuse earlier step results directly. Use this only when the value needs a clear reusable name."
                : isGetVariable && effectiveParamDef.key === "variable"
                    ? "Use this only when re-loading a saved variable makes the flow easier to read than referencing it inline."
                    : isFormatText && effectiveParamDef.key === "template"
                        ? "Write your text, then use the Source menu to insert values from previous steps."
                        : isMath && effectiveParamDef.key === "a"
                            ? "Type a number or choose a numeric result from an earlier step."
                            : effectiveHint;

        if (effectiveParamDef.type === "condition") {
            return (
                <BuilderFieldRow
                    key={effectiveParamDef.key}
                    label={effectiveParamDef.label}
                    required={effectiveParamDef.required}
                    hint={effectiveParamDef.hint}
                    labelClassName="md:pt-1"
                >
                    <div onClick={(event) => event.stopPropagation()}>
                        <ConditionBuilder
                            value={value}
                            onChange={(val) => onUpdateParam(effectiveParamDef.key, val)}
                            allBlocks={allBlocks}
                            currentBlockId={currentBlockId}
                            shortcutInputs={shortcutInputs}
                            networkId={networkId}
                        />
                    </div>
                </BuilderFieldRow>
            );
        }

        return (
            <StandardParamField
                key={effectiveParamDef.key}
                block={block}
                paramDef={effectiveParamDef}
                displayLabel={displayLabel}
                displayHint={displayHint}
                isGetVariable={isGetVariable}
                value={value}
                bindingSources={bindingSources}
                onUpdateParam={onUpdateParam}
                networkId={networkId}
                shortcutInputs={shortcutInputs}
                onCreateShortcutInput={onCreateShortcutInput}
            />
        );
    }

    return (
        <div className="flex flex-col gap-2">
            {primaryParamDefs.map((paramDef) => renderParamField(paramDef))}

            {block.skillId === "swap.uniswap_prepare_swap" ? (
                <SwapReviewCard block={block} networkId={networkId} />
            ) : null}

            {block.skillId.startsWith("bridge.") ? (
                <BridgeNotesCard block={block} networkId={networkId} />
            ) : null}

            {block.skillId.startsWith("defi.") ? (
                <DefiNotesCard block={block} networkId={networkId} />
            ) : null}

            {block.skillId.startsWith("wallet.") ? (
                <WalletNotesCard block={block} />
            ) : null}

            {block.skillId.startsWith("nft.") ? (
                <NftNotesCard block={block} />
            ) : null}

            {block.skillId.startsWith("data.") || block.skillId.startsWith("tx.") ? (
                <DataNotesCard block={block} />
            ) : null}

            {block.skillId.startsWith("social.") ? (
                <SocialNotesCard block={block} networkId={networkId} />
            ) : null}

            {block.skillId.startsWith("x402.") ? (
                <X402NotesCard block={block} />
            ) : null}

            {isSetVariable && (
                <div className="rounded-md border border-border-subtle bg-primary/40 px-3 py-2">
                    <BuilderFieldRow
                        label="Variable Name"
                        hint="Give this value a short reusable name only when direct step references would be noisy, for example latestPrice."
                    >
                        <input
                            type="text"
                            className={`h-9 w-full min-w-0 rounded-md border bg-tertiary px-3 text-sm text-fg outline-none transition-colors placeholder:text-fg-muted hover:border-border-default focus:border-border-strong focus:bg-elevated ${hasSavedVariableName ? "border-border-subtle" : "border-status-warning/60"}`}
                            value={block.outputAs ?? ""}
                            onChange={(event) => onUpdateOutputAs(event.target.value)}
                            placeholder="e.g. latestPrice or mintTarget"
                        />
                        <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
                            Most shortcuts do not need this block. Use it when a computed value needs an explicit readable handoff.
                        </p>
                        {!hasSavedVariableName ? (
                            <p className="mt-1 text-[11px] leading-relaxed text-status-warning">
                                Set Variable must include a variable name. Otherwise this block adds no value over direct step reuse.
                            </p>
                        ) : null}
                    </BuilderFieldRow>
                </div>
            )}

            {(advancedParamDefs.length > 0 || !isSetVariable) && (
                <details className="pt-2 border-t border-border-subtle mt-1">
                    <summary className="cursor-pointer select-none list-none rounded-md px-1 py-0.5 hover:bg-secondary/40 transition-colors">
                        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
                            <span className="text-xs font-medium text-fg-muted hover:text-fg-secondary transition-colors">
                                {isSwapSkill ? "Advanced Swap Settings" : "Advanced"}
                            </span>
                            {isSwapSkill ? (
                                <span className="text-[11px] text-fg-muted">
                                    {getSwapAdvancedSettingsSummary(feeTierValue, slippageBpsValue)}
                                </span>
                            ) : null}
                        </div>
                    </summary>
                    <div className="flex flex-col gap-2 mt-2">
                        {isSwapSkill ? (
                            <div className="rounded-md border border-border-subtle bg-primary/40 px-3 py-2 text-[11px] leading-relaxed text-fg-muted">
                                Most swaps should stay in Auto. Only override Pool Fee or Max Slippage when you are targeting a known pool or testing a volatile route.
                            </div>
                        ) : null}
                        {advancedParamDefs.map((paramDef) => renderParamField(paramDef))}
                        {!isSetVariable && (
                            <BuilderFieldRow
                                label="Save as Variable"
                                hint="Save this step result as a reusable variable for later steps. Leave empty if you only need the step once."
                            >
                                <div className="min-w-0">
                                    <input
                                        type="text"
                                        className="h-9 w-full min-w-0 rounded-md border border-border-subtle bg-tertiary px-3 text-sm text-fg outline-none transition-colors placeholder:text-fg-muted hover:border-border-default focus:border-border-strong focus:bg-elevated"
                                        value={block.outputAs ?? ""}
                                        onChange={(event) => onUpdateOutputAs(event.target.value)}
                                        placeholder="e.g. balanceCheck or mintQuota"
                                    />
                                    <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
                                        Any step can save its result as a variable. Prefer this over Set Variable when you only need to name an existing step result.
                                    </p>
                                </div>
                            </BuilderFieldRow>
                        )}
                    </div>
                </details>
            )}
        </div>
    );
}

function formatTemplateDisplay(
    raw: string,
    allBlocks?: CanvasBlock[],
    shortcutInputs?: ShortcutInput[],
): string {
    const match = raw.match(/^\{\{(.+?)\}\}$/);
    if (!match) return raw;

    const ref = match[1];

    return resolveInputRefLabel(ref, allBlocks, shortcutInputs);
}

export function ParamViewRow({
    param,
    allBlocks,
    shortcutInputs,
    paramLabel,
}: {
    param: BlockParam;
    allBlocks?: CanvasBlock[];
    shortcutInputs?: ShortcutInput[];
    paramLabel?: string;
}) {
    const isTemplate = param.value.startsWith("{{");
    const displayKey = paramLabel ?? humanizeIdentifier(param.key);
    const isSwapFeeParam = param.key === "feeTier";
    const isSwapSlippageParam = param.key === "slippageBps";

    if (param.key === "condition") {
        const cond = parseConditionValue(param.value);
        if (cond) {
            if (isConditionGroup(cond)) {
                const joinLabel = cond.mode === "all" ? "AND" : "OR";
                const items = cond.conditions
                    .filter((item): item is ConditionExpression => isConditionExpression(item))
                    .map((item) => {
                        const operators = getOperatorsForType(item.valueType);
                        const opLabel = operators.find((option) => option.value === item.operator)?.label ?? item.operator;
                        const isUnary = item.operator === "is_empty" || item.operator === "is_not_empty";
                        return `${resolveInputRefLabel(item.inputRef, allBlocks, shortcutInputs)} ${opLabel}${!isUnary && item.compareValue ? ` ${item.compareValue}` : ""}`;
                    });

                return (
                    <div className="flex items-center gap-1.5 text-sm flex-wrap">
                        <span className="text-fg-muted shrink-0">If</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-brand-subtle text-brand-light">
                            {items.join(` ${joinLabel} `)}
                        </span>
                    </div>
                );
            }

            const operators = getOperatorsForType(cond.valueType);
            const opLabel = operators.find((option) => option.value === cond.operator)?.label ?? cond.operator;
            const isUnary = cond.operator === "is_empty" || cond.operator === "is_not_empty";
            const inputLabel = resolveInputRefLabel(cond.inputRef, allBlocks, shortcutInputs);

            return (
                <div className="flex items-center gap-1.5 text-sm flex-wrap">
                    <span className="text-fg-muted shrink-0">If</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-brand-subtle text-brand-light">
                        {inputLabel}
                    </span>
                    <span className="text-fg-secondary">{opLabel}</span>
                    {!isUnary && cond.compareValue && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-tertiary text-fg-secondary">
                            {cond.compareValue}
                        </span>
                    )}
                </div>
            );
        }
    }

    if (isTemplate) {
        const display = formatTemplateDisplay(param.value, allBlocks, shortcutInputs);
        return (
            <div className="flex items-center gap-2 text-sm">
                <span className="text-fg-muted shrink-0">{displayKey}:</span>
                <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-brand-subtle text-brand-light">
                    {display}
                </span>
            </div>
        );
    }

    return (
        <div className="flex items-center gap-2 text-sm">
            <span className="text-fg-muted shrink-0">{displayKey}:</span>
            <span className="truncate text-xs px-1.5 py-0.5 rounded bg-tertiary text-fg-secondary">
                {isSwapFeeParam && param.value === "auto"
                    ? "Auto"
                    : isSwapSlippageParam && param.value === "auto"
                        ? "Auto (0.50%)"
                        : isSwapSlippageParam
                            ? (() => {
                                const parsed = Number(param.value);
                                return Number.isFinite(parsed)
                                    ? formatSlippageBpsLabel(parsed)
                                    : param.value;
                            })()
                            : param.value || <span className="italic opacity-50">empty</span>}
            </span>
        </div>
    );
}
