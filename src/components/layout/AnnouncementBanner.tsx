"use client";

import Link from "next/link";

export function AnnouncementBanner() {
  return (
    <div className="w-full h-[52px] sm:h-[60px] bg-primary border-b border-white/[0.08] flex items-center justify-center px-6 relative overflow-hidden">
      {/* Subtle ambient light effect */}
      <div className="absolute inset-0 bg-gradient-to-r from-brand/10 via-transparent to-brand/10 opacity-30 pointer-events-none" />
      
      <div className="flex items-center gap-4 sm:gap-10 relative z-10">
        <span className="text-[15px] sm:text-[18px] text-fg font-medium tracking-tight text-center">
          Bavium is live on private beta for{" "}
          <span className="text-fg font-bold">Base Batches 003 Student Track</span>
        </span>
        
        <Link
          href="https://base-batches-student-track-3.devfolio.co/"
          target="_blank"
          rel="noopener noreferrer"
          className="h-9 px-5 rounded-full border border-border-strong bg-transparent text-fg text-[14px] sm:text-[15px] font-semibold hover:border-fg hover:bg-secondary transition-all active:scale-95 whitespace-nowrap flex items-center justify-center"
        >
          Learn More
        </Link>
      </div>
    </div>
  );
}
