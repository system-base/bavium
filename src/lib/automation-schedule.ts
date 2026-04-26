/* ==========================================================================
   Automation Schedule Helpers
   Shared cron helpers for scheduled automation creation and execution.
   ========================================================================== */

function matchCronField(field: string, value: number, min: number, max: number): boolean {
    if (field === "*") return true;

    if (field.includes("/")) {
        const [rangeStr, stepStr] = field.split("/");
        const step = parseInt(stepStr, 10);
        if (Number.isNaN(step) || step <= 0) return false;

        const start = rangeStr === "*" ? min : parseInt(rangeStr, 10);
        if (Number.isNaN(start) || start < min || start > max) return false;

        for (let candidate = start; candidate <= max; candidate += step) {
            if (candidate === value) return true;
        }
        return false;
    }

    if (field.includes(",")) {
        return field
            .split(",")
            .some((part) => matchCronField(part.trim(), value, min, max));
    }

    if (field.includes("-")) {
        const [lo, hi] = field.split("-").map(Number);
        if (Number.isNaN(lo) || Number.isNaN(hi)) return false;
        return value >= lo && value <= hi;
    }

    const exact = parseInt(field, 10);
    return !Number.isNaN(exact) && exact === value;
}

export function matchesCronExpression(cron: string, date: Date): boolean {
    const fields = cron.trim().split(/\s+/);
    if (fields.length !== 5) return false;

    const [minuteF, hourF, domF, monthF, dowF] = fields;

    return (
        matchCronField(minuteF, date.getUTCMinutes(), 0, 59) &&
        matchCronField(hourF, date.getUTCHours(), 0, 23) &&
        matchCronField(domF, date.getUTCDate(), 1, 31) &&
        matchCronField(monthF, date.getUTCMonth() + 1, 1, 12) &&
        matchCronField(dowF, date.getUTCDay(), 0, 6)
    );
}

export function computeNextScheduledRunAt(
    cron: string,
    from: Date,
    options?: { inclusive?: boolean },
): string | null {
    const cursor = new Date(from);
    cursor.setUTCSeconds(0, 0);

    if (!options?.inclusive) {
        cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
    }

    const maxLookaheadMinutes = 366 * 24 * 60;
    for (let attempt = 0; attempt < maxLookaheadMinutes; attempt += 1) {
        if (matchesCronExpression(cron, cursor)) {
            return cursor.toISOString();
        }
        cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
    }

    return null;
}
