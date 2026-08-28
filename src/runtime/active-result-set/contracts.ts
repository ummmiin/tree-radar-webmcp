import type { RuntimeBindingResolution } from "../binding/resolver.ts";
import {
  validateRuntimeDataSourceAttributionToken,
  validateRuntimeDataSourceResponseAttribution,
  type OpenedRuntimeDataSourceIdentity,
  type RuntimeDataSourceAttributionToken,
  type RuntimeDataSourceCapabilities,
  type RuntimeDataSourceOpenResult,
  type RuntimeDataSourceOperation,
} from "../data-source/static-package-data-source.ts";

export const RUNTIME_ACTIVE_RESULT_SET_LIFECYCLES = [
  "admitted",
  "active",
  "superseded",
] as const;

export type RuntimeActiveResultSetLifecycle =
  (typeof RUNTIME_ACTIVE_RESULT_SET_LIFECYCLES)[number];

export const RUNTIME_ACTIVE_RESULT_SET_UI_LIFECYCLES = [
  "opening",
  "active",
  "rejected",
  "unavailable",
  "superseded",
] as const;

export type RuntimeActiveResultSetUiLifecycle =
  (typeof RUNTIME_ACTIVE_RESULT_SET_UI_LIFECYCLES)[number];

export type RuntimeRequiredCapabilityProfile = Readonly<{
  canonicalDetail: boolean;
  speciesExactValueSearch: boolean;
  viewportClusters: boolean;
  viewportPoints: boolean;
}>;

/**
 * An opaque caller-owned scope, deliberately not a route, URL, or UI state.
 * Phase 8.3 only validates and retains it for admission diagnostics; later
 * coordinators define any routing or viewport meaning outside this contract.
 */
export type RuntimeActivationContext = Readonly<{
  activationContextId: string;
}>;

export type RuntimeActivationAdmissionInput = Readonly<{
  attribution: unknown;
  binding: RuntimeBindingResolution;
  context: unknown;
  opened: RuntimeDataSourceOpenResult;
  requiredCapabilities: unknown;
}>;

export const RUNTIME_ACTIVATION_ADMISSION_FAILURE_CODES = [
  "activation_context_invalid",
  "attribution_invalid",
  "attribution_mismatch",
  "binding_identity_mismatch",
  "capability_rejected",
  "canonical_schema_mismatch",
  "data_source_unopened",
  "generation_mismatch",
  "package_semantic_identity_mismatch",
  "unresolved_binding",
] as const;

export type RuntimeActivationAdmissionFailureCode =
  (typeof RUNTIME_ACTIVATION_ADMISSION_FAILURE_CODES)[number];

export type RuntimeActivationAdmissionFailure = Readonly<{
  code: RuntimeActivationAdmissionFailureCode;
}>;

/** Internal-only result-set identity. It never carries loader or cache state. */
export type RuntimeActiveResultSet = Readonly<{
  activationContext: RuntimeActivationContext;
  activationEpoch: number;
  activeResultSetId: string;
  attribution: RuntimeDataSourceAttributionToken;
  binding: RuntimeDataSourceAttributionToken["binding"];
  capabilities: RuntimeDataSourceCapabilities;
  generation: number;
  lifecycle: RuntimeActiveResultSetLifecycle;
  packageOfficialRecordCount: number;
  packageSemanticIdentity: RuntimeDataSourceAttributionToken["runtimePackage"];
}>;

export type RuntimeActivationAdmissionResult =
  | Readonly<{ resultSet: RuntimeActiveResultSet; status: "admitted" }>
  | Readonly<{
      failure: RuntimeActivationAdmissionFailure;
      status: "rejected" | "unavailable";
    }>;

export const RUNTIME_ACTIVE_RESULT_SET_FAILURE_CODES = [
  "activation_epoch_mismatch",
  "capability_rejected",
  "data_source_attribution_invalid",
  "data_source_binding_identity_mismatch",
  "data_source_instance_mismatch",
  "data_source_generation_superseded",
  "data_source_operation_mismatch",
  "data_source_package_semantic_identity_mismatch",
  "duplicate_activation",
  "operation_mismatch",
  "result_set_mismatch",
  "result_set_superseded",
  "selection_invalid",
] as const;

export type RuntimeActiveResultSetFailureCode =
  (typeof RUNTIME_ACTIVE_RESULT_SET_FAILURE_CODES)[number];

export type RuntimeActiveResultSetFailure = Readonly<{
  code: RuntimeActiveResultSetFailureCode;
}>;

