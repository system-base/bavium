import { BaviumLogo } from "@/components/ui/BaviumLogo";

export function LandingBuilderShowcase() {
    return (
        <section className="px-6 sm:px-10 py-24 sm:py-32 bg-primary relative overflow-hidden flex flex-col items-center z-10">
            {/* Background glow for the section */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-brand/5 rounded-full blur-[140px] pointer-events-none z-0" />

            {/* Section Marketing Text */}
            <div className="relative z-10 w-full max-w-[800px] mx-auto text-center mb-16 animate-slide-up">
                <div className="inline-flex items-center gap-2 mb-6">
                    <span className="text-[12px] font-mono font-bold tracking-[0.15em] uppercase px-2.5 py-1 bg-brand-subtle rounded text-brand-light border border-brand/20">
                        Workflow Builder
                    </span>
                </div>
                <h2 className="text-[32px] sm:text-[44px] lg:text-[48px] font-bold tracking-tight leading-[1.1] text-fg mb-6">
                    The workflow builder for Base.
                </h2>
                <p className="text-[18px] text-fg-secondary leading-relaxed mx-auto max-w-[500px]">
                    Arrange reusable blocks into Base workflows with clear steps, logic, and actions.
                </p>
            </div>

            {/* App Mockup UI Presentation (Exact Original) */}
            <div className="w-full max-w-[960px] rounded-2xl bg-secondary border border-border-subtle shadow-2xl overflow-hidden ring-1 ring-white/5 mx-auto relative z-10 animate-slide-up [animation-delay:200ms]">
                {/* Fake Mac Toolbar */}
                <div className="flex items-center gap-2 px-5 h-12 border-b border-border-subtle bg-tertiary">
                    <div className="flex gap-1.5">
                        <div className="w-[11px] h-[11px] rounded-full bg-status-error border border-black/10" />
                        <div className="w-[11px] h-[11px] rounded-full bg-status-warning border border-black/10" />
                        <div className="w-[11px] h-[11px] rounded-full bg-status-success border border-black/10" />
                    </div>
                    <div className="flex-1 flex justify-center">
                        <div className="flex items-center gap-2 px-4 py-1.5 bg-primary border border-border-subtle rounded text-fg-muted font-medium text-[12px]">
                            <BaviumLogo className="h-3.5 w-auto text-fg-muted" />
                            <span>Bavium</span>
                        </div>
                    </div>
                    {/* Visual balance for Mac window */}
                    <div className="w-[50px]" />
                </div>

                {/* Builder Canvas Simulation (Untouched Layout from before) */}
                <div className="h-[480px] bg-primary bg-[radial-gradient(circle,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:24px_24px] relative flex flex-col items-center justify-center">
                    <div className="relative flex flex-col items-center">
                        {/* Block 1 */}
                        <div className="w-[320px] sm:w-[420px] bg-secondary border border-border-default rounded-[12px] p-5 shadow-sm relative z-20">
                            <div className="flex justify-between items-start mb-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-7 h-7 rounded-sm bg-brand-subtle flex items-center justify-center text-[13px] font-bold text-brand-light border border-brand/20">1</div>
                                    <span className="font-semibold text-[15px] text-fg">Get USDC Balance</span>
                                </div>
                                <span className="text-[10px] font-bold tracking-widest text-fg-muted uppercase bg-tertiary px-2 py-1 rounded border border-border-subtle">Wallet</span>
                            </div>
                            <div className="flex items-center gap-2 bg-primary rounded px-2.5 py-1.5 w-fit border border-border-subtle">
                                <span className="text-[13px] text-fg-muted">token:</span>
                                <span className="text-[13px] font-medium text-fg">USDC</span>
                            </div>
                        </div>

                        {/* Connector */}
                        <div className="w-px h-8 bg-border-strong relative z-10" />

                        {/* Block 2 */}
                        <div className="group w-[320px] sm:w-[420px] bg-secondary border border-border-default hover:border-brand-light/50 hover:bg-tertiary rounded-[12px] p-5 shadow-lg relative z-20 transition-all duration-300 hover:shadow-[0_0_20px_var(--color-brand-subtle)]">
                            <div className="flex justify-between items-start mb-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-7 h-7 rounded-sm bg-brand text-primary flex items-center justify-center text-[13px] font-bold">2</div>
                                    <span className="font-semibold text-[15px] text-fg">Send Tokens</span>
                                </div>
                                <span className="text-[10px] font-bold tracking-widest text-fg-muted uppercase bg-tertiary px-2 py-1 rounded border border-border-subtle">Wallet</span>
                            </div>
                            <div className="flex items-center gap-2 bg-primary rounded px-2.5 py-1.5 w-fit border border-border-subtle">
                                <span className="text-[13px] text-fg-muted">amount:</span>
                                <span className="text-[13px] font-medium text-brand-light">100</span>
                            </div>
                        </div>

                        {/* Connector 3 faded */}
                        <div className="absolute top-full flex flex-col items-center">
                            <div className="w-px h-8 bg-border-subtle relative z-10" />
                            <div className="w-[320px] sm:w-[420px] bg-tertiary border border-border-subtle rounded-[12px] p-5 opacity-40 blur-[1px]">
                                <div className="flex items-center gap-3">
                                    <div className="w-7 h-7 rounded-sm bg-border-strong flex items-center justify-center text-[13px] font-bold text-fg-muted">3</div>
                                    <div className="h-4 bg-border-strong w-24 rounded" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
