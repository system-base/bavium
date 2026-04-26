import Link from "next/link";
import { BaviumLogo } from "@/components/ui/BaviumLogo";

const FOOTER_LINKS = [
    {
        title: "Product",
        links: [
            { label: "Builder", href: "/builder", soon: false },
            { label: "Skills", href: "/shortcuts", soon: false },
            { label: "Runs", href: "/runs", soon: false },
            { label: "AI Assistant", href: "/chat", soon: false },
        ],
    },
    {
        title: "Resources",
        links: [
            { label: "Documentation", href: "#", soon: true },
            { label: "API", href: "#", soon: true },
            { label: "Changelog", href: "#", soon: true },
        ],
    },
    {
        title: "Connect",
        links: [
            { label: "Base App", href: "#", soon: true },
            { label: "X (Twitter)", href: "#", soon: true },
            { label: "GitHub", href: "#", soon: true },
            { label: "Discord", href: "#", soon: true },
        ],
    },
];

export function Footer() {
    const year = new Date().getFullYear();

    return (
        <footer className="border-t border-border-subtle bg-secondary">
            {/* Links grid */}
            <div className="max-w-[1200px] mx-auto px-6 sm:px-10 pt-12 sm:pt-16 pb-8 sm:pb-12">
                {/*
                  Mobile  (2 cols): [Logo] [Product] / [Resources] [Connect]  — no empty cell
                  Desktop (4 cols): [Logo] [Product] [Resources] [Connect]    — single row
                */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-10 sm:gap-12">
                    {/* 1 — Logo watermark */}
                    <div className="col-span-2 sm:col-span-1 flex items-start justify-start sm:pt-2 mb-2 sm:mb-0">
                        <BaviumLogo className="h-16 sm:h-36 lg:h-40 w-auto text-fg pointer-events-none select-none animate-pulse-faint" />
                    </div>

                    {/* 2 — Product */}
                    <div>
                        <h3 className="text-xs font-semibold tracking-wider uppercase text-fg-muted mb-4 sm:mb-5">
                            {FOOTER_LINKS[0].title}
                        </h3>
                        <ul className="flex flex-col gap-2.5 sm:gap-3">
                            {FOOTER_LINKS[0].links.map((link) => (
                                <li key={link.label}>
                                    <Link
                                        href={link.href}
                                        className="text-sm text-fg-secondary hover:text-fg no-underline transition-colors block w-fit"
                                    >
                                        {link.label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* 3 — Resources */}
                    <div>
                        <h3 className="text-xs font-semibold tracking-wider uppercase text-fg-muted mb-4 sm:mb-5">
                            {FOOTER_LINKS[1].title}
                        </h3>
                        <ul className="grid grid-cols-[max-content_max-content] gap-x-3 gap-y-2.5 sm:gap-y-3 items-center">
                            {FOOTER_LINKS[1].links.map((link) => (
                                <li key={link.label} className="contents">
                                    {link.soon ? (
                                        <>
                                            <span className="col-start-1 text-sm text-fg-muted/50">
                                                {link.label}
                                            </span>
                                            <span className="col-start-2 text-[10px] font-semibold uppercase tracking-wider bg-tertiary text-fg-muted px-1.5 py-0.5 rounded leading-none w-fit">
                                                SOON
                                            </span>
                                        </>
                                    ) : (
                                        <Link
                                            href={link.href}
                                            className="col-start-1 text-sm text-fg-secondary hover:text-fg no-underline transition-colors block w-fit"
                                        >
                                            {link.label}
                                        </Link>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* 4 — Connect */}
                    <div>
                        <h3 className="text-xs font-semibold tracking-wider uppercase text-fg-muted mb-4 sm:mb-5">
                            {FOOTER_LINKS[2].title}
                        </h3>
                        <ul className="grid grid-cols-[max-content_max-content] gap-x-3 gap-y-2.5 sm:gap-y-3 items-center">
                            {FOOTER_LINKS[2].links.map((link) => (
                                <li key={link.label} className="contents">
                                    {link.soon ? (
                                        <>
                                            <span className="col-start-1 text-sm text-fg-muted/50">
                                                {link.label}
                                            </span>
                                            <span className="col-start-2 text-[10px] font-semibold uppercase tracking-wider bg-tertiary text-fg-muted px-1.5 py-0.5 rounded leading-none w-fit">
                                                SOON
                                            </span>
                                        </>
                                    ) : (
                                        <Link
                                            href={link.href}
                                            className="col-start-1 text-sm text-fg-secondary hover:text-fg no-underline transition-colors block w-fit"
                                        >
                                            {link.label}
                                        </Link>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>

            {/* Bottom bar — single line always */}
            <div className="border-t border-border-subtle">
                <div className="max-w-[1200px] mx-auto px-6 sm:px-10 py-4 sm:py-6 flex items-center justify-between">
                    <span className="text-[12px] sm:text-[13px] text-fg-muted">
                        Bavium &middot; {year}
                    </span>
                    <div className="flex items-center gap-4 sm:gap-6">
                        <Link href="#" className="text-[12px] sm:text-[13px] text-fg-muted hover:text-fg no-underline transition-colors">
                            Terms
                        </Link>
                        <Link href="#" className="text-[12px] sm:text-[13px] text-fg-muted hover:text-fg no-underline transition-colors">
                            Privacy
                        </Link>
                        <Link href="https://batches.base.org/" className="text-[12px] sm:text-[13px] text-fg-muted hover:text-fg no-underline transition-colors">
                            Base Batches 003
                        </Link>
                    </div>
                </div>
            </div>
        </footer>
    );
}
