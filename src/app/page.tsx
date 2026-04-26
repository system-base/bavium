import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Footer } from "@/components/layout/Footer";
import { LandingNav } from "@/components/layout/LandingNav";
import { LandingBuilderShowcase } from "@/components/layout/LandingBuilderShowcase";
import { LandingAIAgent } from "@/components/layout/LandingAIAgent";
import { BuilderSkillsShowcase } from "@/components/layout/BuilderSkillsShowcase";

export default function LandingPage() {
  return (
    <div className="flex flex-col bg-primary min-h-screen selection:bg-brand/30">
      {/* Dynamic Scroll Navigation */}
      <LandingNav />

      {/* Hero Section */}
      <section className="relative pt-[calc(var(--height-header)+60px+80px)] pb-16 sm:pb-24 px-6 sm:px-10 flex flex-col items-start justify-center text-left min-h-screen overflow-hidden">
        {/* Background Image - Sketch Style Overlay */}
        <div className="absolute inset-0 z-0 pointer-events-none flex items-center justify-center overflow-hidden">
          <div 
            className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-20 mix-blend-luminosity"
            style={{ 
              backgroundImage: "url('/hero-bg.jpg')", 
            }}
          />
          {/* Soft gradients to ensure text remains highly readable */}
          <div className="absolute inset-0 bg-gradient-to-r from-primary via-primary/70 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-b from-primary/30 via-transparent to-primary/90" />
        </div>

        {/* Glow effect / Mesh gradient background */}
        <div className="absolute top-1/2 left-0 -translate-y-1/2 w-[800px] h-[800px] bg-brand/5 rounded-full blur-[140px] pointer-events-none z-0" />

        <h1 className="text-[44px] sm:text-[64px] lg:text-[80px] font-bold tracking-tight leading-[1.05] text-fg max-w-[900px] mb-6 animate-slide-up [animation-delay:100ms] [animation-fill-mode:both] relative z-10">
          Build workflows {" "}
          <br className="hidden sm:block" />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-fg to-fg-muted">
            for Base.
          </span>
        </h1>

        <p className="text-[18px] sm:text-[20px] text-fg-secondary leading-relaxed max-w-[640px] mb-10 animate-slide-up [animation-delay:200ms] [animation-fill-mode:both] relative z-10">
          Bavium is the visual way to build, run, and share onchain workflows on Base. Create flows for swaps, balances, bridge reads, DeFi, logic, and social sharing.
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-4 animate-slide-up [animation-delay:300ms] [animation-fill-mode:both] w-full sm:w-auto relative z-10">
          <Link
            href="/builder"
            className="h-12 w-full sm:w-auto px-8 inline-flex items-center justify-center gap-2.5 text-[16px] font-semibold text-primary bg-fg hover:scale-[1.02] active:scale-[0.98] rounded-full no-underline transition-all shadow-lg"
          >
            Open Builder
            <ArrowRight size={18} />
          </Link>
          <Link
            href="/shortcuts"
            className="h-12 w-full sm:w-auto px-8 inline-flex items-center justify-center gap-2 text-[16px] font-semibold text-fg border border-border-strong hover:border-fg hover:bg-secondary active:scale-[0.98] rounded-full no-underline transition-all"
          >
            Explore Workflows
          </Link>
        </div>
      </section>

      {/* Builder Product Showcase */}
      <LandingBuilderShowcase />

      {/* AI Agent Showcase */}
      <LandingAIAgent />

      {/* Skills Showcase */}
      <BuilderSkillsShowcase />

      {/* Feature Highlights - Bento Grid */}
      <section className="relative py-24 sm:py-32 border-t border-border-subtle overflow-hidden">
        {/* Brand glow — same visual language as hero section */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-brand/5 rounded-full blur-[160px] pointer-events-none" />
        <div className="max-w-[1200px] mx-auto px-6 sm:px-10 relative z-10">
          <div className="text-center mb-16 sm:mb-24">
            <h2 className="text-[32px] sm:text-[48px] font-bold tracking-tight text-fg mb-4">
              From blocks to <br className="sm:hidden" />
              <span className="text-fg-muted">Base workflows.</span>
            </h2>
            <p className="text-[18px] text-fg-secondary max-w-[600px] mx-auto">
              Build visually, add logic, review what runs, and publish reusable flows that other builders can inspect.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 auto-rows-[minmax(350px,auto)]">
            {/* Bento Card 1 */}
            <div className="group relative overflow-hidden bg-tertiary border border-border-subtle rounded-[24px] p-8 hover:border-border-strong transition-colors flex flex-col justify-end min-h-[350px]">
               <div className="absolute inset-0 bg-brand/10 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
               <div className="absolute inset-0 bg-cover bg-center opacity-30 mix-blend-luminosity pointer-events-none transition-all duration-700 group-hover:scale-105 group-hover:opacity-50" style={{backgroundImage: "url('/bento-bg-1.png')"}} />
               <div className="absolute inset-x-0 bottom-0 h-[85%] bg-gradient-to-t from-tertiary via-tertiary/90 to-transparent pointer-events-none" />
               <div className="flex flex-col relative z-20 h-full">
                <h3 className="text-[20px] lg:text-[24px] font-semibold text-fg mb-3 mt-auto">Core Blocks</h3>
                <p className="text-[14px] lg:text-[15px] text-fg-secondary leading-relaxed">
                  Build swaps, balances, bridge reads, DeFi moves, and social flows from blocks.
                </p>
               </div>
            </div>

            {/* Bento Card 2 */}
            <div className="group relative overflow-hidden bg-tertiary border border-border-subtle rounded-[24px] p-8 hover:border-border-strong transition-colors flex flex-col justify-end min-h-[350px]">
               <div className="absolute inset-0 bg-brand/10 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
               <div className="absolute inset-0 bg-cover bg-center opacity-30 mix-blend-luminosity pointer-events-none transition-all duration-700 group-hover:scale-105 group-hover:opacity-50" style={{backgroundImage: "url('/bento-bg-2.png')"}} />
               <div className="absolute inset-x-0 bottom-0 h-[85%] bg-gradient-to-t from-tertiary via-tertiary/90 to-transparent pointer-events-none" />
              <div className="flex flex-col relative z-20 h-full">
                <h3 className="text-[20px] lg:text-[24px] font-semibold text-fg mb-3 mt-auto">Flow Logic</h3>
                <p className="text-[14px] lg:text-[15px] text-fg-secondary leading-relaxed">
                  Add conditions, variables, repeats, and outputs without leaving the canvas.
                </p>
              </div>
            </div>

            {/* Bento Card 3 */}
            <div className="group relative overflow-hidden bg-tertiary border border-border-subtle rounded-[24px] p-8 hover:border-border-strong transition-colors flex flex-col justify-end min-h-[350px]">
               <div className="absolute inset-0 bg-brand/10 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
               <div className="absolute inset-0 bg-cover bg-center opacity-30 mix-blend-luminosity pointer-events-none transition-all duration-700 group-hover:scale-105 group-hover:opacity-50" style={{backgroundImage: "url('/bento-bg-3.png')"}} />
               <div className="absolute inset-x-0 bottom-0 h-[85%] bg-gradient-to-t from-tertiary via-tertiary/90 to-transparent pointer-events-none" />
               <div className="flex flex-col relative z-20 h-full">
                <h3 className="text-[20px] lg:text-[24px] font-semibold text-fg mb-3 mt-auto">Safe Runs</h3>
                <p className="text-[14px] lg:text-[15px] text-fg-secondary leading-relaxed">
                  Open every run, inspect the result, and keep approvals in the wallet path.
                </p>
               </div>
            </div>

            {/* Bento Card 4 */}
            <div className="group relative overflow-hidden bg-tertiary border border-border-subtle rounded-[24px] p-8 hover:border-border-strong transition-colors flex flex-col justify-end min-h-[350px]">
               <div className="absolute inset-0 bg-brand/10 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
               <div className="absolute inset-0 bg-cover bg-center opacity-30 mix-blend-luminosity pointer-events-none transition-all duration-700 group-hover:scale-105 group-hover:opacity-50" style={{backgroundImage: "url('/bento-bg-4.png')"}} />
               <div className="absolute inset-x-0 bottom-0 h-[85%] bg-gradient-to-t from-tertiary via-tertiary/90 to-transparent pointer-events-none" />
               <div className="flex flex-col relative z-20 h-full">
                <h3 className="text-[20px] lg:text-[24px] font-semibold text-fg mb-3 mt-auto">Share Flows</h3>
                <p className="text-[14px] lg:text-[15px] text-fg-secondary leading-relaxed">
                  Publish workflow pages with previews, metadata, and a starting point for remixing.
                </p>
               </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <Footer />
    </div>
  );
}
