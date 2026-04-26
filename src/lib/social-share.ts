export interface SocialSharePreparationData {
    kind: "share_preparation";
    shareKind: "generic" | "trade" | "workflow";
    title: string;
    message: string;
    summary: string;
    shareText: string;
    fallbackCopy: string;
    shareUrl?: string;
    shareUrlLabel?: string;
    baseProfileUrl?: string;
    baseTokenUrl?: string;
    walletAddress?: string;
    tokenAddress?: string;
    networkId?: string;
    networkNote?: string;
    webShareData?: {
        title?: string;
        text?: string;
        url?: string;
    };
}

export function isSocialSharePreparationData(value: unknown): value is SocialSharePreparationData {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

    const record = value as Record<string, unknown>;
    return (
        record.kind === "share_preparation" &&
        (record.shareKind === "generic" || record.shareKind === "trade" || record.shareKind === "workflow") &&
        typeof record.title === "string" &&
        typeof record.message === "string" &&
        typeof record.summary === "string" &&
        typeof record.shareText === "string" &&
        typeof record.fallbackCopy === "string"
    );
}

export function serializeSocialSharePreparationData(
    value: SocialSharePreparationData,
): string {
    return JSON.stringify({
        kind: "share_preparation",
        shareKind: value.shareKind,
        title: value.title,
        message: value.message,
        summary: value.summary,
        shareText: value.shareText,
        fallbackCopy: value.fallbackCopy,
        ...(value.shareUrl ? { shareUrl: value.shareUrl } : {}),
        ...(value.shareUrlLabel ? { shareUrlLabel: value.shareUrlLabel } : {}),
        ...(value.baseProfileUrl ? { baseProfileUrl: value.baseProfileUrl } : {}),
        ...(value.baseTokenUrl ? { baseTokenUrl: value.baseTokenUrl } : {}),
        ...(value.walletAddress ? { walletAddress: value.walletAddress } : {}),
        ...(value.tokenAddress ? { tokenAddress: value.tokenAddress } : {}),
        ...(value.networkId ? { networkId: value.networkId } : {}),
        ...(value.networkNote ? { networkNote: value.networkNote } : {}),
        ...(value.webShareData ? { webShareData: value.webShareData } : {}),
    });
}

export function parseSocialSharePreparationSummary(
    value: string,
): SocialSharePreparationData | null {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{")) return null;

    try {
        const parsed: unknown = JSON.parse(trimmed);
        return isSocialSharePreparationData(parsed) ? parsed : null;
    } catch {
        return null;
    }
}
