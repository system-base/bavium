"use client";

import React, {
    useState,
    useRef,
    useEffect,
    useCallback,
    useLayoutEffect,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";

// ---------------------------------------------------------------------------
// Combobox — custom styled dropdown that respects the Bavium design system
// Uses a portal for the dropdown so it is never clipped by scrolling parents.
// ---------------------------------------------------------------------------

export interface ComboboxOption {
    label: string;
    value: string;
    description?: string;
    group?: string;
    disabled?: boolean;
}

export interface ComboboxProps {
    options: ComboboxOption[];
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    hint?: string;
    className?: string;
    disabled?: boolean;
}

export function Combobox({
    options,
    value,
    onChange,
    placeholder = "Select…",
    hint,
    className = "",
    disabled,
}: ComboboxProps) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

    // Close when clicking outside
    const handleClickOutside = useCallback((e: MouseEvent) => {
        const target = e.target as Node;
        if (
            containerRef.current &&
            !containerRef.current.contains(target) &&
            dropdownRef.current &&
            !dropdownRef.current.contains(target)
        ) {
            setOpen(false);
        }
    }, []);

    useEffect(() => {
        if (open) {
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () =>
            document.removeEventListener("mousedown", handleClickOutside);
    }, [open, handleClickOutside]);

    // Close on Escape
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [open]);

    // Position the portal dropdown relative to the trigger button
    useLayoutEffect(() => {
        if (!open || !containerRef.current) return;

        function updatePosition() {
            if (!containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const margin = 8;
            const width = Math.min(Math.max(rect.width, 180), viewportWidth - margin * 2);
            const left = Math.min(
                Math.max(rect.left, margin),
                Math.max(margin, viewportWidth - width - margin),
            );
            const spaceBelow = viewportHeight - rect.bottom - margin;
            const spaceAbove = rect.top - margin;
            const openAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
            const maxHeight = Math.max(
                96,
                Math.min(240, openAbove ? spaceAbove : spaceBelow),
            );

            setDropdownStyle({
                position: "fixed",
                ...(openAbove
                    ? { bottom: viewportHeight - rect.top + 4 }
                    : { top: rect.bottom + 4 }),
                left,
                width,
                minWidth: Math.min(rect.width, width),
                maxHeight,
                zIndex: 9999,
            });
        }

        updatePosition();

        // Reposition on scroll/resize (any parent could scroll)
        window.addEventListener("scroll", updatePosition, true);
        window.addEventListener("resize", updatePosition);
        return () => {
            window.removeEventListener("scroll", updatePosition, true);
            window.removeEventListener("resize", updatePosition);
        };
    }, [open]);

    const selectedLabel =
        options.find((o) => o.value === value)?.label ?? placeholder;

    const dropdown = open ? (
        <div
            ref={dropdownRef}
            style={dropdownStyle}
            className="py-1 rounded-lg border border-border-default bg-secondary shadow-card animate-fade-in overflow-auto"
        >
            {options.map((opt, index) => {
                const isActive = opt.value === value;
                const previousGroup = index > 0 ? options[index - 1]?.group : undefined;
                const showGroup = opt.group && opt.group !== previousGroup;
                return (
                    <React.Fragment key={`${opt.group ?? "default"}:${opt.value}`}>
                        {showGroup && (
                            <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase text-fg-muted">
                                {opt.group}
                            </div>
                        )}
                        <button
                            type="button"
                            disabled={opt.disabled}
                            onClick={() => {
                                if (opt.disabled) return;
                                onChange(opt.value);
                                setOpen(false);
                            }}
                            className={`flex items-start gap-2 w-full px-3 py-2 text-sm rounded-md transition-colors
                                ${opt.disabled
                                    ? "cursor-not-allowed text-fg-muted opacity-60"
                                    : isActive
                                        ? "cursor-pointer text-brand-light font-semibold"
                                        : "cursor-pointer text-fg hover:bg-tertiary"}`}
                        >
                            {isActive ? (
                                <Check size={14} className="shrink-0" />
                            ) : (
                                <span className="w-[14px] shrink-0" />
                            )}
                            <span className="min-w-0 flex-1 text-left" title={opt.label}>
                                <span className="block line-clamp-2">{opt.label}</span>
                                {opt.description ? (
                                    <span className="mt-0.5 block truncate text-[11px] font-normal text-fg-muted">
                                        {opt.description}
                                    </span>
                                ) : null}
                            </span>
                        </button>
                    </React.Fragment>
                );
            })}
        </div>
    ) : null;

    return (
        <div ref={containerRef} className={`relative ${className}`}>
            {/* Trigger */}
            <button
                type="button"
                title={hint}
                disabled={disabled}
                onClick={() => setOpen((prev) => !prev)}
                aria-haspopup="listbox"
                aria-expanded={open}
                className={`flex items-center justify-between w-full min-w-0 h-9 px-3 text-sm font-medium rounded-md border transition-colors outline-none focus-visible:outline-none cursor-pointer
                    bg-tertiary border-border-default text-fg
                    hover:bg-elevated hover:border-border-strong
                    disabled:opacity-50 disabled:cursor-not-allowed
                    ${open ? "border-border-strong bg-elevated" : ""}`}
                data-focus-managed="true"
            >
                <span className="truncate">{selectedLabel}</span>
                <ChevronDown
                    size={14}
                    className={`ml-2 shrink-0 text-fg-muted transition-transform ${open ? "rotate-180" : ""}`}
                />
            </button>

            {/* Dropdown — rendered via portal to avoid overflow clipping */}
            {typeof window !== "undefined" && createPortal(dropdown, document.body)}
        </div>
    );
}
