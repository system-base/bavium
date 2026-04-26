import { ArrowRight, PenTool, Check } from "lucide-react";
import Link from "next/link";
import { BaviumLogo } from "@/components/ui/BaviumLogo";

export function LandingAIAgent() {
    return (
        <section className="px-6 sm:px-10 py-24 sm:py-32 bg-primary relative overflow-hidden border-t border-border-subtle">
            {/* Background elements */}
            <div className="absolute top-1/2 left-0 w-[600px] h-[600px] bg-brand/5 rounded-full blur-[120px] pointer-events-none -translate-y-1/2" />
            
            <div className="max-w-[1200px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-8 items-center relative z-10">
                
                {/* Left Side: Visual Mockup */}
                <div className="group relative w-full max-w-[500px] lg:max-w-none mx-auto lg:mx-0 h-[600px] flex items-center justify-center animate-slide-up [animation-delay:200ms] order-2 lg:order-1">
                    
                    {/* The "Chat" Window */}
                    <div className="absolute left-0 lg:-left-4 w-full sm:w-[380px] h-[520px] bg-secondary border border-border-subtle rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] ring-1 ring-white/5 flex flex-col overflow-hidden z-20 transition-transform duration-700 ease-out group-hover:-translate-x-4">
                        
                        {/* Chat Header */}
                        <div className="h-[60px] flex items-center gap-3 px-4 shrink-0 border-b border-border-subtle bg-tertiary">
                            <BaviumLogo className="h-6 w-auto text-fg" />
                            <div className="flex flex-col">
                                <div className="flex items-center gap-2">
                                    <span className="text-[14px] font-semibold text-fg">Agent</span>
                                    <span className="text-[10px] font-bold tracking-widest text-brand-light bg-brand-subtle uppercase px-1.5 py-0.5 rounded border border-brand/20">AI</span>
                                </div>
                            </div>
                        </div>

                        {/* Chat Body */}
                        <div className="flex-1 overflow-hidden p-4 bg-secondary flex flex-col gap-4 relative">
                            {/* Push content down/scroll effect */}
                            <div className="flex-1" />

                            {/* User Bubble 1 */}
                            <div className="flex justify-end ml-8 shrink-0 mt-8">
                                <div className="bg-tertiary border border-border-subtle text-fg text-[13.5px] px-3.5 py-2.5 rounded-2xl rounded-tr-sm leading-relaxed">
                                    Can you draft a workflow that checks my balance and automatically swaps 10 USDC for ETH if I have over 50 USDC?
                                </div>
                            </div>
                            
                            <div className="flex justify-end ml-12">
                                <div className="flex items-center gap-1.5 px-2 py-1 bg-tertiary/50 border border-border-subtle rounded-md text-[10px] font-mono text-brand-light -mt-2">
                                    <PenTool size={10} />
                                    generateShortcutDraft
                                    <span className="text-fg-muted ml-0.5">done</span>
                                </div>
                            </div>

                            {/* AI Bubble / Draft Card */}
                            <div className="flex flex-col items-start mr-8 gap-2 shrink-0 mb-4">
                                <div className="w-full bg-primary border border-border-subtle rounded-xl p-3 shadow-sm">
                                    <div className="flex items-center gap-2 mb-1">
                                        <div className="w-4 h-4 rounded-full border border-status-success flex items-center justify-center text-status-success">
                                            <Check size={10} strokeWidth={3} />
                                        </div>
                                        <span className="font-semibold text-[14.5px] text-fg leading-tight">Conditional USDC to ETH Swap</span>
                                    </div>
                                    <div className="text-[12px] text-fg-muted mb-3 pl-6">2 steps</div>
                                    <div className="pl-6 flex flex-col gap-1.5 mb-4">
                                        <div className="flex items-center gap-3 text-[13px] text-fg-secondary">
                                            <span className="text-[10px] font-mono text-fg-muted">1</span> Check Balance
                                        </div>
                                        <div className="flex items-center gap-3 text-[13px] text-fg-secondary">
                                            <span className="text-[10px] font-mono text-fg-muted">2</span> If / Else
                                        </div>
                                    </div>
                                    <button className="w-full h-[38px] rounded-lg bg-[#1C1C1C] hover:bg-[#2C2C2C] text-[#EFEFEF] text-[13.5px] font-medium flex items-center justify-center gap-2 transition-colors">
                                        <PenTool size={14} className="opacity-80" /> 
                                        Open in Builder 
                                        <ArrowRight size={14} className="opacity-80 ml-1" />
                                    </button>
                                </div>
                            </div>

                            {/* Mask the top to create a smooth fade out if they scroll up */}
                            <div className="absolute top-0 left-0 right-0 h-10 bg-gradient-to-b from-secondary to-transparent z-10 pointer-events-none" />
                        </div>
                        
                        {/* Chat Input Field Placeholder */}
                        <div className="h-[60px] p-3 shrink-0 border-t border-border-subtle bg-primary">
                            <div className="w-full h-full bg-secondary border text-fg-muted border-border-subtle rounded-full flex items-center px-4 text-[13px]">
                                Ask anything...
                            </div>
                        </div>
                    </div>
                    
                    {/* Decorative backdrop behind the chat */}
                    <div className="absolute left-12 lg:-left-8 top-12 bottom-12 w-[340px] bg-[radial-gradient(ellipse_at_center,var(--color-brand-subtle)_0%,transparent_70%)] opacity-20 blur-[40px] z-0" />
                    
                    {/* Interactive Hover "Shortcut Saved" Card */}
                    <div className="absolute right-0 bottom-1/4 w-[300px] bg-secondary border border-[#34A853]/20 rounded-xl p-4 shadow-xl z-10 
                                  blur-[3px] opacity-40 scale-95 rotate-6 translate-x-8 translate-y-8
                                  transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] 
                                  group-hover:-translate-x-4 group-hover:-translate-y-4 group-hover:rotate-0 group-hover:scale-105 group-hover:blur-none group-hover:opacity-100 group-hover:z-30 group-hover:shadow-[0_30px_60px_-15px_rgba(52,168,83,0.15)] 
                                  hidden sm:block overflow-hidden cursor-default">
                        <div className="absolute inset-0 bg-[#E6F4EA]/5 pointer-events-none" />
                        <div className="relative z-10">
                            <div className="font-medium text-[14px] text-[#34A853] mb-2 flex items-center gap-2">
                                <div className="w-4 h-4 rounded-full bg-[#34A853]/10 flex items-center justify-center">
                                    <Check size={10} strokeWidth={3} />
                                </div>
                                Shortcut saved
                            </div>
                            <div className="text-[13px] text-fg-secondary mb-4 leading-relaxed">
                                Shortcut "Conditional USDC to ETH Swap" saved successfully with 2 steps. You can find it in your Shortcuts page.
                            </div>
                            <div className="flex items-center text-[13.5px] font-semibold text-brand hover:text-brand-light transition-colors">
                                View Shortcuts <ArrowRight size={14} className="ml-1" />
                            </div>
                        </div>
                    </div>

                </div>

                {/* Right Side: Text Content */}
                <div className="flex flex-col animate-slide-up order-1 lg:order-2">
                    <div className="inline-flex items-center gap-2 mb-6 text-brand-light">
                        <span className="text-[12px] font-mono font-bold tracking-[0.15em] uppercase px-2.5 py-1 bg-brand-subtle rounded text-brand-light border border-brand/20">
                            AI Agent
                        </span>
                    </div>
                    <h2 className="text-[32px] sm:text-[44px] lg:text-[48px] font-bold tracking-tight leading-[1.1] text-fg mb-6 max-w-[500px]">
                        Describe it. Bavium creates it.
                    </h2>
                    <p className="text-[16px] sm:text-[18px] text-fg-secondary leading-relaxed mb-8 max-w-[500px]">
                        Tell Bavium what you want to do on Base, then open the result in Builder to review the steps before you save or run it.
                    </p>
                    
                    <ul className="flex flex-col gap-4 mb-10">
                        <li className="flex items-start gap-3">
                            <span className="shrink-0 mt-2 w-2 h-2 rounded-full bg-brand-light" />
                            <span className="text-[15px] sm:text-[16px] font-medium text-fg-secondary">Understands multi-step Base flows</span>
                        </li>
                        <li className="flex items-start gap-3">
                            <span className="shrink-0 mt-2 w-2 h-2 rounded-full bg-brand-light" />
                            <span className="text-[15px] sm:text-[16px] font-medium text-fg-secondary">Creates builder-ready blocks and logic</span>
                        </li>
                        <li className="flex items-start gap-3">
                            <span className="shrink-0 mt-2 w-2 h-2 rounded-full bg-brand-light" />
                            <span className="text-[15px] sm:text-[16px] font-medium text-fg-secondary">Opens in Builder for review, save, and run</span>
                        </li>
                    </ul>

                    <div className="flex">
                        <Link
                            href="/chat"
                            className="group inline-flex items-center gap-2 text-[15px] font-semibold text-brand-light hover:text-brand transition-colors"
                        >
                            Try the AI Agent
                            <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
                        </Link>
                    </div>
                </div>

            </div>
        </section>
    );
}
