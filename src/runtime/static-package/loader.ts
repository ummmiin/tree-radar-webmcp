import {
  ClusterPayloadSchema,
  DetailPayloadSchema,
  OverviewPayloadSchema,
  PointPayloadSchema,
  SpeciesNameIndexPayloadSchema,
  SpeciesSearchPayloadSchema,
  type DescriptorSelector,
  type RuntimeCapability,
  type RuntimePayload,
} from "./contracts.ts";
import { VerifiedMemoryCache } from "./cache.ts";
import { selectDescriptor } from "./descriptor-selector.ts";
import { runtimeError } from "./errors.ts";
import { FetchQueue, type RuntimeTimers } from "./fetch-queue.ts";
import { GenerationController } from "./generation-controller.ts";
import {
  assertJsonMime,
  decodeUtf8,
  defaultCrypto,
  parseJson,
  readResponseBytes,
  sha256Hex,
  type WebCryptoLike,
} from "./integrity.ts";
import {
  fileIdentity,
  identityKey,
  type CacheNamespaceIdentity,
  type FileIdentity,
  type LoadGenerationIdentity,
} from "./identity.ts";
import {
  loadVerifiedManifest,
  type RuntimeFetch,
  type VerifiedManifest,
} from "./manifest-reader.ts";
import { ParseGate } from "./parse-gate.ts";
import {
  createRuntimePolicy,
  type RuntimePriority,
  type StaticPackageRuntimePolicy,
} from "./policy.ts";
import {
  assertResponseOrigin,
  resolveDescriptorUrl,
  type RuntimePackageTarget,
} from "./url-policy.ts";
import { materializeRuntimePackageTarget } from "../binding/contracts.ts";
import type { ResolvedRuntimeBinding } from "../binding/resolver.ts";

export type StaticPackageLoader = Readonly<{
  cancelGeneration(generationId: number): void;
  clearCache(): void;
  dispose(): void;
  getDiagnostics(): Readonly<Record<string, number | boolean>>;
  loadDescriptor(
    selector: DescriptorSelector,
    options?: Readonly<{ priority?: RuntimePriority; signal?: AbortSignal }>,
  ): Promise<RuntimePayload>;
  loadManifest(
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<VerifiedManifest>;
  replaceBinding(binding: ResolvedRuntimeBinding): void;
}>;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}

function mergedSignal(
  ...signals: readonly (AbortSignal | undefined)[]
): Readonly<{ dispose(): void; signal: AbortSignal }> {
  const controller = new AbortController();
  const abort = () => {
    controller.abort();
  };
  for (const signal of signals)
    signal?.addEventListener("abort", abort, { once: true });
  return Object.freeze({
    dispose: () => {
      for (const signal of signals) signal?.removeEventListener("abort", abort);
    },
    signal: controller.signal,
  });
}

function parsePayload(
  selector: DescriptorSelector,
  raw: unknown,
  verified: VerifiedManifest,
  descriptorRecordCount: number,
): RuntimePayload {
  const fail = () =>
    runtimeError({ code: "payload_schema_invalid", phase: "file" });
  switch (selector.capability) {
    case "overview": {
      const result = OverviewPayloadSchema.safeParse(raw);
      if (!result.success) throw fail();
      if (
        result.data.artifactSha256 !== verified.manifest.artifactSha256 ||
        result.data.recordCount !== verified.manifest.recordCount ||
        descriptorRecordCount !== 0
      )
        throw runtimeError({
          code: "payload_identity_mismatch",
          phase: "file",
        });
      return deepFreeze(result.data);
    }
    case "cluster": {
      const result = ClusterPayloadSchema.safeParse(raw);
      if (!result.success) throw fail();
      if (
        result.data.artifactSha256 !== verified.manifest.artifactSha256 ||
        result.data.zoom !== selector.zoom ||
        result.data.clusters.length !== descriptorRecordCount
      )
        throw runtimeError({
          code: "payload_identity_mismatch",
          phase: "file",
        });
      return deepFreeze(result.data);
    }
    case "point": {
      const result = PointPayloadSchema.safeParse(raw);
      if (!result.success) throw fail();
      const tile = result.data.tile;
      if (
        result.data.artifactSha256 !== verified.manifest.artifactSha256 ||
        tile.zoom !== selector.tile.zoom ||
        tile.x !== selector.tile.x ||
        tile.y !== selector.tile.y ||
        result.data.records.length !== descriptorRecordCount
      )
        throw runtimeError({
          code: "payload_identity_mismatch",
          phase: "file",
        });
      return deepFreeze(result.data);
    }
    case "detail": {
      const result = DetailPayloadSchema.safeParse(raw);
      if (!result.success) throw fail();
      if (
        result.data.artifactSha256 !== verified.manifest.artifactSha256 ||
        result.data.shard !== selector.shard ||
        result.data.records.length !== descriptorRecordCount
      )
        throw runtimeError({
          code: "payload_identity_mismatch",
          phase: "file",
        });
      return deepFreeze(result.data);
    }
    case "species-search": {
      const result = SpeciesSearchPayloadSchema.safeParse(raw);
      if (!result.success) throw fail();
      if (
        result.data.artifactSha256 !== verified.manifest.artifactSha256 ||
        result.data.shard !== selector.shard ||
        Object.keys(result.data.entries).length !== descriptorRecordCount
      )
        throw runtimeError({
          code: "payload_identity_mismatch",
          phase: "file",
        });
      return deepFreeze(result.data);
    }
    case "species-name-index": {
      const result = SpeciesNameIndexPayloadSchema.safeParse(raw);
      if (!result.success) throw fail();
      if (
        result.data.artifactSha256 !== verified.manifest.artifactSha256 ||
        result.data.names.length !== descriptorRecordCount ||
        result.data.names.some(
          (name, index) =>
            index > 0 && name <= (result.data.names[index - 1] ?? ""),
        )
      )
        throw runtimeError({
          code: "payload_identity_mismatch",
          phase: "file",
        });
      return deepFreeze(result.data);
    }
  }
}

