"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, Copy, ExternalLink, Share2 } from "lucide-react";
import type { SocialSharePreparationData } from "@/lib/social-share";

type CopyState = "idle" | "copied" | "error";

export function SharePreparationCard({
    data,
    tone = "default",
}: {
    data: SocialSharePreparationData;
    tone?: "default" | "success";
}) {
    const [copyState, setCopyState] = useState<CopyState>("idle");
    const [shareBusy, setShareBusy] = useState(false);
    const [shareError, setShareError] = useState<string | null>(null);

    const shareUrl = data.shareUrl ?? data.webShareData?.url;
    const shareLinkLabel = useMemo(() => {
        if (data.shareUrlLabel) {
            return data.shareUrlLabel;
        }

        switch (data.shareKind) {
            case "workflow":
                return "Open Workflow";
            case "trade":
                return "Open Bavium Link";
            default:
                return "Open Link";
        }
    }, [data.shareKind, data.shareUrlLabel]);
    const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
    const linkActions = useMemo(
        () => {
            const actions = [
                data.baseProfileUrl ? { label: "Open Base Profile", href: data.baseProfileUrl } : null,
                data.baseTokenUrl ? { label: "Open Base Token", href: data.baseTokenUrl } : null,
                shareUrl ? { label: shareLinkLabel, href: shareUrl } : null,
            ].filter(Boolean) as Array<{ label: string; href: string }>;

            const seen = new Set<string>();
            return actions.filter((action) => {
                if (seen.has(action.href)) {
                    return false;
                }
                seen.add(action.href);
                return true;
            });
        },
        [data.baseProfileUrl, data.baseTokenUrl, shareLinkLabel, shareUrl],
    );

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(data.fallbackCopy || data.shareText);
            setCopyState("copied");
            setShareError(null);
            window.setTimeout(() => setCopyState("idle"), 1800);
        } catch {
            setCopyState("error");
            setShareError("Copy failed in this browser.");
        }
    }, [data.fallbackCopy, data.shareText]);

    const handleShare = useCallback(async () => {
        if (!canNativeShare) return;

        setShareBusy(true);
        setShareError(null);

        try {
            await navigator.share({
                title: data.webShareData?.title ?? data.title,
                text: data.webShareData?.text ?? data.message,
                ...(shareUrl ? { url: shareUrl } : {}),
            });
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
                return;
            }
            setShareError(error instanceof Error ? error.message : "Share failed.");
        } finally {
            setShareBusy(false);
        }
    }, [canNativeShare, data.message, data.title, data.webShareData?.text, data.webShareData?.title, shareUrl]);

    return (
        <div className={`mt-3 rounded-lg border px-3 py-3 ${
            tone === "success"
                ? "border-status-success/25 bg-status-success/5"
                : "border-border-subtle bg-primary/45"
        }`}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
                Share Ready
            </div>
            <div className="mt-1 break-words text-sm font-medium text-fg">
                {data.title}
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-fg-secondary">
                {data.message}
            </p>
            {data.networkNote && (
                <p className="mt-2 text-xs leading-relaxed text-fg-muted">
                    {data.networkNote}
                </p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-border-subtle bg-tertiary px-3 text-xs font-semibold text-fg-secondary hover:text-fg"
                >
                    {copyState === "copied" ? <Check size={12} /> : <Copy size={12} />}
                    {copyState === "copied" ? "Copied" : "Copy Share Text"}
                </button>

                {canNativeShare && (
                    <button
                        type="button"
                        onClick={handleShare}
                        disabled={shareBusy}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-border-subtle bg-tertiary px-3 text-xs font-semibold text-fg-secondary hover:text-fg disabled:opacity-60"
                    >
                        <Share2 size={12} />
                        {shareBusy ? "Sharing..." : "Share Sheet"}
                    </button>
                )}

                {linkActions.map((action) => (
                    <a
                        key={action.href}
                        href={action.href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-border-subtle bg-tertiary px-3 text-xs font-semibold text-fg-secondary hover:text-fg"
                    >
                        {action.label}
                        <ExternalLink size={12} />
                    </a>
                ))}
            </div>

            {shareError && (
                <p className="mt-2 text-xs text-status-error">
                    {shareError}
                </p>
            )}
        </div>
    );
}
