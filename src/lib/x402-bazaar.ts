export type X402FacilitatorId = "coinbase" | "payai";
export type X402DiscoveryType = "all" | "http" | "mcp";
export type X402DiscoveryNetwork = "all" | "base-mainnet" | "base-sepolia";

export interface X402DiscoveryFilters {
    facilitator?: X402FacilitatorId;
    type?: X402DiscoveryType;
    network?: X402DiscoveryNetwork;
    keyword?: string;
    asset?: string;
    scheme?: string;
    maxUsdPrice?: string;
    payTo?: string;
    maxResults?: number;
}

export interface X402DiscoveryService {
    facilitator: X402FacilitatorId;
    resource: string;
    type: string;
    x402Version?: number | string;
    lastUpdated?: string;
    networks: string[];
    acceptsCount: number;
    pricePreview?: string;
    tool?: string;
    description?: string;
}

export interface X402DiscoverySummaryData {
    kind?: "x402_discovery";
    facilitator: X402FacilitatorId;
    typeFilter: X402DiscoveryType;
    networkFilter: X402DiscoveryNetwork;
    keyword?: string;
    searchMode?: "catalog" | "semantic";
    asset?: string;
    scheme?: string;
    maxUsdPrice?: string;
    payTo?: string;
    returnedCount: number;
    services: X402DiscoveryService[];
}

const BASE_NETWORK_LABELS: Record<
    Exclude<X402DiscoveryNetwork, "all">,
    string
> = {
    "base-mainnet": "eip155:8453",
    "base-sepolia": "eip155:84532",
};

export const X402_FACILITATOR_ENDPOINTS: Record<X402FacilitatorId, string> = {
    coinbase: "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources",
    payai: "https://facilitator.payai.network/discovery/resources",
};

const COINBASE_X402_SEARCH_ENDPOINT = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search";

function normalizeFilterKeyword(value: string | undefined): string {
    return value?.trim().toLowerCase() ?? "";
}

function readString(
    value: unknown,
): string | undefined {
    return typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function readAcceptsNetworks(item: Record<string, unknown>): string[] {
    const accepts = Array.isArray(item.accepts) ? item.accepts : [];
    const networks = accepts
        .map((entry) => readRecord(entry)?.network)
        .filter((value): value is string => typeof value === "string" && value.length > 0);

    return Array.from(new Set(networks));
}

function readPricePreview(item: Record<string, unknown>): string | undefined {
    const accepts = Array.isArray(item.accepts) ? item.accepts : [];
    for (const entry of accepts) {
        const accept = readRecord(entry);
        if (!accept) continue;

        const amount =
            readString(accept.maxAmountRequired) ??
            readString(accept.amount);
        const asset =
            readString(accept.asset) ??
            readString(accept.payTo);

        if (amount && asset) {
            return `${amount} · ${asset}`;
        }
        if (amount) {
            return amount;
        }
    }

    return undefined;
}

function readToolName(item: Record<string, unknown>): string | undefined {
    const accepts = Array.isArray(item.accepts) ? item.accepts : [];
    for (const entry of accepts) {
        const accept = readRecord(entry);
        const outputSchema = readRecord(accept?.outputSchema);
        const input = readRecord(outputSchema?.input);
        const tool = readString(input?.tool);
        if (tool) {
            return tool;
        }
    }

    return undefined;
}

function readDescription(item: Record<string, unknown>): string | undefined {
    const direct = readString(item.description);
    if (direct) return direct;

    const metadata = readRecord(item.metadata);
    const metadataDescription = readString(metadata?.description);
    if (metadataDescription) return metadataDescription;

    const accepts = Array.isArray(item.accepts) ? item.accepts : [];
    for (const entry of accepts) {
        const accept = readRecord(entry);
        const outputSchema = readRecord(accept?.outputSchema);
        const description = readString(outputSchema?.description);
        if (description) return description;
    }

    return undefined;
}

function normalizeDiscoveryItems(
    payload: unknown,
    facilitator: X402FacilitatorId,
): X402DiscoveryService[] {
    const container = readRecord(payload);
    const rawItems = Array.isArray(container?.items)
        ? container.items
        : Array.isArray(container?.resources)
            ? container.resources
        : Array.isArray(payload)
            ? payload
            : [];

    return rawItems
        .map((entry) => readRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
        .map((entry) => ({
            facilitator,
            resource: readString(entry.resource) ?? "Unknown resource",
            type: readString(entry.type) ?? "unknown",
            ...(entry.x402Version !== undefined ? { x402Version: entry.x402Version as number | string } : {}),
            ...(readString(entry.lastUpdated) ? { lastUpdated: readString(entry.lastUpdated) } : {}),
            networks: readAcceptsNetworks(entry),
            acceptsCount: Array.isArray(entry.accepts) ? entry.accepts.length : 0,
            ...(readPricePreview(entry) ? { pricePreview: readPricePreview(entry) } : {}),
            ...(readToolName(entry) ? { tool: readToolName(entry) } : {}),
            ...(readDescription(entry) ? { description: readDescription(entry) } : {}),
        }));
}

function isDiscoveryService(value: unknown): value is X402DiscoveryService {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }

    const record = value as Record<string, unknown>;
    return (
        (record.facilitator === "coinbase" || record.facilitator === "payai") &&
        typeof record.resource === "string" &&
        typeof record.type === "string" &&
        Array.isArray(record.networks) &&
        record.networks.every((network) => typeof network === "string") &&
        typeof record.acceptsCount === "number"
    );
}

export function isX402DiscoverySummaryData(value: unknown): value is X402DiscoverySummaryData {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }

    const record = value as Record<string, unknown>;
    return (
        (record.kind === undefined || record.kind === "x402_discovery") &&
        (record.facilitator === "coinbase" || record.facilitator === "payai") &&
        (record.typeFilter === "all" || record.typeFilter === "http" || record.typeFilter === "mcp") &&
        (
            record.networkFilter === "all" ||
            record.networkFilter === "base-mainnet" ||
            record.networkFilter === "base-sepolia"
        ) &&
        (
            record.searchMode === undefined ||
            record.searchMode === "catalog" ||
            record.searchMode === "semantic"
        ) &&
        typeof record.returnedCount === "number" &&
        Array.isArray(record.services) &&
        record.services.every(isDiscoveryService) &&
        (record.keyword === undefined || typeof record.keyword === "string") &&
        (record.asset === undefined || typeof record.asset === "string") &&
        (record.scheme === undefined || typeof record.scheme === "string") &&
        (record.maxUsdPrice === undefined || typeof record.maxUsdPrice === "string") &&
        (record.payTo === undefined || typeof record.payTo === "string")
    );
}