export type RuntimeActiveResultSetOperationRequest = Readonly<{
  activationEpoch: number;
  activeResultSetId: string;
  attribution: RuntimeDataSourceAttributionToken;
  operation: RuntimeDataSourceOperation;
}>;

export type RuntimeActiveResultSetResponseAttribution = Readonly<{
  activationEpoch: number;
  activeResultSetId: string;
  attribution: RuntimeDataSourceAttributionToken;
  operation: RuntimeDataSourceOperation;
}>;

export type RuntimeActiveResultSetSelection = Readonly<{
  activationEpoch: number;
  activeResultSetId: string;
  canonicalTreeId: string;
}>;

/** The only identity projection that a future UI may receive. */
export type RuntimeActiveResultSetUiIdentity = Readonly<{
  activationEpoch: number;
  activeResultSetId: string;
  canonicalSchemaVersion: string;
  capabilities: RuntimeDataSourceCapabilities;
  cityId: string;
  datasetKey: string;
  lifecycle: RuntimeActiveResultSetUiLifecycle;
  packageOfficialRecordCount: number;
  packageVersion: string;
}>;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function capabilities(value: unknown): value is RuntimeDataSourceCapabilities {
  return (
    exactRecord(value, [
      "canonicalDetail",
      "speciesExactValueSearch",
      "viewportClusters",
      "viewportPoints",
    ]) && Object.values(value).every((entry) => typeof entry === "boolean")
  );
}

function context(value: unknown): value is RuntimeActivationContext {
  return (
    exactRecord(value, ["activationContextId"]) &&
    typeof value.activationContextId === "string" &&
    value.activationContextId.trim().length > 0
  );
}

function sameBinding(
  left: RuntimeDataSourceAttributionToken["binding"],
  right: RuntimeDataSourceAttributionToken["binding"],
): boolean {
  return (
    left.bindingId === right.bindingId &&
    left.cityId === right.cityId &&
    left.datasetKey === right.datasetKey &&
    left.canonicalSchemaVersion === right.canonicalSchemaVersion
  );
}

function samePackage(
  left: RuntimeDataSourceAttributionToken["runtimePackage"],
  right: RuntimeDataSourceAttributionToken["runtimePackage"],
): boolean {
  return (
    left.artifactSha256 === right.artifactSha256 &&
    left.packageHash === right.packageHash &&
    left.packageVersion === right.packageVersion &&
    left.canonicalSchemaVersion === right.canonicalSchemaVersion
  );
}

function sameOpenedIdentity(
  opened: OpenedRuntimeDataSourceIdentity,
  token: RuntimeDataSourceAttributionToken,
): RuntimeActivationAdmissionFailureCode | undefined {
  if (
    opened.canonicalSchemaVersion !==
    token.runtimePackage.canonicalSchemaVersion
  )
    return "canonical_schema_mismatch";
  if (opened.packageVersion !== token.runtimePackage.packageVersion)
    return "package_semantic_identity_mismatch";
  if (opened.generation !== token.generation) return "generation_mismatch";
  if (!sameBinding(openedToBinding(opened), token.binding))
    return "binding_identity_mismatch";
  return undefined;
}

function openedToBinding(
  identity: OpenedRuntimeDataSourceIdentity,
): RuntimeDataSourceAttributionToken["binding"] {
  return {
    bindingId: identity.bindingId,
    canonicalSchemaVersion: identity.canonicalSchemaVersion,
    cityId: identity.cityId,
    datasetKey: identity.datasetKey,
    strategy: identity.strategy,
  };
}

function requestedCapabilityMissing(
  required: RuntimeRequiredCapabilityProfile,
  actual: RuntimeDataSourceCapabilities,
): boolean {
  return (
    (required.canonicalDetail && !actual.canonicalDetail) ||
    (required.speciesExactValueSearch && !actual.speciesExactValueSearch) ||
    (required.viewportClusters && !actual.viewportClusters) ||
    (required.viewportPoints && !actual.viewportPoints)
  );
}

function operationSupported(
  resultSet: RuntimeActiveResultSet,
  operation: RuntimeDataSourceOperation,
): boolean {
  if (operation === "detail") return resultSet.capabilities.canonicalDetail;
  if (operation === "search")
    return resultSet.capabilities.speciesExactValueSearch;
  return (
    resultSet.capabilities.viewportClusters ||
    resultSet.capabilities.viewportPoints
  );
}

