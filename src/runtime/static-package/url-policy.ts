import { SHA256_PATTERN } from "./contracts.ts";
import { runtimeError } from "./errors.ts";
import type { ManifestTrustIdentity } from "./identity.ts";

export type RuntimePackageTarget = Readonly<{
  allowedOrigin: string;
  expectedManifestSha256: string;
  manifestPath: "manifest.json";
  packageRoot: URL;
}>;

const SAFE_RELATIVE_JSON_PATH = /^(?:[a-z0-9-]+\/)*[a-z0-9-]+\.json$/u;

export function validateTarget(
  target: RuntimePackageTarget,
): ManifestTrustIdentity {
  let allowedOrigin: URL;
  try {
    allowedOrigin = new URL(target.allowedOrigin);
  } catch (cause) {
    throw runtimeError({ code: "invalid_target", phase: "target", cause });
  }
  if (
    allowedOrigin.origin !== target.allowedOrigin ||
    target.packageRoot.origin !== allowedOrigin.origin ||
    target.packageRoot.username ||
    target.packageRoot.password ||
    target.packageRoot.hash ||
    !target.packageRoot.pathname.endsWith("/") ||
    !SHA256_PATTERN.test(target.expectedManifestSha256)
  )
    throw runtimeError({ code: "invalid_target", phase: "target" });
  return Object.freeze({
    allowedOrigin: allowedOrigin.origin,
    expectedManifestSha256: target.expectedManifestSha256,
    manifestPath: target.manifestPath,
    packageRoot: target.packageRoot.toString(),
  });
}

function assertSafeRelativePath(path: string): void {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch (cause) {
    throw runtimeError({ code: "unsafe_path", phase: "descriptor", cause });
  }
  if (
    !SAFE_RELATIVE_JSON_PATH.test(path) ||
    !SAFE_RELATIVE_JSON_PATH.test(decoded) ||
    path.includes("\\") ||
    decoded.includes("\\") ||
    path.includes("//") ||
    decoded.includes("//") ||
    decoded.split("/").includes("..") ||
    decoded.startsWith("/") ||
    /^[a-z][a-z0-9+.-]*:/iu.test(path)
  )
    throw runtimeError({ code: "unsafe_path", phase: "descriptor" });
}

export function resolveManifestUrl(target: RuntimePackageTarget): URL {
  const trust = validateTarget(target);
  return new URL(trust.manifestPath, trust.packageRoot);
}

export function resolveDescriptorUrl(
  target: RuntimePackageTarget,
  descriptorPath: string,
): URL {
  const trust = validateTarget(target);
  assertSafeRelativePath(descriptorPath);
  const url = new URL(descriptorPath, trust.packageRoot);
  if (
    url.origin !== trust.allowedOrigin ||
    !url.toString().startsWith(trust.packageRoot)
  )
    throw runtimeError({ code: "disallowed_origin", phase: "descriptor" });
  return url;
}

export function assertResponseOrigin(
  responseUrl: string,
  trust: ManifestTrustIdentity,
  phase: "manifest" | "file",
): void {
  let response: URL;
  try {
    response = new URL(responseUrl);
  } catch (cause) {
    throw runtimeError({ code: "disallowed_origin", phase, cause });
  }
  if (response.origin !== trust.allowedOrigin)
    throw runtimeError({ code: "disallowed_origin", phase });
}
