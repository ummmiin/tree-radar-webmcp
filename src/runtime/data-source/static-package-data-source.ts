import {
  normalizeSpeciesExactValue,
  shardKeyFromSha256,
} from "../../domain/static-package-shard-contract.ts";
import type {
  RuntimeBindingFailureCode,
  RuntimeBindingStrategy,
} from "../binding/contracts.ts";
import { validateRuntimeBindingPackage } from "../binding/identity-validation.ts";
import type {
  ResolvedRuntimeBinding,
  RuntimeBindingResolution,
} from "../binding/resolver.ts";
import {
  type ClusterPayload,
  type DetailPayload,
  type OverviewPayload,
  type PointPayload,
  type SpeciesSearchPayload,
} from "../static-package/contracts.ts";
import {
  StaticPackageRuntimeError,
  type RuntimeFailureCode,
} from "../static-package/errors.ts";
import {
  defaultCrypto,
  sha256Hex,
  type WebCryptoLike,
} from "../static-package/integrity.ts";
import {
  createStaticPackageLoader,
  type StaticPackageLoader,
} from "../static-package/loader.ts";

const MAX_POINT_TILES_PER_VIEWPORT = 64;
const WEB_MERCATOR_MAX_LATITUDE = 85.0511287798066;
let nextDataSourceInstanceSequence = 0;

export const RUNTIME_DATA_SOURCE_FAILURE_CODES = [
  "binding_rejected",
  "identity_mismatch",
  "source_not_open",
  "capability_unsupported",
  "viewport_invalid",
  "viewport_resolution_unsupported",
  "viewport_tile_budget_exceeded",
  "canonical_id_invalid",
  "query_invalid",
  "generation_superseded",
  "network_unavailable",
  "payload_invalid",
  "source_unavailable",
] as const;

export type RuntimeDataSourceFailureCode =
  (typeof RUNTIME_DATA_SOURCE_FAILURE_CODES)[number];

export type RuntimeDataSourceFailure = Readonly<{
  code: RuntimeDataSourceFailureCode;
  operation: "detail" | "open" | "search" | "viewport";
  bindingFailureCode?: RuntimeBindingFailureCode;
}>;

export type RuntimeDataSourceCapabilities = Readonly<{
  canonicalDetail: boolean;
  speciesExactValueSearch: boolean;
  viewportClusters: boolean;
  viewportPoints: boolean;
}>;

/**
 * Runtime-internal identity used to attribute completed data-source operations.
 * It is deliberately absent from UI identity and contains no origin, URL,
 * manifest pin, descriptor, crypto, or loader diagnostic data.
 */
export type RuntimeDataSourceAttributionToken = Readonly<{
  binding: Readonly<{
    bindingId: string;
    canonicalSchemaVersion: string;
    cityId: string;
    datasetKey: string;
    strategy: RuntimeBindingStrategy;
  }>;
  dataSourceInstanceId: string;
  generation: number;
  runtimePackage: Readonly<{
    artifactSha256: string;
    canonicalSchemaVersion: string;
    packageHash: string;
    packageVersion: string;
  }>;
}>;

export type RuntimeDataSourceOperation = "detail" | "search" | "viewport";

export type RuntimeDataSourceResponseAttribution = Readonly<{
  operation: RuntimeDataSourceOperation;
  token: RuntimeDataSourceAttributionToken;
}>;

export const RUNTIME_DATA_SOURCE_ATTRIBUTION_FAILURE_CODES = [
  "attribution_invalid",
  "binding_identity_mismatch",
  "data_source_instance_mismatch",
  "generation_superseded",
  "operation_mismatch",
  "package_semantic_identity_mismatch",
] as const;

export type RuntimeDataSourceAttributionFailureCode =
  (typeof RUNTIME_DATA_SOURCE_ATTRIBUTION_FAILURE_CODES)[number];

export type RuntimeDataSourceAttributionValidation =
  | Readonly<{
      attribution: RuntimeDataSourceResponseAttribution;
      status: "valid";
    }>
  | Readonly<{
      code: RuntimeDataSourceAttributionFailureCode;
      status: "rejected";
    }>;

