import {
  createRuntimeActiveResultSetOperationRequest,
  createRuntimeActiveResultSetSelection,
  projectRuntimeActiveResultSetForUi,
  validateRuntimeActiveResponseAttribution,
  type RuntimeActiveResultSet,
  type RuntimeActiveResultSetUiIdentity,
} from "../active-result-set/contracts.ts";
import type {
  RuntimeCluster,
  RuntimeDataSourceAttributionToken,
  RuntimeDetailResult,
  RuntimePoint,
  RuntimeSpeciesSearchResult,
  RuntimeStaticPackageDataSource,
  RuntimeViewportResult,
} from "../data-source/static-package-data-source.ts";

const MAX_DIAGNOSTICS = 64;

export const RUNTIME_COORDINATOR_UI_STATUSES = [
  "idle",
  "loading",
  "ready",
  "rejected",
  "superseded",
  "unavailable",
] as const;

export type RuntimeCoordinatorUiStatus =
  (typeof RUNTIME_COORDINATOR_UI_STATUSES)[number];

export type RuntimeCoordinatorOperation = "detail" | "search" | "viewport";

export type RuntimeCoordinatorUiRejectionCategory =
  "capability_unsupported" | "invalid_request";

export type RuntimeCoordinatorOperationIdentity = Readonly<{
  activationEpoch: number;
  activeResultSetId: string;
  operation: RuntimeCoordinatorOperation;
  requestSequence: number;
}>;

type RuntimeCoordinatorUiOperationIdentity = Readonly<{
  activationEpoch: number;
  activeResultSetId: string;
  canonicalTreeId: string | null;
  query: string | null;
  requestSequence: number | null;
  zoom: number | null;
}>;

type RuntimeCoordinatorUiNonReadyState = RuntimeCoordinatorUiOperationIdentity &
  Readonly<{
    rejectionCategory?: RuntimeCoordinatorUiRejectionCategory;
    status: Exclude<RuntimeCoordinatorUiStatus, "ready">;
  }>;

export type RuntimeCoordinatorViewportUiState =
  | RuntimeCoordinatorUiNonReadyState
  | (RuntimeCoordinatorUiOperationIdentity &
      Readonly<{
        result: Readonly<{
          clusters: readonly RuntimeCluster[];
          mode: "clusters";
        }>;
        status: "ready";
      }>)
  | (RuntimeCoordinatorUiOperationIdentity &
      Readonly<{
        result: Readonly<{ mode: "points"; points: readonly RuntimePoint[] }>;
        status: "ready";
      }>);

export type RuntimeCoordinatorSearchUiState =
  | RuntimeCoordinatorUiNonReadyState
  | (RuntimeCoordinatorUiOperationIdentity &
      Readonly<{
        result: Readonly<{
          canonicalTreeIds: readonly string[];
          normalizedQuery: string;
          speciesDisplayValues: Readonly<Record<string, string>>;
          status: "found" | "not_found";
        }>;
        status: "ready";
      }>);

export type RuntimeCoordinatorDetailUiState =
  | RuntimeCoordinatorUiNonReadyState
  | (RuntimeCoordinatorUiOperationIdentity &
      Readonly<{
        result:
          | Readonly<{ record: RuntimePoint; status: "found" }>
          | Readonly<{ status: "not_found" }>;
        status: "ready";
      }>);

/** Immutable, UI-safe result projections; no token, URL, hash, or loader data. */
export type RuntimeCoordinatorUiState = Readonly<{
  activeResultSet: RuntimeActiveResultSetUiIdentity;
  detail: RuntimeCoordinatorDetailUiState;
  search: RuntimeCoordinatorSearchUiState;
  viewport: RuntimeCoordinatorViewportUiState;
}>;

export type RuntimeCoordinatorDiagnostic = Readonly<{
  activationEpoch: number;
  activeResultSetId: string;
  event:
    | "cancelled"
    | "completed"
    | "disposed"
    | "rejected"
    | "started"
    | "stale"
    | "unavailable";
  operation: RuntimeCoordinatorOperation;
  latencyMs: number;
  reason?: string;
  requestSequence: number;
  retryOutcome: "not_attempted";
}>;

export type RuntimeCoordinatorCompletion = Readonly<{
  identity: RuntimeCoordinatorOperationIdentity;
  status: RuntimeCoordinatorUiStatus;
}>;

