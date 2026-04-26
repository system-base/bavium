"use client";

import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import {
    createBuilderAIContextSnapshot,
    type BuilderAIContextDraft,
    type BuilderAIContextSnapshot,
} from "@/lib/builder-ai-context";

interface BuilderAIContextValue {
    snapshot: BuilderAIContextSnapshot | null;
    publishBuilderContext: (draft: BuilderAIContextDraft) => void;
    clearBuilderContext: () => void;
}

const noop = () => {};

const fallbackValue: BuilderAIContextValue = {
    snapshot: null,
    publishBuilderContext: noop,
    clearBuilderContext: noop,
};

const BuilderAIContext = createContext<BuilderAIContextValue | null>(null);

export function BuilderAIContextProvider({ children }: { children: ReactNode }) {
    const [snapshot, setSnapshot] = useState<BuilderAIContextSnapshot | null>(null);

    const publishBuilderContext = useCallback((draft: BuilderAIContextDraft) => {
        setSnapshot(createBuilderAIContextSnapshot(draft));
    }, []);

    const clearBuilderContext = useCallback(() => {
        setSnapshot(null);
    }, []);

    const value = useMemo(
        () => ({
            snapshot,
            publishBuilderContext,
            clearBuilderContext,
        }),
        [clearBuilderContext, publishBuilderContext, snapshot],
    );

    return (
        <BuilderAIContext.Provider value={value}>
            {children}
        </BuilderAIContext.Provider>
    );
}

export function useBuilderAIContext(): BuilderAIContextValue {
    return useContext(BuilderAIContext) ?? fallbackValue;
}