export type RuntimeDataSourceAttributionTokenValidation =
  | Readonly<{ status: "valid"; token: RuntimeDataSourceAttributionToken }>
  | Readonly<{
      code: "attribution_invalid";
      status: "rejected";
    }>;

/** Safe public identity: package URLs, hashes and loader state are withheld. */
export type OpenedRuntimeDataSourceIdentity = Readonly<{
  bindingId: string;
  canonicalSchemaVersion: string;
  cityId: string;
  datasetKey: string;
  generation: number;
  packageOfficialRecordCount: number;
  packageVersion: string;
  strategy: RuntimeBindingStrategy;
}>;

export type RuntimeDataSourceOpenResult =
  | Readonly<{
      attribution: RuntimeDataSourceAttributionToken;
      capabilities: RuntimeDataSourceCapabilities;
      identity: OpenedRuntimeDataSourceIdentity;
      status: "opened";
    }>
  | Readonly<{
      failure: RuntimeDataSourceFailure;
      status: "rejected" | "unavailable";
    }>;

export type RuntimeViewportRequest = Readonly<{
  bounds: Readonly<{
    east: number;
    north: number;
    south: number;
    west: number;
  }>;
  zoom: number;
}>;

export type RuntimeCluster = Readonly<{
  clusterId: string;
  representativeCoordinates: Readonly<{ latitude: number; longitude: number }>;
  recordCount: number;
  tile: Readonly<{ x: number; y: number; zoom: number }>;
}>;

export type RuntimePoint = Readonly<{
  canonicalTreeId: string;
  coordinates: Readonly<{ latitude: number; longitude: number }>;
  sourceRecordId: string;
  speciesDisplayValue: string | null;
}>;

export type RuntimeViewportResult =
  | Readonly<{
      attribution: RuntimeDataSourceResponseAttribution;
      clusters: readonly RuntimeCluster[];
      generation: number;
      status: "clusters";
    }>
  | Readonly<{
      attribution: RuntimeDataSourceResponseAttribution;
      generation: number;
      points: readonly RuntimePoint[];
      status: "points";
    }>
  | Readonly<{
      failure: RuntimeDataSourceFailure;
      generation?: number;
      status: "rejected" | "unavailable";
    }>;

export type RuntimeDetailResult =
  | Readonly<{
      attribution: RuntimeDataSourceResponseAttribution;
      generation: number;
      record: RuntimePoint;
      status: "found";
    }>
  | Readonly<{
      attribution: RuntimeDataSourceResponseAttribution;
      generation: number;
      status: "not_found";
    }>
  | Readonly<{
      failure: RuntimeDataSourceFailure;
      generation?: number;
      status: "rejected" | "unavailable";
    }>;

export type RuntimeSpeciesSearchResult =
  | Readonly<{
      attribution: RuntimeDataSourceResponseAttribution;
      canonicalTreeIds: readonly string[];
      generation: number;
      normalizedQuery: string;
      semantics: "species-exact-value";
      status: "found";
    }>
  | Readonly<{
      attribution: RuntimeDataSourceResponseAttribution;
      generation: number;
      normalizedQuery: string;
      semantics: "species-exact-value";
      status: "not_found";
    }>
  | Readonly<{
      failure: RuntimeDataSourceFailure;
      generation?: number;
      status: "rejected" | "unavailable";
    }>;

export type RuntimeStaticPackageDataSource = Readonly<{
  loadDetail(canonicalTreeId: unknown): Promise<RuntimeDetailResult>;
  loadViewport(request: unknown): Promise<RuntimeViewportResult>;
  open(): Promise<RuntimeDataSourceOpenResult>;
  replaceBinding(binding: RuntimeBindingResolution): void;
  searchSpecies(query: unknown): Promise<RuntimeSpeciesSearchResult>;
}>;

type LoaderFactory = (binding: ResolvedRuntimeBinding) => StaticPackageLoader;
type OpenState = Readonly<{
  attribution: RuntimeDataSourceAttributionToken;
  capabilities: RuntimeDataSourceCapabilities;
  identity: OpenedRuntimeDataSourceIdentity;
  revision: number;
}>;
type Tile = Readonly<{ x: number; y: number; zoom: number }>;

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function responseAttribution(
  token: RuntimeDataSourceAttributionToken,
  operation: RuntimeDataSourceOperation,
): RuntimeDataSourceResponseAttribution {
  return freeze({ operation, token });
}

