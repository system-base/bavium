"use client";

const SETTINGS_PLAINTEXT_KEY = "base-shortcuts-settings";
const SETTINGS_ENCRYPTED_KEY = "base-shortcuts-settings.enc";
const SETTINGS_UNLOCK_SECRET_KEY = "base-shortcuts-settings.unlock";
const PBKDF2_ITERATIONS = 250000;

interface EncryptedSettingsPayloadV1 {
    v: 1;
    kdf: {
        name: "PBKDF2";
        hash: "SHA-256";
        iterations: number;
        saltB64: string;
    };
    cipher: {
        name: "AES-GCM";
        ivB64: string;
        dataB64: string;
    };
}

export interface StoredSettingsResult {
    settings: Record<string, unknown> | null;
    source: "none" | "plaintext" | "encrypted";
    locked: boolean;
    error?: string;
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
}

function toBase64(bytes: Uint8Array): string {
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
}

function getUnlockSecret(): string | null {
    if (typeof window === "undefined") return null;
    return sessionStorage.getItem(SETTINGS_UNLOCK_SECRET_KEY);
}

function setUnlockSecret(secret: string): void {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(SETTINGS_UNLOCK_SECRET_KEY, secret);
}

export function clearUnlockSecret(): void {
    if (typeof window === "undefined") return;
    sessionStorage.removeItem(SETTINGS_UNLOCK_SECRET_KEY);
}

async function deriveAesKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
    if (!globalThis.crypto?.subtle) {
        throw new Error("WebCrypto is not available in this browser.");
    }
    const encoder = new TextEncoder();
    const material = await crypto.subtle.importKey(
        "raw",
        encoder.encode(passphrase),
        "PBKDF2",
        false,
        ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: asArrayBuffer(salt),
            iterations: PBKDF2_ITERATIONS,
            hash: "SHA-256",
        },
        material,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
    );
}

async function encryptSettings(
    settings: unknown,
    passphrase: string,
): Promise<string> {
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveAesKey(passphrase, salt);
    const plainText = encoder.encode(JSON.stringify(settings));
    const cipherBuffer = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: asArrayBuffer(iv) },
        key,
        plainText,
    );

    const payload: EncryptedSettingsPayloadV1 = {
        v: 1,
        kdf: {
            name: "PBKDF2",
            hash: "SHA-256",
            iterations: PBKDF2_ITERATIONS,
            saltB64: toBase64(salt),
        },
        cipher: {
            name: "AES-GCM",
            ivB64: toBase64(iv),
            dataB64: toBase64(new Uint8Array(cipherBuffer)),
        },
    };
    return JSON.stringify(payload);
}

async function decryptSettings(
    payloadRaw: string,
    passphrase: string,
): Promise<Record<string, unknown>> {
    const payload = JSON.parse(payloadRaw) as EncryptedSettingsPayloadV1;
    if (
        payload?.v !== 1 ||
        payload?.kdf?.name !== "PBKDF2" ||
        payload?.cipher?.name !== "AES-GCM"
    ) {
        throw new Error("Unsupported encrypted payload version.");
    }

    const salt = fromBase64(payload.kdf.saltB64);
    const iv = fromBase64(payload.cipher.ivB64);
    const data = fromBase64(payload.cipher.dataB64);
    const key = await deriveAesKey(passphrase, salt);
    const plainBuffer = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: asArrayBuffer(iv) },
        key,
        asArrayBuffer(data),
    );
    const text = new TextDecoder().decode(plainBuffer);
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
        throw new Error("Decrypted settings format is invalid.");
    }
    return parsed as Record<string, unknown>;
}

export function isEncryptedSettingsEnabled(): boolean {
    if (typeof window === "undefined") return false;
    return Boolean(localStorage.getItem(SETTINGS_ENCRYPTED_KEY));
}

export async function loadStoredSettings(): Promise<StoredSettingsResult> {
    if (typeof window === "undefined") {
        return { settings: null, source: "none", locked: true };
    }

    const encrypted = localStorage.getItem(SETTINGS_ENCRYPTED_KEY);
    if (encrypted) {
        const unlock = getUnlockSecret();
        if (!unlock) {
            return {
                settings: null,
                source: "encrypted",
                locked: true,
            };
        }
        try {
            const settings = await decryptSettings(encrypted, unlock);
            return {
                settings,
                source: "encrypted",
                locked: false,
            };
        } catch {
            clearUnlockSecret();
            return {
                settings: null,
                source: "encrypted",
                locked: true,
                error: "Failed to decrypt settings. Check your local secret.",
            };
        }
    }

    const plaintext = localStorage.getItem(SETTINGS_PLAINTEXT_KEY);
    if (!plaintext) {
        return { settings: null, source: "none", locked: false };
    }
    try {
        const parsed = JSON.parse(plaintext) as unknown;
        if (typeof parsed !== "object" || parsed === null) {
            return { settings: null, source: "none", locked: false };
        }
        return {
            settings: parsed as Record<string, unknown>,
            source: "plaintext",
            locked: false,
        };
    } catch {
        return { settings: null, source: "none", locked: false };
    }
}

export async function unlockSettings(
    passphrase: string,
): Promise<Record<string, unknown> | null> {
    if (typeof window === "undefined") return null;
    const encrypted = localStorage.getItem(SETTINGS_ENCRYPTED_KEY);
    if (!encrypted) return null;

    const settings = await decryptSettings(encrypted, passphrase);
    setUnlockSecret(passphrase);
    return settings;
}

export async function saveStoredSettings(
    settings: unknown,
    passphraseOverride?: string,
): Promise<void> {
    if (typeof window === "undefined") return;
    const encrypted = localStorage.getItem(SETTINGS_ENCRYPTED_KEY);
    if (encrypted) {
        const passphrase = passphraseOverride ?? getUnlockSecret();
        if (!passphrase) {
            throw new Error("Settings are encrypted. Unlock first to save changes.");
        }
        const next = await encryptSettings(settings, passphrase);
        localStorage.setItem(SETTINGS_ENCRYPTED_KEY, next);
        setUnlockSecret(passphrase);
        localStorage.removeItem(SETTINGS_PLAINTEXT_KEY);
        return;
    }

    localStorage.setItem(SETTINGS_PLAINTEXT_KEY, JSON.stringify(settings));
}

export async function enableEncryptedSettings(
    settings: unknown,
    passphrase: string,
): Promise<void> {
    if (typeof window === "undefined") return;
    const encrypted = await encryptSettings(settings, passphrase);
    localStorage.setItem(SETTINGS_ENCRYPTED_KEY, encrypted);
    localStorage.removeItem(SETTINGS_PLAINTEXT_KEY);
    setUnlockSecret(passphrase);
}