async function fetchFile(
  input: Readonly<{
    crypto: WebCryptoLike | undefined;
    descriptor: Readonly<{ bytes: number; path: string; sha256: string }>;
    fetcher: RuntimeFetch;
    generationSignal: AbortSignal;
    policy: StaticPackageRuntimePolicy;
    queueSignal: AbortSignal;
    target: RuntimePackageTarget;
    verified: VerifiedManifest;
  }>,
): Promise<unknown> {
  const signals = mergedSignal(input.generationSignal, input.queueSignal);
  const controller = new AbortController();
  const abort = () => {
    controller.abort();
  };
  signals.signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => {
    controller.abort();
  }, input.policy.shardTimeoutMs);
  try {
    let response: Response;
    try {
      response = await input.fetcher(
        resolveDescriptorUrl(input.target, input.descriptor.path),
        { redirect: "error", signal: controller.signal },
      );
    } catch (cause) {
      if (controller.signal.aborted) {
        const code =
          input.queueSignal.aborted || input.generationSignal.aborted
            ? "request_aborted"
            : "request_timeout";
        throw runtimeError({
          code,
          phase: "file",
          retryable: code === "request_timeout",
          cause,
        });
      }
      throw runtimeError({
        code: "file_fetch_failed",
        phase: "file",
        retryable: true,
        cause,
      });
    }
    if (response.redirected)
      throw runtimeError({ code: "redirect_rejected", phase: "file" });
    assertResponseOrigin(
      response.url ||
        resolveDescriptorUrl(input.target, input.descriptor.path).toString(),
      input.verified.trust,
      "file",
    );
    if (response.status === 404)
      throw runtimeError({ code: "file_not_found", phase: "file" });
    if (!response.ok)
      throw runtimeError({
        code: "file_fetch_failed",
        phase: "file",
        retryable: input.policy.retryableStatuses.includes(response.status),
        diagnostic: { status: response.status },
      });
    assertJsonMime(response, "file");
    const bytes = await readResponseBytes(
      response,
      input.policy.maxShardBytes,
      "file",
    );
    if (bytes.byteLength !== input.descriptor.bytes)
      throw runtimeError({ code: "file_size_mismatch", phase: "file" });
    if ((await sha256Hex(bytes, input.crypto)) !== input.descriptor.sha256)
      throw runtimeError({ code: "file_integrity_mismatch", phase: "file" });
    return parseJson(decodeUtf8(bytes, "file"), "file");
  } finally {
    clearTimeout(timeout);
    signals.signal.removeEventListener("abort", abort);
    signals.dispose();
  }
}

