"use client";

import { useRef, useState, useCallback, useEffect, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface MobileCarouselProps {
    /** Total number of items */
    itemCount: number;
    children: ReactNode;
}

/**
 * A horizontal snap-scroll carousel for mobile with arrow buttons and dot indicators.
 * On desktop (sm+), this renders children in a transparent pass-through (grid handled by parent).
 */
export function MobileCarousel({ itemCount, children }: MobileCarouselProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [activeIndex, setActiveIndex] = useState(0);

    const scrollTo = useCallback((index: number) => {
        const container = scrollRef.current;
        if (!container) return;
        const child = container.children[index] as HTMLElement | undefined;
        if (child) {
            child.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
        }
    }, []);

    const handlePrev = useCallback(() => {
        const next = Math.max(0, activeIndex - 1);
        setActiveIndex(next);
        scrollTo(next);
    }, [activeIndex, scrollTo]);

    const handleNext = useCallback(() => {
        const next = Math.min(itemCount - 1, activeIndex + 1);
        setActiveIndex(next);
        scrollTo(next);
    }, [activeIndex, itemCount, scrollTo]);

    // Sync active index on scroll (snap detection via IntersectionObserver to avoid jank)
    useEffect(() => {
        const container = scrollRef.current;
        if (!container) return;

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        const index = Array.from(container.children).indexOf(entry.target);
                        if (index !== -1) {
                            setActiveIndex(index);
                        }
                    }
                });
            },
            { root: container, threshold: 0.5 }
        );

        Array.from(container.children).forEach((child) => observer.observe(child));

        return () => observer.disconnect();
    }, [itemCount]);

    if (itemCount === 0) return null;

    return (
        <div className="sm:hidden">
            {/* Arrow buttons row */}
            {itemCount > 1 && (
                <div className="flex items-center justify-end gap-2 mb-3">
                    <button
                        type="button"
                        onClick={handlePrev}
                        disabled={activeIndex === 0}
                        className="w-8 h-8 flex items-center justify-center rounded-full border border-border-default text-fg-secondary hover:text-fg hover:border-fg disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                        aria-label="Previous"
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <button
                        type="button"
                        onClick={handleNext}
                        disabled={activeIndex >= itemCount - 1}
                        className="w-8 h-8 flex items-center justify-center rounded-full border border-border-default text-fg-secondary hover:text-fg hover:border-fg disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                        aria-label="Next"
                    >
                        <ChevronRight size={16} />
                    </button>
                </div>
            )}

            {/* Scrollable cards row */}
            <div
                ref={scrollRef}
                className="flex snap-x snap-mandatory gap-4 overflow-x-auto hide-scrollbar py-4 -my-4"
            >
                {children}
            </div>

            {/* Dot indicators */}
            {itemCount > 1 && (
                <div className="flex flex-wrap items-center justify-center gap-1.5 mt-4">
                    {Array.from({ length: itemCount }, (_, i) => (
                        <button
                            key={i}
                            type="button"
                            onClick={() => { setActiveIndex(i); scrollTo(i); }}
                            className={`rounded-full transition-all ${
                                i === activeIndex
                                    ? "w-5 h-2 bg-fg"
                                    : "w-2 h-2 bg-fg-muted/30 hover:bg-fg-muted/50"
                            }`}
                            aria-label={`Go to slide ${i + 1}`}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
