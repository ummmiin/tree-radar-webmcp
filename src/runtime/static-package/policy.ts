export type RuntimePriority =
  "active-query" | "viewport" | "preload" | "background";

export type StaticPackageRuntimePolicy = Readonly<{
  cacheEntryLimit: number;
  estimatedParsedMultiplier: number;
  fetchConcurrency: number;
  hardCacheBytes: number;
  manifestTimeoutMs: number;
  maxManifestBytes: number;
  maxQueuedRequests: number;
  maxShardBytes: number;
  parseConcurrency: number;
  retryBaseDelaysMs: readonly number[];
  retryableStatuses: readonly number[];
  shardTimeoutMs: number;
  viewportPreloadRings: number;
  warningCacheBytes: number;
}>;

export const DEFAULT_RUNTIME_POLICY: StaticPackageRuntimePolicy = Object.freeze(
  {
    cacheEntryLimit: 12,
    estimatedParsedMultiplier: 3,
    fetchConcurrency: 3,
    hardCacheBytes: 12 * 1024 * 1024,
    manifestTimeoutMs: 10_000,
    maxManifestBytes: 512 * 1024,
    maxQueuedRequests: 24,
    maxShardBytes: 1024 * 1024,
    parseConcurrency: 1,
    retryBaseDelaysMs: Object.freeze([250, 1_000]),
    retryableStatuses: Object.freeze([408, 429, 500, 502, 503, 504]),
    shardTimeoutMs: 15_000,
    viewportPreloadRings: 1,
    warningCacheBytes: 8 * 1024 * 1024,
  },
);

export function createRuntimePolicy(
  overrides: Partial<StaticPackageRuntimePolicy> = {},
): StaticPackageRuntimePolicy {
  const policy = { ...DEFAULT_RUNTIME_POLICY, ...overrides };
  const positive = [
    policy.cacheEntryLimit,
    policy.fetchConcurrency,
    policy.parseConcurrency,
    policy.hardCacheBytes,
    policy.manifestTimeoutMs,
    policy.maxManifestBytes,
    policy.maxQueuedRequests,
    policy.maxShardBytes,
    policy.shardTimeoutMs,
    policy.warningCacheBytes,
  ];
  if (
    positive.some((value) => !Number.isInteger(value) || value <= 0) ||
    !Number.isFinite(policy.estimatedParsedMultiplier) ||
    policy.estimatedParsedMultiplier < 1 ||
    policy.warningCacheBytes > policy.hardCacheBytes ||
    !Number.isInteger(policy.viewportPreloadRings) ||
    policy.viewportPreloadRings < 0 ||
    policy.retryBaseDelaysMs.some(
      (value) => !Number.isInteger(value) || value < 0,
    ) ||
    policy.retryableStatuses.some(
      (value) => !Number.isInteger(value) || value < 100 || value > 599,
    )
  )
    throw new Error("Invalid static package runtime policy.");
  return Object.freeze({
    ...policy,
    retryBaseDelaysMs: Object.freeze([...policy.retryBaseDelaysMs]),
    retryableStatuses: Object.freeze([...policy.retryableStatuses]),
  });
}
