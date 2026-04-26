import type { Metadata } from "next";
import {
    getPublishedShortcutDescription,
    getPublishedShortcutSocialRecord,
} from "@/lib/published-shortcut-social";

export const revalidate = 300;

export async function generateMetadata(
    { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
    const { slug } = await params;
    const shortcut = await getPublishedShortcutSocialRecord(slug);

    if (!shortcut) {
        return {
            title: "Shortcut Not Found · Bavium",
            description: "This public shortcut is unavailable on Bavium.",
            robots: {
                index: false,
                follow: false,
            },
        };
    }

    const title = `${shortcut.name} · Bavium`;
    const description = getPublishedShortcutDescription(shortcut);
    const canonicalPath = `/p/${shortcut.slug}`;
    const ogImagePath = `${canonicalPath}/opengraph-image`;

    return {
        title,
        description,
        alternates: {
            canonical: canonicalPath,
        },
        openGraph: {
            title,
            description,
            type: "website",
            url: canonicalPath,
            siteName: "Bavium",
            images: [
                {
                    url: ogImagePath,
                    width: 1200,
                    height: 630,
                    alt: `${shortcut.name} on Bavium`,
                },
            ],
        },
        twitter: {
            card: "summary_large_image",
            title,
            description,
            images: [ogImagePath],
        },
    };
}

export default function PublicShortcutLayout({ children }: { children: React.ReactNode }) {
    return children;
}
