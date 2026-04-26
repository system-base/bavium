"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { BaviumLogo } from "@/components/ui/BaviumLogo";
import { ArrowRight } from "lucide-react";
import { AnnouncementBanner } from "./AnnouncementBanner";

export function LandingNav() {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 80);
    };
    
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <>
      <div 
        className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]
          ${isScrolled ? '-translate-y-full opacity-0 pointer-events-none' : 'translate-y-0 opacity-100 pointer-events-auto'}
        `}
      >
        <AnnouncementBanner />

        {/* Original Full Width Header */}
        <nav className="flex items-center justify-between h-[var(--height-header)] px-6 sm:px-10 bg-primary/60 backdrop-blur-md border-b border-border-subtle/50">
          <Link
            href="/"
            onClick={(e) => {
              if (window.location.pathname === '/') {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }}
            className="flex items-center gap-4 no-underline group outline-none"
          >
            <BaviumLogo className="h-14 w-auto text-fg shrink-0 transition-opacity group-hover:opacity-80" />
            <span className="text-fg text-[22px] tracking-wide font-semibold">
              Bavium
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <Link
              href="/builder"
              className="h-9 px-5 inline-flex items-center gap-2 text-[14px] font-semibold text-primary bg-fg hover:opacity-90 rounded-full no-underline transition-opacity shadow-sm"
            >
              Open Builder
            </Link>
          </div>
        </nav>
      </div>

      {/* Floating Pill Header */}
      <div 
        className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] w-full max-w-[calc(100%-2rem)] sm:max-w-none sm:w-auto flex justify-center
          ${isScrolled ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto' : 'opacity-0 -translate-y-4 scale-95 pointer-events-none'}
        `}
      >
        <div className="w-full sm:w-auto flex items-center justify-between sm:justify-start gap-6 sm:gap-8 bg-primary/45 backdrop-blur-md border border-border-subtle rounded-full pl-6 sm:pl-8 pr-3 sm:pr-4 py-2 sm:py-2.5 shadow-lg ring-1 ring-black/5 dark:ring-white/5">
          <Link 
            href="/" 
            onClick={(e) => {
              if (window.location.pathname === '/') {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }}
            className="group flex items-center gap-4 outline-none"
            aria-label="Home"
          >
            <BaviumLogo className="h-10 sm:h-12 w-auto text-fg transition-opacity group-hover:opacity-80" />
            <span className="text-fg text-[18px] sm:text-[22px] font-semibold tracking-wide hidden min-[360px]:block">Bavium</span>
          </Link>
          
          <Link
            href="/builder"
            className="inline-flex items-center justify-center whitespace-nowrap text-[14px] sm:text-[15px] font-sans font-medium transition-transform outline-none bg-fg text-primary hover:scale-[1.02] active:scale-[0.98] h-10 sm:h-12 gap-2 rounded-full px-6 group shadow-sm shrink-0"
          >
            Open Builder
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </>
  );
}
