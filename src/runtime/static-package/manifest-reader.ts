import { z } from "zod";

import {
  StaticPackageManifestSchema,
  StaticPackageManifestStructureSchema,
  type StaticPackageManifest,
} from "./contracts.ts";
import { runtimeError } from "./errors.ts";
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
  compatibilityIdentity,
  runtimePackageIdentity,
  type CompatibilityIdentity,
  type ManifestTrustIdentity,
  type RuntimePackageIdentity,
} from "./identity.ts";
import type { StaticPackageRuntimePolicy } from "./policy.ts";
import {
  assertResponseOrigin,
  resolveDescriptorUrl,
  resolveManifestUrl,
  validateTarget,
  type RuntimePackageTarget,
} from "./url-policy.ts";

export type RuntimeFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type VerifiedManifest = Readonly<{
  compatibility: CompatibilityIdentity;
  manifest: StaticPackageManifest;
  manifestSha256: string;
  runtimePackage: RuntimePackageIdentity;
  trust: ManifestTrustIdentity;
}>;

function stableJson(value: unknown): string {
  const normalize = (item: unknown, ancestors: Set<object>): unknown => {
    if (item === null || typeof item === "boolean" || typeof item === "string")
      return item;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new Error("Non-finite JSON number.");
      return item;
    }
    if (typeof item !== "object" || ancestors.has(item))
      throw new Error("Invalid stable JSON value.");
    ancestors.add(item);
    try {
      if (Array.isArray(item))
        return item.map((child) => normalize(child, ancestors));
      const normalized: Record<string, unknown> = {};
      for (const key of Object.keys(item).sort())
        normalized[key] = normalize(
          (item as Record<string, unknown>)[key],
          ancestors,
        );
      return normalized;
    } finally {
      ancestors.delete(item);
    }
  };
  return `${JSON.stringify(normalize(value, new Set()), null, 2)}\n`;
}

async function packageHash(
  manifest: StaticPackageManifest,
  crypto: WebCryptoLike | undefined,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    stableJson({
      artifactSha256: manifest.artifactSha256,
      files: manifest.files.map(({ path, sha256 }) => ({ path, sha256 })),
      packageVersion: manifest.packageVersion,
    }),
  );
  return sha256Hex(bytes, crypto);
}

function validateManifest(
  raw: unknown,
  target: RuntimePackageTarget,
): StaticPackageManifest {
  const structural = StaticPackageManifestStructureSchema.safeParse(raw);
  if (!structural.success)
    throw runtimeError({
      code: "manifest_schema_invalid",
      phase: "manifest",
      diagnostic: { issueCount: structural.error.issues.length },
    });
  const versions = structural.data;
  if (
    versions.packageVersion !== "1.0.0" ||
    versions.canonicalSchemaVersion !== "2.0.0" ||
    versions.clusterVersion !== "1.0.0" ||
    versions.detailVersion !== "1.0.0" ||
    versions.searchVersion !== "1.0.0"
  )
    throw runtimeError({
      code: "manifest_version_unsupported",
      phase: "manifest",
    });
  const parsed = StaticPackageManifestSchema.parse(structural.data);
  const manifest = parsed;
  let previousPath = "";
  const seen = new Set<string>();
  for (const descriptor of manifest.files) {
    if (seen.has(descriptor.path))
      throw runtimeError({ code: "descriptor_duplicate", phase: "manifest" });
    if (previousPath && descriptor.path <= previousPath)
      throw runtimeError({
        code: "manifest_schema_invalid",
        phase: "manifest",
        diagnostic: { reason: "descriptor_order" },
      });
    seen.add(descriptor.path);
    previousPath = descriptor.path;
    resolveDescriptorUrl(target, descriptor.path);
    if (
      !/^(?:overview|accounting|benchmark)\.json$/u.test(descriptor.path) &&
      !/^lookup\/exact-id\.json$/u.test(descriptor.path) &&
      !/^clusters\/z(?:10|12|14)\.json$/u.test(descriptor.path) &&
      !/^details\/[a-f0-9]{2}\.json$/u.test(descriptor.path) &&
      !/^points\/z15\/\d+-\d+\.json$/u.test(descriptor.path) &&
      !/^search\/species\/[a-f0-9]{2}\.json$/u.test(descriptor.path) &&
      descriptor.path !== "search/species-names.json"
    )
      throw runtimeError({ code: "unsafe_path", phase: "manifest" });
  }
  const counts = {
    clusters: manifest.files.filter(({ path }) => path.startsWith("clusters/"))
      .length,
    detail: manifest.files.filter(({ path }) => path.startsWith("details/"))
      .length,
    point: manifest.files.filter(({ path }) => path.startsWith("points/"))
      .length,
    search: manifest.files.filter(({ path }) => path.startsWith("search/"))
      .length,
  };
  if (
    Object.entries(counts).some(
      ([key, count]) =>
        manifest.shardCounts[key as keyof typeof counts] !== count,
    )
  )
    throw runtimeError({ code: "package_identity_invalid", phase: "manifest" });
  return Object.freeze({
    ...manifest,
    files: Object.freeze(
      manifest.files.map((descriptor) => Object.freeze({ ...descriptor })),
    ),
    shardCounts: Object.freeze({ ...manifest.shardCounts }),
  }) as unknown as StaticPackageManifest;
}

