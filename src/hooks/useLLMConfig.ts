"use client";

import { useEffect, useState } from "react";
import { getLLMConfig, type LLMConfig } from "@/lib/llm";
import { loadStoredSettings } from "@/lib/secure-storage";

export function useLLMConfig() {
    const [config, setConfig] = useState<LLMConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [locked, setLocked] = useState(false);

    useEffect(() => {
        let canceled = false;

        async function load() {
            setLoading(true);
            try {
                const stored = await loadStoredSettings();
                if (canceled) return;

                if (stored.source === "encrypted" && stored.locked) {
                    setConfig(null);
                    setLocked(true);
                    return;
                }

                const nextConfig = await getLLMConfig();
                if (canceled) return;
                setLocked(false);
                setConfig(nextConfig);
            } catch {
                if (!canceled) {
                    setConfig(null);
                    setLocked(false);
                }
            } finally {
                if (!canceled) setLoading(false);
            }
        }

        void load();

        return () => {
            canceled = true;
        };
    }, []);

    return { config, loading, locked };
}

