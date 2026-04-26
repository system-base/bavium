"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Loader2, ArrowUp, Square, AlertCircle, Settings, Wrench, ExternalLink, ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
    ShortcutDraftErrorCard,
    ShortcutPreview,
} from "@/components/chat/ShortcutPreview";
import { ChatAccessNotice } from "@/components/chat/ChatAccessNotice";
import { useAIChat } from "@/contexts/AIChatContext";
import { isShortcutDraftOutput } from "@/lib/builder-ai-handoff";
import { useBuilderAIContext } from "@/contexts/BuilderAIContext";

function isCreateShortcutOutput(
    value: unknown,
): value is { success: boolean; shortcutId?: string; message: string } {
    return (
        typeof value === "object" &&
        value !== null &&
        "success" in value &&
        "message" in value &&
        !("steps" in value)
    );
}

function MiniMessage({ message }: { message: UIMessage }) {
    const isUser = message.role === "user";

    return (
        <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-2`}>
            <div
                className={`max-w-[95%] rounded-lg px-2.5 py-1.5 text-[13px] leading-relaxed ${
                    isUser
                        ? "bg-brand-subtle text-fg"
                        : "bg-tertiary border border-border-subtle text-fg"
                }`}
            >
                {message.parts.map((part, i) => {
                    if (part.type === "text") {
                        if (isUser) {
                            return (
                                <span key={i} className="whitespace-pre-wrap break-words">
                                    {part.text}
                                </span>
                            );
                        }
                        return (
                            <div key={i} className="prose-chat text-[13px]">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {part.text}
                                </ReactMarkdown>
                            </div>
                        );
                    }
                    if (part.type.startsWith("tool-")) {
                        const toolPart = part as { type: string; state: string; output?: unknown };
                        const toolName = toolPart.type.replace(/^tool-/, "");
                        const isRunning = toolPart.state === "input-streaming" || toolPart.state === "call";
                        const isDone = toolPart.state === "output" || toolPart.state === "output-available";

                        if (toolName === "generateShortcutDraft" && isDone) {
                            if (isShortcutDraftOutput(toolPart.output)) {
                                return <ShortcutPreview key={i} data={toolPart.output} />;
                            }

                            return (
                                <ShortcutDraftErrorCard
                                    key={i}
                                    message="The AI finished without a valid Builder draft. Try again with a shorter workflow, or ask it to use available blocks."
                                />
                            );
                        }

                        if (toolName === "createShortcut" && isDone && isCreateShortcutOutput(toolPart.output)) {
                            const output = toolPart.output;

                            return (
                                <div
                                    key={i}
                                    className={`my-2 rounded-lg border p-3 ${
                                        output.success
                                            ? "border-status-success/20 bg-status-success/5"
                                            : "border-status-error/20 bg-status-error/5"
                                    }`}
                                >
                                    <p
                                        className={`text-xs font-medium ${
                                            output.success
                                                ? "text-status-success"
                                                : "text-status-error"
                                        }`}
                                    >
                                        {output.success ? "Shortcut saved" : "Save failed"}
                                    </p>
                                    <p className="mt-1 text-xs text-fg-secondary">
                                        {output.message}
                                    </p>
                                    {output.success && (
                                        <Link
                                            href="/shortcuts"
                                            className="inline-flex items-center gap-1 mt-2 text-xs text-brand-light hover:underline"
                                        >
                                            View Shortcuts
                                            <ChevronRight size={10} />
                                        </Link>
                                    )}
                                </div>
                            );
                        }

                        return (
                            <div key={i} className="flex items-center gap-1.5 my-1 text-[11px] text-fg-muted">
                                <Wrench size={10} className="text-brand-light" />
                                <span>{toolName}</span>
                                {isRunning && <Loader2 size={10} className="animate-spin" />}
                                {!isRunning && <span className="text-status-success">done</span>}
                            </div>
                        );
                    }
                    return null;
                })}
            </div>
        </div>
    );
}

interface SidebarChatProps {
    onNavigate?: () => void;
}

export function SidebarChat({ onNavigate }: SidebarChatProps) {
    const pathname = usePathname();
    const {
        config,
        configLoading,
        settingsLocked,
        messages,
        isStreaming,
        error,
        authState,
        walletAddress,
        sendTextMessage,
        clearChat,
        stop,
    } = useAIChat();
    const { snapshot: builderContext } = useBuilderAIContext();
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [inputValue, setInputValue] = useState("");

    const requestBuilderContext = pathname.startsWith("/builder")
        ? builderContext
        : null;

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const handleSend = useCallback(async () => {
        const text = inputValue.trim();
        if (!text || isStreaming || !config) return;

        setInputValue("");
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
        }
        await sendTextMessage(text, { builderContext: requestBuilderContext });
    }, [inputValue, isStreaming, config, requestBuilderContext, sendTextMessage]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
            }
        },
        [handleSend],
    );

    const handleInputChange = useCallback(
        (e: React.ChangeEvent<HTMLTextAreaElement>) => {
            setInputValue(e.target.value);
            const el = e.target;
            el.style.height = "auto";
            el.style.height = `${Math.min(Math.max(el.scrollHeight, 36), 100)}px`;
        },
        [],
    );

    const hasMessages = messages.length > 0;

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Messages area */}
            <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2">
                {!hasMessages ? (
                    <div className="flex flex-col items-center justify-center h-full text-center select-none">
                        <p className="text-[13px] text-fg-secondary mb-3">
                            Ask anything about Bavium or generate workflows.
                        </p>
                        <Link
                            href="/chat"
                            onClick={onNavigate}
                            className="inline-flex items-center gap-1.5 text-xs text-brand-light hover:underline"
                        >
                            Open full chat
                            <ExternalLink size={10} />
                        </Link>

                        {!configLoading && !config && (
                            <div className="mt-4 flex items-center gap-1.5 text-xs text-status-warning">
                                <AlertCircle size={12} />
                                <Link href="/settings" className="text-brand-light underline">
                                    {settingsLocked ? "Unlock AI settings" : "Configure AI provider"}
                                </Link>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="pt-2">
                        <div className="mb-2 flex justify-end">
                            <button
                                type="button"
                                onClick={clearChat}
                                className="text-[11px] text-fg-muted hover:text-fg-secondary transition-colors"
                            >
                                Clear chat
                            </button>
                        </div>

                        {messages.map((msg) => (
                            <MiniMessage key={msg.id} message={msg} />
                        ))}

                        {isStreaming && messages[messages.length - 1]?.role === "user" && (
                            <div className="flex justify-start mb-2">
                                <div className="rounded-lg bg-tertiary border border-border-subtle px-3 py-1.5">
                                    <Loader2 size={12} className="animate-spin text-brand-light" />
                                </div>
                            </div>
                        )}

                        {error && (
                            <div className="mb-2 rounded-lg bg-status-error/10 border border-status-error/20 px-2.5 py-1.5 text-xs text-status-error">
                                {error.message}
                            </div>
                        )}

                        <div ref={messagesEndRef} />
                    </div>
                )}
            </div>

            {/* Input area */}
            <div className="shrink-0 border-t border-border-subtle bg-secondary p-3">
                <ChatAccessNotice
                    authState={authState}
                    walletAddress={walletAddress}
                    compact
                />
                <div className="flex flex-col bg-tertiary border border-border-default rounded-xl overflow-hidden px-2 pt-2 pb-1.5 shadow-sm transition-all focus-within:border-border-strong">
                    <textarea
                        ref={textareaRef}
                        className="w-full min-h-[36px] max-h-[100px] bg-transparent text-[13px] text-fg placeholder:text-fg-muted outline-none resize-none px-1"
                        placeholder={
                            config
                                ? "Ask anything..."
                                : settingsLocked
                                    ? "Unlock AI settings first"
                                    : "Configure AI in Settings first"
                        }
                        value={inputValue}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        disabled={!config || configLoading}
                        style={{ boxShadow: "none" }}
                    />
                    <div className="flex items-center justify-between mt-1">
                        <Link
                            href="/settings"
                            className="text-fg-muted hover:text-fg-secondary transition-colors"
                            aria-label="AI Settings"
                        >
                            <Settings size={12} />
                        </Link>
                        <div className="flex items-center gap-1.5">
                            {isStreaming && (
                                <button
                                    type="button"
                                    onClick={stop}
                                    className="w-6 h-6 flex items-center justify-center rounded-md text-fg-secondary hover:text-fg hover:bg-secondary transition-colors"
                                    aria-label="Stop generating"
                                >
                                    <Square size={10} />
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => void handleSend()}
                                disabled={isStreaming || !inputValue.trim() || !config}
                                className="w-6 h-6 flex items-center justify-center rounded-full bg-fg text-primary hover:opacity-85 disabled:opacity-40 transition-opacity"
                                aria-label="Send message"
                            >
                                {isStreaming ? (
                                    <Loader2 size={10} className="animate-spin" />
                                ) : (
                                    <ArrowUp size={10} className="stroke-[3px]" />
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