function tokenEquals(
  left: RuntimeDataSourceAttributionToken,
  right: RuntimeDataSourceAttributionToken,
): RuntimeDataSourceAttributionFailureCode | undefined {
  if (left.dataSourceInstanceId !== right.dataSourceInstanceId)
    return "data_source_instance_mismatch";
  if (
    left.binding.bindingId !== right.binding.bindingId ||
    left.binding.cityId !== right.binding.cityId ||
    left.binding.datasetKey !== right.binding.datasetKey ||
    left.binding.canonicalSchemaVersion !== right.binding.canonicalSchemaVersion
  )
    return "binding_identity_mismatch";
  if (
    left.runtimePackage.artifactSha256 !==
      right.runtimePackage.artifactSha256 ||
    left.runtimePackage.canonicalSchemaVersion !==
      right.runtimePackage.canonicalSchemaVersion ||
    left.runtimePackage.packageHash !== right.runtimePackage.packageHash ||
    left.runtimePackage.packageVersion !== right.runtimePackage.packageVersion
  )
    return "package_semantic_identity_mismatch";
  if (left.generation !== right.generation) return "generation_superseded";
  return undefined;
}

function isExactRecord(
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

function isAttributionToken(
  value: unknown,
): value is RuntimeDataSourceAttributionToken {
  if (
    !isExactRecord(value, [
      "binding",
      "dataSourceInstanceId",
      "generation",
      "runtimePackage",
    ]) ||
    typeof value.dataSourceInstanceId !== "string" ||
    typeof value.generation !== "number" ||
    !Number.isInteger(value.generation) ||
    value.generation < 1 ||
    !isExactRecord(value.binding, [
      "bindingId",
      "canonicalSchemaVersion",
      "cityId",
      "datasetKey",
      "strategy",
    ]) ||
    !Object.values(value.binding).every((item) => typeof item === "string") ||
    !isExactRecord(value.runtimePackage, [
      "artifactSha256",
      "canonicalSchemaVersion",
      "packageHash",
      "packageVersion",
    ]) ||
    !Object.values(value.runtimePackage).every(
      (item) => typeof item === "string",
    )
  )
    return false;
  return value.binding.strategy === "static-package-v1";
}

/**
 * Validates an internal token without manufacturing an operation response.
 * Active Result Set admission uses this before it compares the token with the
 * successfully opened data-source identity.
 */
export function validateRuntimeDataSourceAttributionToken(
  value: unknown,
): RuntimeDataSourceAttributionTokenValidation {
  return isAttributionToken(value)
    ? freeze({ status: "valid", token: value })
    : freeze({ code: "attribution_invalid", status: "rejected" });
}

/**
 * Validates a completed operation against its expected internal token. Future
 * Active Result Set admission can add its own epoch and result-set checks on
 * top of this data-source ownership proof.
 */
export function validateRuntimeDataSourceResponseAttribution(
  input: Readonly<{
    expected: RuntimeDataSourceAttributionToken;
    operation: RuntimeDataSourceOperation;
    response: unknown;
  }>,
): RuntimeDataSourceAttributionValidation {
  if (typeof input.response !== "object" || input.response === null)
    return freeze({ code: "attribution_invalid", status: "rejected" });
  const attribution = (input.response as Record<string, unknown>).attribution;
  if (typeof attribution !== "object" || attribution === null)
    return freeze({ code: "attribution_invalid", status: "rejected" });
  if (!isExactRecord(attribution, ["operation", "token"]))
    return freeze({ code: "attribution_invalid", status: "rejected" });
  const candidate = attribution as RuntimeDataSourceResponseAttribution;
  if (candidate.operation !== input.operation)
    return freeze({ code: "operation_mismatch", status: "rejected" });
  if (
    validateRuntimeDataSourceAttributionToken(candidate.token).status !==
    "valid"
  )
    return freeze({ code: "attribution_invalid", status: "rejected" });
  const mismatch = tokenEquals(input.expected, candidate.token);
  return mismatch
    ? freeze({ code: mismatch, status: "rejected" })
    : freeze({
        attribution: candidate,
        status: "valid",
      });
}

function failure(
  code: RuntimeDataSourceFailureCode,
  operation: RuntimeDataSourceFailure["operation"],
  bindingFailureCode?: RuntimeBindingFailureCode,
): RuntimeDataSourceFailure {
  return freeze({
    code,
    operation,
    ...(bindingFailureCode ? { bindingFailureCode } : {}),
  });
}

function rejected(
  code: RuntimeDataSourceFailureCode,
  operation: RuntimeDataSourceFailure["operation"],
  generation?: number,
): Readonly<{
  failure: RuntimeDataSourceFailure;
  generation?: number;
  status: "rejected";
}> {
  return freeze({
    failure: failure(code, operation),
    ...(generation === undefined ? {} : { generation }),
    status: "rejected",
  });
}

function unavailable(
  code: RuntimeDataSourceFailureCode,
  operation: RuntimeDataSourceFailure["operation"],
  generation?: number,
): Readonly<{
  failure: RuntimeDataSourceFailure;
  generation?: number;
  status: "unavailable";
}> {
  return freeze({
    failure: failure(code, operation),
    ...(generation === undefined ? {} : { generation }),
    status: "unavailable",
  });
}

function runtimeErrorCode(cause: unknown): RuntimeFailureCode | undefined {
  return cause instanceof StaticPackageRuntimeError ? cause.code : undefined;
}

function failureForLoader(
  cause: unknown,
  operation: RuntimeDataSourceFailure["operation"],
): RuntimeDataSourceFailureCode {
  const code = runtimeErrorCode(cause);
  if (code === "generation_superseded" || code === "request_aborted")
    return "generation_superseded";
  if (
    code === "payload_decode_failed" ||
    code === "payload_parse_failed" ||
    code === "payload_schema_invalid" ||
    code === "payload_identity_mismatch" ||
    code === "file_integrity_mismatch" ||
    code === "file_size_mismatch"
  )
    return "payload_invalid";
  if (
    code === "file_fetch_failed" ||
    code === "file_not_found" ||
    code === "request_timeout" ||
    code === "queue_capacity_exceeded"
  )
    return "network_unavailable";
  return operation === "open" ? "source_unavailable" : "source_unavailable";
}

function projectPoint(record: {
  canonicalTreeId: string;
  coordinates: { latitude: number; longitude: number };
  sourceRecordId: string;
  speciesDisplayValue: string | null;
}): RuntimePoint {
  return freeze({
    canonicalTreeId: record.canonicalTreeId,
    coordinates: freeze({ ...record.coordinates }),
    sourceRecordId: record.sourceRecordId,
    speciesDisplayValue: record.speciesDisplayValue,
  });
}

function projectCluster(
  record: ClusterPayload["clusters"][number],
): RuntimeCluster {
  return freeze({
    clusterId: record.clusterId,
    representativeCoordinates: freeze({ ...record.representativeCoordinates }),
    recordCount: record.recordCount,
    tile: freeze({ ...record.tile }),
  });
}

function isOverview(payload: unknown): payload is OverviewPayload {
  return typeof payload === "object" && payload !== null && "cityId" in payload;
}
function isCluster(payload: unknown): payload is ClusterPayload {
  return (
    typeof payload === "object" && payload !== null && "clusters" in payload
  );
}
function isPoint(payload: unknown): payload is PointPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "records" in payload &&
    "tile" in payload
  );
}
function isDetail(payload: unknown): payload is DetailPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "records" in payload &&
    "shard" in payload
  );
}
function isSpeciesSearch(payload: unknown): payload is SpeciesSearchPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "entries" in payload &&
    "type" in payload
  );
}

