import { consumeDurableRateLimitInConvex } from "@/lib/convex-server";

interface RateLimitEntry {
    count: number;
    resetAt: number;
}

const buckets = new Map<string, RateLimitEntry>();

interface ConsumeRateLimitOptions {
    bucket: string;
    key: string;
    windowMs: number;
    max: number;
}

export function getRequestClientKey(request: Request): string {
    const xff = request.headers.get("x-forwarded-for");
    if (xff) {
        return xff.split(",")[0]!.trim().toLowerCase();
    }

    const realIp = request.headers.get("x-real-ip")?.trim().toLowerCase();
    if (realIp) return realIp;

    return "unknown";
}

function consumeMemoryRateLimit(
    options: ConsumeRateLimitOptions,
): { allowed: boolean; retryAfterSeconds: number } {
    const now = Date.now();
    const normalizedKey = `${options.bucket}:${options.key.trim().toLowerCase()}`;
    const entry = buckets.get(normalizedKey);

    if (!entry || now > entry.resetAt) {
        buckets.set(normalizedKey, {
            count: 1,
            resetAt: now + options.windowMs,
        });
        return {
            allowed: true,
            retryAfterSeconds: Math.ceil(options.windowMs / 1000),
        };
    }

    entry.count += 1;

    return {
        allowed: entry.count <= options.max,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
}

export function consumeBestEffortRateLimit(
    options: ConsumeRateLimitOptions,
): { allowed: boolean; retryAfterSeconds: number } {
    return consumeMemoryRateLimit(options);
}

export async function consumeServerRateLimit(
    options: ConsumeRateLimitOptions,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const durableResult = await consumeDurableRateLimitInConvex(
        options.bucket,
        options.key,
        options.windowMs,
        options.max,
    );

    if (durableResult) {
        return durableResult;
    }

    return consumeMemoryRateLimit(options);
}