export type RuntimeCoordinatorReplacement = Readonly<{
  dataSource: RuntimeStaticPackageDataSource;
  resultSet: RuntimeActiveResultSet;
}>;

type RuntimeCoordinatorInternalOperation = Readonly<{
  attribution: RuntimeDataSourceAttributionToken;
  identity: RuntimeCoordinatorOperationIdentity;
}>;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}

function operationState(
  resultSet: RuntimeActiveResultSet,
  status: RuntimeCoordinatorUiNonReadyState["status"],
  requestSequence: number | null = null,
  metadata: Readonly<{
    canonicalTreeId?: string | null;
    query?: string | null;
    zoom?: number | null;
  }> = {},
  rejectionCategory?: RuntimeCoordinatorUiRejectionCategory,
): RuntimeCoordinatorUiNonReadyState {
  return deepFreeze({
    activationEpoch: resultSet.activationEpoch,
    activeResultSetId: resultSet.activeResultSetId,
    canonicalTreeId: metadata.canonicalTreeId ?? null,
    query: metadata.query ?? null,
    requestSequence,
    status,
    ...(rejectionCategory === undefined ? {} : { rejectionCategory }),
    zoom: metadata.zoom ?? null,
  });
}

function rejectionCategory(
  code: string,
): RuntimeCoordinatorUiRejectionCategory | undefined {
  if (code === "capability_unsupported") return "capability_unsupported";
  if (
    [
      "canonical_id_invalid",
      "query_invalid",
      "viewport_invalid",
      "viewport_resolution_unsupported",
      "viewport_tile_budget_exceeded",
    ].includes(code)
  )
    return "invalid_request";
  return undefined;
}

function viewportZoom(value: unknown): number | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const zoom = (value as Record<string, unknown>).zoom;
  return typeof zoom === "number" && Number.isInteger(zoom) ? zoom : null;
}

function initialUiState(
  resultSet: RuntimeActiveResultSet,
): RuntimeCoordinatorUiState {
  return deepFreeze({
    activeResultSet: projectRuntimeActiveResultSetForUi(resultSet),
    detail: operationState(resultSet, "idle"),
    search: operationState(resultSet, "idle"),
    viewport: operationState(resultSet, "idle"),
  });
}

function sameResultSet(
  left: RuntimeActiveResultSet,
  right: RuntimeActiveResultSet,
): boolean {
  return (
    left.activeResultSetId === right.activeResultSetId &&
    left.activationEpoch === right.activationEpoch
  );
}

/**
 * Owns one active result-set reference and logical request cancellation. It
 * consumes only the Phase 8.2 data-source capability API; it never receives a
 * binding, loader, package target, payload cache, route, or production state.
 */
