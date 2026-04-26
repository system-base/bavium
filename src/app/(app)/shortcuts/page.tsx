"use client";

import { Suspense, useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Bookmark, Compass, LayoutGrid, Loader2, Plus } from "lucide-react";
import { MobileCarousel } from "@/components/ui/MobileCarousel";
import { useAuthSession } from "@/hooks/useAuthSession";
import { Skeleton } from "@/components/ui/Skeleton";
import type { Variants } from "framer-motion";
import { motion, AnimatePresence } from "framer-motion";
import { ShortcutCard, ShortcutCardSkeleton } from "@/components/gallery/ShortcutCard";
import { PublishedShortcutCard, type PublishedShortcutData } from "@/components/gallery/PublishedShortcutCard";
import { SavedShortcutCard, type SavedShortcutData } from "@/components/gallery/SavedShortcutCard";
import {
    CATEGORY_META,
    SHORTCUT_FILTER_CATEGORIES,
    type BlockCategory,
} from "@/lib/constants";
import { TEMPLATE_SHORTCUTS } from "@/lib/template-shortcuts";

const ALL_CATEGORIES = SHORTCUT_FILTER_CATEGORIES;
type ShortcutSurface = "discover" | "my_shortcuts" | "library";

const gridVariants: Variants = {
    hidden: { opacity: 0 },
    show: {
        opacity: 1,
        transition: { staggerChildren: 0.05 }
    }
};

const cardVariants: Variants = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
};

function parseShortcutSurface(value: string | null): ShortcutSurface | null {
    if (value === "discover" || value === "my_shortcuts" || value === "library") {
        return value;
    }
    return null;
}

function matchesCategoryFilter(
    category: string,
    activeFilter: BlockCategory | "all",
): boolean {
    return activeFilter === "all" || category === activeFilter;
}

