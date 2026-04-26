"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import {
    Check,
    Copy,
    Download,
    Loader2,
    MessageSquareShare,
    X,
} from "lucide-react";
import type { BlockCategory } from "@/lib/constants";
import { CATEGORY_META } from "@/lib/constants";

interface PublishedShortcutShareDialogProps {
    shortcut: {
        slug: string;
        name: string;
        description?: string;
        category: string;
        steps: Array<{
            id: string;
            label: string;
            skill: string;
        }>;
    };
    pageUrl: string;
    xShareUrl: string;
    onClose: () => void;
}

type CardTheme = "dark" | "light";

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;
const BRAND_COLOR = "#30D5C8";
const LIGHT_BRAND_COLOR = "#A91101";
const BACKGROUND_COLOR = "#050505";
const TEXT_PRIMARY = "#f5f5f5";
const TEXT_SECONDARY = "rgba(245, 245, 245, 0.72)";
const TEXT_MUTED = "rgba(245, 245, 245, 0.48)";

function rgba(hex: string, alpha: number): string {
    const sanitized = hex.replace("#", "");
    if (sanitized.length !== 6) {
        return `rgba(48, 213, 200, ${alpha})`;
    }

    const red = Number.parseInt(sanitized.slice(0, 2), 16);
    const green = Number.parseInt(sanitized.slice(2, 4), 16);
    const blue = Number.parseInt(sanitized.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function resolveCanvasColor(cssValue: string): string {
    if (typeof window === "undefined") {
        return BRAND_COLOR;
    }

    const trimmed = cssValue.trim();
    if (!trimmed.startsWith("var(")) {
        return trimmed || BRAND_COLOR;
    }

    const variableName = trimmed.slice(4, -1).trim();
    const resolved = window.getComputedStyle(document.documentElement)
        .getPropertyValue(variableName)
        .trim();

    return resolved || BRAND_COLOR;
}

function normalizeText(value: string): string {
    return value.trim().replace(/\s+/g, " ");
}

function trimText(value: string, maxLength: number): string {
    const normalized = normalizeText(value);
    if (normalized.length <= maxLength) {
        return normalized;
    }

    return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function buildShareDescription(description: string | undefined, stepCount: number): string {
    const shortDescription = description?.trim();
    if (shortDescription) {
        return trimText(shortDescription, 148);
    }

    return `Base workflow with ${stepCount} step${stepCount === 1 ? "" : "s"}.`;
}

function supportsNativeFileShare(): boolean {
    return typeof navigator !== "undefined"
        && "share" in navigator
        && typeof navigator.share === "function"
        && "canShare" in navigator
        && typeof navigator.canShare === "function";
}

function getDocumentTheme(): CardTheme {
    if (typeof document === "undefined") {
        return "dark";
    }

    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function getActionAccent(theme: CardTheme): string {
    return theme === "light" ? LIGHT_BRAND_COLOR : BRAND_COLOR;
}

function getCardThemeTokens(theme: CardTheme) {
    if (theme === "light") {
        return {
            background: "#f6f3ef",
            surface: "rgba(0, 0, 0, 0.05)",
            surfaceBorder: "rgba(0, 0, 0, 0.08)",
            textPrimary: "#181818",
            textSecondary: "rgba(24, 24, 24, 0.72)",
            textMuted: "rgba(24, 24, 24, 0.44)",
            topGlowStart: "rgba(255, 255, 255, 0.62)",
            topGlowEnd: "rgba(255, 255, 255, 0)",
            logoColor: "#181818",
            logoOpacity: 0.06,
            brandColor: LIGHT_BRAND_COLOR,
        };
    }

    return {
        background: BACKGROUND_COLOR,
        surface: "rgba(255, 255, 255, 0.06)",
        surfaceBorder: "rgba(255, 255, 255, 0.10)",
        textPrimary: TEXT_PRIMARY,
        textSecondary: TEXT_SECONDARY,
        textMuted: TEXT_MUTED,
        topGlowStart: "rgba(255, 255, 255, 0.04)",
        topGlowEnd: "rgba(255, 255, 255, 0)",
        logoColor: "#ffffff",
        logoOpacity: 0.08,
        brandColor: BRAND_COLOR,
    };
}

function wrapText(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
    maxLines: number,
): string[] {
    const normalized = normalizeText(text);
    if (!normalized) {
        return [];
    }

    const words = normalized.split(" ");
    const lines: string[] = [];
    let currentLine = "";

    for (let index = 0; index < words.length; index += 1) {
        const word = words[index];
        const candidate = currentLine ? `${currentLine} ${word}` : word;

        if (ctx.measureText(candidate).width <= maxWidth) {
            currentLine = candidate;
            continue;
        }

        if (!currentLine) {
            let truncatedWord = word;

            while (truncatedWord.length > 0 && ctx.measureText(`${truncatedWord}…`).width > maxWidth) {
                truncatedWord = truncatedWord.slice(0, -1);
            }

            lines.push(truncatedWord ? `${truncatedWord}…` : "…");
            currentLine = "";
        } else {
            lines.push(currentLine);
            currentLine = word;
        }

        if (lines.length === maxLines - 1) {
            const remainderStartIndex = currentLine ? index : index + 1;
            const remainder = words.slice(remainderStartIndex).join(" ");
            let finalLine = remainder;

            while (finalLine.length > 0 && ctx.measureText(`${finalLine}…`).width > maxWidth) {
                finalLine = finalLine.slice(0, -1).trimEnd();
            }

            lines.push(finalLine ? `${finalLine}…` : "…");
            return lines;
        }
    }

    if (currentLine) {
        lines.push(currentLine);
    }

    return lines.slice(0, maxLines);
}

function roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.closePath();
}

function drawPill(
    ctx: CanvasRenderingContext2D,
    options: {
        x: number;
        y: number;
        text: string;
        background: string;
        color: string;
        border?: string;
        font: string;
        height: number;
        horizontalPadding: number;
        uppercase?: boolean;
    },
): number {
    const {
        x,
        y,
        text,
        background,
        color,
        border,
        font,
        height,
        horizontalPadding,
        uppercase = false,
    } = options;

    ctx.save();
    ctx.font = font;
    const value = uppercase ? text.toUpperCase() : text;
    const width = ctx.measureText(value).width + horizontalPadding * 2;

    roundRect(ctx, x, y, width, height, height / 2);
    ctx.fillStyle = background;
    ctx.fill();

    if (border) {
        ctx.strokeStyle = border;
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(value, x + horizontalPadding, y + height / 2 + 1);
    ctx.restore();

    return width;
}

function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new window.Image();
        image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Failed to load image: ${url}`));
        image.src = url;
    });
}

async function loadTintedSvg(url: string, color: string): Promise<HTMLImageElement> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load svg: ${url}`);
    }

    const svg = await response.text();
    const tintedSvg = svg.replaceAll("currentColor", color);
    const blob = new Blob([tintedSvg], { type: "image/svg+xml" });
    const objectUrl = URL.createObjectURL(blob);

    try {
        return await loadImage(objectUrl);
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

async function generateShareCardImage(
    shortcut: PublishedShortcutShareDialogProps["shortcut"],
    cardTheme: CardTheme,
): Promise<Blob> {
    if ("fonts" in document) {
        await document.fonts.ready;
    }

    const canvas = document.createElement("canvas");
    canvas.width = CARD_WIDTH;
    canvas.height = CARD_HEIGHT;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
        throw new Error("Canvas is not supported in this browser.");
    }

    const category = shortcut.category as BlockCategory;
    const meta = CATEGORY_META[category] ?? {
        label: shortcut.category,
        cssColor: BRAND_COLOR,
    };
    const accent = resolveCanvasColor(meta.cssColor);
    const themeTokens = getCardThemeTokens(cardTheme);
    const description = buildShareDescription(shortcut.description, shortcut.steps.length);
    const logoImage = await loadTintedSvg("/logo.svg", themeTokens.logoColor);

    ctx.fillStyle = themeTokens.background;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    const radial = ctx.createRadialGradient(140, 80, 10, 420, 200, 640);
    radial.addColorStop(0, rgba(accent, cardTheme === "light" ? 0.16 : 0.26));
    radial.addColorStop(1, cardTheme === "light" ? "rgba(246, 243, 239, 0)" : "rgba(5, 5, 5, 0)");
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    const topGlow = ctx.createLinearGradient(0, 0, 0, 220);
    topGlow.addColorStop(0, themeTokens.topGlowStart);
    topGlow.addColorStop(1, themeTokens.topGlowEnd);
    ctx.fillStyle = topGlow;
    ctx.fillRect(0, 0, CARD_WIDTH, 220);

    ctx.save();
    ctx.globalAlpha = themeTokens.logoOpacity;
    ctx.drawImage(logoImage, 750, 88, 404, 404);
    ctx.restore();

    const leftX = 72;
    const contentWidth = 688;

    ctx.font = '600 20px "Questrial", "Helvetica Neue", Arial, sans-serif';
    drawPill(ctx, {
        x: leftX,
        y: 68,
        text: meta.label,
        background: rgba(accent, 0.12),
        border: rgba(accent, 0.28),
        color: accent,
        font: '600 20px "Questrial", "Helvetica Neue", Arial, sans-serif',
        height: 42,
        horizontalPadding: 18,
        uppercase: true,
    });
    ctx.fillStyle = themeTokens.textPrimary;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = '700 74px "Questrial", "Helvetica Neue", Arial, sans-serif';
    const titleLines = wrapText(ctx, trimText(shortcut.name, 72), contentWidth, 2);
    titleLines.forEach((line, index) => {
        ctx.fillText(line, leftX, 162 + index * 84);
    });

    ctx.fillStyle = themeTokens.textSecondary;
    ctx.font = '400 30px "Questrial", "Helvetica Neue", Arial, sans-serif';
    const descriptionStartY = 162 + titleLines.length * 84 + 18;
    const descriptionLines = wrapText(ctx, description, 640, 3);
    descriptionLines.forEach((line, index) => {
        ctx.fillText(line, leftX, descriptionStartY + index * 40);
    });

    const stepsStartY = 420;
    ctx.fillStyle = themeTokens.textMuted;
    ctx.font = '500 18px "Questrial", "Helvetica Neue", Arial, sans-serif';
    ctx.fillText("Workflow", leftX, stepsStartY);

    let pillX = leftX;
    let pillY = stepsStartY + 22;
    shortcut.steps.slice(0, 3).forEach((step) => {
        ctx.font = '500 18px "Questrial", "Helvetica Neue", Arial, sans-serif';
        const label = trimText(step.label, 24);
        const pillWidth = ctx.measureText(label).width + 26;

        if (pillX + pillWidth > leftX + 640) {
            pillX = leftX;
            pillY += 42;
        }

        const width = drawPill(ctx, {
            x: pillX,
            y: pillY,
            text: label,
            background: themeTokens.surface,
            border: themeTokens.surfaceBorder,
            color: themeTokens.textSecondary,
            font: '500 18px "Questrial", "Helvetica Neue", Arial, sans-serif',
            height: 34,
            horizontalPadding: 13,
        });

        pillX += width + 10;
    });

    ctx.drawImage(logoImage, leftX, 548, 28, 28);
    ctx.fillStyle = themeTokens.brandColor;
    ctx.font = '700 28px "Questrial", "Helvetica Neue", Arial, sans-serif';
    ctx.fillText("BAVIUM", leftX + 40, 548);

    ctx.fillStyle = themeTokens.textMuted;
    ctx.font = '500 18px "Questrial", "Helvetica Neue", Arial, sans-serif';
    ctx.fillText("The workflow builder for Base", leftX + 40, 582);

    return await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) {
                resolve(blob);
                return;
            }

            reject(new Error("Failed to generate share card image."));
        }, "image/png", 1);
    });
}