export function createStaticPackageLoader(
  input: Readonly<{
    binding: ResolvedRuntimeBinding;
    crypto?: WebCryptoLike | undefined;
    fetch?: RuntimeFetch | undefined;
    policy?: Partial<StaticPackageRuntimePolicy> | undefined;
    random?: (() => number) | undefined;
    timers?: RuntimeTimers | undefined;
  }>,
): StaticPackageLoader {
  let bindingRevision = 0;
  let target = materializeRuntimePackageTarget(input.binding);
  const policy = createRuntimePolicy(input.policy);
  const crypto = input.crypto ?? defaultCrypto();
  // Browser fetch can require its global receiver; retain it through the
  // wrapper instead of invoking a detached function reference.
  const fetcher: RuntimeFetch =
    input.fetch ?? ((request, init) => globalThis.fetch(request, init));
  const cache = new VerifiedMemoryCache(policy);
  const queue = new FetchQueue(
    policy,
    input.random || input.timers
      ? {
          ...(input.random ? { random: input.random } : {}),
          ...(input.timers ? { timers: input.timers } : {}),
        }
      : {},
  );
  const generations = new GenerationController();
  let disposed = false;
  let parsedPayloads = 0;
  let current:
    | Readonly<{
        generation: LoadGenerationIdentity;
        verified: VerifiedManifest;
      }>
    | undefined;
  let manifestPromise: Promise<VerifiedManifest> | undefined;
  const parseGate = new ParseGate(policy.parseConcurrency);

  const withCachePin = <T>(
    identity: FileIdentity,
    capability: RuntimeCapability,
    value: T,
  ): T => {
    const release = cache.pin(identity, capability);
    try {
      return value;
    } finally {
      release();
    }
  };

  const loadManifest = async (
    options: Readonly<{ signal?: AbortSignal | undefined }> = {},
  ): Promise<VerifiedManifest> => {
    if (disposed)
      throw runtimeError({ code: "loader_disposed", phase: "loader" });
    const revision = bindingRevision;
    const manifestTarget = target;
    manifestPromise ??= loadVerifiedManifest({
      ...(crypto ? { crypto } : {}),
      fetch: fetcher,
      policy,
      ...(options.signal ? { signal: options.signal } : {}),
      target: manifestTarget,
    });
    try {
      const verified = await manifestPromise;
      if (revision !== bindingRevision)
        throw runtimeError({
          code: "generation_superseded",
          phase: "generation",
        });
      const cacheNamespace: CacheNamespaceIdentity = Object.freeze({
        manifestTrust: verified.trust,
        runtimePackage: verified.runtimePackage,
      });
      if (
        current &&
        generations.isActive(current.generation) &&
        identityKey(current.generation.cacheNamespace) ===
          identityKey(cacheNamespace) &&
        identityKey(current.verified.compatibility) ===
          identityKey(verified.compatibility)
      )
        return current.verified;
      const generation = generations.begin({ cacheNamespace });
      current = Object.freeze({ generation, verified });
      return verified;
    } finally {
      manifestPromise = undefined;
    }
  };

  const loadDescriptor = async (
    selector: DescriptorSelector,
    options: Readonly<{
      priority?: RuntimePriority | undefined;
      signal?: AbortSignal | undefined;
    }> = {},
  ): Promise<RuntimePayload> => {
    if (disposed)
      throw runtimeError({ code: "loader_disposed", phase: "loader" });
    if (!current)
      await loadManifest(options.signal ? { signal: options.signal } : {});
    const active = current;
    const activeTarget = target;
    if (!active || !generations.isActive(active.generation))
      throw runtimeError({
        code: "generation_superseded",
        phase: "generation",
      });
    const selected = selectDescriptor(active.verified.manifest, selector);
    const identity: FileIdentity = fileIdentity(
      active.generation.cacheNamespace,
      selected.descriptor,
    );
    const hit = cache.get(identity, selected.capability);
    if (hit) return withCachePin(identity, selected.capability, hit);
    const key = `${String(active.generation.sequence)}:${identity.path}:${identity.sha256}:${selected.capability}`;
    const raw = await queue.enqueue({
      execute: (queueSignal) =>
        fetchFile({
          crypto,
          descriptor: selected.descriptor,
          fetcher,
          generationSignal: generations.signal(active.generation),
          policy,
          queueSignal,
          target: activeTarget,
          verified: active.verified,
        }),
      key,
      priority: options.priority ?? "active-query",
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return parseGate.run(() =>
      Promise.resolve().then(() => {
        if (!generations.isActive(active.generation))
          throw runtimeError({
            code: "generation_superseded",
            phase: "generation",
          });
        const payload = parsePayload(
          selector,
          raw,
          active.verified,
          selected.descriptor.recordCount,
        );
        parsedPayloads += 1;
        if (!generations.isActive(active.generation))
          throw runtimeError({
            code: "generation_superseded",
            phase: "generation",
          });
        return withCachePin(
          identity,
          selected.capability,
          cache.admit(identity, selected.capability, payload),
        );
      }),
    );
  };

  return Object.freeze({
    cancelGeneration: (generationId) => {
      generations.cancel(generationId);
    },
    clearCache: () => {
      cache.clear();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      generations.dispose();
      queue.dispose();
      parseGate.dispose();
      cache.clear();
    },
    getDiagnostics: () =>
      Object.freeze({
        disposed,
        ...queue.diagnostics,
        cacheEntries: cache.diagnostics.entries,
        cacheAdmissionFailures: cache.diagnostics.admissionFailures,
        estimatedCacheBytes: cache.diagnostics.estimatedBytes,
        cacheHits: cache.diagnostics.hits,
        cacheMisses: cache.diagnostics.misses,
        cacheEvictions: cache.diagnostics.evictions,
        peakEstimatedCacheBytes: cache.diagnostics.peakEstimatedBytes,
        pinnedCacheEntries: cache.diagnostics.pinnedEntries,
        cachePins: cache.diagnostics.pins,
        parsedPayloads,
        ...parseGate.diagnostics,
        ...generations.diagnostics,
        generation: current?.generation.sequence ?? 0,
      }),
    loadDescriptor,
    loadManifest,
    replaceBinding: (binding) => {
      if (disposed) return;
      bindingRevision += 1;
      target = materializeRuntimePackageTarget(binding);
      if (current) generations.cancel(current.generation.sequence);
      current = undefined;
      manifestPromise = undefined;
    },
  });
}
