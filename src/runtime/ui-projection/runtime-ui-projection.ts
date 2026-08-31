import type { RuntimeActiveResultSetUiIdentity } from "../active-result-set/contracts.ts";
import type {
  RuntimeCoordinatorCompletion,
  RuntimeCoordinatorDetailUiState,
  RuntimeCoordinatorSearchUiState,
  RuntimeCoordinatorUiRejectionCategory,
  RuntimeCoordinatorUiState,
  RuntimeCoordinatorViewportUiState,
} from "../coordinator/runtime-coordinator.ts";

export const RUNTIME_UI_LIFECYCLE_CATEGORIES = [
  "idle",
  "opening",
  "loading",
  "ready",
  "unavailable",
  "rejected",
  "superseded",
  "capability_unsupported",
  "no_result",
  "not_found",
  "invalid_request",
] as const;

export type RuntimeUiLifecycleCategory =
  (typeof RUNTIME_UI_LIFECYCLE_CATEGORIES)[number];

export type RuntimeUiSessionIdentity = Readonly<{
  activationEpoch: number;
  activeResultSetId: string;
  cityId: string;
  datasetKey: string;
  lifecycle: RuntimeActiveResultSetUiIdentity["lifecycle"];
}>;

export type RuntimeUiRequestIdentity = Readonly<{
  activationEpoch: number;
  activeResultSetId: string;
  requestSequence: number | null;
}>;

export type RuntimeUiMapCluster = Readonly<{
  clusterId: string;
  displayCoordinates: Readonly<{ latitude: number; longitude: number }>;
  recordCount: number;
  tile: Readonly<{ x: number; y: number; zoom: number }>;
}>;

export type RuntimeUiMapPoint = Readonly<{
  canonicalTreeId: string;
  coordinates: Readonly<{ latitude: number; longitude: number }>;
  sourceRecordId: string;
  speciesDisplayValue: string | null;
}>;

export type RuntimeUiMapViewModel = Readonly<{
  identity: RuntimeUiSessionIdentity;
  request: RuntimeUiRequestIdentity & Readonly<{ zoom: number | null }>;
  result: Readonly<{
    clusters?: readonly RuntimeUiMapCluster[];
    mode?: "clusters" | "points";
    points?: readonly RuntimeUiMapPoint[];
  }>;
  status: RuntimeUiLifecycleCategory;
}>;

export type RuntimeUiSearchViewModel = Readonly<{
  identity: RuntimeUiSessionIdentity;
  normalizedQuery: string | null;
  query: string | null;
  resultReferences: readonly Readonly<{
    canonicalTreeId: string;
    speciesDisplayValue: string;
  }>[];
  resultCount: number | undefined;
  semantics: "species-exact-value" | "species-partial-value";
  status: RuntimeUiLifecycleCategory;
}>;

export type RuntimeUiDetailFieldAvailability = Readonly<{
  canonicalTreeId: "available";
  coordinates: "available";
  sourceRecordId: "available";
  speciesDisplayValue: "available";
  productionDetailFields: "unavailable";
}>;

export type RuntimeUiDetailViewModel = Readonly<{
  fieldAvailability: RuntimeUiDetailFieldAvailability | undefined;
  identity: RuntimeUiSessionIdentity;
  record?: RuntimeUiMapPoint;
  selection:
    | Readonly<{
        activationEpoch: number;
        activeResultSetId: string;
        canonicalTreeId: string;
      }>
    | undefined;
  status: RuntimeUiLifecycleCategory;
}>;

export type RuntimeUiStatistic = Readonly<{
  scope:
    | "loaded_points"
    | "package_official_total"
    | "search_results"
    | "visible_cluster_record_count"
    | "visible_cluster_count";
  status: RuntimeUiLifecycleCategory;
  value?: number;
}>;

export type RuntimeUiAccessibilityProjection = Readonly<{
  announcement:
    | "active"
    | "loading"
    | "result_set_replaced"
    | "unavailable"
    | "unavailable_or_rejected";
  ariaBusy: boolean;
  detailSelectionInvalidated: boolean;
}>;

export type RuntimeUiProjection = Readonly<{
  accessibility: RuntimeUiAccessibilityProjection;
  detail: RuntimeUiDetailViewModel;
  identity: RuntimeUiSessionIdentity;
  map: RuntimeUiMapViewModel;
  search: RuntimeUiSearchViewModel;
  statistics: readonly RuntimeUiStatistic[];
}>;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}

function sessionIdentity(
  identity: RuntimeActiveResultSetUiIdentity,
): RuntimeUiSessionIdentity {
  return deepFreeze({
    activationEpoch: identity.activationEpoch,
    activeResultSetId: identity.activeResultSetId,
    cityId: identity.cityId,
    datasetKey: identity.datasetKey,
    lifecycle: identity.lifecycle,
  });
}

