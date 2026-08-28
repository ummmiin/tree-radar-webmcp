import {
  createRuntimeBinding,
  type RuntimeBinding,
  type RuntimeBindingFailure,
} from "./contracts.ts";

export type RuntimeBindingResolverConfiguration = Readonly<{
  bindings: readonly unknown[];
}>;

export type RuntimeBindingRequest = Readonly<{ bindingId: string }>;

declare const resolvedRuntimeBindingBrand: unique symbol;

/** A binding that can only be obtained from a successful resolver result. */
export type ResolvedRuntimeBinding = RuntimeBinding &
  Readonly<{ [resolvedRuntimeBindingBrand]: true }>;

export type RuntimeBindingResolution =
  | Readonly<{ binding: ResolvedRuntimeBinding; status: "resolved" }>
  | Readonly<{ failure: RuntimeBindingFailure; status: "rejected" }>;

export type RuntimeBindingResolverCreation =
  | Readonly<{ resolver: RuntimeBindingResolver; status: "created" }>
  | Readonly<{ failure: RuntimeBindingFailure; status: "rejected" }>;

export type RuntimeBindingResolver = Readonly<{
  resolve(input: unknown): RuntimeBindingResolution;
}>;

function failure(
  code: RuntimeBindingFailure["code"],
  field: string,
  message: string,
): RuntimeBindingFailure {
  return Object.freeze({ code, field, message });
}

function requestBindingId(input: unknown): string | undefined {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    typeof (input as Record<string, unknown>).bindingId !== "string"
  )
    return undefined;
  return (input as { bindingId: string }).bindingId;
}

function createResolver(
  bindings: ReadonlyMap<string, RuntimeBinding>,
): RuntimeBindingResolver {
  return Object.freeze({
    resolve: (input: unknown): RuntimeBindingResolution => {
      const bindingId = requestBindingId(input);
      if (!bindingId)
        return Object.freeze({
          failure: failure(
            "binding_request_invalid",
            "bindingId",
            "Runtime binding request must contain exactly one bindingId.",
          ),
          status: "rejected",
        });
      const binding = bindings.get(bindingId);
      if (!binding)
        return Object.freeze({
          failure: failure(
            "binding_unknown",
            "bindingId",
            "Runtime binding is not configured.",
          ),
          status: "rejected",
        });
      return Object.freeze({
        binding: binding as ResolvedRuntimeBinding,
        status: "resolved",
      });
    },
  });
}

/**
 * Builds a resolver from explicitly supplied private bindings. No production
 * registry, route, URL, package, or UI state is accepted or consulted.
 */
export function createRuntimeBindingResolver(
  input: unknown,
): RuntimeBindingResolverCreation {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    !Array.isArray((input as Record<string, unknown>).bindings)
  )
    return Object.freeze({
      failure: failure(
        "binding_configuration_invalid",
        "bindings",
        "Runtime resolver requires an explicit bindings array.",
      ),
      status: "rejected",
    });

  const byId = new Map<string, RuntimeBinding>();
  const byDataset = new Set<string>();
  for (const rawBinding of (input as RuntimeBindingResolverConfiguration)
    .bindings) {
    const created = createRuntimeBinding(rawBinding);
    if (created.status === "rejected")
      return Object.freeze({ failure: created.failure, status: "rejected" });
    const datasetIdentity = `${created.binding.cityId}:${created.binding.datasetKey}`;
    if (byId.has(created.binding.bindingId) || byDataset.has(datasetIdentity))
      return Object.freeze({
        failure: failure(
          "binding_conflict",
          "bindings",
          "Runtime bindings must be unique by bindingId and city/dataset.",
        ),
        status: "rejected",
      });
    byId.set(created.binding.bindingId, created.binding);
    byDataset.add(datasetIdentity);
  }
  return Object.freeze({ resolver: createResolver(byId), status: "created" });
}

export function resolveRuntimeBinding(
  resolver: RuntimeBindingResolver,
  input: RuntimeBindingRequest,
): RuntimeBindingResolution {
  return resolver.resolve(input);
}
