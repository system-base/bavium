import type { NetworkId } from "@/lib/chain-config";

/* ==========================================================================
   Automation Types
   Core type definitions for the automation platform.
   ========================================================================== */

// ---------------------------------------------------------------------------
// Trigger types — what starts an automation
// ---------------------------------------------------------------------------

export type TriggerType = "price_below" | "price_above" | "scheduled";

/** Price-based trigger: fires when token price crosses a threshold */
export interface PriceTrigger {
    type: "price_below" | "price_above";
    /** Token symbol (e.g. "ETH", "BTC", "WETH") */
    token: string;
    /** USD price threshold */
    priceUsd: number;
}

/** Time-based trigger: fires on a cron schedule */
export interface ScheduledTrigger {
    type: "scheduled";
    /** Cron expression (e.g. "0 0 * * *" for daily at midnight UTC) */
    cron: string;
    /** Human-readable description (e.g. "Every day at 12:00 AM UTC") */
    cronDescription?: string;
}

export type Trigger = PriceTrigger | ScheduledTrigger;

// ---------------------------------------------------------------------------
// Action types — legacy compatibility payload
// ---------------------------------------------------------------------------

// NOTE:
// The canonical runtime model is now "trigger -> linked saved shortcut".
// `action` remains in the persisted shape as a compatibility field while the
// backend contract finishes converging on the linked-shortcut execution model.

export type ActionType = "swap" | "send" | "notify";

/** Legacy compatibility action: intended swap behavior, not the canonical runtime graph. */
export interface SwapAction {
    type: "swap";
    /** Token to sell (e.g. "USDC") */
    fromToken: string;
    /** Token to buy (e.g. "ETH") */
    toToken: string;
    /** Amount to spend in human-readable format (e.g. "50" for $50 USDC) */
    amount: string;
}

/** Send action: transfer tokens to an address */
export interface SendAction {
    type: "send";
    /** Token to send (e.g. "USDC", "ETH") */
    token: string;
    /** Amount to send */
    amount: string;
    /** Recipient address or ENS name */
    to: string;
}

/** Notify action: send a notification (email, webhook) */
export interface NotifyAction {
    type: "notify";
    /** Notification channel */
    channel: "email" | "webhook";
    /** Recipient (email address or webhook URL) */
    target: string;
    /** Custom message template (supports {{price}}, {{token}} variables) */
    message: string;
}

export type Action = SwapAction | SendAction | NotifyAction;

// ---------------------------------------------------------------------------
// Automation — the complete rule definition
// ---------------------------------------------------------------------------

export type AutomationStatus = "active" | "paused" | "completed" | "error";

export interface Automation {
    /** Unique automation ID */
    id: string;
    /** User-facing name */
    name: string;
    /** User-facing description */
    description?: string;
    /** Authenticated wallet address that owns this automation */
    accountAddress: string;
    /** Network this automation should execute on */
    networkId?: NetworkId;
    /** What triggers this automation */
    trigger: Trigger;
    /** Compatibility payload; runtime delegates to targetShortcutId */
    action: Action;
    /** Canonical saved shortcut backing this automation */
    targetShortcutId: string;
    /** Current status */
    status: AutomationStatus;
    /** Maximum number of times to execute (0 = unlimited) */
    maxExecutions: number;
    /** How many times this has executed */
    executionCount: number;
    /** ISO timestamp of creation */
    createdAt: string;
    /** ISO timestamp of last execution */
    lastExecutedAt?: string;
    /** ISO timestamp of last trigger evaluation that actually fired */
    lastTriggeredAt?: string;
    /** ISO timestamp of the next scheduled execution window */
    nextRunAt?: string;
    /** Last error message, if any */
    lastError?: string;
    /** Most recent persisted run id for this automation */
    lastRunId?: string;
}

// ---------------------------------------------------------------------------
// Execution log — history of automation runs
// ---------------------------------------------------------------------------

export interface ExecutionLog {
    id: string;
    automationId: string;
    /** Was the trigger condition met? */
    triggered: boolean;
    /** Did the action execute successfully? */
    success: boolean;
    /** Persisted run status for richer UI states */
    status?: "awaiting_signature" | "succeeded" | "failed" | "canceled" | "running" | "queued";
    /** Action result data (tx hash, notification id, etc.) */
    result?: Record<string, unknown>;
    /** Error message if failed */
    error?: string;
    /** ISO timestamp */
    executedAt: string;
    /** Price at time of check (for price triggers) */
    priceAtCheck?: number;
}
