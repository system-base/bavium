"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";

export default function AppError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error(error);
    }, [error]);

    return (
        <div className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center">
            <section className="w-full rounded-2xl border border-status-error/20 bg-status-error/5 p-6 shadow-card sm:p-8">
                <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-status-error/10 text-status-error">
                    <AlertTriangle size={22} />
                </div>
                <h1 className="text-2xl font-semibold text-fg sm:text-3xl">
                    Something went wrong
                </h1>
                <p className="mt-3 max-w-2xl text-sm text-fg-secondary sm:text-base">
                    This screen could not finish loading. You can retry this view or go back to your shortcuts.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                    <Button type="button" onClick={reset}>
                        <RefreshCw size={16} />
                        Try again
                    </Button>
                    <Link
                        href="/shortcuts"
                        className="h-9 rounded-md border border-border-default px-4 text-sm font-semibold text-fg transition-colors hover:border-border-strong hover:bg-tertiary"
                    >
                        <span className="inline-flex h-full items-center">Go to Shortcuts</span>
                    </Link>
                </div>
            </section>
        </div>
    );
}
