export default function AppLoading() {
    return (
        <div className="w-full max-w-7xl mx-auto pt-6 flex flex-col gap-6 animate-fade-in">
            <div className="flex items-center gap-4 border-b border-border-subtle pb-6 mb-2">
                <div className="w-12 h-12 rounded-full bg-border-subtle/50 animate-pulse" />
                <div className="flex flex-col gap-2">
                    <div className="w-48 h-5 rounded-md bg-border-subtle/50 animate-pulse" />
                    <div className="w-32 h-4 rounded-md bg-border-subtle/30 animate-pulse" />
                </div>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {[...Array(6)].map((_, i) => (
                    <div key={i} className="flex flex-col gap-3 p-5 rounded-2xl border border-border-subtle bg-secondary/50">
                        <div className="w-1/3 h-5 rounded bg-border-subtle/50 mb-3 animate-pulse" />
                        <div className="w-full h-4 rounded bg-border-subtle/30 animate-pulse" />
                        <div className="w-5/6 h-4 rounded bg-border-subtle/30 animate-pulse" />
                        <div className="w-1/2 h-4 rounded bg-border-subtle/30 animate-pulse mt-2" />
                    </div>
                ))}
            </div>
        </div>
    );
}