export function createRuntimeCoordinator(
  input: RuntimeCoordinatorReplacement,
): Readonly<{
  clearDetail(): void;
  clearSpeciesSearch(): void;
  dispose(): void;
  getDiagnostics(): readonly RuntimeCoordinatorDiagnostic[];
  getUiState(): RuntimeCoordinatorUiState;
  loadDetail(canonicalTreeId: unknown): Promise<RuntimeCoordinatorCompletion>;
  loadViewport(request: unknown): Promise<RuntimeCoordinatorCompletion>;
  replaceActiveResultSet(input: unknown): boolean;
  searchSpecies(query: unknown): Promise<RuntimeCoordinatorCompletion>;
}> {
  let resultSet = input.resultSet;
  let dataSource = input.dataSource;
  let disposed = false;
  let sequence = 0;
  let uiState = initialUiState(resultSet);
  const latest = new Map<
    RuntimeCoordinatorOperation,
    RuntimeCoordinatorInternalOperation
  >();
  const diagnostics: RuntimeCoordinatorDiagnostic[] = [];
  const startedAtMs = new Map<string, number>();

  const diagnosticKey = (
    identity: RuntimeCoordinatorOperationIdentity,
  ): string =>
    `${identity.activeResultSetId}:${String(identity.activationEpoch)}:${identity.operation}:${String(identity.requestSequence)}`;

  const diagnose = (
    identity: RuntimeCoordinatorOperationIdentity,
    event: RuntimeCoordinatorDiagnostic["event"],
    reason?: string,
  ): void => {
    const startedAt = startedAtMs.get(diagnosticKey(identity)) ?? Date.now();
    diagnostics.push(
      deepFreeze({
        ...identity,
        event,
        latencyMs: Math.max(0, Date.now() - startedAt),
        ...(reason ? { reason } : {}),
        retryOutcome: "not_attempted",
      }),
    );
    if (diagnostics.length > MAX_DIAGNOSTICS) diagnostics.shift();
  };

  const update = (
    operation: RuntimeCoordinatorOperation,
    value:
      | RuntimeCoordinatorViewportUiState
      | RuntimeCoordinatorSearchUiState
      | RuntimeCoordinatorDetailUiState,
  ): void => {
    uiState = deepFreeze({ ...uiState, [operation]: value });
  };

  const isCurrent = (identity: RuntimeCoordinatorOperationIdentity): boolean =>
    !disposed &&
    sameResultSet(resultSet, {
      ...resultSet,
      activationEpoch: identity.activationEpoch,
      activeResultSetId: identity.activeResultSetId,
    }) &&
    latest.get(identity.operation)?.identity.requestSequence ===
      identity.requestSequence;

  const begin = (
    operation: RuntimeCoordinatorOperation,
    metadata: Parameters<typeof operationState>[3] = {},
  ):
    | Readonly<{
        identity: RuntimeCoordinatorOperationIdentity;
        status: "started";
      }>
    | Readonly<{ status: "superseded" }> => {
    if (disposed) return deepFreeze({ status: "superseded" });
    const prepared = createRuntimeActiveResultSetOperationRequest(
      resultSet,
      operation,
    );
    if (prepared.status !== "created")
      return deepFreeze({ status: "superseded" });
    const previous = latest.get(operation);
    if (previous)
      diagnose(previous.identity, "cancelled", "superseded_by_new_request");
    const identity = deepFreeze({
      activationEpoch: resultSet.activationEpoch,
      activeResultSetId: resultSet.activeResultSetId,
      operation,
      requestSequence: ++sequence,
    });
    startedAtMs.set(diagnosticKey(identity), Date.now());
    latest.set(
      operation,
      deepFreeze({ attribution: prepared.request.attribution, identity }),
    );
    update(
      operation,
      operationState(resultSet, "loading", identity.requestSequence, metadata),
    );
    diagnose(identity, "started");
    return deepFreeze({ identity, status: "started" });
  };

  const completion = (
    identity: RuntimeCoordinatorOperationIdentity,
    status: RuntimeCoordinatorUiStatus,
  ): RuntimeCoordinatorCompletion => deepFreeze({ identity, status });

  const rejectStale = (
    identity: RuntimeCoordinatorOperationIdentity,
  ): RuntimeCoordinatorCompletion => {
    diagnose(
      identity,
      "stale",
      disposed ? "coordinator_disposed" : "request_superseded",
    );
    return completion(identity, "superseded");
  };

  const validate = (
    identity: RuntimeCoordinatorOperationIdentity,
    response: unknown,
  ): "valid" | "rejected" => {
    const prepared = createRuntimeActiveResultSetOperationRequest(
      resultSet,
      identity.operation,
    );
    if (prepared.status !== "created") return "rejected";
    const attributed = validateRuntimeActiveResponseAttribution({
      activeResultSet: resultSet,
      request: prepared.request,
      response,
    });
    if (attributed.status === "valid") return "valid";
    diagnose(identity, "rejected", attributed.failure.code);
    return "rejected";
  };

  const settleFailure = (
    operation: RuntimeCoordinatorOperation,
    identity: RuntimeCoordinatorOperationIdentity,
    result:
      RuntimeViewportResult | RuntimeSpeciesSearchResult | RuntimeDetailResult,
    metadata: Parameters<typeof operationState>[3],
  ): RuntimeCoordinatorCompletion | undefined => {
    if (result.status !== "rejected" && result.status !== "unavailable")
      return undefined;
    const status = result.status;
    if (!isCurrent(identity)) return rejectStale(identity);
    update(
      operation,
      operationState(
        resultSet,
        status,
        identity.requestSequence,
        metadata,
        rejectionCategory(result.failure.code),
      ),
    );
    diagnose(
      identity,
      status === "unavailable" ? "unavailable" : "rejected",
      result.failure.code,
    );
    return completion(identity, status);
  };

  const settleUnexpectedFailure = (
    operation: RuntimeCoordinatorOperation,
    identity: RuntimeCoordinatorOperationIdentity,
    metadata: Parameters<typeof operationState>[3],
  ): RuntimeCoordinatorCompletion => {
    if (!isCurrent(identity)) return rejectStale(identity);
    update(
      operation,
      operationState(
        resultSet,
        "unavailable",
        identity.requestSequence,
        metadata,
      ),
    );
    diagnose(identity, "unavailable", "operation_threw");
    return completion(identity, "unavailable");
  };

  const runViewport = async (
    request: unknown,
  ): Promise<RuntimeCoordinatorCompletion> => {
    const metadata = { zoom: viewportZoom(request) };
    const started = begin("viewport", metadata);
    if (started.status !== "started")
      return deepFreeze({
        identity: deepFreeze({
          activationEpoch: resultSet.activationEpoch,
          activeResultSetId: resultSet.activeResultSetId,
          operation: "viewport",
          requestSequence: sequence,
        }),
        status: "superseded",
      });
    let response: RuntimeViewportResult;
    try {
      response = await dataSource.loadViewport(request);
    } catch {
      return settleUnexpectedFailure("viewport", started.identity, metadata);
    }
    if (!isCurrent(started.identity)) return rejectStale(started.identity);
    const failed = settleFailure(
      "viewport",
      started.identity,
      response,
      metadata,
    );
    if (failed) return failed;
    if (validate(started.identity, response) !== "valid") {
      update(
        "viewport",
        operationState(
          resultSet,
          "rejected",
          started.identity.requestSequence,
          metadata,
        ),
      );
      return completion(started.identity, "rejected");
    }
    if (response.status !== "clusters" && response.status !== "points") {
      update(
        "viewport",
        operationState(
          resultSet,
          "rejected",
          started.identity.requestSequence,
          metadata,
        ),
      );
      diagnose(started.identity, "rejected", "unexpected_response");
      return completion(started.identity, "rejected");
    }
    const state: RuntimeCoordinatorViewportUiState =
      response.status === "clusters"
        ? deepFreeze({
            ...operationState(
              resultSet,
              "loading",
              started.identity.requestSequence,
              metadata,
            ),
            result: { clusters: response.clusters, mode: "clusters" },
            status: "ready",
          })
        : deepFreeze({
            ...operationState(
              resultSet,
              "loading",
              started.identity.requestSequence,
              metadata,
            ),
            result: { mode: "points", points: response.points },
            status: "ready",
          });
    update("viewport", state);
    diagnose(started.identity, "completed");
    return completion(started.identity, "ready");
  };

  const runSearch = async (
    query: unknown,
  ): Promise<RuntimeCoordinatorCompletion> => {
    const metadata = { query: typeof query === "string" ? query : null };
    const started = begin("search", metadata);
    if (started.status !== "started")
      return completion(
        deepFreeze({
          activationEpoch: resultSet.activationEpoch,
          activeResultSetId: resultSet.activeResultSetId,
          operation: "search",
          requestSequence: sequence,
        }),
        "superseded",
      );
    let response: RuntimeSpeciesSearchResult;
    try {
      response = await dataSource.searchSpecies(query);
    } catch {
      return settleUnexpectedFailure("search", started.identity, metadata);
    }
    if (!isCurrent(started.identity)) return rejectStale(started.identity);
    const failed = settleFailure(
      "search",
      started.identity,
      response,
      metadata,
    );
    if (failed) return failed;
    if (validate(started.identity, response) !== "valid") {
      update(
        "search",
        operationState(
          resultSet,
          "rejected",
          started.identity.requestSequence,
          metadata,
        ),
      );
      return completion(started.identity, "rejected");
    }
    if (response.status !== "found" && response.status !== "not_found") {
      update(
        "search",
        operationState(
          resultSet,
          "rejected",
          started.identity.requestSequence,
          metadata,
        ),
      );
      diagnose(started.identity, "rejected", "unexpected_response");
      return completion(started.identity, "rejected");
    }
    const state: RuntimeCoordinatorSearchUiState = deepFreeze({
      ...operationState(
        resultSet,
        "loading",
        started.identity.requestSequence,
        metadata,
      ),
      result: {
        canonicalTreeIds:
          response.status === "found" ? response.canonicalTreeIds : [],
        normalizedQuery: response.normalizedQuery,
        speciesDisplayValues:
          response.status === "found" ? response.speciesDisplayValues : {},
        status: response.status,
      },
      status: "ready",
    });
    update("search", state);
    diagnose(started.identity, "completed");
    return completion(started.identity, "ready");
  };

  const runDetail = async (
    canonicalTreeId: unknown,
  ): Promise<RuntimeCoordinatorCompletion> => {
    const metadata = {
      canonicalTreeId:
        typeof canonicalTreeId === "string" ? canonicalTreeId : null,
    };
    const selection = createRuntimeActiveResultSetSelection(
      resultSet,
      canonicalTreeId,
    );
    if (selection.status !== "created") {
      const identity = deepFreeze({
        activationEpoch: resultSet.activationEpoch,
        activeResultSetId: resultSet.activeResultSetId,
        operation: "detail" as const,
        requestSequence: sequence,
      });
      update(
        "detail",
        operationState(
          resultSet,
          "rejected",
          identity.requestSequence,
          metadata,
          "invalid_request",
        ),
      );
      diagnose(identity, "rejected", selection.failure.code);
      return completion(identity, "rejected");
    }
    const started = begin("detail", metadata);
    if (started.status !== "started")
      return completion(
        deepFreeze({
          activationEpoch: resultSet.activationEpoch,
          activeResultSetId: resultSet.activeResultSetId,
          operation: "detail",
          requestSequence: sequence,
        }),
        "superseded",
      );
    let response: RuntimeDetailResult;
    try {
      response = await dataSource.loadDetail(canonicalTreeId);
    } catch {
      return settleUnexpectedFailure("detail", started.identity, metadata);
    }
    if (!isCurrent(started.identity)) return rejectStale(started.identity);
    const failed = settleFailure(
      "detail",
      started.identity,
      response,
      metadata,
    );
    if (failed) return failed;
    if (validate(started.identity, response) !== "valid") {
      update(
        "detail",
        operationState(
          resultSet,
          "rejected",
          started.identity.requestSequence,
          metadata,
        ),
      );
      return completion(started.identity, "rejected");
    }
    if (response.status !== "found" && response.status !== "not_found") {
      update(
        "detail",
        operationState(
          resultSet,
          "rejected",
          started.identity.requestSequence,
          metadata,
        ),
      );
      diagnose(started.identity, "rejected", "unexpected_response");
      return completion(started.identity, "rejected");
    }
    const state: RuntimeCoordinatorDetailUiState =
      response.status === "found"
        ? deepFreeze({
            ...operationState(
              resultSet,
              "loading",
              started.identity.requestSequence,
              metadata,
            ),
            result: { record: response.record, status: "found" },
            status: "ready",
          })
        : deepFreeze({
            ...operationState(
              resultSet,
              "loading",
              started.identity.requestSequence,
              metadata,
            ),
            result: { status: "not_found" },
            status: "ready",
          });
    update("detail", state);
    diagnose(started.identity, "completed");
    return completion(started.identity, "ready");
  };

  return Object.freeze({
    clearDetail() {
      if (disposed) return;
      const previous = latest.get("detail");
      if (previous) {
        latest.delete("detail");
        diagnose(previous.identity, "cancelled", "cleared_by_user");
      }
      update("detail", operationState(resultSet, "idle"));
    },
    clearSpeciesSearch() {
      if (disposed) return;
      const previous = latest.get("search");
      if (previous) {
        latest.delete("search");
        diagnose(previous.identity, "cancelled", "cleared_by_user");
      }
      update("search", operationState(resultSet, "idle"));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const operation of latest.values())
        diagnose(operation.identity, "disposed", "coordinator_disposed");
      uiState = deepFreeze({
        ...uiState,
        detail: operationState(resultSet, "superseded"),
        search: operationState(resultSet, "superseded"),
        viewport: operationState(resultSet, "superseded"),
      });
    },
    getDiagnostics: () => deepFreeze([...diagnostics]),
    getUiState: () => uiState,
    loadDetail: runDetail,
    loadViewport: runViewport,
    replaceActiveResultSet(next: unknown) {
      if (
        disposed ||
        typeof next !== "object" ||
        next === null ||
        Array.isArray(next)
      )
        return false;
      const candidate = next as Partial<RuntimeCoordinatorReplacement>;
      if (!candidate.dataSource || !candidate.resultSet) return false;
      const prepared = createRuntimeActiveResultSetOperationRequest(
        candidate.resultSet,
        "viewport",
      );
      if (prepared.status !== "created") return false;
      for (const operation of latest.values())
        diagnose(operation.identity, "cancelled", "active_result_set_replaced");
      resultSet = candidate.resultSet;
      dataSource = candidate.dataSource;
      latest.clear();
      uiState = initialUiState(resultSet);
      return true;
    },
    searchSpecies: runSearch,
  });
}