function admissionFailure(
  code: RuntimeActivationAdmissionFailureCode,
): RuntimeActivationAdmissionFailure {
  return Object.freeze({ code });
}

function activeFailure(
  code: RuntimeActiveResultSetFailureCode,
): RuntimeActiveResultSetFailure {
  return Object.freeze({ code });
}

function sourceAttributionFailure(code: string): RuntimeActiveResultSetFailure {
  const mapped: Record<string, RuntimeActiveResultSetFailureCode> = {
    attribution_invalid: "data_source_attribution_invalid",
    binding_identity_mismatch: "data_source_binding_identity_mismatch",
    data_source_instance_mismatch: "data_source_instance_mismatch",
    generation_superseded: "data_source_generation_superseded",
    operation_mismatch: "data_source_operation_mismatch",
    package_semantic_identity_mismatch:
      "data_source_package_semantic_identity_mismatch",
  };
  return activeFailure(mapped[code] ?? "data_source_attribution_invalid");
}

function cloneResultSet(
  resultSet: RuntimeActiveResultSet,
  lifecycle: RuntimeActiveResultSetLifecycle,
): RuntimeActiveResultSet {
  return deepFreeze({ ...resultSet, lifecycle });
}

function validActiveResultSet(value: unknown): value is RuntimeActiveResultSet {
  if (
    !exactRecord(value, [
      "activationContext",
      "activationEpoch",
      "activeResultSetId",
      "attribution",
      "binding",
      "capabilities",
      "generation",
      "lifecycle",
      "packageOfficialRecordCount",
      "packageSemanticIdentity",
    ])
  )
    return false;
  const candidate = value as RuntimeActiveResultSet;
  return (
    typeof candidate.activeResultSetId === "string" &&
    Number.isInteger(candidate.activationEpoch) &&
    candidate.activationEpoch > 0 &&
    typeof candidate.generation === "number" &&
    Number.isInteger(candidate.packageOfficialRecordCount) &&
    candidate.packageOfficialRecordCount >= 0 &&
    (RUNTIME_ACTIVE_RESULT_SET_LIFECYCLES as readonly string[]).includes(
      candidate.lifecycle,
    ) &&
    context(candidate.activationContext) &&
    capabilities(candidate.capabilities) &&
    validateRuntimeDataSourceAttributionToken(candidate.attribution).status ===
      "valid"
  );
}

/**
 * A browser-safe activation owner. It performs no loading, querying, routing,
 * UI projection beyond the safe helper below, or production integration.
 */
