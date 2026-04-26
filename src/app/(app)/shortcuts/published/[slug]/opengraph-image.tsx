import { ImageResponse } from "next/og";
import {
    getBrandLogoDataUrl,
    getPublishedShortcutCategoryColor,
    getPublishedShortcutCategoryLabel,
    getPublishedShortcutDescription,
    getPublishedShortcutSocialRecord,
    trimText,
    withAlpha,
} from "@/lib/published-shortcut-social";

export const runtime = "nodejs";
export const revalidate = 300;
export const alt = "Bavium public workflow";
export const size = {
    width: 1200,
    height: 630,
};
export const contentType = "image/png";

export default async function Image(
    { params }: { params: Promise<{ slug: string }> },
) {
    const { slug } = await params;
    const shortcut = await getPublishedShortcutSocialRecord(slug);
    const logoDataUrl = await getBrandLogoDataUrl("#ffffff");

    const accent = shortcut ? getPublishedShortcutCategoryColor(shortcut.category) : "#30D5C8";
    const categoryLabel = shortcut ? getPublishedShortcutCategoryLabel(shortcut.category) : "Public Workflow";
    const stepCount = shortcut ? shortcut.steps.length : 0;
    const title = shortcut ? trimText(shortcut.name, 64) : "Bavium";
    const description = shortcut
        ? getPublishedShortcutDescription(shortcut)
        : "Public workflow for Base.";

    return new ImageResponse(
        (
            <div
                style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    position: "relative",
                    overflow: "hidden",
                    background: "#050505",
                    color: "#f5f5f5",
                    padding: "64px",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    fontFamily: '"Questrial", "Helvetica Neue", Arial, sans-serif',
                }}
            >
                <div
                    style={{
                        position: "absolute",
                        inset: "0",
                        background: [
                            `radial-gradient(circle at top left, ${withAlpha(accent, 0.22)} 0%, transparent 42%)`,
                            "linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0) 36%)",
                        ].join(", "),
                    }}
                />

                <div
                    style={{
                        position: "absolute",
                        top: "78px",
                        right: "-54px",
                        width: "460px",
                        height: "460px",
                        display: "flex",
                        opacity: 0.08,
                    }}
                >
                    <img
                        src={logoDataUrl}
                        alt=""
                        width="460"
                        height="460"
                        style={{ objectFit: "contain" }}
                    />
                </div>

                <div
                    style={{
                        position: "relative",
                        zIndex: 1,
                        display: "flex",
                        width: "72%",
                        flexDirection: "column",
                        gap: "26px",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                padding: "10px 16px",
                                borderRadius: "999px",
                                fontSize: "20px",
                                letterSpacing: "0.08em",
                                textTransform: "uppercase",
                                color: accent,
                                background: withAlpha(accent, 0.12),
                                border: `1px solid ${withAlpha(accent, 0.28)}`,
                            }}
                        >
                            {categoryLabel}
                        </div>
                        {shortcut && (
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    padding: "10px 16px",
                                    borderRadius: "999px",
                                    fontSize: "20px",
                                    color: "rgba(245, 245, 245, 0.76)",
                                    background: "rgba(255, 255, 255, 0.06)",
                                    border: "1px solid rgba(255, 255, 255, 0.10)",
                                }}
                            >
                                {stepCount} step{stepCount === 1 ? "" : "s"}
                            </div>
                        )}
                    </div>

                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "18px",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                fontSize: "72px",
                                lineHeight: 1.04,
                                letterSpacing: "-0.05em",
                                fontWeight: 700,
                            }}
                        >
                            {title}
                        </div>
                        <div
                            style={{
                                display: "flex",
                                maxWidth: "760px",
                                fontSize: "28px",
                                lineHeight: 1.35,
                                color: "rgba(245, 245, 245, 0.72)",
                            }}
                        >
                            {description}
                        </div>
                    </div>
                </div>

                <div
                    style={{
                        position: "relative",
                        zIndex: 1,
                        display: "flex",
                        alignItems: "flex-end",
                        justifyContent: "space-between",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "14px",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                fontSize: "18px",
                                textTransform: "uppercase",
                                letterSpacing: "0.12em",
                                color: "rgba(245, 245, 245, 0.42)",
                            }}
                        >
                            Public Workflow
                        </div>
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "14px",
                            }}
                        >
                            <img
                                src={logoDataUrl}
                                alt=""
                                width="34"
                                height="34"
                                style={{ objectFit: "contain" }}
                            />
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        fontSize: "30px",
                                        fontWeight: 700,
                                        letterSpacing: "-0.03em",
                                    }}
                                >
                                    Bavium
                                </div>
                                <div
                                    style={{
                                        display: "flex",
                                        fontSize: "18px",
                                        color: "rgba(245, 245, 245, 0.56)",
                                    }}
                                >
                                    Workflow builder for Base
                                </div>
                            </div>
                        </div>
                    </div>

                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            padding: "12px 18px",
                            borderRadius: "999px",
                            border: `1px solid ${withAlpha(accent, 0.22)}`,
                            background: withAlpha(accent, 0.08),
                            fontSize: "20px",
                            color: "rgba(245, 245, 245, 0.78)",
                        }}
                    >
                        Shareable workflow for Base
                    </div>
                </div>
            </div>
        ),
        size,
    );
}
