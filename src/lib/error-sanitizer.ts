/* ==========================================================================
   Error Sanitizer
   Prevents internal/technical error messages (Convex internals, deployment
   hints, request IDs, etc.) from leaking to end users.

   Usage:
     import { sanitizeErrorMessage } from "@/lib/error-sanitizer";
     const userMessage = sanitizeErrorMessage(error, "Failed to save shortcut");
   ========================================================================== */

/**
 * Patterns that indicate an internal/infrastructure error message
 * which should never be exposed to end users.
 */
const INTERNAL_PATTERNS = [
    "Could not find public function",
    "npx convex",
    "Request ID:",
    "Server Error",
    "INTERNAL_SERVER_ERROR",
    "Internal Server Error",
    "ConvexError",
    "_generated/",
    "serverSecret",
    "CONVEX_SERVER_SECRET",
    "NEXT_PUBLIC_CONVEX_URL",
    "fetchQuery",
    "fetchMutation",
    "assertServerAccess",
    "is not configured",
] as const;

/**
 * Known user-facing error messages that are safe to pass through.
 * These are messages we explicitly construct in Convex mutations
 * and want the user to see.
 */
const SAFE_PATTERNS = [
    "not found",
    "does not belong",
    "linked to",
    "unique publish slug",
    "Too many",
    "already exists",
    "at least one step",
    "Missing required",
    "Invalid",
    "must be",
    "not configured",
    "Selection required",
    "Published shortcut not found",
] as const;

/**
 * Returns true if the message looks like it was intentionally written
 * for end users (known domain-level error).
 */
function isSafeMessage(message: string): boolean {
    const lower = message.toLowerCase();
    return SAFE_PATTERNS.some((pattern) => lower.includes(pattern.toLowerCase()));
}

/**
 * Returns true if the message contains infrastructure/internal details
 * that should never reach the end user.
 */
function isInternalMessage(message: string): boolean {
    return INTERNAL_PATTERNS.some((pattern) => message.includes(pattern));
}

/**
 * Sanitize an error for user-facing API responses.
 *
 * - If the error contains known internal patterns → return fallback
 * - If the error contains known safe patterns → return as-is
 * - If the message is very long (>200 chars) → likely a stack trace → return fallback
 * - Otherwise → return as-is (likely a domain error from our own code)
 *
 * @param error   The caught error (unknown type)
 * @param fallback  The generic user-facing message to show instead
 */
export function sanitizeErrorMessage(error: unknown, fallback: string): string {
    if (!(error instanceof Error)) return fallback;

    const message = error.message;

    // Always block internal messages
    if (isInternalMessage(message)) {
        return fallback;
    }

    // Known safe domain errors — pass through
    if (isSafeMessage(message)) {
        return message;
    }

    // Very long messages are likely stack traces or verbose Convex errors
    if (message.length > 200) {
        return fallback;
    }

    // Short, non-internal messages — likely our own domain errors
    return message;
}

/**
 * Helper to determine HTTP status from an error, using only safe patterns.
 * Replaces the previous `getStatusFromError` scattered across routes.
 */
export function getHttpStatusFromError(error: unknown, defaultStatus = 500): number {
    if (!(error instanceof Error)) return defaultStatus;
    const msg = error.message.toLowerCase();
    if (msg.includes("not found")) return 404;
    if (msg.includes("unique publish slug") || msg.includes("already exists")) return 409;
    if (msg.includes("does not belong") || msg.includes("unauthorized")) return 403;
    return defaultStatus;
}
