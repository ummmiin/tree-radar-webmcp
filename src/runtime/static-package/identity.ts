import type {
  StaticPackageDescriptor,
  StaticPackageManifest,
} from "./contracts.ts";

export type ManifestTrustIdentity = Readonly<{
  allowedOrigin: string;
  expectedManifestSha256: string;
  manifestPath: "manifest.json";
  packageRoot: string;
}>;
export type RuntimePackageIdentity = Readonly<{
  artifactSha256: string;
  canonicalSchemaVersion: string;
  packageHash: string;
  packageVersion: string;
}>;
export type CompatibilityIdentity = Readonly<{
  canonicalSchemaVersion: string;
  clusterVersion: string;
  detailVersion: string;
  packageVersion: string;
  searchVersion: string;
}>;
export type CacheNamespaceIdentity = Readonly<{
  manifestTrust: ManifestTrustIdentity;
  runtimePackage: RuntimePackageIdentity;
}>;
export type FileIdentity = Readonly<{
  bytes: number;
  cacheNamespace: CacheNamespaceIdentity;
  path: string;
  sha256: string;
}>;
export type LoadGenerationIdentity = Readonly<{
  cacheNamespace: CacheNamespaceIdentity;
  sequence: number;
}>;

export function runtimePackageIdentity(
  manifest: StaticPackageManifest,
): RuntimePackageIdentity {
  return Object.freeze({
    artifactSha256: manifest.artifactSha256,
    canonicalSchemaVersion: manifest.canonicalSchemaVersion,
    packageHash: manifest.packageHash,
    packageVersion: manifest.packageVersion,
  });
}
export function compatibilityIdentity(
  manifest: StaticPackageManifest,
): CompatibilityIdentity {
  return Object.freeze({
    canonicalSchemaVersion: manifest.canonicalSchemaVersion,
    clusterVersion: manifest.clusterVersion,
    detailVersion: manifest.detailVersion,
    packageVersion: manifest.packageVersion,
    searchVersion: manifest.searchVersion,
  });
}
export function fileIdentity(
  cacheNamespace: CacheNamespaceIdentity,
  descriptor: StaticPackageDescriptor,
): FileIdentity {
  return Object.freeze({
    bytes: descriptor.bytes,
    cacheNamespace,
    path: descriptor.path,
    sha256: descriptor.sha256,
  });
}
export function identityKey(
  value:
    | ManifestTrustIdentity
    | RuntimePackageIdentity
    | CompatibilityIdentity
    | CacheNamespaceIdentity
    | FileIdentity
    | LoadGenerationIdentity,
): string {
  return JSON.stringify(value);
}
