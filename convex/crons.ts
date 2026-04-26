import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Trigger automation evaluation every 5 minutes.
// Convex owns the recurring schedule; the actual execution still runs
// on the Next.js app server via the secure /api/cron/check endpoint.
crons.interval(
    "run automation checks",
    { minutes: 5 },
    internal.scheduler.triggerAutomationCheck,
    {},
);

// Cleanup expired SIWE nonces every hour.
// The function generates its own Date.now() internally —
// cron args are evaluated at deploy time and must not contain dynamic values.
crons.hourly(
    "cleanup expired siwe nonces",
    { minuteUTC: 0 },
    internal.auth.cleanupExpiredNonces,
    {},
);

// Cleanup expired rate-limit windows every hour.
// Keeps the private-beta durable limiter bounded on Convex free tier.
crons.hourly(
    "cleanup expired rate limits",
    { minuteUTC: 15 },
    internal.auth.cleanupExpiredRateLimits,
    {},
);

// Cleanup old manual test runs daily at 03:00 UTC.
// Removes runs older than 30 days to prevent unbounded DB growth.
crons.daily(
    "cleanup old manual test runs",
    { hourUTC: 3, minuteUTC: 0 },
    internal.runs.cleanupOldRuns,
    {},
);

export default crons;