function capabilitiesFromManifest(
  files: readonly { path: string }[],
): RuntimeDataSourceCapabilities {
  return freeze({
    canonicalDetail: files.some((file) => file.path.startsWith("details/")),
    speciesExactValueSearch: files.some((file) =>
      file.path.startsWith("search/species/"),
    ),
    viewportClusters: files.some((file) =>
      /^clusters\/z(?:10|12|14)\.json$/u.test(file.path),
    ),
    viewportPoints: files.some((file) => file.path.startsWith("points/z15/")),
  });
}

function parseViewport(input: unknown): RuntimeViewportRequest | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return undefined;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== 2 || typeof value.zoom !== "number")
    return undefined;
  if (
    typeof value.bounds !== "object" ||
    value.bounds === null ||
    Array.isArray(value.bounds)
  )
    return undefined;
  const bounds = value.bounds as Record<string, unknown>;
  if (
    Object.keys(bounds).length !== 4 ||
    ![bounds.west, bounds.south, bounds.east, bounds.north, value.zoom].every(
      (entry) => typeof entry === "number" && Number.isFinite(entry),
    )
  )
    return undefined;
  const west = bounds.west;
  const south = bounds.south;
  const east = bounds.east;
  const north = bounds.north;
  if (
    typeof west !== "number" ||
    typeof south !== "number" ||
    typeof east !== "number" ||
    typeof north !== "number"
  )
    return undefined;
  if (
    !Number.isInteger(value.zoom) ||
    west < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90 ||
    west > east ||
    south > north
  )
    return undefined;
  return freeze({
    bounds: freeze({ east, north, south, west }),
    zoom: value.zoom,
  });
}

