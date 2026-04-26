"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, FileCode2 } from "lucide-react";

interface ShortcutOption {
    id: string;
    name: string;
    category: string;
}

interface MentionDropdownProps {
    query: string;
    visible: boolean;
    onSelect: (shortcut: ShortcutOption) => void;
    onClose: () => void;
    selectedIndex: number;
    confirmRef?: React.MutableRefObject<(() => void) | null>;
}

export function MentionDropdown({
    query,
    visible,
    onSelect,
    onClose,
    selectedIndex,
    confirmRef,
}: MentionDropdownProps) {
    const [results, setResults] = useState<ShortcutOption[]>([]);
    const [loading, setLoading] = useState(false);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!confirmRef) return;
        if (!visible || results.length === 0) {
            confirmRef.current = null;
            return;
        }
        const bounded = Math.min(selectedIndex, results.length - 1);
        confirmRef.current = () => {
            if (results[bounded]) onSelect(results[bounded]);
        };
    }, [confirmRef, visible, results, selectedIndex, onSelect]);

    const fetchShortcuts = useCallback(async (search: string) => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ limit: "10" });
            const res = await fetch(`/api/shortcuts?${params.toString()}`, {
                credentials: "include",
            });
            if (!res.ok) {
                setResults([]);
                return;
            }
            const data = (await res.json()) as {
                page?: { _id: string; name: string; category: string }[];
            };
            const all = (data.page ?? []).map((s) => ({
                id: s._id,
                name: s.name,
                category: s.category,
            }));

            if (search) {
                const lower = search.toLowerCase();
                setResults(
                    all.filter((s) => s.name.toLowerCase().includes(lower)),
                );
            } else {
                setResults(all);
            }
        } catch {
            setResults([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!visible) return;
        const timer = setTimeout(() => void fetchShortcuts(query), 200);
        return () => clearTimeout(timer);
    }, [visible, query, fetchShortcuts]);

    useEffect(() => {
        if (!listRef.current) return;
        const selected = listRef.current.children[selectedIndex] as HTMLElement | undefined;
        selected?.scrollIntoView({ block: "nearest" });
    }, [selectedIndex]);

    if (!visible) return null;

    return (
        <div
            ref={listRef}
            className="absolute bottom-full left-0 right-0 mb-1 max-h-48 overflow-y-auto rounded-xl bg-secondary border border-border-subtle shadow-lg z-50"
            role="listbox"
            aria-label="Shortcut suggestions"
        >
            {loading && (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-fg-muted">
                    <Loader2 size={12} className="animate-spin" />
                    Searching shortcuts...
                </div>
            )}
            {!loading && results.length === 0 && (
                <div className="px-3 py-2 text-xs text-fg-muted">
                    No shortcuts found
                </div>
            )}
            {results.map((shortcut, i) => (
                <button
                    key={shortcut.id}
                    type="button"
                    role="option"
                    aria-selected={i === selectedIndex}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                        i === selectedIndex
                            ? "bg-brand-subtle text-fg"
                            : "text-fg-secondary hover:bg-tertiary"
                    }`}
                    onMouseDown={(e) => {
                        e.preventDefault();
                        onSelect(shortcut);
                    }}
                >
                    <FileCode2
                        size={14}
                        className="text-brand-light shrink-0"
                    />
                    <span className="truncate font-medium">
                        {shortcut.name}
                    </span>
                    <span className="ml-auto text-xs text-fg-muted capitalize">
                        {shortcut.category}
                    </span>
                </button>
            ))}
        </div>
    );
}

export type { ShortcutOption };