function category(
  status:
    "idle" | "loading" | "ready" | "rejected" | "superseded" | "unavailable",
  rejectionCategory?: RuntimeCoordinatorUiRejectionCategory,
): RuntimeUiLifecycleCategory {
  if (status === "rejected" && rejectionCategory !== undefined)
    return rejectionCategory;
  return status;
}

function request(
  state: Readonly<{
    activationEpoch: number;
    activeResultSetId: string;
    requestSequence: number | null;
  }>,
): RuntimeUiRequestIdentity {
  return deepFreeze({
    activationEpoch: state.activationEpoch,
    activeResultSetId: state.activeResultSetId,
    requestSequence: state.requestSequence,
  });
}

function mapProjection(
  identity: RuntimeUiSessionIdentity,
  state: RuntimeCoordinatorViewportUiState,
): RuntimeUiMapViewModel {
  const base = {
    identity,
    request: deepFreeze({ ...request(state), zoom: state.zoom }),
  };
  if (state.status !== "ready")
    return deepFreeze({
      ...base,
      result: {},
      status: category(state.status, state.rejectionCategory),
    });
  if (state.result.mode === "clusters")
    return deepFreeze({
      ...base,
      result: {
        clusters: state.result.clusters.map((cluster) =>
          deepFreeze({
            clusterId: cluster.clusterId,
            displayCoordinates: { ...cluster.representativeCoordinates },
            recordCount: cluster.recordCount,
            tile: { ...cluster.tile },
          }),
        ),
        mode: "clusters" as const,
      },
      status: "ready" as const,
    });
  return deepFreeze({
    ...base,
    result: {
      mode: "points" as const,
      points: state.result.points.map((point) =>
        deepFreeze({ ...point, coordinates: { ...point.coordinates } }),
      ),
    },
    status: "ready" as const,
  });
}

function searchProjection(
  identity: RuntimeUiSessionIdentity,
  state: RuntimeCoordinatorSearchUiState,
): RuntimeUiSearchViewModel {
  if (state.status !== "ready")
    return deepFreeze({
      identity,
      normalizedQuery: null,
      query: state.query,
      resultCount: undefined,
      resultReferences: [],
      semantics: "species-exact-value",
      status: category(state.status, state.rejectionCategory),
    });
  const found = state.result.status === "found";
  return deepFreeze({
    identity,
    normalizedQuery: state.result.normalizedQuery,
    query: state.query,
    resultCount: found ? state.result.canonicalTreeIds.length : 0,
    resultReferences: found
      ? state.result.canonicalTreeIds.map((canonicalTreeId) =>
          deepFreeze({
            canonicalTreeId,
            speciesDisplayValue:
              state.result.speciesDisplayValues[canonicalTreeId] ??
              "未提供樹種名稱",
          }),
        )
      : [],
    semantics: state.result.semantics,
    status: found ? "ready" : "no_result",
  });
}

function detailProjection(
  identity: RuntimeUiSessionIdentity,
  state: RuntimeCoordinatorDetailUiState,
): RuntimeUiDetailViewModel {
  const selection =
    state.canonicalTreeId === null
      ? undefined
      : deepFreeze({
          activationEpoch: state.activationEpoch,
          activeResultSetId: state.activeResultSetId,
          canonicalTreeId: state.canonicalTreeId,
        });
  if (state.status !== "ready")
    return deepFreeze({
      fieldAvailability: undefined,
      identity,
      selection,
      status: category(state.status, state.rejectionCategory),
    });
  if (state.result.status === "not_found")
    return deepFreeze({
      fieldAvailability: undefined,
      identity,
      selection,
      status: "not_found",
    });
  return deepFreeze({
    fieldAvailability: {
      canonicalTreeId: "available",
      coordinates: "available",
      sourceRecordId: "available",
      speciesDisplayValue: "available",
      productionDetailFields: "unavailable",
    },
    identity,
    record: deepFreeze({
      ...state.result.record,
      coordinates: { ...state.result.record.coordinates },
    }),
    selection,
    status: "ready",
  });
}

function stateStatistic(
  scope: RuntimeUiStatistic["scope"],
  status: RuntimeUiLifecycleCategory,
  value?: number,
): RuntimeUiStatistic {
  return deepFreeze({
    scope,
    status,
    ...(value === undefined ? {} : { value }),
  });
}

