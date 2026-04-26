"use client";

import { useState, useCallback } from "react";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { BuilderAIContextProvider } from "@/contexts/BuilderAIContext";

export default function AppLayout({ children }: { children: React.ReactNode }) {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const handleMenuToggle = useCallback(() => {
        setMobileMenuOpen((prev) => !prev);
    }, []);

    const handleMenuClose = useCallback(() => {
        setMobileMenuOpen(false);
    }, []);

    return (
        <BuilderAIContextProvider>
            <div className="flex flex-col min-h-screen">
                <Header onMenuToggle={handleMenuToggle} />
                <div className="flex flex-1">
                    <Sidebar mobileOpen={mobileMenuOpen} onClose={handleMenuClose} />
                    {mobileMenuOpen && (
                        <div
                            className="fixed inset-0 z-30 bg-black/50 sm:hidden"
                            onClick={handleMenuClose}
                        />
                    )}
                    <main className="flex-1 p-4 sm:p-6 sm:ml-[var(--width-sidebar)] lg:p-8 min-h-[calc(100vh-var(--height-header))] overflow-x-hidden">
                        {children}
                    </main>
                </div>
            </div>
        </BuilderAIContextProvider>
    );
}
