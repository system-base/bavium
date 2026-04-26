"use client";

import { useMemo } from "react";

function parseChoices(value: string): string[] {
    return value
        .split(/\r?\n|,/)
        .map((entry) => entry.trim())
        .filter(Boolean);
}

export function ChoiceListParamInput({
    value,
    onChange,
    hint,
}: {
    value: string;
    onChange: (value: string) => void;
    hint?: string;
}) {
    const choices = useMemo(() => parseChoices(value), [value]);

    return (
        <div className="flex flex-col gap-2">
            <textarea
                className="min-h-[84px] w-full min-w-0 resize-y rounded-md border border-border-subtle bg-tertiary px-3 py-2 text-sm text-fg outline-none transition-colors placeholder:text-fg-muted hover:border-border-default focus:border-border-strong focus:bg-elevated"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={"ETH\nUSDC\ncbBTC"}
                title={hint}
                spellCheck={false}
                rows={4}
            />

            <div className="flex flex-wrap items-center gap-1.5">
                {choices.length > 0 ? (
                    choices.map((choice, index) => (
                        <span
                            key={`${choice}-${index}`}
                            className="inline-flex items-center rounded-md bg-brand-subtle px-2 py-1 text-xs text-brand-light"
                        >
                            {choice}
                        </span>
                    ))
                ) : (
                    <span className="text-[11px] text-fg-muted">
                        Add one option per line or separate options with commas.
                    </span>
                )}
            </div>

            {choices.length > 0 ? (
                <p className="text-[11px] leading-relaxed text-fg-muted">
                    {choices.length} option{choices.length === 1 ? "" : "s"} will be shown to the user at run time.
                </p>
            ) : null}
        </div>
    );
}
