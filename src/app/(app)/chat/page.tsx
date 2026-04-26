"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
    Settings,
    ChevronRight,
    Loader2,
    ArrowUp,
    Square,
    Wrench,
    AlertCircle,
} from "lucide-react";
import Link from "next/link";
import { BaviumLogo } from "@/components/ui/BaviumLogo";
import type { UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
    MentionDropdown,
    type ShortcutOption,
} from "@/components/chat/MentionDropdown";
import {
    ShortcutDraftErrorCard,
    ShortcutPreview,
} from "@/components/chat/ShortcutPreview";
import { ChatAccessNotice } from "@/components/chat/ChatAccessNotice";
import { useAIChat } from "@/contexts/AIChatContext";
import { isShortcutDraftOutput } from "@/lib/builder-ai-handoff";

const EXAMPLES = [
    "Send USDC if ETH drops below $2000",
    "Deposit 50% of my ETH into Morpho weekly",
    "Get price of ETH and notify me via webhook",
    "What skills are available for trading?",
];

// ---------------------------------------------------------------------------
// @ mention detection
// ---------------------------------------------------------------------------

function getMentionContext(value: string, cursorPos: number) {
    const before = value.slice(0, cursorPos);
    const match = before.match(/@(\w*)$/);
    if (!match) return null;
    return {
        query: match[1],
        startIndex: before.length - match[0].length,
    };
}

// ---------------------------------------------------------------------------
// Message bubble components
// ---------------------------------------------------------------------------

function TextPart({ text, isUser }: { text: string; isUser: boolean }) {
    if (isUser) {
        const parts = text.split(/(@\w[\w\s]*?\b)/g);
        return (
            <span className="whitespace-pre-wrap break-words">
                {parts.map((segment, i) =>
                    segment.startsWith("@") ? (
                        <span
                            key={i}
                            className="inline-flex items-center gap-0.5 px-1 rounded bg-brand-subtle text-brand-light font-medium"
                        >
                            {segment}
                        </span>
                    ) : (
                        <span key={i}>{segment}</span>
                    ),
                )}
            </span>
        );
    }

    return (
        <div className="prose-chat break-words">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
    );
}

function isCreateShortcutOutput(
    v: unknown,
): v is { success: boolean; shortcutId?: string; message: string } {
    return (
        typeof v === "object" &&
        v !== null &&
        "success" in v &&
        "message" in v &&
        !("steps" in v)
    );
}

function ToolInvocationPart({
    part,
}: {
    part: {
        type: string;
        toolCallId: string;
        state: string;
        input?: unknown;
        output?: unknown;
    };
}) {
    const toolName = part.type.replace(/^tool-/, "");
    const isRunning =
        part.state === "input-streaming" || part.state === "call";
    const isDone =
        part.state === "output" || part.state === "output-available";

    if (toolName === "generateShortcutDraft" && isDone) {
        if (isShortcutDraftOutput(part.output)) {
            return <ShortcutPreview data={part.output} />;
        }

        return (
            <ShortcutDraftErrorCard message="The AI finished without a valid Builder draft. Try again with a shorter workflow, or ask it to use available blocks." />
        );
    }

    if (toolName === "createShortcut" && isDone && isCreateShortcutOutput(part.output)) {
        const out = part.output;
        return (
            <div className={`my-2 rounded-xl border p-4 ${out.success ? "border-status-success/20 bg-status-success/5" : "border-status-error/20 bg-status-error/5"}`}>
                <div className="flex items-center gap-2 mb-1">
                    {out.success ? (
                        <span className="text-status-success text-sm font-medium">Shortcut Saved</span>
                    ) : (
                        <span className="text-status-error text-sm font-medium">Save Failed</span>
                    )}
                </div>
                <p className="text-xs text-fg-secondary">{out.message}</p>
                {out.success && (
                    <Link
                        href="/shortcuts"
                        className="inline-flex items-center gap-1.5 mt-2 text-xs text-brand-light hover:underline"
                    >
                        View in Shortcuts
                        <ChevronRight size={12} />
                    </Link>
                )}
            </div>
        );
    }

    return (
        <div className="my-2 rounded-lg bg-tertiary border border-border-subtle p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-fg-secondary mb-1">
                <Wrench size={12} className="text-brand-light" />
                <span>{toolName}</span>
                {isRunning && (
                    <Loader2
                        size={12}
                        className="animate-spin text-brand-light"
                    />
                )}
                {isDone && (
                    <span className="text-status-success">done</span>
                )}
            </div>
            {part.output != null && (
                <details className="mt-1">
                    <summary className="text-xs text-fg-muted cursor-pointer hover:text-fg-secondary">
                        View result
                    </summary>
                    <pre className="mt-1 text-xs text-fg-secondary overflow-x-auto max-h-48 overflow-y-auto">
                        {typeof part.output === "string"
                            ? part.output
                            : JSON.stringify(part.output, null, 2)}
                    </pre>
                </details>
            )}
        </div>
    );
}

