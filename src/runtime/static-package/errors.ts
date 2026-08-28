export const RUNTIME_FAILURE_CODES = [
  "invalid_target",
  "disallowed_origin",
  "unsafe_path",
  "redirect_rejected",
  "manifest_fetch_failed",
  "manifest_not_found",
  "manifest_too_large",
  "manifest_mime_invalid",
  "manifest_integrity_mismatch",
  "manifest_decode_failed",
  "manifest_parse_failed",
  "manifest_schema_invalid",
  "manifest_version_unsupported",
  "package_identity_invalid",
  "descriptor_not_found",
  "descriptor_duplicate",
  "descriptor_capability_denied",
  "file_fetch_failed",
  "file_not_found",
  "file_too_large",
  "file_mime_invalid",
  "file_size_mismatch",
  "file_integrity_mismatch",
  "payload_decode_failed",
  "payload_parse_failed",
  "payload_schema_invalid",
  "payload_identity_mismatch",
  "request_timeout",
  "request_aborted",
  "generation_superseded",
  "queue_capacity_exceeded",
  "memory_budget_exceeded",
  "crypto_unavailable",
  "loader_disposed",
] as const;

export type RuntimeFailureCode = (typeof RUNTIME_FAILURE_CODES)[number];
export type RuntimeFailurePhase =
  | "target"
  | "manifest"
  | "descriptor"
  | "file"
  | "queue"
  | "cache"
  | "generation"
  | "loader";

export class StaticPackageRuntimeError extends Error {
  readonly cacheMutationAllowed: boolean;
  readonly code: RuntimeFailureCode;
  readonly diagnostic: Readonly<Record<string, string | number | boolean>>;
  readonly phase: RuntimeFailurePhase;
  readonly retryable: boolean;

  constructor(
    input: Readonly<{
      code: RuntimeFailureCode;
      phase: RuntimeFailurePhase;
      retryable?: boolean;
      cacheMutationAllowed?: boolean;
      diagnostic?: Readonly<Record<string, string | number | boolean>>;
      cause?: unknown;
    }>,
  ) {
    super(`Static package runtime failure: ${input.code}`, {
      cause: input.cause,
    });
    this.name = "StaticPackageRuntimeError";
    this.code = input.code;
    this.phase = input.phase;
    this.retryable = input.retryable ?? false;
    this.cacheMutationAllowed = input.cacheMutationAllowed ?? false;
    this.diagnostic = Object.freeze({ ...(input.diagnostic ?? {}) });
  }
}

export function runtimeError(
  input: ConstructorParameters<typeof StaticPackageRuntimeError>[0],
): StaticPackageRuntimeError {
  return new StaticPackageRuntimeError(input);
}
