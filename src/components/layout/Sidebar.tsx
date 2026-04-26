"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useCallback, useEffect } from "react";
import { LayoutGrid, Hammer, Play, Zap, Settings, X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui";
import { SidebarChat } from "@/components/chat/SidebarChat";

const NAV_ITEMS = [
    {
        section: "Navigate",
        links: [
            { href: "/shortcuts", label: "Shortcuts", icon: LayoutGrid },
            { href: "/builder", label: "Builder", icon: Hammer },
            { href: "/runs", label: "Runs", icon: Play },
            { href: "/automations", label: "Automations", icon: Zap },
            { href: "/chat", label: "AI Agent", icon: Sparkles },
        ],
    },
    {
        section: "System",
        links: [{ href: "/settings", label: "Settings", icon: Settings }],
    },
];

interface SidebarProps {
    mobileOpen?: boolean;
    onClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onClose }: SidebarProps) {
    const pathname = usePathname();
    const [activeTab, setActiveTab] = useState<"menu" | "chat">("menu");
    const [isResizing, setIsResizing] = useState(false);

    // SSR-safe initialization for sidebar width CSS variable.
    useEffect(() => {
        const saved = localStorage.getItem("bavium:sidebarWidth");
        const parsed = saved ? parseInt(saved, 10) : NaN;
        const width = !isNaN(parsed) && parsed >= 240 ? parsed : 240;
        document.documentElement.style.setProperty("--width-sidebar", `${width}px`);
    }, []);

    const handleResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
    }, []);

    useEffect(() => {
        if (!isResizing) return;

        const handleMouseMove = (e: MouseEvent) => {
            const newWidth = Math.max(240, Math.min(e.clientX, 600)); // Min 240px, Max 600px
            document.documentElement.style.setProperty("--width-sidebar", `${newWidth}px`);
        };

        const handleMouseUp = () => {
            setIsResizing(false);
            // Save final width to local storage when dragging stops
            localStorage.setItem("bavium:sidebarWidth", document.documentElement.style.getPropertyValue("--width-sidebar").replace("px", ""));
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
        return () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
        };
    }, [isResizing]);

    return (
        <aside
            className={`fixed top-[var(--height-header)] left-0 bottom-0 bg-secondary border-r border-border-subtle flex flex-col z-40 transition-transform duration-200 ${mobileOpen
                ? "flex translate-x-0 w-screen shadow-2xl"
                : "hidden sm:flex sm:translate-x-0 -translate-x-full"
                }`}
            style={{ width: mobileOpen ? undefined : "var(--width-sidebar)" }}
        >
            {/* Context/Layout Resize Handle (Only visible on desktop) */}
            {!mobileOpen && (
                <div
                    className="absolute top-0 right-0 bottom-0 w-1.5 cursor-col-resize hover:bg-brand/50 bg-transparent transition-colors z-50"
                    onMouseDown={handleResizeStart}
                />
            )}

            {/* Mobile close button */}
            <div className="flex sm:hidden items-center justify-between px-3 pt-4 mb-3 shrink-0">
                <span className="text-sm font-semibold text-fg-muted uppercase tracking-wider">
                    Menu
                </span>
                <Button
                    type="button"
                    variant="icon"
                    size="icon"
                    onClick={onClose}
                    aria-label="Close menu"
                >
                    <X size={16} />
                </Button>
            </div>

            {/* Top Area: Toggle Segment Control */}
            <div className="h-[60px] flex items-center shrink-0 px-4 border-b border-border-subtle/50 mb-2">
                <div className="flex w-full items-center p-0.5 bg-tertiary border border-border-subtle rounded-[10px]">
                    <button
                        onClick={() => setActiveTab("menu")}
                        className={`flex-1 h-[30px] flex items-center justify-center text-[14px] font-semibold rounded-[8px] transition-all ${activeTab === "menu"
                            ? "text-fg bg-secondary shadow-sm border border-border-default"
                            : "text-fg-muted hover:text-fg border border-transparent"
                            }`}
                    >
                        Menu
                    </button>
                    <button
                        onClick={() => setActiveTab("chat")}
                        className={`flex-1 h-[30px] flex items-center justify-center text-[14px] font-semibold rounded-[8px] transition-all ${activeTab === "chat"
                            ? "text-fg bg-secondary shadow-sm border border-border-default"
                            : "text-fg-muted hover:text-fg border border-transparent"
                            }`}
                    >
                        Chat
                    </button>
                </div>
            </div>

            {/* Content Area */}
            {activeTab === "menu" ? (
                /* MENU UI */
                <nav className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 select-none">
                    {NAV_ITEMS.map((section) => (
                        <div key={section.section} className="mb-6">
                            {section.section !== "Navigate" && (
                                <span className="block px-3 mb-2 text-[13px] font-bold tracking-widest uppercase text-fg-muted">
                                    {section.section}
                                </span>
                            )}
                            <ul className="flex flex-col gap-0.5">
                                {section.links.map((link) => {
                                    const isActive = pathname.startsWith(link.href);
                                    const Icon = link.icon;
                                    return (
                                        <li key={link.href}>
                                            <Link
                                                href={link.href}
                                                className={`flex items-center gap-3 h-9 px-3 text-[15px] rounded-md no-underline transition-colors ${isActive
                                                    ? "bg-brand-subtle text-fg font-medium"
                                                    : "text-fg-secondary hover:bg-tertiary hover:text-fg"
                                                    }`}
                                                onClick={onClose}
                                            >
                                                <span
                                                    className={`flex items-center justify-center w-5 h-5 shrink-0 ${isActive
                                                        ? "text-brand-light"
                                                        : "opacity-50"
                                                        }`}
                                                >
                                                    <Icon size={16} />
                                                </span>
                                                {link.label}
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    ))}
                </nav>
            ) : (
                /* CHAT UI — streaming mini-chat (Cursor-style) */
                <div className="flex min-h-0 flex-1 overflow-hidden">
                    <SidebarChat onNavigate={onClose} />
                </div>
            )}
        </aside>
    );
}