function tileFor(longitude: number, latitude: number, zoom: number): Tile {
  const size = 2 ** zoom;
  const x = Math.min(
    size - 1,
    Math.max(0, Math.floor(((longitude + 180) / 360) * size)),
  );
  const safeLatitude = Math.min(
    WEB_MERCATOR_MAX_LATITUDE,
    Math.max(-WEB_MERCATOR_MAX_LATITUDE, latitude),
  );
  const y = Math.min(
    size - 1,
    Math.max(
      0,
      Math.floor(
        ((1 - Math.asinh(Math.tan((safeLatitude * Math.PI) / 180)) / Math.PI) /
          2) *
          size,
      ),
    ),
  );
  return freeze({ x, y, zoom });
}

function tilesForViewport(
  request: RuntimeViewportRequest,
  zoom: number,
): readonly Tile[] {
  const northWest = tileFor(request.bounds.west, request.bounds.north, zoom);
  const southEast = tileFor(request.bounds.east, request.bounds.south, zoom);
  const tiles: Tile[] = [];
  for (let y = northWest.y; y <= southEast.y; y += 1)
    for (let x = northWest.x; x <= southEast.x; x += 1)
      tiles.push(freeze({ x, y, zoom }));
  return freeze(tiles);
}

function viewportTileCount(
  request: RuntimeViewportRequest,
  zoom: number,
): number {
  const northWest = tileFor(request.bounds.west, request.bounds.north, zoom);
  const southEast = tileFor(request.bounds.east, request.bounds.south, zoom);
  return (southEast.y - northWest.y + 1) * (southEast.x - northWest.x + 1);
}

async function shardFor(
  value: string,
  crypto: WebCryptoLike | undefined,
): Promise<string> {
  const digest = await sha256Hex(new TextEncoder().encode(value), crypto);
  return shardKeyFromSha256(digest);
}

function containsAsciiControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? -1;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function validCanonicalTreeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value === value.trim() &&
    !containsAsciiControl(value)
  );
}

/**
 * The sole runtime-layer consumer of StaticPackageLoader. It exposes only
 * verified, capability-scoped projections and never exposes loader payloads.
 */