export function createRuntimeActivationAdmission(): Readonly<{
  activate(
    candidate: unknown,
  ):
    | Readonly<{ resultSet: RuntimeActiveResultSet; status: "active" }>
    | Readonly<{ failure: RuntimeActiveResultSetFailure; status: "rejected" }>;
  admit(
    input: RuntimeActivationAdmissionInput,
  ): RuntimeActivationAdmissionResult;
  current(): RuntimeActiveResultSet | undefined;
  replace(input: RuntimeActivationAdmissionInput):
    | Readonly<{
        resultSet: RuntimeActiveResultSet;
        status: "active";
        superseded: RuntimeActiveResultSet | undefined;
      }>
    | RuntimeActivationAdmissionResult
    | Readonly<{ failure: RuntimeActiveResultSetFailure; status: "rejected" }>;
  validateResponse(input: Readonly<{ request: unknown; response: unknown }>):
    | Readonly<{
        attribution: RuntimeActiveResultSetResponseAttribution;
        status: "valid";
      }>
    | Readonly<{ failure: RuntimeActiveResultSetFailure; status: "rejected" }>;
  validateSelection(
    selection: unknown,
  ):
    | Readonly<{ selection: RuntimeActiveResultSetSelection; status: "valid" }>
    | Readonly<{ failure: RuntimeActiveResultSetFailure; status: "rejected" }>;
}> {
  let nextEpoch = 0;
  let current: RuntimeActiveResultSet | undefined;
  const pending = new Map<string, RuntimeActiveResultSet>();

  const admit = (
    input: RuntimeActivationAdmissionInput,
  ): RuntimeActivationAdmissionResult => {
    if (input.binding.status !== "resolved")
      return deepFreeze({
        failure: admissionFailure("unresolved_binding"),
        status: "rejected",
      });
    if (input.opened.status !== "opened")
      return deepFreeze({
        failure: admissionFailure("data_source_unopened"),
        status:
          input.opened.status === "unavailable" ? "unavailable" : "rejected",
      });
    const token = validateRuntimeDataSourceAttributionToken(input.attribution);
    if (token.status !== "valid")
      return deepFreeze({
        failure: admissionFailure("attribution_invalid"),
        status: "rejected",
      });
    if (!sameToken(input.opened.attribution, token.token))
      return deepFreeze({
        failure: admissionFailure("attribution_mismatch"),
        status: "rejected",
      });
    if (!context(input.context))
      return deepFreeze({
        failure: admissionFailure("activation_context_invalid"),
        status: "rejected",
      });
    if (!capabilities(input.requiredCapabilities))
      return deepFreeze({
        failure: admissionFailure("capability_rejected"),
        status: "rejected",
      });
    const binding = input.binding.binding;
    if (!sameBinding(binding, token.token.binding))
      return deepFreeze({
        failure: admissionFailure("binding_identity_mismatch"),
        status: "rejected",
      });
    if (
      binding.canonicalSchemaVersion !==
      token.token.runtimePackage.canonicalSchemaVersion
    )
      return deepFreeze({
        failure: admissionFailure("canonical_schema_mismatch"),
        status: "rejected",
      });
    if (
      binding.expectedRuntimePackage.artifactSha256 !==
        token.token.runtimePackage.artifactSha256 ||
      binding.expectedRuntimePackage.packageHash !==
        token.token.runtimePackage.packageHash ||
      binding.expectedRuntimePackage.packageVersion !==
        token.token.runtimePackage.packageVersion
    )
      return deepFreeze({
        failure: admissionFailure("package_semantic_identity_mismatch"),
        status: "rejected",
      });
    const openedMismatch = sameOpenedIdentity(
      input.opened.identity,
      token.token,
    );
    if (openedMismatch)
      return deepFreeze({
        failure: admissionFailure(openedMismatch),
        status: "rejected",
      });
    if (
      requestedCapabilityMissing(
        input.requiredCapabilities,
        input.opened.capabilities,
      )
    )
      return deepFreeze({
        failure: admissionFailure("capability_rejected"),
        status: "rejected",
      });

    const activationEpoch = ++nextEpoch;
    const resultSet = deepFreeze({
      activationContext: {
        activationContextId: input.context.activationContextId,
      },
      activationEpoch,
      activeResultSetId: `runtime-active-result-set-${String(activationEpoch)}`,
      attribution: cloneToken(token.token),
      binding: { ...token.token.binding },
      capabilities: { ...input.opened.capabilities },
      generation: token.token.generation,
      lifecycle: "admitted" as const,
      packageOfficialRecordCount:
        input.opened.identity.packageOfficialRecordCount,
      packageSemanticIdentity: { ...token.token.runtimePackage },
    });
    pending.set(resultSet.activeResultSetId, resultSet);
    return deepFreeze({ resultSet, status: "admitted" });
  };

  const activateCandidate = (candidate: unknown, replacement: boolean) => {
    if (!validActiveResultSet(candidate) || candidate.lifecycle !== "admitted")
      return deepFreeze({
        failure: activeFailure("duplicate_activation"),
        status: "rejected" as const,
      });
    const pendingResult = pending.get(candidate.activeResultSetId);
    if (!pendingResult || !sameResultSet(candidate, pendingResult))
      return deepFreeze({
        failure: activeFailure("duplicate_activation"),
        status: "rejected" as const,
      });
    if (current && !replacement)
      return deepFreeze({
        failure: activeFailure("duplicate_activation"),
        status: "rejected" as const,
      });
    const superseded = current
      ? cloneResultSet(current, "superseded")
      : undefined;
    const active = cloneResultSet(pendingResult, "active");
    pending.delete(active.activeResultSetId);
    current = active;
    return deepFreeze({
      resultSet: active,
      status: "active" as const,
      superseded,
    });
  };

  return Object.freeze({
    activate(candidate) {
      const activated = activateCandidate(candidate, false);
      return activated.status === "active"
        ? deepFreeze({ resultSet: activated.resultSet, status: "active" })
        : activated;
    },
    admit,
    current: () => current,
    replace(input) {
      const admitted = admit(input);
      if (admitted.status !== "admitted") return admitted;
      return activateCandidate(admitted.resultSet, true);
    },
    validateResponse(input) {
      if (!current)
        return deepFreeze({
          failure: activeFailure("result_set_superseded"),
          status: "rejected",
        });
      return validateRuntimeActiveResponseAttribution({
        activeResultSet: current,
        ...input,
      });
    },
    validateSelection(selection) {
      if (!current)
        return deepFreeze({
          failure: activeFailure("result_set_superseded"),
          status: "rejected",
        });
      return validateRuntimeActiveResultSetSelection({
        activeResultSet: current,
        selection,
      });
    },
  });
}