async function fetchWithTimeout(
  fetcher: RuntimeFetch,
  url: URL,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort("timeout");
  }, timeoutMs);
  const abort = () => {
    controller.abort(signal?.reason ?? "aborted");
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    return await fetcher(url, { redirect: "error", signal: controller.signal });
  } catch (cause) {
    if (controller.signal.aborted) {
      const code = signal?.aborted ? "request_aborted" : "request_timeout";
      throw runtimeError({
        code,
        phase: "manifest",
        retryable: code === "request_timeout",
        cause,
      });
    }
    throw runtimeError({
      code: "manifest_fetch_failed",
      phase: "manifest",
      retryable: true,
      cause,
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export async function loadVerifiedManifest(
  input: Readonly<{
    crypto?: WebCryptoLike | undefined;
    fetch?: RuntimeFetch | undefined;
    policy: StaticPackageRuntimePolicy;
    signal?: AbortSignal | undefined;
    target: RuntimePackageTarget;
  }>,
): Promise<VerifiedManifest> {
  const trust = validateTarget(input.target);
  const response = await fetchWithTimeout(
    input.fetch ?? fetch,
    resolveManifestUrl(input.target),
    input.policy.manifestTimeoutMs,
    input.signal,
  );
  if (response.redirected)
    throw runtimeError({ code: "redirect_rejected", phase: "manifest" });
  assertResponseOrigin(
    response.url || resolveManifestUrl(input.target).toString(),
    trust,
    "manifest",
  );
  if (response.status === 404)
    throw runtimeError({ code: "manifest_not_found", phase: "manifest" });
  if (!response.ok)
    throw runtimeError({
      code: "manifest_fetch_failed",
      phase: "manifest",
      retryable: input.policy.retryableStatuses.includes(response.status),
      diagnostic: { status: response.status },
    });
  assertJsonMime(response, "manifest");
  const bytes = await readResponseBytes(
    response,
    input.policy.maxManifestBytes,
    "manifest",
  );
  const manifestSha256 = await sha256Hex(
    bytes,
    input.crypto ?? defaultCrypto(),
  );
  if (manifestSha256 !== trust.expectedManifestSha256)
    throw runtimeError({
      code: "manifest_integrity_mismatch",
      phase: "manifest",
    });
  const manifest = validateManifest(
    parseJson(decodeUtf8(bytes, "manifest"), "manifest"),
    input.target,
  );
  const calculatedPackageHash = await packageHash(
    manifest,
    input.crypto ?? defaultCrypto(),
  );
  if (calculatedPackageHash !== manifest.packageHash)
    throw runtimeError({ code: "package_identity_invalid", phase: "manifest" });
  return Object.freeze({
    compatibility: compatibilityIdentity(manifest),
    manifest,
    manifestSha256,
    runtimePackage: runtimePackageIdentity(manifest),
    trust,
  });
}

export function isSchemaError(error: unknown): error is z.ZodError {
  return error instanceof z.ZodError;
}
