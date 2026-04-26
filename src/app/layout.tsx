import type { Metadata } from "next";
import { Questrial, JetBrains_Mono } from "next/font/google";
import "@rainbow-me/rainbowkit/styles.css";
import "./globals.css";
import { Providers } from "./providers";
import { getAppBaseUrl } from "@/lib/app-url";

const questrial = Questrial({
  variable: "--font-questrial",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: getAppBaseUrl(),
  title: "Bavium | The Workflow Builder for Base",
  description:
    "Bavium is the visual way to build, run, and share onchain workflows on Base. Create reusable flows for swaps, balances, bridge reads, DeFi, logic, and social sharing.",
  openGraph: {
    title: "Bavium | The Workflow Builder for Base",
    description:
      "Build, run, and share onchain workflows on Base.",
    type: "website",
    siteName: "Bavium",
    url: "/",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Bavium",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Bavium | The Workflow Builder for Base",
    description:
      "Build, run, and share onchain workflows on Base.",
    images: ["/opengraph-image"],
  },
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
  other: {
    "base:app_id": "69e9025956caa7489826f52d",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${questrial.variable} ${jetBrainsMono.variable}`}
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
