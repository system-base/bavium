import { Search, ChevronDown, ArrowRight } from "lucide-react";
import Link from "next/link";
import { SKILL_PALETTE, CATEGORY_META, CATEGORY_ICONS, type BlockCategory, type SkillDefinition } from "@/lib/constants";

function groupByCategory(skills: SkillDefinition[]): Partial<Record<BlockCategory, SkillDefinition[]>> {
    const groups: Partial<Record<BlockCategory, SkillDefinition[]>> = {};
    for (const skill of skills) {
        if (!groups[skill.category]) groups[skill.category] = [];
        groups[skill.category]?.push(skill);
    }
    return groups;
}

export function BuilderSkillsShowcase() {
    // Only pick a subset of categories for a clean showcase
    const showcaseCategories: BlockCategory[] = ["wallet", "defi", "data", "logic"];
    
    // Filter the real SKILL_PALETTE to only those categories so it perfectly reflects the app
    const showcaseSkills = SKILL_PALETTE.filter(skill => showcaseCategories.includes(skill.category));
    const grouped = groupByCategory(showcaseSkills);

    return (
        <section className="px-6 sm:px-10 py-24 sm:py-32 bg-primary relative overflow-hidden border-t border-border-subtle">
            {/* Background elements */}
            <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-brand/5 rounded-full blur-[120px] pointer-events-none" />
            
            <div className="max-w-[1200px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-8 items-center relative z-10">
                
                {/* Left Side: Text Content */}
                <div className="flex flex-col animate-slide-up">
                    <div className="inline-flex items-center gap-2 mb-6 text-brand-light">
                        <span className="text-[12px] font-mono font-bold tracking-[0.15em] uppercase px-2.5 py-1 bg-brand-subtle rounded text-brand-light border border-brand/20">
                            Built-in Blocks
                        </span>
                    </div>
                    <h2 className="text-[32px] sm:text-[44px] lg:text-[48px] font-bold tracking-tight leading-[1.1] text-fg mb-6">
                        Built-in blocks for real Base flows.
                    </h2>
                    <p className="text-[16px] sm:text-[18px] text-fg-secondary leading-relaxed mb-8 max-w-[500px]">
                        Wallet, data, DeFi, and logic blocks stay explicit so each workflow remains inspectable before any wallet action runs.
                    </p>
                    
                    <ul className="flex flex-col gap-4 mb-10">
                        <li className="flex items-start gap-3">
                            <span className="shrink-0 mt-2 w-2 h-2 rounded-full bg-brand-light" />
                            <span className="text-[15px] sm:text-[16px] font-medium text-fg-secondary">Wallet, swap, bridge, DeFi, data, and logic coverage</span>
                        </li>
                        <li className="flex items-start gap-3">
                            <span className="shrink-0 mt-2 w-2 h-2 rounded-full bg-brand-light" />
                            <span className="text-[15px] sm:text-[16px] font-medium text-fg-secondary">Variables, conditions, and reusable outputs</span>
                        </li>
                        <li className="flex items-start gap-3">
                            <span className="shrink-0 mt-2 w-2 h-2 rounded-full bg-brand-light" />
                            <span className="text-[15px] sm:text-[16px] font-medium text-fg-secondary">Parameters stay explicit before execution</span>
                        </li>
                    </ul>

                    <div className="flex">
                        <Link
                            href="/builder"
                            className="group inline-flex items-center gap-2 text-[15px] font-semibold text-brand-light hover:text-brand transition-colors"
                        >
                            Explore all Builder blocks
                            <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
                        </Link>
                    </div>
                </div>

                {/* Right Side: Visual Mockup */}
                <div className="relative w-full max-w-[500px] lg:max-w-none mx-auto lg:mx-0 lg:ml-auto h-[600px] flex items-center justify-center animate-slide-up [animation-delay:200ms]">
                    
                    {/* The "Menu" element */}
                    <div className="absolute right-0 lg:-right-4 w-[320px] h-[520px] bg-secondary border border-border-subtle rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] ring-1 ring-white/5 flex flex-col overflow-hidden z-20">
                        
                        {/* Search Bar matching Builder */}
                        <div className="h-[60px] flex items-center px-4 shrink-0 border-b border-border-subtle bg-tertiary">
                            <div className="relative w-full">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
                                <div className="w-full h-8 pl-8 pr-3 text-[13px] bg-primary border border-border-subtle rounded-md flex items-center text-fg-muted shadow-sm">
                                    Search blocks...
                                </div>
                            </div>
                        </div>

                        {/* Skills List matching Builder */}
                        <div className="flex-1 overflow-hidden p-4 bg-secondary">
                            <span className="block mb-4 text-[11px] font-bold tracking-widest uppercase text-fg-muted select-none">
                                Available Blocks
                            </span>
                            
                            {/* Mask the bottom to create a smooth fade out */}
                            <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-secondary to-transparent z-10 pointer-events-none" />

                            <div className="flex flex-col pb-10">
                                {showcaseCategories.map((cat) => {
                                    const meta = CATEGORY_META[cat];
                                    const skills = grouped[cat] || [];
                                    const Icon = CATEGORY_ICONS[cat];
                                    if (skills.length === 0) return null;

                                    return (
                                        <div key={cat} className="mb-4">
                                            {/* Category Header */}
                                            <div className="flex items-center justify-between w-full px-2 py-1.5 mb-1 select-none">
                                                <span className="flex items-center gap-2 text-xs font-semibold tracking-widest uppercase text-fg-muted">
                                                    <span 
                                                        className="w-2 h-2 rounded-full shrink-0" 
                                                        style={{ backgroundColor: meta.cssColor }} 
                                                    />
                                                    {meta.label}
                                                </span>
                                                <ChevronDown size={12} className="opacity-30" />
                                            </div>

                                            {/* Skill Items */}
                                            <div className="flex flex-col font-sans">
                                                {skills.map((skill) => (
                                                    <div 
                                                        key={skill.id}
                                                        className="flex items-center gap-3 h-9 px-3 text-[14px] font-medium text-fg-secondary rounded-md hover:bg-tertiary hover:text-fg transition-colors select-none cursor-default group"
                                                    >
                                                        <span className="flex items-center justify-center w-[18px] h-[18px] shrink-0 opacity-50 group-hover:opacity-80 transition-opacity">
                                                            <Icon size={14} />
                                                        </span>
                                                        <span className="flex-1 text-left truncate">
                                                            {skill.label}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                    
                    {/* Decorative backdrop behind the menu to give it depth */}
                    <div className="absolute right-12 lg:-right-8 top-12 bottom-12 w-[340px] bg-[radial-gradient(ellipse_at_center,var(--color-brand-subtle)_0%,transparent_70%)] opacity-30 blur-[40px] z-0" />
                    
                    {/* A faint mockup canvas block behind the menu to imply the drag/drop context */}
                    <div className="absolute left-0 bottom-1/4 w-[280px] bg-tertiary border border-border-default rounded-xl p-4 shadow-xl opacity-40 blur-[1px] -rotate-3 z-10 hidden sm:block">
                        <div className="flex justify-between items-start mb-3">
                            <div className="flex items-center gap-3">
                                <div className="w-6 h-6 rounded-sm bg-brand-subtle flex items-center justify-center text-[12px] font-bold text-brand-light">1</div>
                                <span className="font-semibold text-[14px] text-fg">Get USDC Balance</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 bg-secondary rounded px-2.5 py-1.5 w-fit border border-border-subtle">
                            <span className="text-[12px] text-fg-muted">token:</span>
                            <span className="text-[12px] font-medium text-fg">USDC</span>
                        </div>
                    </div>

                </div>
            </div>
        </section>
    );
}
