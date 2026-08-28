import { z } from "zod";

import {
  SHA256_PATTERN,
  type OverviewPayload,
} from "../static-package/contracts.ts";
import type { RuntimePackageTarget } from "../static-package/url-policy.ts";
import { validateTarget } from "../static-package/url-policy.ts";

export const RUNTIME_BINDING_STRATEGIES = ["static-package-v1"] as const;
export type RuntimeBindingStrategy =
  (typeof RUNTIME_BINDING_STRATEGIES)[number];

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/u;
const sha256 = z.string().regex(SHA256_PATTERN);
const slug = z.string().regex(SLUG_PATTERN);
const semver = z.string().regex(SEMVER_PATTERN);

export type SerializedRuntimePackageTarget = Readonly<{
  allowedOrigin: string;
  expectedManifestSha256: string;
  manifestPath: "manifest.json";
  packageRoot: string;
}>;

export type ExpectedRuntimePackageIdentity = Readonly<{
  artifactSha256: string;
  packageHash: string;
  packageVersion: string;
}>;

export type RuntimeBinding = Readonly<{
  bindingId: string;
  canonicalSchemaVersion: string;
  cityId: string;
  datasetKey: string;
  expectedRuntimePackage: ExpectedRuntimePackageIdentity;
  strategy: RuntimeBindingStrategy;
  target: SerializedRuntimePackageTarget;
}>;

export type RuntimeBindingDefinition = Readonly<{
  bindingId: string;
  canonicalSchemaVersion: string;
  cityId: string;
  datasetKey: string;
  expectedRuntimePackage: ExpectedRuntimePackageIdentity;
  strategy: string;
  target: SerializedRuntimePackageTarget;
}>;

export const RUNTIME_BINDING_FAILURE_CODES = [
  "binding_configuration_invalid",
  "binding_conflict",
  "binding_request_invalid",
  "binding_strategy_unsupported",
  "binding_unknown",
  "binding_city_mismatch",
  "binding_dataset_mismatch",
  "binding_canonical_schema_mismatch",
  "binding_artifact_identity_mismatch",
  "binding_package_identity_mismatch",
  "binding_overview_identity_mismatch",
] as const;

export type RuntimeBindingFailureCode =
  (typeof RUNTIME_BINDING_FAILURE_CODES)[number];

export type RuntimeBindingFailure = Readonly<{
  code: RuntimeBindingFailureCode;
  field: string;
  message: string;
}>;

export type RuntimeBindingCreationResult =
  | Readonly<{ binding: RuntimeBinding; status: "created" }>
  | Readonly<{ failure: RuntimeBindingFailure; status: "rejected" }>;

const RuntimeBindingDefinitionSchema = z.strictObject({
  bindingId: slug,
  canonicalSchemaVersion: semver,
  cityId: slug,
  datasetKey: slug,
  expectedRuntimePackage: z.strictObject({
    artifactSha256: sha256,
    packageHash: sha256,
    packageVersion: semver,
  }),
  strategy: z.string().min(1),
  target: z.strictObject({
    allowedOrigin: z.string().min(1),
    expectedManifestSha256: sha256,
    manifestPath: z.literal("manifest.json"),
    packageRoot: z.string().min(1),
  }),
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}

function failure(
  code: RuntimeBindingFailureCode,
  field: string,
  message: string,
): RuntimeBindingFailure {
  return Object.freeze({ code, field, message });
}

function supportedStrategy(value: string): value is RuntimeBindingStrategy {
  return (RUNTIME_BINDING_STRATEGIES as readonly string[]).includes(value);
}

function validateSerializedTarget(
  target: SerializedRuntimePackageTarget,
): boolean {
  try {
    validateTarget({
      allowedOrigin: target.allowedOrigin,
      expectedManifestSha256: target.expectedManifestSha256,
      manifestPath: target.manifestPath,
      packageRoot: new URL(target.packageRoot),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates an immutable binding from an explicit private configuration value.
 * It never reads application routes, URL state, or the production registry.
 */
export function createRuntimeBinding(
  raw: unknown,
): RuntimeBindingCreationResult {
  const parsed = RuntimeBindingDefinitionSchema.safeParse(raw);
  if (!parsed.success)
    return Object.freeze({
      failure: failure(
        "binding_configuration_invalid",
        "binding",
        "Runtime binding configuration is invalid.",
      ),
      status: "rejected",
    });
  if (!supportedStrategy(parsed.data.strategy))
    return Object.freeze({
      failure: failure(
        "binding_strategy_unsupported",
        "strategy",
        "Runtime binding strategy is not supported.",
      ),
      status: "rejected",
    });
  if (!validateSerializedTarget(parsed.data.target))
    return Object.freeze({
      failure: failure(
        "binding_configuration_invalid",
        "target",
        "Runtime package target is invalid.",
      ),
      status: "rejected",
    });

  const binding: RuntimeBinding = {
    bindingId: parsed.data.bindingId,
    canonicalSchemaVersion: parsed.data.canonicalSchemaVersion,
    cityId: parsed.data.cityId,
    datasetKey: parsed.data.datasetKey,
    expectedRuntimePackage: {
      artifactSha256: parsed.data.expectedRuntimePackage.artifactSha256,
      packageHash: parsed.data.expectedRuntimePackage.packageHash,
      packageVersion: parsed.data.expectedRuntimePackage.packageVersion,
    },
    strategy: parsed.data.strategy,
    target: {
      allowedOrigin: parsed.data.target.allowedOrigin,
      expectedManifestSha256: parsed.data.target.expectedManifestSha256,
      manifestPath: parsed.data.target.manifestPath,
      packageRoot: parsed.data.target.packageRoot,
    },
  };
  return Object.freeze({ binding: deepFreeze(binding), status: "created" });
}

/** Returns a JSON-safe copy suitable for explicitly authored private config. */
export function serializeRuntimeBinding(
  binding: RuntimeBinding,
): RuntimeBindingDefinition {
  return deepFreeze({
    bindingId: binding.bindingId,
    canonicalSchemaVersion: binding.canonicalSchemaVersion,
    cityId: binding.cityId,
    datasetKey: binding.datasetKey,
    expectedRuntimePackage: { ...binding.expectedRuntimePackage },
    strategy: binding.strategy,
    target: { ...binding.target },
  });
}

/**
 * Creates a fresh loader target from immutable serialized binding state.
 * The mutable URL object is deliberately not retained inside RuntimeBinding.
 */
export function materializeRuntimePackageTarget(
  binding: RuntimeBinding,
): RuntimePackageTarget {
  return Object.freeze({
    allowedOrigin: binding.target.allowedOrigin,
    expectedManifestSha256: binding.target.expectedManifestSha256,
    manifestPath: binding.target.manifestPath,
    packageRoot: new URL(binding.target.packageRoot),
  });
}

export type RuntimeBindingOverview = Pick<
  OverviewPayload,
  | "artifactSha256"
  | "canonicalSchemaVersion"
  | "cityId"
  | "datasetKey"
  | "packageVersion"
>;