export function createRuntimeStaticPackageDataSource(
  input: Readonly<{
    binding: RuntimeBindingResolution;
    createLoader?: LoaderFactory;
    crypto?: WebCryptoLike | undefined;
  }>,
): RuntimeStaticPackageDataSource {
  const createLoader =
    input.createLoader ?? ((binding) => createStaticPackageLoader({ binding }));
  const crypto = input.crypto ?? defaultCrypto();
  const dataSourceInstanceId = `runtime-data-source-${String(++nextDataSourceInstanceSequence)}`;
  let binding = input.binding;
  let loader =
    binding.status === "resolved" ? createLoader(binding.binding) : undefined;
  let revision = 0;
  let opened: OpenState | undefined;
  let opening:
    | Readonly<{
        promise: Promise<RuntimeDataSourceOpenResult>;
        revision: number;
      }>
    | undefined;

  const current = (state: OpenState): boolean =>
    state.revision === revision &&
    loader?.getDiagnostics().generation === state.identity.generation;

  const openFresh = async (): Promise<RuntimeDataSourceOpenResult> => {
    const openingRevision = revision;
    if (binding.status === "rejected")
      return freeze({
        failure: failure("binding_rejected", "open", binding.failure.code),
        status: "rejected",
      });
    const activeLoader = loader;
    if (!activeLoader) return unavailable("source_unavailable", "open");
    try {
      const manifest = await activeLoader.loadManifest();
      const overviewPayload = await activeLoader.loadDescriptor({
        capability: "overview",
      });
      if (openingRevision !== revision)
        return unavailable("generation_superseded", "open");
      if (!isOverview(overviewPayload))
        return unavailable("payload_invalid", "open");
      const validation = validateRuntimeBindingPackage(binding.binding, {
        manifest,
        overview: overviewPayload,
      });
      if (validation.status === "invalid")
        return freeze({
          failure: failure(
            "identity_mismatch",
            "open",
            validation.failure.code,
          ),
          status: "rejected",
        });
      const diagnosticGeneration = activeLoader.getDiagnostics().generation;
      if (
        typeof diagnosticGeneration !== "number" ||
        !Number.isInteger(diagnosticGeneration) ||
        diagnosticGeneration < 1 ||
        openingRevision !== revision
      )
        return unavailable("generation_superseded", "open");
      const generation = diagnosticGeneration;
      const identity = freeze({
        bindingId: binding.binding.bindingId,
        canonicalSchemaVersion: validation.identity.canonicalSchemaVersion,
        cityId: validation.identity.cityId,
        datasetKey: validation.identity.datasetKey,
        generation,
        packageOfficialRecordCount: overviewPayload.recordCount,
        packageVersion: validation.identity.packageVersion,
        strategy: binding.binding.strategy,
      });
      const attribution = freeze({
        binding: freeze({
          bindingId: binding.binding.bindingId,
          canonicalSchemaVersion: binding.binding.canonicalSchemaVersion,
          cityId: binding.binding.cityId,
          datasetKey: binding.binding.datasetKey,
          strategy: binding.binding.strategy,
        }),
        dataSourceInstanceId,
        generation,
        runtimePackage: freeze({
          artifactSha256: validation.identity.artifactSha256,
          canonicalSchemaVersion: validation.identity.canonicalSchemaVersion,
          packageHash: validation.identity.packageHash,
          packageVersion: validation.identity.packageVersion,
        }),
      });
      const state: OpenState = freeze({
        attribution,
        capabilities: capabilitiesFromManifest(manifest.manifest.files),
        identity,
        revision: openingRevision,
      });
      if (openingRevision !== revision)
        return unavailable("generation_superseded", "open");
      opened = state;
      return freeze({
        attribution: state.attribution,
        capabilities: state.capabilities,
        identity,
        status: "opened",
      });
    } catch (cause) {
      return unavailable(failureForLoader(cause, "open"), "open");
    }
  };

  const requireOpen = (
    operation: RuntimeDataSourceFailure["operation"],
  ): OpenState | RuntimeDataSourceFailure => {
    if (!opened) return failure("source_not_open", operation);
    if (!current(opened)) return failure("generation_superseded", operation);
    return opened;
  };

  return freeze({
    open: async () => {
      if (opened && current(opened))
        return freeze({
          attribution: opened.attribution,
          capabilities: opened.capabilities,
          identity: opened.identity,
          status: "opened",
        });
      if (opening?.revision === revision) return opening.promise;
      const promise = openFresh();
      opening = freeze({ promise, revision });
      try {
        return await promise;
      } finally {
        if (opening.promise === promise) opening = undefined;
      }
    },
    replaceBinding: (nextBinding) => {
      revision += 1;
      opened = undefined;
      opening = undefined;
      binding = nextBinding;
      if (binding.status === "resolved") {
        if (loader) loader.replaceBinding(binding.binding);
        else loader = createLoader(binding.binding);
      } else {
        loader?.dispose();
        loader = undefined;
      }
    },
    loadViewport: async (input) => {
      const state = requireOpen("viewport");
      if ("code" in state) return rejected(state.code, "viewport");
      const request = parseViewport(input);
      if (!request)
        return rejected(
          "viewport_invalid",
          "viewport",
          state.identity.generation,
        );
      if ([10, 12, 14].includes(request.zoom)) {
        if (!state.capabilities.viewportClusters)
          return rejected(
            "capability_unsupported",
            "viewport",
            state.identity.generation,
          );
        if (
          viewportTileCount(request, request.zoom) >
          MAX_POINT_TILES_PER_VIEWPORT
        )
          return rejected(
            "viewport_tile_budget_exceeded",
            "viewport",
            state.identity.generation,
          );
        const activeLoader = loader;
        if (!activeLoader)
          return unavailable(
            "generation_superseded",
            "viewport",
            state.identity.generation,
          );
        try {
          const payload = await activeLoader.loadDescriptor({
            capability: "cluster",
            zoom: request.zoom as 10 | 12 | 14,
          });
          if (!current(state))
            return unavailable(
              "generation_superseded",
              "viewport",
              state.identity.generation,
            );
          if (!isCluster(payload))
            return unavailable(
              "payload_invalid",
              "viewport",
              state.identity.generation,
            );
          const tiles = new Set(
            tilesForViewport(request, request.zoom).map(
              (tile) => `${String(tile.x)}:${String(tile.y)}`,
            ),
          );
          const clusters = payload.clusters
            .filter((cluster) =>
              tiles.has(`${String(cluster.tile.x)}:${String(cluster.tile.y)}`),
            )
            .map(projectCluster)
            .sort((left, right) =>
              left.clusterId < right.clusterId
                ? -1
                : left.clusterId > right.clusterId
                  ? 1
                  : 0,
            );
          return freeze({
            attribution: responseAttribution(state.attribution, "viewport"),
            clusters: freeze(clusters),
            generation: state.identity.generation,
            status: "clusters",
          });
        } catch (cause) {
          return unavailable(
            failureForLoader(cause, "viewport"),
            "viewport",
            state.identity.generation,
          );
        }
      }
      if (request.zoom !== 15)
        return rejected(
          "viewport_resolution_unsupported",
          "viewport",
          state.identity.generation,
        );
      if (!state.capabilities.viewportPoints)
        return rejected(
          "capability_unsupported",
          "viewport",
          state.identity.generation,
        );
      if (viewportTileCount(request, 15) > MAX_POINT_TILES_PER_VIEWPORT)
        return rejected(
          "viewport_tile_budget_exceeded",
          "viewport",
          state.identity.generation,
        );
      const tiles = tilesForViewport(request, 15);
      const activeLoader = loader;
      if (!activeLoader)
        return unavailable(
          "generation_superseded",
          "viewport",
          state.identity.generation,
        );
      try {
        const payloads = await Promise.all(
          tiles.map(async (tile) => {
            try {
              const payload = await activeLoader.loadDescriptor({
                capability: "point",
                tile: tile as { x: number; y: number; zoom: 15 },
              });
              return isPoint(payload) ? payload : undefined;
            } catch (cause) {
              if (runtimeErrorCode(cause) === "descriptor_not_found")
                return undefined;
              throw cause;
            }
          }),
        );
        if (!current(state))
          return unavailable(
            "generation_superseded",
            "viewport",
            state.identity.generation,
          );
        const points = payloads
          .flatMap((payload) => payload?.records ?? [])
          .map(projectPoint)
          .sort((left, right) =>
            left.canonicalTreeId < right.canonicalTreeId
              ? -1
              : left.canonicalTreeId > right.canonicalTreeId
                ? 1
                : 0,
          );
        return freeze({
          attribution: responseAttribution(state.attribution, "viewport"),
          generation: state.identity.generation,
          points: freeze(points),
          status: "points",
        });
      } catch (cause) {
        return unavailable(
          failureForLoader(cause, "viewport"),
          "viewport",
          state.identity.generation,
        );
      }
    },
    loadDetail: async (canonicalTreeId) => {
      const state = requireOpen("detail");
      if ("code" in state) return rejected(state.code, "detail");
      if (!validCanonicalTreeId(canonicalTreeId))
        return rejected(
          "canonical_id_invalid",
          "detail",
          state.identity.generation,
        );
      if (!state.capabilities.canonicalDetail)
        return rejected(
          "capability_unsupported",
          "detail",
          state.identity.generation,
        );
      const activeLoader = loader;
      if (!activeLoader)
        return unavailable(
          "generation_superseded",
          "detail",
          state.identity.generation,
        );
      try {
        const shard = await shardFor(canonicalTreeId, crypto);
        const payload = await activeLoader.loadDescriptor({
          capability: "detail",
          shard,
        });
        if (!current(state))
          return unavailable(
            "generation_superseded",
            "detail",
            state.identity.generation,
          );
        if (!isDetail(payload))
          return unavailable(
            "payload_invalid",
            "detail",
            state.identity.generation,
          );
        const record = payload.records.find(
          (item) => item.canonicalTreeId === canonicalTreeId,
        );
        return record
          ? freeze({
              attribution: responseAttribution(state.attribution, "detail"),
              generation: state.identity.generation,
              record: projectPoint(record),
              status: "found",
            })
          : freeze({
              attribution: responseAttribution(state.attribution, "detail"),
              generation: state.identity.generation,
              status: "not_found",
            });
      } catch (cause) {
        if (runtimeErrorCode(cause) === "descriptor_not_found") {
          if (!current(state))
            return unavailable(
              "generation_superseded",
              "detail",
              state.identity.generation,
            );
          return freeze({
            attribution: responseAttribution(state.attribution, "detail"),
            generation: state.identity.generation,
            status: "not_found",
          });
        }
        return unavailable(
          failureForLoader(cause, "detail"),
          "detail",
          state.identity.generation,
        );
      }
    },
    searchSpecies: async (query) => {
      const state = requireOpen("search");
      if ("code" in state) return rejected(state.code, "search");
      if (typeof query !== "string" || query.length > 512)
        return rejected("query_invalid", "search", state.identity.generation);
      const normalizedQuery = normalizeSpeciesExactValue(query);
      if (!normalizedQuery)
        return rejected("query_invalid", "search", state.identity.generation);
      if (!state.capabilities.speciesExactValueSearch)
        return rejected(
          "capability_unsupported",
          "search",
          state.identity.generation,
        );
      const activeLoader = loader;
      if (!activeLoader)
        return unavailable(
          "generation_superseded",
          "search",
          state.identity.generation,
        );
      try {
        const shard = await shardFor(normalizedQuery, crypto);
        const payload = await activeLoader.loadDescriptor({
          capability: "species-search",
          shard,
        });
        if (!current(state))
          return unavailable(
            "generation_superseded",
            "search",
            state.identity.generation,
          );
        if (!isSpeciesSearch(payload))
          return unavailable(
            "payload_invalid",
            "search",
            state.identity.generation,
          );
        const canonicalTreeIds = payload.entries[normalizedQuery];
        return canonicalTreeIds && canonicalTreeIds.length > 0
          ? freeze({
              attribution: responseAttribution(state.attribution, "search"),
              canonicalTreeIds: freeze([...canonicalTreeIds]),
              generation: state.identity.generation,
              normalizedQuery,
              semantics: "species-exact-value",
              status: "found",
            })
          : freeze({
              attribution: responseAttribution(state.attribution, "search"),
              generation: state.identity.generation,
              normalizedQuery,
              semantics: "species-exact-value",
              status: "not_found",
            });
      } catch (cause) {
        if (runtimeErrorCode(cause) === "descriptor_not_found") {
          if (!current(state))
            return unavailable(
              "generation_superseded",
              "search",
              state.identity.generation,
            );
          return freeze({
            attribution: responseAttribution(state.attribution, "search"),
            generation: state.identity.generation,
            normalizedQuery,
            semantics: "species-exact-value",
            status: "not_found",
          });
        }
        return unavailable(
          failureForLoader(cause, "search"),
          "search",
          state.identity.generation,
        );
      }
    },
  });
}