export default function PublishedShortcutShareDialog({
    shortcut,
    pageUrl,
    xShareUrl,
    onClose,
}: PublishedShortcutShareDialogProps) {
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [imageBlob, setImageBlob] = useState<Blob | null>(null);
    const [isGenerating, setIsGenerating] = useState(true);
    const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
    const [shareState, setShareState] = useState<"idle" | "sharing">("idle");
    const [error, setError] = useState<string | null>(null);
    const [canShareImage, setCanShareImage] = useState(false);
    const [cardTheme, setCardTheme] = useState<CardTheme>("dark");

    useEffect(() => {
        setCardTheme(getDocumentTheme());
    }, []);

    useEffect(() => {
        let isCancelled = false;
        let currentObjectUrl: string | null = null;

        async function generate() {
            setIsGenerating(true);
            setError(null);
            setCopyState("idle");

            try {
                const blob = await generateShareCardImage(shortcut, cardTheme);
                if (isCancelled) {
                    return;
                }

                currentObjectUrl = URL.createObjectURL(blob);
                setImageBlob(blob);
                setImageUrl(currentObjectUrl);

                if (supportsNativeFileShare()) {
                    try {
                        const file = new File([blob], `bavium-${shortcut.slug}.png`, { type: "image/png" });
                        setCanShareImage(navigator.canShare({ files: [file] }));
                    } catch {
                        setCanShareImage(false);
                    }
                } else {
                    setCanShareImage(false);
                }
            } catch (generationError) {
                if (isCancelled) {
                    return;
                }

                setError(
                    generationError instanceof Error
                        ? generationError.message
                        : "Failed to generate the share card.",
                );
            } finally {
                if (!isCancelled) {
                    setIsGenerating(false);
                }
            }
        }

        void generate();

        return () => {
            isCancelled = true;
            if (currentObjectUrl) {
                URL.revokeObjectURL(currentObjectUrl);
            }
        };
    }, [cardTheme, shortcut]);

    const handleDownload = useCallback(() => {
        if (!imageUrl) {
            return;
        }

        const link = document.createElement("a");
        link.href = imageUrl;
        link.download = `bavium-${shortcut.slug}-share-card.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }, [imageUrl, shortcut.slug]);

    const handleCopy = useCallback(async () => {
        if (!imageBlob) {
            return;
        }

        setError(null);

        try {
            if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
                throw new Error("Image copy is not supported in this browser. Use Download instead.");
            }

            await navigator.clipboard.write([
                new ClipboardItem({ [imageBlob.type]: imageBlob }),
            ]);
            setCopyState("copied");
            window.setTimeout(() => setCopyState("idle"), 2000);
        } catch (copyError) {
            setError(copyError instanceof Error ? copyError.message : "Failed to copy image.");
        }
    }, [imageBlob]);

    const handleShareImage = useCallback(async () => {
        if (!imageBlob) {
            return;
        }

        setShareState("sharing");
        setError(null);

        try {
            if (!supportsNativeFileShare()) {
                throw new Error("Direct image sharing is not supported here. Use Copy Image or Download.");
            }

            const file = new File([imageBlob], `bavium-${shortcut.slug}.png`, { type: "image/png" });
            if (!navigator.canShare({ files: [file] })) {
                throw new Error("This browser cannot share image files directly. Use Copy Image or Download.");
            }

            await navigator.share({
                title: `${shortcut.name} · Bavium`,
                text: `${shortcut.name}\n${pageUrl}`,
                files: [file],
            });
        } catch (shareError) {
            if (shareError instanceof DOMException && shareError.name === "AbortError") {
                return;
            }

            setError(shareError instanceof Error ? shareError.message : "Failed to share image.");
        } finally {
            setShareState("idle");
        }
    }, [imageBlob, pageUrl, shortcut.name, shortcut.slug]);

    const handleShareLinkToX = useCallback(() => {
        window.open(xShareUrl, "_blank", "noopener,noreferrer");
        onClose();
    }, [onClose, xShareUrl]);

    const actionAccent = getActionAccent(getDocumentTheme());

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="w-full max-w-4xl rounded-2xl border border-border-subtle bg-secondary shadow-2xl overflow-hidden"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-center justify-between gap-4 p-5 border-b border-border-subtle">
                    <div>
                        <div className="text-base font-semibold text-fg mb-1">
                            Share Shortcut
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center p-1 rounded-xl bg-tertiary border border-border-subtle">
                            <button
                                type="button"
                                onClick={() => setCardTheme("dark")}
                                className={`h-9 px-3 inline-flex items-center justify-center rounded-lg text-sm font-medium transition-colors ${
                                    cardTheme === "dark"
                                        ? "text-fg bg-secondary border border-border-default"
                                        : "text-fg-secondary hover:text-fg"
                                }`}
                                style={cardTheme === "dark" ? {
                                    boxShadow: `inset 0 0 0 1px ${BRAND_COLOR}22`,
                                    backgroundColor: `${BRAND_COLOR}12`,
                                } : undefined}
                            >
                                Dark Card
                            </button>
                            <button
                                type="button"
                                onClick={() => setCardTheme("light")}
                                className={`h-9 px-3 inline-flex items-center justify-center rounded-lg text-sm font-medium transition-colors ${
                                    cardTheme === "light"
                                        ? "text-fg bg-secondary border border-border-default"
                                        : "text-fg-secondary hover:text-fg"
                                }`}
                                style={cardTheme === "light" ? {
                                    boxShadow: `inset 0 0 0 1px ${LIGHT_BRAND_COLOR}22`,
                                    backgroundColor: `${LIGHT_BRAND_COLOR}10`,
                                } : undefined}
                            >
                                Light Card
                            </button>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-10 h-10 inline-flex items-center justify-center rounded-xl bg-tertiary text-fg-secondary hover:text-fg border border-border-subtle transition-colors shrink-0"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="p-5">
                    <div className="relative aspect-[1200/630] rounded-2xl overflow-hidden border border-border-subtle bg-[#050505]">
                        {imageUrl ? (
                            <Image
                                src={imageUrl}
                                alt={`${shortcut.name} share card`}
                                fill
                                unoptimized
                                className="object-cover"
                            />
                        ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-fg-secondary">
                                <Loader2 size={24} className="animate-spin" />
                                <div className="text-sm">
                                    {isGenerating ? "Generating share card..." : "Preview unavailable"}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex items-start justify-end gap-4 mt-4 mb-5 min-h-6">
                        {error && (
                            <div className="text-sm text-status-error">
                                {error}
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <button
                            type="button"
                            onClick={handleShareLinkToX}
                            className="h-11 px-4 inline-flex items-center justify-center gap-2 text-sm font-semibold rounded-xl border transition-colors"
                            style={{
                                backgroundColor: `${actionAccent}14`,
                                borderColor: `${actionAccent}33`,
                                color: "var(--color-fg)",
                            }}
                        >
                            <MessageSquareShare size={16} />
                            Share to X
                        </button>

                        <button
                            type="button"
                            onClick={handleShareImage}
                            disabled={!imageBlob || !canShareImage || shareState === "sharing"}
                            title={!canShareImage ? "Native image sharing is not supported in this browser." : undefined}
                            className="h-11 px-4 inline-flex items-center justify-center gap-2 text-sm font-medium text-fg-secondary bg-tertiary border border-border-subtle hover:border-border-default hover:text-fg rounded-xl transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {shareState === "sharing" ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    Sharing...
                                </>
                            ) : (
                                <>
                                    <MessageSquareShare size={16} />
                                    Share Image
                                </>
                            )}
                        </button>

                        <button
                            type="button"
                            onClick={handleCopy}
                            disabled={!imageBlob}
                            className="h-11 px-4 inline-flex items-center justify-center gap-2 text-sm font-medium text-fg-secondary bg-tertiary border border-border-subtle hover:border-border-default hover:text-fg rounded-xl transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {copyState === "copied" ? (
                                <>
                                    <Check size={16} className="text-status-success" />
                                    Copied
                                </>
                            ) : (
                                <>
                                    <Copy size={16} />
                                    Copy Image
                                </>
                            )}
                        </button>

                        <button
                            type="button"
                            onClick={handleDownload}
                            disabled={!imageUrl}
                            className="h-11 px-4 inline-flex items-center justify-center gap-2 text-sm font-medium text-fg-secondary bg-tertiary border border-border-subtle hover:border-border-default hover:text-fg rounded-xl transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            <Download size={16} />
                            Download
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