export function parseX402DiscoverySummary(value: string): X402DiscoverySummaryData | null {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{")) {
        return null;
    }

    try {
        const parsed: unknown = JSON.parse(trimmed);
        return isX402DiscoverySummaryData(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

export function formatX402NetworkLabel(value: X402DiscoveryNetwork | string): string {
    switch (value) {
        case "base-mainnet":
        case "eip155:8453":
            return "Base Mainnet";
        case "base-sepolia":
        case "eip155:84532":
            return "Base Sepolia";
        case "all":
            return "All Networks";
        default:
            return value;
    }
}

function filterDiscoveryServices(
    services: X402DiscoveryService[],
    filters: Required<Pick<X402DiscoveryFilters, "type" | "network">> & {
        keyword: string;
        maxResults: number;
    },
): X402DiscoveryService[] {
    return services
        .filter((service) =>
            filters.type === "all" ? true : service.type === filters.type,
        )
        .filter((service) =>
            filters.network === "all"
                ? true
                : service.networks.includes(BASE_NETWORK_LABELS[filters.network]),
        )
        .filter((service) => {
            if (!filters.keyword) return true;

            const haystack = [
                service.resource,
                service.type,
                service.tool,
                service.description,
                ...service.networks,
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();

            return haystack.includes(filters.keyword);
        })
        .slice(0, filters.maxResults);
}

function normalizeOptionalFilter(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function shouldUseCoinbaseSemanticSearch(filters: X402DiscoveryFilters): boolean {
    return (
        (filters.facilitator ?? "coinbase") === "coinbase" &&
        Boolean(
            normalizeOptionalFilter(filters.keyword) ||
            normalizeOptionalFilter(filters.asset) ||
            normalizeOptionalFilter(filters.scheme) ||
            normalizeOptionalFilter(filters.maxUsdPrice) ||
            normalizeOptionalFilter(filters.payTo),
        )
    );
}

async function fetchDiscoveryPayload(
    facilitator: X402FacilitatorId,
    filters: X402DiscoveryFilters,
): Promise<unknown> {
    const useSemanticSearch = shouldUseCoinbaseSemanticSearch({
        ...filters,
        facilitator,
    });
    const endpoint = useSemanticSearch
        ? COINBASE_X402_SEARCH_ENDPOINT
        : X402_FACILITATOR_ENDPOINTS[facilitator];
    const url = new URL(endpoint);
    const maxResults = Math.max(1, Math.min(20, Number(filters.maxResults ?? 10)));

    if (useSemanticSearch) {
        const keyword = normalizeOptionalFilter(filters.keyword);
        const network = filters.network === "base-mainnet"
            ? "eip155:8453"
            : filters.network === "base-sepolia"
                ? "eip155:84532"
                : undefined;

        if (keyword) url.searchParams.set("query", keyword.slice(0, 400));
        if (network) url.searchParams.set("network", network);
        if (normalizeOptionalFilter(filters.asset)) url.searchParams.set("asset", normalizeOptionalFilter(filters.asset)!.slice(0, 200));
        if (normalizeOptionalFilter(filters.scheme)) url.searchParams.set("scheme", normalizeOptionalFilter(filters.scheme)!.slice(0, 200));
        if (normalizeOptionalFilter(filters.maxUsdPrice)) url.searchParams.set("maxUsdPrice", normalizeOptionalFilter(filters.maxUsdPrice)!.slice(0, 200));
        if (normalizeOptionalFilter(filters.payTo)) url.searchParams.set("payTo", normalizeOptionalFilter(filters.payTo)!.slice(0, 200));
        url.searchParams.set("limit", String(maxResults));
    } else {
        if (filters.type && filters.type !== "all") url.searchParams.set("type", filters.type);
        url.searchParams.set("limit", String(maxResults));
    }

    const response = await fetch(url.toString(), {
        method: "GET",
        cache: "no-store",
        headers: {
            accept: "application/json",
        },
    });

    if (!response.ok) {
        throw new Error(`x402 Bazaar request failed (${response.status}) for ${facilitator}.`);
    }

    return response.json();
}

export async function fetchX402DiscoveryDirect(
    filters: X402DiscoveryFilters,
): Promise<{
    facilitator: X402FacilitatorId;
    searchMode: "catalog" | "semantic";
    services: X402DiscoveryService[];
}> {
    const facilitator = filters.facilitator ?? "coinbase";
    const useSemanticSearch = shouldUseCoinbaseSemanticSearch({
        ...filters,
        facilitator,
    });
    const payload = await fetchDiscoveryPayload(facilitator, filters);
    const normalizedItems = normalizeDiscoveryItems(payload, facilitator);
    const services = useSemanticSearch
        ? normalizedItems
            .filter((service) =>
                filters.type === "all" || !filters.type ? true : service.type === filters.type,
            )
            .slice(0, Math.max(1, Math.min(20, Number(filters.maxResults ?? 10))))
        : filterDiscoveryServices(
            normalizedItems,
            {
                type: filters.type ?? "all",
                network: filters.network ?? "base-mainnet",
                keyword: normalizeFilterKeyword(filters.keyword),
                maxResults: Math.max(1, Math.min(20, Number(filters.maxResults ?? 10))),
            },
        );

    return {
        facilitator,
        searchMode: useSemanticSearch ? "semantic" : "catalog",
        services,
    };
}

export async function discoverX402Services(
    filters: X402DiscoveryFilters,
): Promise<{
    facilitator: X402FacilitatorId;
    searchMode: "catalog" | "semantic";
    services: X402DiscoveryService[];
}> {
    if (typeof window === "undefined") {
        return fetchX402DiscoveryDirect(filters);
    }

    const params = new URLSearchParams();
    if (filters.facilitator) params.set("facilitator", filters.facilitator);
    if (filters.type) params.set("type", filters.type);
    if (filters.network) params.set("network", filters.network);
    if (filters.keyword?.trim()) params.set("keyword", filters.keyword.trim());
    if (filters.asset?.trim()) params.set("asset", filters.asset.trim());
    if (filters.scheme?.trim()) params.set("scheme", filters.scheme.trim());
    if (filters.maxUsdPrice?.trim()) params.set("maxUsdPrice", filters.maxUsdPrice.trim());
    if (filters.payTo?.trim()) params.set("payTo", filters.payTo.trim());
    if (filters.maxResults != null) params.set("maxResults", String(filters.maxResults));

    const response = await fetch(`/api/x402/discovery?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
    });

    if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({ error: "x402 discovery failed." }));
        const message =
            typeof errorPayload?.error === "string"
                ? errorPayload.error
                : "x402 discovery failed.";
        throw new Error(message);
    }

    return response.json();
}
