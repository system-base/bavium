import { ImageResponse } from "next/og";
import { getBrandLogoDataUrl, withAlpha } from "@/lib/published-shortcut-social";

export const runtime = "nodejs";
export const revalidate = 300;
export const alt = "Bavium";
export const size = {
    width: 1200,
    height: 630,
};
export const contentType = "image/png";

const BRAND_COLOR = "#30D5C8";

export default async function Image() {
    const logoDataUrl = await getBrandLogoDataUrl("#ffffff");

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
                            `radial-gradient(circle at top left, ${withAlpha(BRAND_COLOR, 0.24)} 0%, transparent 40%)`,
                            "linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0%, rgba(255, 255, 255, 0) 32%)",
                        ].join(", "),
                    }}
                />

                <div
                    style={{
                        position: "absolute",
                        top: "48px",
                        right: "-28px",
                        width: "520px",
                        height: "520px",
                        display: "flex",
                        opacity: 0.1,
                    }}
                >
                    <img
                        src={logoDataUrl}
                        alt=""
                        width="520"
                        height="520"
                        style={{ objectFit: "contain" }}
                    />
                </div>

                <div
                    style={{
                        position: "relative",
                        zIndex: 1,
                        display: "flex",
                        flexDirection: "column",
                        gap: "28px",
                        maxWidth: "760px",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "16px",
                        }}
                    >
                        <img
                            src={logoDataUrl}
                            alt=""
                            width="48"
                            height="48"
                            style={{ objectFit: "contain" }}
                        />
                        <div
                            style={{
                                display: "flex",
                                fontSize: "28px",
                                textTransform: "uppercase",
                                letterSpacing: "0.14em",
                                color: "rgba(245, 245, 245, 0.62)",
                            }}
                        >
                            Workflow builder for Base
                        </div>
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
                                fontSize: "96px",
                                lineHeight: 0.95,
                                letterSpacing: "-0.06em",
                                fontWeight: 700,
                            }}
                        >
                            BAVIUM
                        </div>
                        <div
                            style={{
                                display: "flex",
                                fontSize: "30px",
                                lineHeight: 1.35,
                                color: "rgba(245, 245, 245, 0.72)",
                            }}
                        >
                            Build, run, and share onchain workflows on Base.
                        </div>
                    </div>
                </div>

                <div
                    style={{
                        position: "relative",
                        zIndex: 1,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            padding: "12px 18px",
                            borderRadius: "999px",
                            border: `1px solid ${withAlpha(BRAND_COLOR, 0.24)}`,
                            background: withAlpha(BRAND_COLOR, 0.08),
                            fontSize: "20px",
                            color: "rgba(245, 245, 245, 0.78)",
                        }}
                    >
                        Wallet-reviewed onchain actions
                    </div>

                    <div
                        style={{
                            display: "flex",
                            fontSize: "20px",
                            color: "rgba(245, 245, 245, 0.44)",
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                        }}
                    >
                        Base Batches 003
                    </div>
                </div>
            </div>
        ),
        size,
    );
}
