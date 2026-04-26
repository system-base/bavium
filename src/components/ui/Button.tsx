"use client";

import React, { ButtonHTMLAttributes, forwardRef } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "primary" | "secondary" | "ghost" | "danger" | "success" | "icon";
    size?: "sm" | "md" | "lg" | "icon";
    isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    (
        {
            className = "",
            variant = "primary",
            size = "md",
            isLoading,
            children,
            disabled,
            ...props
        },
        ref
    ) => {
        // Base: rounded-md everywhere (standardized)
        let classes =
            "inline-flex items-center justify-center font-semibold rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-primary disabled:opacity-50 disabled:cursor-not-allowed ";

        // Size
        switch (size) {
            case "sm":
                classes += "h-8 px-3 text-sm gap-1.5 ";
                break;
            case "md":
                classes += "h-9 px-4 text-base gap-2 ";
                break;
            case "lg":
                classes += "h-11 px-5 text-base gap-2 ";
                break;
            case "icon":
                classes += "w-8 h-8 p-0 shrink-0 ";
                break;
        }

        // Variant — no orange/purple hover contamination
        switch (variant) {
            case "primary":
                classes += "bg-brand text-white hover:bg-brand-light ";
                break;
            case "secondary":
                classes += "bg-tertiary text-fg border border-border-default hover:bg-elevated hover:border-border-strong ";
                break;
            case "ghost":
                classes += "bg-transparent text-fg-secondary hover:text-fg hover:bg-tertiary ";
                break;
            case "danger":
                classes += "bg-status-error/10 text-status-error border border-status-error/20 hover:bg-status-error/20 ";
                break;
            case "success":
                classes += "bg-status-success/10 text-status-success border border-status-success/20 hover:bg-status-success/20 ";
                break;
            case "icon":
                classes += "bg-transparent text-fg-muted hover:text-fg hover:bg-tertiary ";
                break;
        }

        return (
            <button
                ref={ref}
                className={classes + className}
                disabled={disabled || isLoading}
                {...props}
            >
                {isLoading && (
                    <svg className="w-4 h-4 mr-1.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                )}
                {children}
            </button>
        );
    }
);

Button.displayName = "Button";
