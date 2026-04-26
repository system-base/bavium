import Link from "next/link";
import { Compass, SearchX } from "lucide-react";
import { BaviumLogo, Button } from "@/components/ui";

export default function NotFound() {
    return (
        <main className="mx-auto flex min-h-screen w-full max-w-4xl items-center justify-center px-6 py-12">
            <section className="w-full rounded-3xl border border-border-default bg-secondary p-8 shadow-card sm:p-10">
                <div className="mb-6 flex items-center justify-between gap-4">
                    <BaviumLogo />
                    <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-subtle text-brand-light">
                        <SearchX size={22} />
                    </div>
                </div>

                <p className="text-sm font-medium uppercase tracking-[0.18em] text-fg-muted">
                    Not Found
                </p>
                <h1 className="mt-3 text-3xl font-semibold text-fg sm:text-4xl">
                    This page is not available
                </h1>
                <p className="mt-4 max-w-2xl text-sm text-fg-secondary sm:text-base">
                    The link may be outdated, private, or no longer exists. Go back to your shortcuts or browse the gallery.
                </p>

                <div className="mt-7 flex flex-wrap gap-3">
                    <Link href="/shortcuts">
                        <Button type="button">
                            <Compass size={16} />
                            Go to Shortcuts
                        </Button>
                    </Link>
                    <Link
                        href="/"
                        className="h-9 rounded-md border border-border-default px-4 text-sm font-semibold text-fg transition-colors hover:border-border-strong hover:bg-tertiary"
                    >
                        <span className="inline-flex h-full items-center">Go home</span>
                    </Link>
                </div>
            </section>
        </main>
    );
}
