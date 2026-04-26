"use client";

import React, { InputHTMLAttributes, forwardRef } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
    ({ className = "", error, ...props }, ref) => {
        return (
            <input
                ref={ref}
                className={`w-full h-10 px-3 text-sm bg-tertiary border rounded-[var(--radius-sm)] outline-none transition-colors placeholder:text-fg-muted 
          ${error
                        ? "border-status-error focus:border-status-error focus:ring-1 focus:ring-status-error"
                        : "border-border-default focus:border-brand"
                    } 
          disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
                {...props}
            />
        );
    }
);

Input.displayName = "Input";