function cloneToken(
  token: RuntimeDataSourceAttributionToken,
): RuntimeDataSourceAttributionToken {
  return deepFreeze({
    binding: { ...token.binding },
    dataSourceInstanceId: token.dataSourceInstanceId,
    generation: token.generation,
    runtimePackage: { ...token.runtimePackage },
  });
}

function sameToken(
  left: RuntimeDataSourceAttributionToken,
  right: RuntimeDataSourceAttributionToken,
): boolean {
  return (
    left.dataSourceInstanceId === right.dataSourceInstanceId &&
    left.generation === right.generation &&
    sameBinding(left.binding, right.binding) &&
    samePackage(left.runtimePackage, right.runtimePackage)
  );
}

function sameResultSet(
  left: RuntimeActiveResultSet,
  right: RuntimeActiveResultSet,
): boolean {
  return (
    left.activeResultSetId === right.activeResultSetId &&
    left.activationEpoch === right.activationEpoch &&
    sameToken(left.attribution, right.attribution) &&
    left.lifecycle === right.lifecycle
  );
}

export function createRuntimeActiveResultSetOperationRequest(
  resultSet: unknown,
  operation: RuntimeDataSourceOperation,
):
  | Readonly<{
      request: RuntimeActiveResultSetOperationRequest;
      status: "created";
    }>
  | Readonly<{ failure: RuntimeActiveResultSetFailure; status: "rejected" }> {
  if (!validActiveResultSet(resultSet) || resultSet.lifecycle !== "active")
    return deepFreeze({
      failure: activeFailure("result_set_superseded"),
      status: "rejected",
    });
  if (!operationSupported(resultSet, operation))
    return deepFreeze({
      failure: activeFailure("capability_rejected"),
      status: "rejected",
    });
  return deepFreeze({
    request: {
      activationEpoch: resultSet.activationEpoch,
      activeResultSetId: resultSet.activeResultSetId,
      attribution: cloneToken(resultSet.attribution),
      operation,
    },
    status: "created",
  });
}

export function validateRuntimeActiveResponseAttribution(
  input: Readonly<{
    activeResultSet: RuntimeActiveResultSet;
    request: unknown;
    response: unknown;
  }>,
):
  | Readonly<{
      attribution: RuntimeActiveResultSetResponseAttribution;
      status: "valid";
    }>
  | Readonly<{ failure: RuntimeActiveResultSetFailure; status: "rejected" }> {
  if (
    !validActiveResultSet(input.activeResultSet) ||
    input.activeResultSet.lifecycle !== "active"
  )
    return deepFreeze({
      failure: activeFailure("result_set_superseded"),
      status: "rejected",
    });
  if (
    !exactRecord(input.request, [
      "activationEpoch",
      "activeResultSetId",
      "attribution",
      "operation",
    ])
  )
    return deepFreeze({
      failure: activeFailure("result_set_mismatch"),
      status: "rejected",
    });
  if (
    input.request.activeResultSetId !== input.activeResultSet.activeResultSetId
  )
    return deepFreeze({
      failure: activeFailure("result_set_mismatch"),
      status: "rejected",
    });
  if (input.request.activationEpoch !== input.activeResultSet.activationEpoch)
    return deepFreeze({
      failure: activeFailure("activation_epoch_mismatch"),
      status: "rejected",
    });
  if (
    input.request.operation !== "detail" &&
    input.request.operation !== "search" &&
    input.request.operation !== "viewport"
  )
    return deepFreeze({
      failure: activeFailure("operation_mismatch"),
      status: "rejected",
    });
  if (!operationSupported(input.activeResultSet, input.request.operation))
    return deepFreeze({
      failure: activeFailure("capability_rejected"),
      status: "rejected",
    });
  const requestAttribution = validateRuntimeDataSourceResponseAttribution({
    expected: input.activeResultSet.attribution,
    operation: input.request.operation,
    response: {
      attribution: {
        operation: input.request.operation,
        token: input.request.attribution,
      },
    },
  });
  if (requestAttribution.status !== "valid")
    return deepFreeze({
      failure: sourceAttributionFailure(requestAttribution.code),
      status: "rejected",
    });
  const source = validateRuntimeDataSourceResponseAttribution({
    expected: input.activeResultSet.attribution,
    operation: input.request.operation,
    response: input.response,
  });
  if (source.status !== "valid")
    return deepFreeze({
      failure: sourceAttributionFailure(source.code),
      status: "rejected",
    });
  return deepFreeze({
    attribution: {
      activationEpoch: input.activeResultSet.activationEpoch,
      activeResultSetId: input.activeResultSet.activeResultSetId,
      attribution: cloneToken(input.activeResultSet.attribution),
      operation: input.request.operation,
    },
    status: "valid",
  });
}

