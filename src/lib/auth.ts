/* ==========================================================================
   Auth Utilities — SIWE (Sign-In with Ethereum) Helpers
   CDP-free authentication using viem's signature verification.
   ========================================================================== */

import { verifyMessage, type Address } from "viem";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getActiveNetwork } from "./chain-config";
import {
    consumeNonceInConvex,
    persistNonceInConvex,
} from "./convex-server";

// ---------------------------------------------------------------------------
// Nonce Management
// ---------------------------------------------------------------------------

/**
 * In-memory nonce store for MVP.
 * Phase 2: Replace with Redis or DB-backed store for multi-instance.
 */
const nonceStore = new Map<string, { nonce: string; expiresAt: number; persisted?: boolean }>();

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const SESSION_COOKIE_NAME = "bavium_session";
export const LEGACY_SESSION_COOKIE_NAME = "session";
const DETACHED_NONCE_SESSION_PREFIX = "detached-nonce";

function normalizeNonceSessionKey(sessionKey: string): string {
    return sessionKey.trim().toLowerCase();
}

function getDetachedNonceSessionKey(nonce: string): string {
    return `${DETACHED_NONCE_SESSION_PREFIX}:${nonce}`;
}

/**
 * Generate a cryptographically secure nonce.
 */
export function generateNonce(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Store a nonce associated with an address (or session key).
 * Returns the generated nonce.
 */
export function createNonce(sessionKey: string): string {
    const nonce = generateNonce();
    nonceStore.set(normalizeNonceSessionKey(sessionKey), {
        nonce,
        expiresAt: Date.now() + NONCE_TTL_MS,
        persisted: false,
    });
    return nonce;
}

/**
 * Consume and validate a nonce. Returns true if valid.
 * The nonce is consumed (deleted) after validation — single use.
 */
export function consumeNonce(sessionKey: string, nonce: string): boolean {
    const stored = nonceStore.get(normalizeNonceSessionKey(sessionKey));
    if (!stored) return false;
    if (Date.now() > stored.expiresAt) {
        nonceStore.delete(normalizeNonceSessionKey(sessionKey));
        return false;
    }
    if (stored.nonce !== nonce) return false;
    nonceStore.delete(normalizeNonceSessionKey(sessionKey));
    return true;
}

function deleteNonceIfCurrent(sessionKey: string, nonce: string): void {
    const normalizedKey = normalizeNonceSessionKey(sessionKey);
    const stored = nonceStore.get(normalizedKey);
    if (!stored) return;

    if (Date.now() > stored.expiresAt || stored.nonce === nonce) {
        nonceStore.delete(normalizedKey);
    }
}

export async function createNoncePersistent(sessionKey: string): Promise<string> {
    const normalizedKey = normalizeNonceSessionKey(sessionKey);
    const nonce = generateNonce();
    const expiresAt = Date.now() + NONCE_TTL_MS;
    const persisted = await persistNonceInConvex(normalizedKey, nonce, expiresAt);
    nonceStore.set(normalizedKey, {
        nonce,
        expiresAt,
        persisted,
    });

    return nonce;
}

export async function createDetachedNoncePersistent(): Promise<string> {
    const nonce = generateNonce();
    const normalizedKey = normalizeNonceSessionKey(getDetachedNonceSessionKey(nonce));
    const expiresAt = Date.now() + NONCE_TTL_MS;
    const persisted = await persistNonceInConvex(normalizedKey, nonce, expiresAt);
    nonceStore.set(normalizedKey, {
        nonce,
        expiresAt,
        persisted,
    });

    return nonce;
}

export async function consumeNoncePersistent(
    sessionKey: string,
    nonce: string,
): Promise<boolean> {
    const normalizedKey = normalizeNonceSessionKey(sessionKey);
    const consumed = await consumeNonceInConvex(normalizedKey, nonce);

    if (consumed === true) {
        deleteNonceIfCurrent(normalizedKey, nonce);
        return true;
    }

    if (consumed === false) {
        const stored = nonceStore.get(normalizedKey);
        if (stored?.nonce === nonce && stored.persisted === false) {
            return consumeNonce(normalizedKey, nonce);
        }
        deleteNonceIfCurrent(normalizedKey, nonce);
        return false;
    }

    return consumeNonce(normalizedKey, nonce);
}

export async function consumeDetachedNoncePersistent(nonce: string): Promise<boolean> {
    return consumeNoncePersistent(getDetachedNonceSessionKey(nonce), nonce);
}

// ---------------------------------------------------------------------------
// SIWE Message Construction
// ---------------------------------------------------------------------------

interface SIWEMessageParams {
    address: string;
    nonce: string;
    statement?: string;
    uri?: string;
    chainId?: number;
    issuedAt?: string;
    expirationTime?: string;
}

/**
 * Build an EIP-4361 (SIWE) message string.
 * This is the canonical message format wallets sign.
 */
export function buildSIWEMessage(params: SIWEMessageParams): string {
    const network = getActiveNetwork();
    const domain = params.uri
        ? new URL(params.uri).host
        : "localhost";
    const uri = params.uri ?? "http://localhost:3000";
    const chainId = params.chainId ?? network.chain.id;
    const issuedAt = params.issuedAt ?? new Date().toISOString();
    const statement = params.statement ?? "Sign in to Bavium";

    // EIP-4361 canonical format
    const lines = [
        `${domain} wants you to sign in with your Ethereum account:`,
        params.address,
        "",
        statement,
        "",
        `URI: ${uri}`,
        `Version: 1`,
        `Chain ID: ${chainId}`,
        `Nonce: ${params.nonce}`,
        `Issued At: ${issuedAt}`,
    ];

    if (params.expirationTime) {
        lines.push(`Expiration Time: ${params.expirationTime}`);
    }

    return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Signature Verification
// ---------------------------------------------------------------------------

interface VerifyResult {
    valid: boolean;
    address?: string;
    error?: string;
}

interface ParsedSIWEMessage {
    domain: string;
    address: string;
    statement: string;
    uri: string;
    version: string;
    chainId: number;
    nonce: string;
    issuedAt: string;
    expirationTime?: string;
}

interface VerifySIWEOptions {
    expectedNonce?: string;
    expectedDomain?: string;
    expectedUri?: string;
    expectedChainId?: number;
}

/**
 * Parse a SIWE message in EIP-4361 line-based format.
 * Returns null when the message is malformed.
 */
export function parseSIWEMessage(message: string): ParsedSIWEMessage | null {
    const lines = message.split("\n");
    if (lines.length < 9) return null;

    const prefix = " wants you to sign in with your Ethereum account:";
    if (!lines[0]?.endsWith(prefix)) return null;

    const domain = lines[0].slice(0, -prefix.length).trim();
    const address = lines[1]?.trim();
    if (!domain || !address) return null;

    const uriLine = lines.find((line) => line.startsWith("URI: "));
    const versionLine = lines.find((line) => line.startsWith("Version: "));
    const chainIdLine = lines.find((line) => line.startsWith("Chain ID: "));
    const nonceLine = lines.find((line) => line.startsWith("Nonce: "));
    const issuedAtLine = lines.find((line) => line.startsWith("Issued At: "));
    const expirationLine = lines.find((line) => line.startsWith("Expiration Time: "));

    if (!uriLine || !versionLine || !chainIdLine || !nonceLine || !issuedAtLine) {
        return null;
    }

    const uri = uriLine.slice("URI: ".length).trim();
    const version = versionLine.slice("Version: ".length).trim();
    const chainId = Number(chainIdLine.slice("Chain ID: ".length).trim());
    const nonce = nonceLine.slice("Nonce: ".length).trim();
    const issuedAt = issuedAtLine.slice("Issued At: ".length).trim();
    const expirationTime = expirationLine
        ? expirationLine.slice("Expiration Time: ".length).trim()
        : undefined;

    if (!uri || !version || Number.isNaN(chainId) || !nonce || !issuedAt) {
        return null;
    }

    const uriIdx = lines.indexOf(uriLine);
    const statementLines = lines.slice(3, Math.max(3, uriIdx - 1));
    const statement = statementLines.join("\n").trim();

    return {
        domain,
        address,
        statement,
        uri,
        version,
        chainId,
        nonce,
        issuedAt,
        expirationTime,
    };
}

/**
 * Verify a SIWE signature.
 * Returns the recovered address if valid.
 */
export async function verifySIWESignature(
    message: string,
    signature: `0x${string}`,
    expectedAddress: string,
    options: VerifySIWEOptions = {},
): Promise<VerifyResult> {
    try {
        const parsed = parseSIWEMessage(message);
        if (!parsed) {
            return { valid: false, error: "Malformed SIWE message" };
        }

        if (parsed.address.toLowerCase() !== expectedAddress.toLowerCase()) {
            return { valid: false, error: "SIWE address does not match expected address" };
        }

        if (parsed.version !== "1") {
            return { valid: false, error: "Unsupported SIWE version" };
        }

        if (
            options.expectedNonce &&
            parsed.nonce !== options.expectedNonce
        ) {
            return { valid: false, error: "SIWE nonce mismatch" };
        }

        if (
            options.expectedDomain &&
            parsed.domain !== options.expectedDomain
        ) {
            return { valid: false, error: "SIWE domain mismatch" };
        }

        if (
            options.expectedUri &&
            parsed.uri !== options.expectedUri
        ) {
            return { valid: false, error: "SIWE URI mismatch" };
        }

        if (
            options.expectedChainId &&
            parsed.chainId !== options.expectedChainId
        ) {
            return { valid: false, error: "SIWE chain mismatch" };
        }

        const issuedAtMs = Date.parse(parsed.issuedAt);
        if (Number.isNaN(issuedAtMs)) {
            return { valid: false, error: "Invalid SIWE issued-at timestamp" };
        }

        if (parsed.expirationTime) {
            const expirationMs = Date.parse(parsed.expirationTime);
            if (Number.isNaN(expirationMs)) {
                return { valid: false, error: "Invalid SIWE expiration timestamp" };
            }
            if (Date.now() > expirationMs) {
                return { valid: false, error: "SIWE message has expired" };
            }
        }

        const valid = await verifyMessage({
            address: expectedAddress as Address,
            message,
            signature,
        });

        if (!valid) {
            return { valid: false, error: "Signature verification failed" };
        }

        return { valid: true, address: expectedAddress };
    } catch (err) {
        return {
            valid: false,
            error: `Verification error: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

// ---------------------------------------------------------------------------
// Session (Cookie-based, server-side)
// ---------------------------------------------------------------------------

export interface SessionData {
    address: string;
    chainId: number;
    authenticatedAt: string;
    expiresAt: string;
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SESSION_TOKEN_VERSION = "v1";
const DEV_FALLBACK_SESSION_SECRET = "dev-insecure-session-secret-change-me";

function getSessionSecret(): string | null {
    const fromEnv = process.env.AUTH_SESSION_SECRET?.trim();
    if (fromEnv) return fromEnv;
    if (process.env.NODE_ENV === "production") return null;
    return DEV_FALLBACK_SESSION_SECRET;
}

function toBase64Url(input: string | Buffer): string {
    const b64 = Buffer.isBuffer(input)
        ? input.toString("base64")
        : Buffer.from(input, "utf-8").toString("base64");
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(input: string): Buffer {
    const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
        normalized.length + ((4 - (normalized.length % 4)) % 4),
        "=",
    );
    return Buffer.from(padded, "base64");
}

function signSessionPayload(payloadB64Url: string, secret: string): string {
    const mac = createHmac("sha256", secret)
        .update(`${SESSION_TOKEN_VERSION}.${payloadB64Url}`)
        .digest();
    return toBase64Url(mac);
}

function verifySessionSignature(
    payloadB64Url: string,
    signatureB64Url: string,
    secret: string,
): boolean {
    try {
        const expected = createHmac("sha256", secret)
            .update(`${SESSION_TOKEN_VERSION}.${payloadB64Url}`)
            .digest();
        const actual = fromBase64Url(signatureB64Url);
        if (expected.length !== actual.length) return false;
        return timingSafeEqual(expected, actual);
    } catch {
        return false;
    }
}

function isSessionData(value: unknown): value is SessionData {
    if (typeof value !== "object" || value === null) return false;
    const session = value as Partial<SessionData>;
    return (
        typeof session.address === "string" &&
        session.address.length > 0 &&
        typeof session.chainId === "number" &&
        Number.isFinite(session.chainId) &&
        typeof session.authenticatedAt === "string" &&
        typeof session.expiresAt === "string"
    );
}

/**
 * Create session data after successful authentication.
 */
export function createSessionData(address: string, chainId?: number): SessionData {
    const network = getActiveNetwork();
    return {
        address,
        chainId: chainId ?? network.chain.id,
        authenticatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    };
}

/**
 * Validate that session data is not expired.
 */
export function isSessionValid(session: SessionData): boolean {
    return new Date(session.expiresAt).getTime() > Date.now();
}

/**
 * Encode and sign session data for cookie storage.
 * Format: v1.<payload-base64url>.<signature-base64url>
 */
export function encodeSession(session: SessionData): string {
    const secret = getSessionSecret();
    if (!secret) {
        throw new Error(
            "AUTH_SESSION_SECRET is required in production to sign session cookies.",
        );
    }
    const payload = toBase64Url(JSON.stringify(session));
    const signature = signSessionPayload(payload, secret);
    return `${SESSION_TOKEN_VERSION}.${payload}.${signature}`;
}

/**
 * Decode session data from cookie.
 */
export function decodeSession(encoded: string): SessionData | null {
    try {
        const secret = getSessionSecret();
        if (!secret) return null;

        const [version, payloadB64Url, signatureB64Url] = encoded.split(".");
        if (
            version !== SESSION_TOKEN_VERSION ||
            !payloadB64Url ||
            !signatureB64Url
        ) {
            return null;
        }
        if (!verifySessionSignature(payloadB64Url, signatureB64Url, secret)) {
            return null;
        }

        const json = fromBase64Url(payloadB64Url).toString("utf-8");
        const parsed: unknown = JSON.parse(json);
        if (isSessionData(parsed)) return parsed;
        return null;
    } catch {
        return null;
    }
}
