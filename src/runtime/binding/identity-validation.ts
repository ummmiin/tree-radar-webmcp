import type { VerifiedManifest } from "../static-package/manifest-reader.ts";
import {
  type RuntimeBinding,
  type RuntimeBindingFailure,
  type RuntimeBindingOverview,
} from "./contracts.ts";

export type RuntimeBindingPackageCandidate = Readonly<{
  manifest: VerifiedManifest;
  overview: RuntimeBindingOverview;
}>;

export type RuntimeBindingPackageIdentity = Readonly<{
  artifactSha256: string;
  canonicalSchemaVersion: string;
  cityId: string;
  datasetKey: string;
  packageHash: string;
  packageVersion: string;
}>;

export type RuntimeBindingPackageValidation =
  | Readonly<{
      identity: RuntimeBindingPackageIdentity;
      status: "valid";
    }>
  | Readonly<{ failure: RuntimeBindingFailure; status: "invalid" }>;

function failure(
  code: RuntimeBindingFailure["code"],
  field: string,
  message: string,
): RuntimeBindingFailure {
  return Object.freeze({ code, field, message });
}

/**
 * Validates semantic package identity after the loader has verified manifest
 * and overview bytes. It returns no payload on failure and never selects an
 * alternate binding, city, dataset, or strategy.
 */
export function validateRuntimeBindingPackage(
  binding: RuntimeBinding,
  candidate: RuntimeBindingPackageCandidate,
): RuntimeBindingPackageValidation {
  const runtimePackage = candidate.manifest.runtimePackage;
  if (
    runtimePackage.artifactSha256 !==
    binding.expectedRuntimePackage.artifactSha256
  )
    return Object.freeze({
      failure: failure(
        "binding_artifact_identity_mismatch",
        "expectedRuntimePackage.artifactSha256",
        "Verified package artifact identity does not match its binding.",
      ),
      status: "invalid",
    });
  if (
    runtimePackage.packageHash !== binding.expectedRuntimePackage.packageHash ||
    runtimePackage.packageVersion !==
      binding.expectedRuntimePackage.packageVersion
  )
    return Object.freeze({
      failure: failure(
        "binding_package_identity_mismatch",
        "expectedRuntimePackage",
        "Verified package identity does not match its binding.",
      ),
      status: "invalid",
    });
  if (
    candidate.manifest.compatibility.canonicalSchemaVersion !==
    binding.canonicalSchemaVersion
  )
    return Object.freeze({
      failure: failure(
        "binding_canonical_schema_mismatch",
        "canonicalSchemaVersion",
        "Verified package canonical schema is incompatible with its binding.",
      ),
      status: "invalid",
    });
  if (candidate.overview.cityId !== binding.cityId)
    return Object.freeze({
      failure: failure(
        "binding_city_mismatch",
        "cityId",
        "Verified package overview city does not match its binding.",
      ),
      status: "invalid",
    });
  if (candidate.overview.datasetKey !== binding.datasetKey)
    return Object.freeze({
      failure: failure(
        "binding_dataset_mismatch",
        "datasetKey",
        "Verified package overview dataset does not match its binding.",
      ),
      status: "invalid",
    });
  if (
    candidate.overview.canonicalSchemaVersion !==
      binding.canonicalSchemaVersion ||
    candidate.overview.artifactSha256 !==
      binding.expectedRuntimePackage.artifactSha256 ||
    candidate.overview.packageVersion !==
      binding.expectedRuntimePackage.packageVersion
  )
    return Object.freeze({
      failure: failure(
        "binding_overview_identity_mismatch",
        "overview",
        "Verified package overview identity does not match its binding.",
      ),
      status: "invalid",
    });
  return Object.freeze({
    identity: Object.freeze({
      artifactSha256: runtimePackage.artifactSha256,
      canonicalSchemaVersion: binding.canonicalSchemaVersion,
      cityId: binding.cityId,
      datasetKey: binding.datasetKey,
      packageHash: runtimePackage.packageHash,
      packageVersion: runtimePackage.packageVersion,
    }),
    status: "valid",
  });
}