export function createRuntimeActiveResultSetSelection(
  resultSet: unknown,
  canonicalTreeId: unknown,
):
  | Readonly<{ selection: RuntimeActiveResultSetSelection; status: "created" }>
  | Readonly<{ failure: RuntimeActiveResultSetFailure; status: "rejected" }> {
  if (!validActiveResultSet(resultSet) || resultSet.lifecycle !== "active")
    return deepFreeze({
      failure: activeFailure("result_set_superseded"),
      status: "rejected",
    });
  if (
    typeof canonicalTreeId !== "string" ||
    canonicalTreeId.trim().length === 0
  )
    return deepFreeze({
      failure: activeFailure("selection_invalid"),
      status: "rejected",
    });
  return deepFreeze({
    selection: {
      activationEpoch: resultSet.activationEpoch,
      activeResultSetId: resultSet.activeResultSetId,
      canonicalTreeId,
    },
    status: "created",
  });
}

export function validateRuntimeActiveResultSetSelection(
  input: Readonly<{
    activeResultSet: RuntimeActiveResultSet;
    selection: unknown;
  }>,
):
  | Readonly<{ selection: RuntimeActiveResultSetSelection; status: "valid" }>
  | Readonly<{ failure: RuntimeActiveResultSetFailure; status: "rejected" }> {
  if (
    !validActiveResultSet(input.activeResultSet) ||
    input.activeResultSet.lifecycle !== "active"
  )
    return deepFreeze({
      failure: activeFailure("result_set_superseded"),
      status: "rejected",
    });
  if (
    !exactRecord(input.selection, [
      "activationEpoch",
      "activeResultSetId",
      "canonicalTreeId",
    ]) ||
    typeof input.selection.canonicalTreeId !== "string" ||
    input.selection.canonicalTreeId.trim().length === 0
  )
    return deepFreeze({
      failure: activeFailure("selection_invalid"),
      status: "rejected",
    });
  if (
    input.selection.activeResultSetId !==
    input.activeResultSet.activeResultSetId
  )
    return deepFreeze({
      failure: activeFailure("result_set_mismatch"),
      status: "rejected",
    });
  if (input.selection.activationEpoch !== input.activeResultSet.activationEpoch)
    return deepFreeze({
      failure: activeFailure("activation_epoch_mismatch"),
      status: "rejected",
    });
  return deepFreeze({
    selection: {
      activationEpoch: input.selection.activationEpoch,
      activeResultSetId: input.selection.activeResultSetId,
      canonicalTreeId: input.selection.canonicalTreeId,
    },
    status: "valid",
  });
}

export function projectRuntimeActiveResultSetForUi(
  resultSet: RuntimeActiveResultSet,
): RuntimeActiveResultSetUiIdentity {
  const lifecycle: RuntimeActiveResultSetUiLifecycle =
    resultSet.lifecycle === "admitted" ? "opening" : resultSet.lifecycle;
  return deepFreeze({
    activationEpoch: resultSet.activationEpoch,
    activeResultSetId: resultSet.activeResultSetId,
    canonicalSchemaVersion: resultSet.binding.canonicalSchemaVersion,
    capabilities: { ...resultSet.capabilities },
    cityId: resultSet.binding.cityId,
    datasetKey: resultSet.binding.datasetKey,
    lifecycle,
    packageOfficialRecordCount: resultSet.packageOfficialRecordCount,
    packageVersion: resultSet.packageSemanticIdentity.packageVersion,
  });
}

export function projectRuntimeActivationFailureForUi(
  result: Exclude<RuntimeActivationAdmissionResult, { status: "admitted" }>,
): Readonly<{ lifecycle: "rejected" | "unavailable" }> {
  return deepFreeze({ lifecycle: result.status });
}
