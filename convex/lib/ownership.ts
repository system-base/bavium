export function normalizeOwnerAddress(address: string): string {
    return address.trim().toLowerCase();
}

export function ensureOwnership(ownerAddress: string, expectedOwner: string): void {
    if (normalizeOwnerAddress(ownerAddress) !== normalizeOwnerAddress(expectedOwner)) {
        throw new Error("Unauthorized resource access.");
    }
}