function MessageBubble({ message }: { message: UIMessage }) {
    const isUser = message.role === "user";

    return (
        <div
            className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}
        >
            <div
                className={`max-w-[92%] sm:max-w-[85%] rounded-xl px-3 sm:px-4 py-2 sm:py-2.5 text-sm leading-relaxed ${
                    isUser
                        ? "bg-brand-subtle text-fg"
                        : "bg-secondary border border-border-subtle text-fg"
                }`}
            >
                {message.parts.map((part, i) => {
                    if (part.type === "text") {
                        return <TextPart key={i} text={part.text} isUser={isUser} />;
                    }
                    if (part.type.startsWith("tool-")) {
                        const toolPart = part as {
                            type: string;
                            toolCallId: string;
                            state: string;
                            input?: unknown;
                            output?: unknown;
                        };
                        return (
                            <ToolInvocationPart key={i} part={toolPart} />
                        );
                    }
                    if (part.type === "reasoning") {
                        const rp = part as { text: string };
                        return (
                            <details key={i} className="my-1">
                                <summary className="text-xs text-fg-muted cursor-pointer">
                                    Thinking...
                                </summary>
                                <p className="text-xs text-fg-secondary mt-1 whitespace-pre-wrap">
                                    {rp.text}
                                </p>
                            </details>
                        );
                    }
                    return null;
                })}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main chat page
// ---------------------------------------------------------------------------

export default function ChatPage() {
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
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [inputValue, setInputValue] = useState("");

    // @ mention state
    const [mentionVisible, setMentionVisible] = useState(false);
    const [mentionQuery, setMentionQuery] = useState("");
    const [mentionStart, setMentionStart] = useState(0);
    const [mentionIndex, setMentionIndex] = useState(0);
    const mentionSelectRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const handleMentionSelect = useCallback(
        (shortcut: ShortcutOption) => {
            const before = inputValue.slice(0, mentionStart);
            const after = inputValue.slice(
                mentionStart + mentionQuery.length + 1,
            );
            const mention = `@${shortcut.name} `;
            setInputValue(before + mention + after);
            setMentionVisible(false);
            textareaRef.current?.focus();
        },
        [inputValue, mentionStart, mentionQuery],
    );

    const handleInputChange = useCallback(
        (e: React.ChangeEvent<HTMLTextAreaElement>) => {
            const val = e.target.value;
            setInputValue(val);

            // Auto-resize textarea (min 40px, max 120px)
            const el = e.target;
            el.style.height = "auto";
            el.style.height = `${Math.min(Math.max(el.scrollHeight, 40), 120)}px`;

            const cursor = e.target.selectionStart ?? val.length;
            const ctx = getMentionContext(val, cursor);
            if (ctx) {
                setMentionQuery(ctx.query);
                setMentionStart(ctx.startIndex);
                setMentionVisible(true);
                setMentionIndex(0);
            } else {
                setMentionVisible(false);
            }
        },
        [],
    );

    const handleSend = useCallback(async () => {
        const text = inputValue.trim();
        if (!text || isStreaming || !config) return;

        setInputValue("");
        setMentionVisible(false);
        await sendTextMessage(text);
    }, [inputValue, isStreaming, config, sendTextMessage]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (mentionVisible) {
                if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setMentionIndex((prev) => prev + 1);
                    return;
                }
                if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setMentionIndex((prev) => Math.max(0, prev - 1));
                    return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    mentionSelectRef.current?.();
                    return;
                }
                if (e.key === "Escape") {
                    e.preventDefault();
                    setMentionVisible(false);
                    return;
                }
            }

            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
            }
        },
        [handleSend, mentionVisible],
    );

    const handleExampleClick = useCallback((example: string) => {
        setInputValue(example);
        textareaRef.current?.focus();
    }, []);

    const hasMessages = messages.length > 0;

    return (
        <div className="mx-auto flex h-[calc(100dvh-var(--height-header)-2rem)] w-full max-w-5xl flex-col pt-1 sm:h-[calc(100dvh-var(--height-header)-3rem)] sm:pt-2 lg:h-[calc(100dvh-var(--height-header)-4rem)]">
            {/* Header */}
            <div className="shrink-0 pb-2 sm:pb-4">
                <div className="flex items-start justify-between gap-3 mb-1">
                    <div className="flex items-center gap-4">
                        <BaviumLogo className="hidden h-10 w-auto text-fg sm:block" />
                        <div>
                            <div className="flex items-center gap-2 mb-1 sm:mb-2">
                                <h1 className="text-[22px] sm:text-[24px] font-bold tracking-tight text-fg">Agent</h1>
                                <div className="px-2 py-0.5 rounded border border-brand/20 bg-brand/5 text-[11px] font-bold tracking-widest text-brand-light uppercase shadow-sm mt-1">
                                    AI
                                </div>
                            </div>
                            <p className="hidden text-[15px] text-fg-secondary leading-relaxed max-w-[500px] sm:block">
                                Generate Base workflows or ask anything about the ecosystem
                            </p>
                        </div>
                    </div>
                    {hasMessages && (
                        <button
                            type="button"
                            onClick={clearChat}
                            className="mt-1 text-xs text-fg-muted hover:text-fg-secondary transition-colors"
                        >
                            Clear chat
                        </button>
                    )}
                </div>
            </div>

            {/* Messages area */}
            <div className="flex-1 min-h-0 overflow-y-auto px-1 pb-2">
                {!hasMessages ? (
                    <div className="flex flex-col items-center justify-center h-full w-full max-w-[760px] mx-auto">
                        {/* Center Icon Removed per Audit */}
                        <p className="text-fg-secondary text-sm text-center mb-6 max-w-sm">
                            Describe what you want to build, ask about
                            available skills, or reference saved shortcuts with{" "}
                            <kbd className="px-1.5 py-0.5 rounded bg-tertiary border border-border-subtle text-xs font-mono">
                                @
                            </kbd>
                        </p>

                        <div className="flex flex-col gap-2 w-full max-w-md">
                            {EXAMPLES.map((example) => (
                                <button
                                    key={example}
                                    type="button"
                                    onClick={() => handleExampleClick(example)}
                                    className="w-full text-left flex items-start gap-2.5 px-4 py-3 rounded-xl bg-secondary border border-border-subtle text-sm text-fg-secondary hover:text-fg hover:border-brand-light/30 transition-all"
                                >
                                    <ChevronRight
                                        size={14}
                                        className="text-brand-light mt-0.5 shrink-0"
                                    />
                                    <span>{example}</span>
                                </button>
                            ))}
                        </div>

                        {!configLoading && !config && (
                            <div className="mt-6 flex items-center gap-2 text-sm text-status-warning">
                                <AlertCircle size={14} />
                                <span>
                                    {settingsLocked ? "Unlock AI settings in " : "Configure an AI provider in "}
                                    <Link
                                        href="/settings"
                                        className="text-brand-light underline"
                                    >
                                        Settings
                                    </Link>
                                </span>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="py-2 w-full max-w-[760px] mx-auto">
                        {messages.map((msg) => (
                            <MessageBubble key={msg.id} message={msg} />
                        ))}

                        {isStreaming &&
                            messages[messages.length - 1]?.role ===
                                "user" && (
                                <div className="flex justify-start mb-3">
                                    <div className="rounded-xl bg-secondary border border-border-subtle px-4 py-2.5">
                                        <Loader2
                                            size={14}
                                            className="animate-spin text-brand-light"
                                        />
                                    </div>
                                </div>
                            )}

                        {error && (
                            <div
                                className="flex justify-start mb-3"
                                role="alert"
                                aria-live="polite"
                            >
                                <div className="max-w-[85%] rounded-xl bg-status-error/10 border border-status-error/20 px-4 py-2.5 text-sm text-status-error">
                                    <div className="flex items-center gap-2 mb-1">
                                        <AlertCircle size={14} />
                                        <span className="font-medium">
                                            Error
                                        </span>
                                    </div>
                                    <p>{error.message}</p>
                                </div>
                            </div>
                        )}

                        <div ref={messagesEndRef} />
                    </div>
                )}
            </div>

            {/* Input area */}
            <div className="shrink-0 border-t border-border-subtle bg-primary px-1 py-2 sm:py-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
                <div className="w-full max-w-[760px] mx-auto">
                    <ChatAccessNotice
                        authState={authState}
                        walletAddress={walletAddress}
                    />
                </div>
                <div className="relative w-full max-w-[760px] mx-auto rounded-xl bg-secondary border border-border-subtle p-3">
                    <MentionDropdown
                        query={mentionQuery}
                        visible={mentionVisible}
                        onSelect={handleMentionSelect}
                        onClose={() => setMentionVisible(false)}
                        selectedIndex={mentionIndex}
                        confirmRef={mentionSelectRef}
                    />

                    <label htmlFor="chat-prompt" className="sr-only">
                        Message
                    </label>
                    <textarea
                        ref={textareaRef}
                        id="chat-prompt"
                        className="w-full min-h-[40px] max-h-[120px] resize-none bg-transparent text-sm text-fg placeholder:text-fg-muted outline-none"
                        placeholder={
                            config
                                ? "Type a message... Use @ to reference shortcuts"
                                : settingsLocked
                                    ? "Unlock AI settings first"
                                    : "Configure an AI provider in Settings first"
                        }
                        value={inputValue}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        onBlur={() => {
                            setTimeout(() => setMentionVisible(false), 150);
                        }}
                        disabled={!config || configLoading}
                        aria-expanded={mentionVisible}
                        aria-haspopup="listbox"
                    />
                    <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-fg-muted">
                            <Link
                                href="/settings"
                                className="text-brand-light hover:underline inline-flex items-center gap-1"
                            >
                                <Settings size={11} />
                                AI Settings
                            </Link>
                        </span>
                        <div className="flex items-center gap-2">
                            {isStreaming && (
                                <button
                                    type="button"
                                    onClick={stop}
                                    className="h-8 w-8 flex items-center justify-center rounded-lg text-fg-secondary hover:text-fg hover:bg-tertiary transition-colors"
                                    aria-label="Stop generating"
                                >
                                    <Square size={14} />
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => void handleSend()}
                                disabled={
                                    isStreaming ||
                                    !inputValue.trim() ||
                                    !config
                                }
                                className="h-8 w-8 flex items-center justify-center rounded-lg bg-fg text-primary hover:opacity-85 disabled:opacity-40 transition-opacity"
                                aria-label="Send message"
                            >
                                {isStreaming ? (
                                    <Loader2
                                        size={14}
                                        className="animate-spin"
                                    />
                                ) : (
                                    <ArrowUp
                                        size={14}
                                        className="stroke-[3px]"
                                    />
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