function ShortcutsPageInner() {
    const searchParams = useSearchParams();
    const { authState, sessionAddress } = useAuthSession();
    const requestedSurface = parseShortcutSurface(searchParams.get("surface"));
    const [surface, setSurface] = useState<ShortcutSurface>(requestedSurface ?? "discover");
    const [activeFilter, setActiveFilter] = useState<BlockCategory | "all">("all");
    const [savedShortcuts, setSavedShortcuts] = useState<SavedShortcutData[]>([]);
    const [savedStatus, setSavedStatus] = useState<"idle" | "loading" | "ready" | "empty" | "unauthorized" | "unavailable" | "error">("idle");
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [loadingMore, setLoadingMore] = useState(false);

    const [publishedShortcuts, setPublishedShortcuts] = useState<PublishedShortcutData[]>([]);
    const [publishedStatus, setPublishedStatus] = useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
    const [publishedNextCursor, setPublishedNextCursor] = useState<string | null>(null);
    const [publishedLoadingMore, setPublishedLoadingMore] = useState(false);
    const [libraryShortcuts, setLibraryShortcuts] = useState<PublishedShortcutData[]>([]);
    const [libraryStatus, setLibraryStatus] = useState<"idle" | "loading" | "ready" | "empty" | "unauthorized" | "unavailable" | "error">("idle");
    const [libraryNextCursor, setLibraryNextCursor] = useState<string | null>(null);
    const [libraryLoadingMore, setLibraryLoadingMore] = useState(false);

    const [showAllTemplates, setShowAllTemplates] = useState(false);
    const [showAllPublic, setShowAllPublic] = useState(false);
    const [showAllSaved, setShowAllSaved] = useState(false);
    const [showAllLibrary, setShowAllLibrary] = useState(false);

    useEffect(() => {
        setShowAllTemplates(false);
        setShowAllPublic(false);
        setShowAllSaved(false);
        setShowAllLibrary(false);
    }, [surface, activeFilter]);

    const filteredTemplates = useMemo(
        () => TEMPLATE_SHORTCUTS.filter((shortcut) => matchesCategoryFilter(shortcut.category, activeFilter)),
        [activeFilter],
    );
    const filteredPublishedShortcuts = useMemo(
        () => publishedShortcuts.filter((shortcut) => matchesCategoryFilter(shortcut.category, activeFilter)),
        [activeFilter, publishedShortcuts],
    );
    const filteredSavedShortcuts = useMemo(
        () => savedShortcuts.filter((shortcut) => matchesCategoryFilter(shortcut.category, activeFilter)),
        [activeFilter, savedShortcuts],
    );
    const filteredLibraryShortcuts = useMemo(
        () => libraryShortcuts.filter((shortcut) => matchesCategoryFilter(shortcut.category, activeFilter)),
        [activeFilter, libraryShortcuts],
    );
    const surfacePanelIds = useMemo(() => ({
        discover: "shortcut-surface-panel-discover",
        my_shortcuts: "shortcut-surface-panel-my-shortcuts",
        library: "shortcut-surface-panel-library",
    }), []);
    const surfaceTabIds = useMemo(() => ({
        discover: "shortcut-surface-tab-discover",
        my_shortcuts: "shortcut-surface-tab-my-shortcuts",
        library: "shortcut-surface-tab-library",
    }), []);

    const loadShortcuts = useCallback(async (cursor?: string) => {
        if (!cursor) {
            setSavedStatus("loading");
        }

        try {
            const params = new URLSearchParams();
            params.set("limit", "20");
            if (cursor) params.set("cursor", cursor);

            const res = await fetch(`/api/shortcuts?${params.toString()}`, {
                credentials: "include",
            });

            if (res.status === 401) {
                setSavedStatus("unauthorized");
                return;
            }

            if (res.status === 503) {
                setSavedStatus("unavailable");
                return;
            }

            if (!res.ok) {
                setSavedStatus("error");
                return;
            }

            const data = await res.json() as {
                shortcuts?: SavedShortcutData[];
                continueCursor?: string;
                isDone?: boolean;
            };
            const shortcuts = Array.isArray(data.shortcuts) ? data.shortcuts : [];

            if (cursor) {
                setSavedShortcuts((prev) => [...prev, ...shortcuts]);
            } else {
                setSavedShortcuts(shortcuts);
            }

            setNextCursor(data.isDone ? null : (data.continueCursor ?? null));
            setSavedStatus((!cursor && shortcuts.length === 0) ? "empty" : "ready");
        } catch {
            if (!cursor) setSavedStatus("error");
        }
    }, []);

    const loadPublished = useCallback(async (cursor?: string) => {
        if (!cursor) {
            setPublishedStatus("loading");
        }

        try {
            const params = new URLSearchParams();
            params.set("limit", "12");
            if (cursor) params.set("cursor", cursor);

            const res = await fetch(`/api/published-shortcuts?${params.toString()}`);
            if (!res.ok) {
                if (!cursor) setPublishedStatus("error");
                return;
            }

            const data = await res.json() as {
                shortcuts?: PublishedShortcutData[];
                continueCursor?: string;
                isDone?: boolean;
            };
            const shortcuts = Array.isArray(data.shortcuts) ? data.shortcuts : [];

            if (cursor) {
                setPublishedShortcuts((prev) => [...prev, ...shortcuts]);
            } else {
                setPublishedShortcuts(shortcuts);
            }

            setPublishedNextCursor(data.isDone ? null : (data.continueCursor ?? null));
            setPublishedStatus((!cursor && shortcuts.length === 0) ? "empty" : "ready");
        } catch {
            if (!cursor) setPublishedStatus("error");
        }
    }, []);

    useEffect(() => {
        if (surface === "discover" && publishedStatus === "idle") {
            const timeoutId = window.setTimeout(() => {
                void loadPublished();
            }, 0);
            return () => {
                window.clearTimeout(timeoutId);
            };
        }

        if (surface === "my_shortcuts") {
            if (authState === "authenticated" && (savedStatus === "idle" || savedStatus === "unauthorized")) {
                const timeoutId = window.setTimeout(() => {
                    void loadShortcuts();
                }, 0);
                return () => {
                    window.clearTimeout(timeoutId);
                };
            }

            if (authState === "connected_unauthenticated" || authState === "disconnected") {
                const timeoutId = window.setTimeout(() => {
                    setSavedShortcuts([]);
                    setNextCursor(null);
                    setSavedStatus("unauthorized");
                }, 0);
                return () => {
                    window.clearTimeout(timeoutId);
                };
            }
        }
    }, [authState, loadPublished, loadShortcuts, publishedStatus, savedStatus, surface]);

    const handleLoadMore = useCallback(async () => {
        if (!nextCursor || loadingMore) return;
        setLoadingMore(true);
        await loadShortcuts(nextCursor);
        setLoadingMore(false);
    }, [nextCursor, loadingMore, loadShortcuts]);

    const handleLoadMorePublished = useCallback(async () => {
        if (!publishedNextCursor || publishedLoadingMore) return;
        setPublishedLoadingMore(true);
        await loadPublished(publishedNextCursor);
        setPublishedLoadingMore(false);
    }, [publishedNextCursor, publishedLoadingMore, loadPublished]);

    const handleShortcutDeleted = useCallback((id: string) => {
        const remaining = savedShortcuts.filter((shortcut) => shortcut._id !== id);
        setSavedShortcuts(remaining);
        setSavedStatus(remaining.length === 0 && !nextCursor ? "empty" : "ready");
        void loadShortcuts();
    }, [loadShortcuts, nextCursor, savedShortcuts]);

    const handleShortcutPublished = useCallback(() => {
        if (publishedStatus !== "idle") {
            void loadPublished();
        }
    }, [loadPublished, publishedStatus]);

    const loadLibrary = useCallback(async (cursor?: string) => {
        if (authState !== "authenticated") {
            setLibraryShortcuts([]);
            setLibraryNextCursor(null);
            setLibraryStatus(
                authState === "connected_unauthenticated" || authState === "disconnected"
                    ? "unauthorized"
                    : "idle",
            );
            return;
        }

        if (!cursor) {
            setLibraryStatus("loading");
        }

        try {
            const params = new URLSearchParams();
            params.set("limit", "12");
            if (cursor) params.set("cursor", cursor);

            const res = await fetch(`/api/library/bookmarks?${params.toString()}`, {
                credentials: "include",
            });

            if (res.status === 401) {
                setLibraryStatus("unauthorized");
                return;
            }

            if (res.status === 503) {
                setLibraryStatus("unavailable");
                return;
            }

            if (!res.ok) {
                setLibraryStatus("error");
                return;
            }

            const data = await res.json() as {
                shortcuts?: PublishedShortcutData[];
                continueCursor?: string;
                isDone?: boolean;
            };
            const shortcuts = Array.isArray(data.shortcuts) ? data.shortcuts : [];

            if (cursor) {
                setLibraryShortcuts((prev) => [...prev, ...shortcuts]);
            } else {
                setLibraryShortcuts(shortcuts);
            }

            setLibraryNextCursor(data.isDone ? null : (data.continueCursor ?? null));
            setLibraryStatus((!cursor && shortcuts.length === 0) ? "empty" : "ready");
        } catch {
            setLibraryStatus("error");
        }
    }, [authState]);

    useEffect(() => {
        if (surface !== "library") return;
        if (libraryStatus === "idle" || authState !== "authenticated") {
            const timeoutId = window.setTimeout(() => {
                void loadLibrary();
            }, 0);

            return () => {
                window.clearTimeout(timeoutId);
            };
        }
    }, [authState, libraryStatus, loadLibrary, surface]);

    const handleLoadMoreLibrary = useCallback(async () => {
        if (!libraryNextCursor || libraryLoadingMore) return;
        setLibraryLoadingMore(true);
        await loadLibrary(libraryNextCursor);
        setLibraryLoadingMore(false);
    }, [libraryLoadingMore, libraryNextCursor, loadLibrary]);

    return (
        <div className="w-full max-w-7xl mx-auto pb-8 pt-2">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-6 gap-4">
                <div className="flex-1">
                    <h1 className="text-[22px] font-semibold tracking-tight text-fg mb-2">
                        Shortcuts
                    </h1>
                    <p className="text-[14px] sm:text-[15px] text-fg-secondary leading-relaxed max-w-[560px]">
                        Browse public shortcuts, manage everything you own, and keep the shortcuts
                        you want to revisit close at hand.
                    </p>
                </div>
                <Link
                    href="/builder"
                    className="h-9 px-4 inline-flex items-center gap-1.5 text-sm font-medium text-fg border border-border-default hover:border-fg hover:text-fg rounded-md no-underline whitespace-nowrap shrink-0 transition-colors w-fit"
                >
                    <Plus size={16} />
                    New Shortcut
                </Link>
            </div>

            <div
                className="flex flex-wrap items-center gap-2 mb-6"
                role="tablist"
                aria-label="Shortcut surfaces"
            >
                {[
                    { id: "discover" as const, label: "Gallery", icon: Compass },
                    { id: "my_shortcuts" as const, label: "All Shortcuts", icon: LayoutGrid },
                    { id: "library" as const, label: "Saved", icon: Bookmark },
                ].map((tab) => {
                    const Icon = tab.icon;
                    const active = surface === tab.id;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setSurface(tab.id)}
                            id={surfaceTabIds[tab.id]}
                            role="tab"
                            aria-selected={active}
                            aria-controls={surfacePanelIds[tab.id]}
                            tabIndex={active ? 0 : -1}
                            className={`relative h-10 px-4 inline-flex items-center gap-2 text-[14px] transition-colors z-10 ${
                                active
                                    ? "font-medium text-fg"
                                    : "text-fg-secondary hover:text-fg hover:bg-tertiary rounded-md"
                            }`}
                        >
                            {active && (
                                <motion.div
                                    layoutId="surfaceTab"
                                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-fg rounded-t-full -mb-[1px]"
                                    initial={false}
                                    transition={{ duration: 0.3, ease: "easeOut" }}
                                />
                            )}
                            <Icon size={15} />
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            <div className="flex items-center gap-2.5 mb-8 overflow-x-auto pb-2 hide-scrollbar">
                <button
                    type="button"
                    className={`h-9 px-5 border inline-flex items-center text-sm font-medium whitespace-nowrap rounded-full shrink-0 transition-all ${
                        activeFilter === "all"
                            ? "text-fg border-border-strong bg-secondary shadow-sm"
                            : "text-fg-secondary border-border-default bg-primary hover:border-border-strong hover:text-fg hover:bg-secondary/50"
                    }`}
                    onClick={() => setActiveFilter("all")}
                >
                    All
                </button>
                {ALL_CATEGORIES.map((cat) => (
                    <button
                        key={cat}
                        type="button"
                        className={`h-9 px-5 border inline-flex items-center text-sm font-medium whitespace-nowrap rounded-full shrink-0 transition-all ${
                            activeFilter === cat
                                ? "text-fg border-border-strong bg-secondary shadow-sm"
                                : "text-fg-secondary border-border-default bg-primary hover:border-border-strong hover:text-fg hover:bg-secondary/50"
                        }`}
                        onClick={() => setActiveFilter(cat)}
                    >
                        {CATEGORY_META[cat].label}
                    </button>
                ))}
            </div>

            {surface === "discover" && (
                <section
                    id={surfacePanelIds.discover}
                    role="tabpanel"
                    aria-labelledby={surfaceTabIds.discover}
                >
                    <div className="flex items-center justify-between pb-2 mb-4 border-b border-border-subtle">
                        <div className="text-[13px] font-semibold tracking-wider uppercase text-fg-muted">
                            {activeFilter === "all" ? "Templates" : CATEGORY_META[activeFilter].label}
                            {" \u2014 "}
                            {filteredTemplates.length} shortcut{filteredTemplates.length !== 1 ? "s" : ""}
                        </div>
                        {filteredTemplates.length > 4 && (
                            <button 
                                onClick={() => setShowAllTemplates(!showAllTemplates)}
                                className="text-[13px] font-medium text-brand-light hover:text-brand transition-colors"
                            >
                                {showAllTemplates ? "Show less" : "Show all"}
                            </button>
                        )}
                    </div>

                    {/* Mobile: carousel with arrows + dots */}
                    <MobileCarousel itemCount={(showAllTemplates ? filteredTemplates : filteredTemplates.slice(0, 4)).length}>
                        {(showAllTemplates ? filteredTemplates : filteredTemplates.slice(0, 4)).map((shortcut) => (
                            <div key={shortcut.id} className="w-[85vw] shrink-0 snap-start h-full">
                                <ShortcutCard shortcut={shortcut} />
                            </div>
                        ))}
                    </MobileCarousel>

                    {/* Desktop: grid */}
                    <div className="hidden sm:block">
                        <motion.div 
                            variants={gridVariants} 
                            initial="hidden" 
                            animate="show" 
                            className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
                        >
                            {(showAllTemplates ? filteredTemplates : filteredTemplates.slice(0, 4)).map((shortcut) => (
                                <motion.div key={shortcut.id} variants={cardVariants} className="h-full">
                                    <ShortcutCard shortcut={shortcut} />
                                </motion.div>
                            ))}
                        </motion.div>
                    </div>

                    <div className="mt-12">
                        <div className="flex items-center justify-between pb-3 mb-4">
                            <div className="flex items-center gap-2">
                                <h2 className="text-[14px] font-semibold tracking-wider uppercase text-fg">Public</h2>
                                {(publishedStatus === "ready" && filteredPublishedShortcuts.length > 0) && (
                                    <span className="flex items-center justify-center bg-tertiary border border-border-subtle text-fg-muted font-mono text-[11px] font-medium h-5 px-1.5 rounded-md">
                                        {filteredPublishedShortcuts.length}{publishedNextCursor ? "+" : ""}
                                    </span>
                                )}
                            </div>
                            {filteredPublishedShortcuts.length > 4 && (
                                <button 
                                    onClick={() => setShowAllPublic(!showAllPublic)}
                                    className="text-[13px] font-medium text-brand-light hover:text-brand transition-colors"
                                >
                                    {showAllPublic ? "Show less" : "Show all"}
                                </button>
                            )}
                        </div>

                        {publishedStatus === "idle" || publishedStatus === "loading" ? (
                            <div className="py-4 -my-4 overflow-x-auto hide-scrollbar sm:overflow-visible">
                                <div className="flex sm:grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 w-max sm:w-auto pr-4 sm:pr-0">
                                    <div className="w-[85vw] sm:w-auto"><ShortcutCardSkeleton /></div>
                                    <div className="w-[85vw] sm:w-auto"><ShortcutCardSkeleton /></div>
                                    <div className="hidden lg:block w-[85vw] sm:w-auto"><ShortcutCardSkeleton /></div>
                                    <div className="hidden xl:block w-[85vw] sm:w-auto"><ShortcutCardSkeleton /></div>
                                </div>
                            </div>
                        ) : publishedStatus === "error" ? (
                            <p className="text-sm text-fg-muted">Could not load public shortcuts.</p>
                        ) : publishedStatus === "empty" ? (
                            <p className="text-sm text-fg-muted">
                                No public shortcuts yet. Save a shortcut and use Share to add it to the gallery.
                            </p>
                        ) : filteredPublishedShortcuts.length === 0 ? (
                            <p className="text-sm text-fg-muted">
                                No public shortcuts in {activeFilter === "all" ? "this view" : CATEGORY_META[activeFilter].label} right now.
                            </p>
                        ) : (
                            <>
                                <MobileCarousel itemCount={(showAllPublic ? filteredPublishedShortcuts : filteredPublishedShortcuts.slice(0, 4)).length}>
                                    {(showAllPublic ? filteredPublishedShortcuts : filteredPublishedShortcuts.slice(0, 4)).map((shortcut) => (
                                        <div key={shortcut._id} className="w-[85vw] shrink-0 snap-start h-full">
                                            <PublishedShortcutCard
                                                shortcut={shortcut}
                                                isOwner={
                                                    typeof sessionAddress === "string"
                                                    && sessionAddress.toLowerCase() === shortcut.creatorAddress.toLowerCase()
                                                }
                                            />
                                        </div>
                                    ))}
                                </MobileCarousel>

                                <div className="hidden sm:block">
                                    <motion.div 
                                        variants={gridVariants} 
                                        initial="hidden" 
                                        animate="show" 
                                        className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
                                    >
                                        {(showAllPublic ? filteredPublishedShortcuts : filteredPublishedShortcuts.slice(0, 4)).map((shortcut) => (
                                            <motion.div key={shortcut._id} variants={cardVariants} className="h-full">
                                                <PublishedShortcutCard
                                                    shortcut={shortcut}
                                                    isOwner={
                                                        typeof sessionAddress === "string"
                                                        && sessionAddress.toLowerCase() === shortcut.creatorAddress.toLowerCase()
                                                    }
                                                />
                                            </motion.div>
                                        ))}
                                    </motion.div>
                                </div>

                                {(publishedNextCursor && showAllPublic) && (
                                    <div className="flex justify-center mt-6">
                                        <button
                                            type="button"
                                            className="px-5 py-2 text-sm font-medium text-fg-secondary bg-tertiary hover:bg-elevated border border-border-subtle hover:border-border-default rounded-lg transition-colors"
                                            onClick={handleLoadMorePublished}
                                            disabled={publishedLoadingMore}
                                        >
                                            {publishedLoadingMore ? "Loading..." : "Load more"}
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </section>
            )}

            {surface === "my_shortcuts" && (
                <section
                    id={surfacePanelIds.my_shortcuts}
                    role="tabpanel"
                    aria-labelledby={surfaceTabIds.my_shortcuts}
                    className="mt-2"
                >
                    <div className="flex items-center justify-between pb-3 mb-4">
                        <div className="flex items-center gap-2">
                            <h2 className="text-[14px] font-semibold tracking-wider uppercase text-fg">All Shortcuts</h2>
                            {(savedStatus === "ready" || savedStatus === "loading") && filteredSavedShortcuts.length > 0 && (
                                <span className="flex items-center justify-center bg-tertiary border border-border-subtle text-fg-muted font-mono text-[11px] font-medium h-5 px-1.5 rounded-md">
                                    {filteredSavedShortcuts.length}{nextCursor ? "+" : ""}
                                </span>
                            )}
                        </div>
                        {filteredSavedShortcuts.length > 4 && (
                            <button 
                                onClick={() => setShowAllSaved(!showAllSaved)}
                                className="text-[13px] font-medium text-brand-light hover:text-brand transition-colors"
                            >
                                {showAllSaved ? "Show less" : "Show all"}
                            </button>
                        )}
                    </div>

                    {savedStatus === "idle" || savedStatus === "loading" ? (
                        <div className="py-4 -my-4 overflow-x-auto hide-scrollbar sm:overflow-visible">
                            <div className="flex sm:grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 w-max sm:w-auto pr-4 sm:pr-0">
                                <div className="w-[85vw] sm:w-auto"><ShortcutCardSkeleton /></div>
                                <div className="w-[85vw] sm:w-auto"><ShortcutCardSkeleton /></div>
                                <div className="hidden lg:block w-[85vw] sm:w-auto"><ShortcutCardSkeleton /></div>
                                <div className="hidden xl:block w-[85vw] sm:w-auto"><ShortcutCardSkeleton /></div>
                            </div>
                        </div>
                    ) : savedStatus === "unauthorized" ? (
                        <p className="text-sm text-fg-muted">
                            {authState === "connected_unauthenticated"
                                ? "Finish signing in to view your shortcuts."
                                : "Connect your wallet to view your shortcuts."}
                        </p>
                    ) : savedStatus === "unavailable" ? (
                        <p className="text-sm text-status-warning">
                            Convex backend is not configured yet, so your shortcuts are unavailable.
                        </p>
                    ) : savedStatus === "error" ? (
                        <p className="text-sm text-status-error">
                            Failed to load your shortcuts.
                        </p>
                    ) : savedStatus === "empty" ? (
                        <p className="text-sm text-fg-muted">
                            No shortcuts yet. Build one in Builder to get started.
                        </p>
                    ) : filteredSavedShortcuts.length === 0 ? (
                        <p className="text-sm text-fg-muted">
                            No saved shortcuts in {activeFilter === "all" ? "this view" : CATEGORY_META[activeFilter].label} yet.
                        </p>
                    ) : (
                        <>
                            <MobileCarousel itemCount={(showAllSaved ? filteredSavedShortcuts : filteredSavedShortcuts.slice(0, 4)).length}>
                                {(showAllSaved ? filteredSavedShortcuts : filteredSavedShortcuts.slice(0, 4)).map((shortcut) => (
                                    <div key={shortcut._id} className="w-[85vw] shrink-0 snap-start h-full">
                                        <SavedShortcutCard
                                            shortcut={shortcut}
                                            onDeleted={handleShortcutDeleted}
                                            onPublished={handleShortcutPublished}
                                        />
                                    </div>
                                ))}
                            </MobileCarousel>

                            <div className="hidden sm:block">
                                <motion.div 
                                    variants={gridVariants} 
                                    initial="hidden" 
                                    animate="show" 
                                    className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
                                >
                                    {(showAllSaved ? filteredSavedShortcuts : filteredSavedShortcuts.slice(0, 4)).map((shortcut) => (
                                        <motion.div key={shortcut._id} variants={cardVariants} className="h-full">
                                            <SavedShortcutCard
                                                shortcut={shortcut}
                                                onDeleted={handleShortcutDeleted}
                                                onPublished={handleShortcutPublished}
                                            />
                                        </motion.div>
                                    ))}
                                </motion.div>
                            </div>

                            {(nextCursor && showAllSaved) && (
                                <div className="flex justify-center mt-6">
                                    <button
                                        type="button"
                                        className="px-5 py-2 text-sm font-medium text-fg-secondary bg-tertiary hover:bg-elevated border border-border-subtle hover:border-border-default rounded-lg transition-colors"
                                        onClick={handleLoadMore}
                                        disabled={loadingMore}
                                    >
                                        {loadingMore ? "Loading…" : "Load more"}
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </section>
            )}

            {surface === "library" && (
                <section
                    id={surfacePanelIds.library}
                    role="tabpanel"
                    aria-labelledby={surfaceTabIds.library}
                    className="mt-2"
                >
                    <div className="flex items-center justify-between pb-3 mb-4">
                        <div className="flex items-center gap-2">
                            <h2 className="text-[14px] font-semibold tracking-wider uppercase text-fg">Saved Library</h2>
                            {(libraryStatus === "ready" || libraryStatus === "loading") && filteredLibraryShortcuts.length > 0 && (
                                <span className="flex items-center justify-center bg-tertiary border border-border-subtle text-fg-muted font-mono text-[11px] font-medium h-5 px-1.5 rounded-md">
                                    {filteredLibraryShortcuts.length}{libraryNextCursor ? "+" : ""}
                                </span>
                            )}
                        </div>
                        {filteredLibraryShortcuts.length > 4 && (
                            <button 
                                onClick={() => setShowAllLibrary(!showAllLibrary)}
                                className="text-[13px] font-medium text-brand-light hover:text-brand transition-colors"
                            >
                                {showAllLibrary ? "Show less" : "Show all"}
                            </button>
                        )}
                    </div>

                    {libraryStatus === "idle" || libraryStatus === "loading" ? (
                        <div className="py-4 -my-4 overflow-x-auto hide-scrollbar sm:overflow-visible">
                            <div className="flex sm:grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 w-max sm:w-auto pr-4 sm:pr-0">
                                <div className="w-[85vw] sm:w-auto"><ShortcutCardSkeleton /></div>
                                <div className="w-[85vw] sm:w-auto"><ShortcutCardSkeleton /></div>
                                <div className="hidden lg:block w-[85vw] sm:w-auto"><ShortcutCardSkeleton /></div>
                                <div className="hidden xl:block w-[85vw] sm:w-auto"><ShortcutCardSkeleton /></div>
                            </div>
                        </div>
                    ) : libraryStatus === "unauthorized" ? (
                        <p className="text-sm text-fg-muted">
                            {authState === "connected_unauthenticated"
                                ? "Finish signing in to open your bookmark library."
                                : "Connect your wallet to open your bookmark library."}
                        </p>
                    ) : libraryStatus === "unavailable" ? (
                        <p className="text-sm text-status-warning">
                            Convex backend is not configured yet, so your bookmark library is unavailable.
                        </p>
                    ) : libraryStatus === "error" ? (
                        <p className="text-sm text-status-error">
                            Failed to load bookmarked shortcuts.
                        </p>
                    ) : libraryStatus === "empty" ? (
                        <p className="text-sm text-fg-muted">
                            Nothing saved yet. Open a public shortcut and save it here for later.
                        </p>
                    ) : filteredLibraryShortcuts.length === 0 ? (
                        <p className="text-sm text-fg-muted">
                            No bookmarked shortcuts in {activeFilter === "all" ? "this view" : CATEGORY_META[activeFilter].label} yet.
                        </p>
                    ) : libraryStatus === "ready" ? (
                        <>
                            <MobileCarousel itemCount={(showAllLibrary ? filteredLibraryShortcuts : filteredLibraryShortcuts.slice(0, 4)).length}>
                                {(showAllLibrary ? filteredLibraryShortcuts : filteredLibraryShortcuts.slice(0, 4)).map((shortcut) => (
                                    <div key={shortcut._id} className="w-[85vw] shrink-0 snap-start h-full">
                                        <PublishedShortcutCard
                                            shortcut={shortcut}
                                            isOwner={
                                                typeof sessionAddress === "string"
                                                && sessionAddress.toLowerCase() === shortcut.creatorAddress.toLowerCase()
                                            }
                                        />
                                    </div>
                                ))}
                            </MobileCarousel>

                            <div className="hidden sm:block">
                                <motion.div 
                                    variants={gridVariants} 
                                    initial="hidden" 
                                    animate="show" 
                                    className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
                                >
                                    {(showAllLibrary ? filteredLibraryShortcuts : filteredLibraryShortcuts.slice(0, 4)).map((shortcut) => (
                                        <motion.div key={shortcut._id} variants={cardVariants} className="h-full">
                                            <PublishedShortcutCard
                                                shortcut={shortcut}
                                                isOwner={
                                                    typeof sessionAddress === "string"
                                                    && sessionAddress.toLowerCase() === shortcut.creatorAddress.toLowerCase()
                                                }
                                            />
                                        </motion.div>
                                    ))}
                                </motion.div>
                            </div>

                            {(libraryNextCursor && showAllLibrary) && (
                                <div className="flex justify-center mt-6">
                                    <button
                                        type="button"
                                        className="px-5 py-2 text-sm font-medium text-fg-secondary bg-tertiary hover:bg-elevated border border-border-subtle hover:border-border-default rounded-lg transition-colors"
                                        onClick={handleLoadMoreLibrary}
                                        disabled={libraryLoadingMore}
                                    >
                                        {libraryLoadingMore ? "Loading..." : "Load more"}
                                    </button>
                                </div>
                            )}
                        </>
                    ) : null}
                </section>
            )}
        </div>
    );
}

export default function ShortcutsPage() {
    return (
        <Suspense
            fallback={(
                <div className="w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-12 py-8">
                    <div className="flex items-center gap-2 text-sm text-fg-muted">
                        <Loader2 size={15} className="animate-spin" />
                        Loading shortcuts...
                    </div>
                </div>
            )}
        >
            <ShortcutsPageInner />
        </Suspense>
    );
}
