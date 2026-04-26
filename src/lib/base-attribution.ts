import { concat, numberToHex, stringToHex, type Hex } from "viem";

const ERC_8021_SUFFIX = "0x80218021802180218021802180218021" as const;

function normalizeBuilderCodes(rawValue: string | undefined): string[] {
    if (!rawValue) return [];

    return rawValue
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
}

function toByteLength(hex: Hex): number {
    return (hex.length - 2) / 2;
}

export function buildBuilderCodeDataSuffix(codes: readonly string[]): Hex | undefined {
    if (codes.length === 0) return undefined;

    const joinedCodes = codes.join(",");
    const codesHex = stringToHex(joinedCodes);
    const codesLength = toByteLength(codesHex);

    if (codesLength > 255) {
        return undefined;
    }

    return concat([
        codesHex,
        numberToHex(codesLength, { size: 1 }),
        numberToHex(0, { size: 1 }),
        ERC_8021_SUFFIX,
    ]);
}

export function getConfiguredBuilderCodeDataSuffix(): Hex | undefined {
    const codes = normalizeBuilderCodes(process.env.NEXT_PUBLIC_BASE_BUILDER_CODE);
    return buildBuilderCodeDataSuffix(codes);
}

