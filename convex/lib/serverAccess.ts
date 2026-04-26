function safeCharCodeAt(value: string, index: number): number {
    const code = value.charCodeAt(index);
    return Number.isNaN(code) ? 0 : code;
}

function constantTimeEquals(left: string, right: string): boolean {
    const maxLength = Math.max(left.length, right.length);
    let mismatch = left.length ^ right.length;

    for (let index = 0; index < maxLength; index += 1) {
        mismatch |= safeCharCodeAt(left, index) ^ safeCharCodeAt(right, index);
    }

    return mismatch === 0;
}

export function assertServerAccess(serverSecret: string): void {
    const expected = process.env.CONVEX_SERVER_SECRET?.trim();

    if (!expected) {
        throw new Error("CONVEX_SERVER_SECRET is not configured.");
    }

    if (!constantTimeEquals(serverSecret, expected)) {
        throw new Error("Unauthorized Convex function access.");
    }
}
