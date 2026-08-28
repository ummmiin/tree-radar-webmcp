/**
 * Browser-safe shard and exact-species normalization contract shared by the
 * static-package builder and runtime consumers. Hashing remains environment
 * specific; both sides derive the shard from the same SHA-256 hex digest.
 */
export const STATIC_PACKAGE_SHARD_PREFIX_LENGTH = 2 as const;

export function normalizeSpeciesExactValue(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === ""
    ? null
    : trimmed.normalize("NFKC").replaceAll(/\s+/gu, " ");
}

export function shardKeyFromSha256(
  sha256: string,
  prefixLength: number = STATIC_PACKAGE_SHARD_PREFIX_LENGTH,
): string {
  if (!/^[a-f0-9]{64}$/u.test(sha256) || !Number.isInteger(prefixLength))
    throw new Error("Static package shard input is invalid.");
  return sha256.slice(0, prefixLength);
}
