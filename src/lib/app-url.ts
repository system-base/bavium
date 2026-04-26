function normalizeBaseUrl(value: string): string {
    const trimmed = value.trim().replace(/\/+$/, "");
    if (!trimmed) {
        return "http://localhost:3000";
    }

    if (/^https?:\/\//i.test(trimmed)) {
        return trimmed;
    }

    if (trimmed.startsWith("localhost") || trimmed.startsWith("127.0.0.1")) {
        return `http://${trimmed}`;
    }

    return `https://${trimmed}`;
}

export function getAppBaseUrl(): URL {
    const candidates = [
        process.env.NEXT_PUBLIC_APP_URL,
        process.env.APP_URL,
        process.env.VERCEL_PROJECT_PRODUCTION_URL,
        process.env.VERCEL_URL,
    ];

    for (const candidate of candidates) {
        if (candidate?.trim()) {
            return new URL(normalizeBaseUrl(candidate));
        }
    }

    return new URL("http://localhost:3000");
}
