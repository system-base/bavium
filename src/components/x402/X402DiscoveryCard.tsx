"use client";

import { ExternalLink, Globe } from "lucide-react";
import {
    formatX402NetworkLabel,
    type X402DiscoveryService,
    type X402DiscoverySummaryData,
} from "@/lib/x402-bazaar";

function isOpenableUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

function formatServiceType(value: string): string {
    return value === "mcp" ? "MCP Tool" : value === "http" ? "HTTP Endpoint" : value;
}

function renderServiceCard(service: X402DiscoveryService) {
    const networks = service.networks.length > 0
        ? service.networks.map(formatX402NetworkLabel).join(" • ")
        : "Network not specified";

    return (
        <div
            key={`${service.facilitator}:${service.resource}:${service.tool ?? "resource"}`}
            className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-3"
        >
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="break-all text-sm font-medium text-fg">
                        {service.tool ?? service.resource}
                    </div>
                    <div className="mt-1 text-xs text-fg-muted">
                        {formatServiceType(service.type)} • {networks}
                    </div>
                </div>
                {service.pricePreview ? (
                    <div className="shrink-0 rounded-md border border-border-subtle bg-primary/50 px-2 py-1 text-[11px] font-medium text-fg-secondary">
                        {service.pricePreview}
                    </div>
                ) : null}
            </div>

            {service.description ? (
                <p className="mt-2 text-[13px] leading-relaxed text-fg-secondary">
                    {service.description}
                </p>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-fg-muted">
                <span className="rounded-md border border-border-subtle bg-primary/45 px-2 py-1">
                    Facilitator: {service.facilitator}
                </span>
                <span className="rounded-md border border-border-subtle bg-primary/45 px-2 py-1">
                    Accepts: {service.acceptsCount}
                </span>
                {service.lastUpdated ? (
                    <span className="rounded-md border border-border-subtle bg-primary/45 px-2 py-1">
                        Updated: {service.lastUpdated}
                    </span>
                ) : null}
            </div>

            {isOpenableUrl(service.resource) ? (
                <div className="mt-3">
                    <a
                        href={service.resource}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-border-subtle bg-tertiary px-3 text-xs font-semibold text-fg-secondary hover:text-fg"
                    >
                        Open Resource
                        <ExternalLink size={12} />
                    </a>
                </div>
            ) : null}
        </div>
    );
}

export function X402DiscoveryCard({
    data,
    tone = "default",
}: {
    data: X402DiscoverySummaryData;
    tone?: "default" | "success";
}) {
    const visibleServices = data.services.slice(0, 4);
    const remainingServices = data.services.slice(4);

    return (
        <div className={`mt-3 rounded-lg border px-3 py-3 ${
            tone === "success"
                ? "border-status-success/25 bg-status-success/5"
                : "border-border-subtle bg-primary/45"
        }`}>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
                <Globe size={12} />
                x402 Discovery
            </div>
            <div className="mt-1 text-sm font-medium text-fg">
                Found {data.returnedCount} service{data.returnedCount === 1 ? "" : "s"} from {data.facilitator}
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-fg-secondary">
                Discovery only. Bavium can inspect candidate services, but it does not pay for x402 resources yet.
            </p>

            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-fg-muted">
                {data.searchMode ? (
                    <span className="rounded-md border border-border-subtle bg-primary/45 px-2 py-1">
                        Mode: {data.searchMode === "semantic" ? "Semantic Search" : "Catalog Browse"}
                    </span>
                ) : null}
                <span className="rounded-md border border-border-subtle bg-primary/45 px-2 py-1">
                    Type: {data.typeFilter === "all" ? "All" : formatServiceType(data.typeFilter)}
                </span>
                <span className="rounded-md border border-border-subtle bg-primary/45 px-2 py-1">
                    Network: {formatX402NetworkLabel(data.networkFilter)}
                </span>
                {data.keyword ? (
                    <span className="rounded-md border border-border-subtle bg-primary/45 px-2 py-1">
                        Keyword: {data.keyword}
                    </span>
                ) : null}
                {data.asset ? (
                    <span className="rounded-md border border-border-subtle bg-primary/45 px-2 py-1">
                        Asset: {data.asset}
                    </span>
                ) : null}
                {data.scheme ? (
                    <span className="rounded-md border border-border-subtle bg-primary/45 px-2 py-1">
                        Scheme: {data.scheme}
                    </span>
                ) : null}
                {data.maxUsdPrice ? (
                    <span className="rounded-md border border-border-subtle bg-primary/45 px-2 py-1">
                        Max: ${data.maxUsdPrice}
                    </span>
                ) : null}
            </div>

            <div className="mt-3 space-y-2">
                {visibleServices.length > 0 ? (
                    visibleServices.map(renderServiceCard)
                ) : (
                    <div className="rounded-lg border border-border-subtle bg-secondary/70 px-3 py-3 text-sm text-fg-secondary">
                        No matching services were returned for these filters.
                    </div>
                )}
            </div>

            {remainingServices.length > 0 ? (
                <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-medium text-fg-muted hover:text-fg-secondary">
                        Show {remainingServices.length} more discovered service{remainingServices.length === 1 ? "" : "s"}
                    </summary>
                    <div className="mt-2 space-y-2">
                        {remainingServices.map(renderServiceCard)}
                    </div>
                </details>
            ) : null}
        </div>
    );
}
