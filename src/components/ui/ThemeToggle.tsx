"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Sun, Moon } from "lucide-react";

type Theme = "dark" | "light";

// SSR-safe mount detection using useSyncExternalStore
const subscribeMounted = () => () => {};
const getMountedSnapshot = () => true;
const getServerSnapshot = () => false;

// External store for theme to avoid setState-in-effect
let currentTheme: Theme = "dark";
const themeListeners = new Set<() => void>();

function initTheme(): void {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem("bavium-theme");
    if (stored === "dark" || stored === "light") {
        currentTheme = stored;
    } else {
        currentTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
}

function setThemeExternal(next: Theme): void {
    currentTheme = next;
    localStorage.setItem("bavium-theme", next);
    document.documentElement.setAttribute("data-theme", next);
    for (const listener of themeListeners) listener();
}

function subscribeTheme(callback: () => void) {
    themeListeners.add(callback);
    return () => { themeListeners.delete(callback); };
}

function getThemeSnapshot(): Theme {
    return currentTheme;
}

function getThemeServerSnapshot(): Theme {
    return "dark";
}

// Initialize on module load (client only)
if (typeof window !== "undefined") {
    initTheme();
}

export function ThemeToggle() {
    const mounted = useSyncExternalStore(subscribeMounted, getMountedSnapshot, getServerSnapshot);
    const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getThemeServerSnapshot);

    // Apply data-theme attribute on mount and when theme changes
    useEffect(() => {
        document.documentElement.setAttribute("data-theme", theme);
    }, [theme]);

    function toggle() {
        setThemeExternal(theme === "dark" ? "light" : "dark");
    }

    // Prevent hydration mismatch
    if (!mounted) {
        return <div className="w-8 h-8 rounded-md shrink-0" />;
    }

    return (
        <button
            type="button"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            onClick={toggle}
            className="flex items-center justify-center w-8 h-8 rounded-md text-fg-muted hover:text-fg hover:bg-tertiary transition-colors shrink-0"
        >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
    );
}
