"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button, BaviumLogo } from "@/components/ui";

export default function GlobalError({
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
        <html lang="en" data-theme="dark">
            <body className="min-h-screen bg-primary text-fg">
                <main className="mx-auto flex min-h-screen w-full max-w-4xl items-center justify-center px-6 py-12">
                    <section className="w-full rounded-3xl border border-status-error/20 bg-secondary p-8 shadow-card sm:p-10">
                        <div className="mb-6 flex items-center justify-between gap-4">
                            <BaviumLogo />
                            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-status-error/10 text-status-error">
                                <AlertTriangle size={22} />
                            </div>
                        </div>
                        <h1 className="text-3xl font-semibold text-fg sm:text-4xl">
                            The app hit an unexpected error
                        </h1>
                        <p className="mt-4 max-w-2xl text-sm text-fg-secondary sm:text-base">
                            A full-page failure occurred before this route could recover. Retry the app, or return to the home page.
                        </p>
                        <div className="mt-7 flex flex-wrap gap-3">
                            <Button type="button" onClick={reset}>
                                <RefreshCw size={16} />
                                Reload screen
                            </Button>
                            <Link
                                href="/"
                                className="h-9 rounded-md border border-border-default px-4 text-sm font-semibold text-fg transition-colors hover:border-border-strong hover:bg-tertiary"
                            >
                                <span className="inline-flex h-full items-center">Go home</span>
                            </Link>
                        </div>
                    </section>
                </main>
            </body>
        </html>
    );
}
