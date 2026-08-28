import type { RuntimeCapability, RuntimePayload } from "./contracts.ts";
import { runtimeError } from "./errors.ts";
import { identityKey, type FileIdentity } from "./identity.ts";
import type { StaticPackageRuntimePolicy } from "./policy.ts";

type CacheEntry = {
  capability: RuntimeCapability;
  file: FileIdentity;
  lastAccess: number;
  payload: RuntimePayload;
  pinCount: number;
  size: number;
};

export class VerifiedMemoryCache {
  #entries = new Map<string, CacheEntry>();
  #admissionFailures = 0;
  #evictions = 0;
  #hits = 0;
  #misses = 0;
  #peakBytes = 0;
  #policy: StaticPackageRuntimePolicy;
  #sequence = 0;
  #totalBytes = 0;
  constructor(policy: StaticPackageRuntimePolicy) {
    this.#policy = policy;
  }
  get diagnostics() {
    return Object.freeze({
      entries: this.#entries.size,
      admissionFailures: this.#admissionFailures,
      estimatedBytes: this.#totalBytes,
      evictions: this.#evictions,
      hits: this.#hits,
      misses: this.#misses,
      peakEstimatedBytes: this.#peakBytes,
      pinnedEntries: [...this.#entries.values()].filter(
        (entry) => entry.pinCount > 0,
      ).length,
      pins: [...this.#entries.values()].reduce(
        (total, entry) => total + entry.pinCount,
        0,
      ),
    });
  }
  #key(file: FileIdentity, capability: RuntimeCapability): string {
    return `${identityKey(file)}:${capability}`;
  }
  get(
    file: FileIdentity,
    capability: RuntimeCapability,
  ): RuntimePayload | undefined {
    const entry = this.#entries.get(this.#key(file, capability));
    if (!entry) {
      this.#misses += 1;
      return undefined;
    }
    this.#hits += 1;
    entry.lastAccess = ++this.#sequence;
    return entry.payload;
  }
  admit(
    file: FileIdentity,
    capability: RuntimeCapability,
    payload: RuntimePayload,
  ): RuntimePayload {
    const key = this.#key(file, capability);
    const size = Math.ceil(file.bytes * this.#policy.estimatedParsedMultiplier);
    if (size > this.#policy.hardCacheBytes) {
      this.#admissionFailures += 1;
      throw runtimeError({ code: "memory_budget_exceeded", phase: "cache" });
    }
    const existing = this.#entries.get(key);
    if (existing) return existing.payload;
    this.#evictFor(size);
    if (
      this.#totalBytes + size > this.#policy.hardCacheBytes ||
      this.#entries.size >= this.#policy.cacheEntryLimit
    ) {
      this.#admissionFailures += 1;
      throw runtimeError({ code: "memory_budget_exceeded", phase: "cache" });
    }
    this.#entries.set(key, {
      capability,
      file,
      lastAccess: ++this.#sequence,
      payload,
      pinCount: 0,
      size,
    });
    this.#totalBytes += size;
    this.#peakBytes = Math.max(this.#peakBytes, this.#totalBytes);
    this.#evictToWarning();
    return payload;
  }
  pin(file: FileIdentity, capability: RuntimeCapability): () => void {
    const entry = this.#entries.get(this.#key(file, capability));
    if (!entry)
      return () => {
        return;
      };
    entry.pinCount += 1;
    return () => {
      entry.pinCount = Math.max(0, entry.pinCount - 1);
      this.#evictToWarning();
    };
  }
  #evictFor(incoming: number): void {
    while (
      (this.#entries.size >= this.#policy.cacheEntryLimit ||
        this.#totalBytes + incoming > this.#policy.hardCacheBytes) &&
      this.#evictOne()
    ) {
      /* bounded */
    }
  }
  #evictToWarning(): void {
    while (
      (this.#entries.size > this.#policy.cacheEntryLimit ||
        this.#totalBytes > this.#policy.warningCacheBytes) &&
      this.#evictOne()
    ) {
      /* LRU */
    }
  }
  #evictOne(): boolean {
    const candidate = [...this.#entries.entries()]
      .filter(([, entry]) => entry.pinCount === 0)
      .sort(([, left], [, right]) => left.lastAccess - right.lastAccess)[0];
    if (!candidate) return false;
    this.#entries.delete(candidate[0]);
    this.#totalBytes -= candidate[1].size;
    this.#evictions += 1;
    return true;
  }
  clear(): void {
    this.#entries.clear();
    this.#totalBytes = 0;
  }
}