function statistics(
  identity: RuntimeActiveResultSetUiIdentity,
  map: RuntimeUiMapViewModel,
  search: RuntimeUiSearchViewModel,
): readonly RuntimeUiStatistic[] {
  const values: RuntimeUiStatistic[] = [
    stateStatistic(
      "package_official_total",
      "ready",
      identity.packageOfficialRecordCount,
    ),
  ];
  if (map.status === "ready" && map.result.mode === "points") {
    values.push(
      stateStatistic("loaded_points", "ready", map.result.points?.length ?? 0),
    );
  } else if (map.status === "ready" && map.result.mode === "clusters") {
    const clusters = map.result.clusters ?? [];
    values.push(stateStatistic("loaded_points", "ready", 0));
    values.push(
      stateStatistic("visible_cluster_count", "ready", clusters.length),
    );
    values.push(
      stateStatistic(
        "visible_cluster_record_count",
        "ready",
        clusters.reduce((total, cluster) => total + cluster.recordCount, 0),
      ),
    );
  } else {
    values.push(stateStatistic("loaded_points", map.status));
    values.push(stateStatistic("visible_cluster_count", map.status));
    values.push(stateStatistic("visible_cluster_record_count", map.status));
  }
  values.push(
    stateStatistic("search_results", search.status, search.resultCount),
  );
  return deepFreeze(values);
}

/** Converts only Coordinator's immutable safe snapshot into UI-facing models. */
export function projectRuntimeUiState(
  state: RuntimeCoordinatorUiState,
  previous?: RuntimeUiProjection,
): RuntimeUiProjection {
  const identity = sessionIdentity(state.activeResultSet);
  const map = mapProjection(identity, state.viewport);
  const search = searchProjection(identity, state.search);
  const detail = detailProjection(identity, state.detail);
  const replaced =
    previous !== undefined &&
    (previous.identity.activeResultSetId !== identity.activeResultSetId ||
      previous.identity.activationEpoch !== identity.activationEpoch);
  const busy = [map.status, search.status, detail.status].includes("loading");
  const unavailable = [map.status, search.status, detail.status].some(
    (status) => status === "unavailable",
  );
  return deepFreeze({
    accessibility: {
      announcement: replaced
        ? "result_set_replaced"
        : busy
          ? "loading"
          : unavailable
            ? "unavailable"
            : "active",
      ariaBusy: busy,
      detailSelectionInvalidated: replaced,
    },
    detail,
    identity,
    map,
    search,
    statistics: statistics(state.activeResultSet, map, search),
  });
}

export type RuntimeUiSession = Readonly<{
  clearDetail(): void;
  clearSpeciesSearch(): void;
  dispose(): void;
  getSnapshot(): RuntimeUiProjection;
  loadDetail(canonicalTreeId: unknown): Promise<RuntimeCoordinatorCompletion>;
  loadViewport(request: unknown): Promise<RuntimeCoordinatorCompletion>;
  searchSpecies(query: unknown): Promise<RuntimeCoordinatorCompletion>;
  subscribe(listener: () => void): () => void;
}>;

/**
 * Host-only owner for wiring a replacement Result Set. Components receive only
 * `session`, which deliberately has no Data Source or replacement input.
 */
export type RuntimeUiSessionHost = Readonly<{
  replaceActiveResultSet(input: unknown): boolean;
  session: RuntimeUiSession;
}>;

export function createRuntimeUiSession(
  input: Readonly<{
    coordinator: Readonly<{
      clearDetail(): void;
      clearSpeciesSearch(): void;
      dispose(): void;
      getUiState(): RuntimeCoordinatorUiState;
      loadDetail(
        canonicalTreeId: unknown,
      ): Promise<RuntimeCoordinatorCompletion>;
      loadViewport(request: unknown): Promise<RuntimeCoordinatorCompletion>;
      replaceActiveResultSet(input: unknown): boolean;
      searchSpecies(query: unknown): Promise<RuntimeCoordinatorCompletion>;
    }>;
  }>,
): RuntimeUiSessionHost {
  const listeners = new Set<() => void>();
  let snapshot = projectRuntimeUiState(input.coordinator.getUiState());
  let disposed = false;
  const publish = () => {
    snapshot = projectRuntimeUiState(input.coordinator.getUiState(), snapshot);
    listeners.forEach((listener) => {
      listener();
    });
  };
  const command = async (
    operation: () => Promise<RuntimeCoordinatorCompletion>,
  ) => {
    const result = operation();
    publish();
    const completion = await result;
    publish();
    return completion;
  };
  const session: RuntimeUiSession = Object.freeze({
    clearDetail() {
      input.coordinator.clearDetail();
      publish();
    },
    clearSpeciesSearch() {
      input.coordinator.clearSpeciesSearch();
      publish();
    },
    dispose() {
      if (!disposed) {
        disposed = true;
        input.coordinator.dispose();
        publish();
        listeners.clear();
      }
    },
    getSnapshot: () => snapshot,
    loadDetail: (canonicalTreeId) =>
      command(() => input.coordinator.loadDetail(canonicalTreeId)),
    loadViewport: (request) =>
      command(() => input.coordinator.loadViewport(request)),
    searchSpecies: (query) =>
      command(() => input.coordinator.searchSpecies(query)),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
  return Object.freeze({
    replaceActiveResultSet(next) {
      const replaced = input.coordinator.replaceActiveResultSet(next);
      publish();
      return replaced;
    },
    session,
  });
}
