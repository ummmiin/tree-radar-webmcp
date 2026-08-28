import { normalizeSpeciesExactValue } from "../domain/static-package-shard-contract.ts";
import type { RuntimeUiSession } from "../runtime/ui-projection/runtime-ui-projection.ts";
import { TAICHUNG_CHALLENGE_CONFIG } from "./taichung-config.ts";

export const TAICHUNG_WEBMCP_MAX_RESULTS = 20;
export const TAICHUNG_WEBMCP_MAX_RADIUS_METERS = 1_000;
export const TAICHUNG_WEBMCP_MAX_TREE_IDS = 5;
const WEB_MERCATOR_MAX_LATITUDE = 85.0511287798066;
const WEB_MCP_ZOOM = 15;

type JsonRecord = Record<string, unknown>;
type WebMcpSignalContext = Readonly<{ signal?: AbortSignal }>;

export type TaichungWebMcpTree = Readonly<{
  canonicalTreeId: string;
  coordinates: Readonly<{ latitude: number; longitude: number }>;
  distanceMeters?: number;
  sourceRecordId: string;
  speciesDisplayValue: string | null;
}>;

type TaichungWebMcpMapController = Readonly<{
  showTrees(
    trees: readonly TaichungWebMcpTree[],
    selectTreeId: string | null,
  ): void;
}>;

type WebMcpToolDefinition = Readonly<{
  annotations?: Readonly<{
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
  }>;
  description: string;
  execute(input: unknown, context: WebMcpSignalContext): Promise<unknown>;
  inputSchema: JsonRecord;
  name: string;
}>;

type WebMcpModelContext = Readonly<{
  registerTool(
    tool: WebMcpToolDefinition,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<unknown>;
}>;

export type WebMcpDocumentLike = Readonly<{
  modelContext?: WebMcpModelContext;
}>;

export type TaichungWebMcpTools = Readonly<{
  findTrees(input: unknown, context?: WebMcpSignalContext): Promise<unknown>;
  getCityCoverage(input: unknown): unknown;
  showTreesOnMap(input: unknown): unknown;
}>;

const registeredContexts = new WeakSet<WebMcpModelContext>();

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function failure(code: string, message: string, extra: JsonRecord = {}) {
  return freeze({
    ...extra,
    error: freeze({ code, message }),
    status: "rejected" as const,
  });
}

function aborted() {
  return failure("aborted", "The request was cancelled.");
}

function signalAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(value: JsonRecord, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function normalizeCity(value: unknown): "taichung" | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (
    normalized === "臺中" ||
    normalized === "台中" ||
    ["taichung", "taichung city"].includes(normalized.toLowerCase())
  )
    return "taichung";
  return undefined;
}

function validCoordinate(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

type Bounds = Readonly<{
  east: number;
  north: number;
  south: number;
  west: number;
}>;

function parseBounds(value: unknown): Bounds | undefined {
  if (!isRecord(value) || !onlyKeys(value, ["east", "north", "south", "west"]))
    return undefined;
  const { east, north, south, west } = value;
  if (
    !validCoordinate(west, -180, 180) ||
    !validCoordinate(east, -180, 180) ||
    !validCoordinate(south, -90, 90) ||
    !validCoordinate(north, -90, 90) ||
    west > east ||
    south > north
  )
    return undefined;
  return freeze({ east, north, south, west });
}

function tileFor(
  longitude: number,
  latitude: number,
): Readonly<{ x: number; y: number }> {
  const size = 2 ** WEB_MCP_ZOOM;
  const safeLatitude = Math.min(
    WEB_MERCATOR_MAX_LATITUDE,
    Math.max(-WEB_MERCATOR_MAX_LATITUDE, latitude),
  );
  return freeze({
    x: Math.min(
      size - 1,
      Math.max(0, Math.floor(((longitude + 180) / 360) * size)),
    ),
    y: Math.min(
      size - 1,
      Math.max(
        0,
        Math.floor(
          ((1 -
            Math.asinh(Math.tan((safeLatitude * Math.PI) / 180)) / Math.PI) /
            2) *
            size,
        ),
      ),
    ),
  });
}

function pointTileCount(bounds: Bounds): number {
  const northWest = tileFor(bounds.west, bounds.north);
  const southEast = tileFor(bounds.east, bounds.south);
  return (southEast.x - northWest.x + 1) * (southEast.y - northWest.y + 1);
}

function radiusBounds(
  latitude: number,
  longitude: number,
  radiusMeters: number,
): Bounds | undefined {
  const latitudeDelta = (radiusMeters / 6_371_008.8) * (180 / Math.PI);
  const cosine = Math.cos((latitude * Math.PI) / 180);
  if (Math.abs(cosine) < 0.000001) return undefined;
  const longitudeDelta = latitudeDelta / cosine;
  const bounds = {
    east: longitude + longitudeDelta,
    north: latitude + latitudeDelta,
    south: latitude - latitudeDelta,
    west: longitude - longitudeDelta,
  };
  return parseBounds(bounds);
}

function distanceMeters(
  latitude: number,
  longitude: number,
  otherLatitude: number,
  otherLongitude: number,
): number {
  const radians = Math.PI / 180;
  const latitudeDifference = (otherLatitude - latitude) * radians;
  const longitudeDifference = (otherLongitude - longitude) * radians;
  const a =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(latitude * radians) *
      Math.cos(otherLatitude * radians) *
      Math.sin(longitudeDifference / 2) ** 2;
  return 2 * 6_371_008.8 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type ParsedFindTrees = Readonly<{
  bounds: Bounds;
  distanceFrom?: Readonly<{
    latitude: number;
    longitude: number;
    radiusMeters: number;
  }>;
  limit: number;
  species: string | undefined;
}>;

function parseFindTrees(
  input: unknown,
): ParsedFindTrees | ReturnType<typeof failure> {
  if (
    !isRecord(input) ||
    !onlyKeys(input, [
      "bounds",
      "city",
      "latitude",
      "limit",
      "longitude",
      "radiusMeters",
      "species",
    ])
  )
    return failure(
      "input_invalid",
      "Provide only the documented find_trees fields.",
    );
  if (!normalizeCity(input.city))
    return failure(
      "city_unsupported",
      "Only Taichung is available in this preview.",
    );
  const limit = input.limit ?? TAICHUNG_WEBMCP_MAX_RESULTS;
  if (
    !Number.isInteger(limit) ||
    typeof limit !== "number" ||
    limit < 1 ||
    limit > TAICHUNG_WEBMCP_MAX_RESULTS
  )
    return failure(
      "limit_invalid",
      `limit must be an integer from 1 to ${String(TAICHUNG_WEBMCP_MAX_RESULTS)}.`,
    );
  const species = input.species;
  if (
    species !== undefined &&
    (typeof species !== "string" || species.length > 512)
  )
    return failure(
      "species_invalid",
      "species must be a source-language value no longer than 512 characters.",
    );
  let normalizedSpecies: string | undefined;
  if (species !== undefined) {
    const normalized = normalizeSpeciesExactValue(species);
    if (!normalized)
      return failure(
        "species_invalid",
        "species must contain a source-language value.",
      );
    normalizedSpecies = normalized;
  }
  const hasBounds = input.bounds !== undefined;
  const hasRadiusFields = [
    input.latitude,
    input.longitude,
    input.radiusMeters,
  ].some((value) => value !== undefined);
  if (hasBounds === hasRadiusFields)
    return failure(
      "location_invalid",
      "Provide either latitude, longitude, radiusMeters or bounds.",
    );
  if (hasBounds) {
    const bounds = parseBounds(input.bounds);
    if (!bounds)
      return failure(
        "bounds_invalid",
        "bounds must be a valid geographic rectangle.",
      );
    if (pointTileCount(bounds) > 64)
      return failure(
        "bounds_too_large",
        "bounds exceed the bounded point-query tile budget.",
      );
    return freeze({ bounds, limit, species: normalizedSpecies });
  }
  const { latitude, longitude, radiusMeters } = input;
  if (
    !validCoordinate(latitude, -90, 90) ||
    !validCoordinate(longitude, -180, 180) ||
    typeof radiusMeters !== "number" ||
    !Number.isFinite(radiusMeters) ||
    radiusMeters <= 0 ||
    radiusMeters > TAICHUNG_WEBMCP_MAX_RADIUS_METERS
  )
    return failure(
      "radius_invalid",
      `radiusMeters must be greater than 0 and no more than ${String(TAICHUNG_WEBMCP_MAX_RADIUS_METERS)}.`,
    );
  const bounds = radiusBounds(latitude, longitude, radiusMeters);
  if (!bounds || pointTileCount(bounds) > 64)
    return failure(
      "radius_scope_invalid",
      "The requested radius cannot be queried within the point budget.",
    );
  return freeze({
    bounds,
    distanceFrom: freeze({ latitude, longitude, radiusMeters }),
    limit,
    species: normalizedSpecies,
  });
}

function focusedBounds(
  trees: readonly TaichungWebMcpTree[],
): Bounds | undefined {
  if (trees.length === 0) return undefined;
  return freeze({
    east: Math.max(...trees.map((tree) => tree.coordinates.longitude)),
    north: Math.max(...trees.map((tree) => tree.coordinates.latitude)),
    south: Math.min(...trees.map((tree) => tree.coordinates.latitude)),
    west: Math.min(...trees.map((tree) => tree.coordinates.longitude)),
  });
}

export function createTaichungWebMcpTools(
  input: Readonly<{
    mapController: TaichungWebMcpMapController;
    session: RuntimeUiSession;
  }>,
): TaichungWebMcpTools {
  let latestCandidates = new Map<string, TaichungWebMcpTree>();
  return freeze({
    getCityCoverage(value) {
      if (!isRecord(value) || !onlyKeys(value, ["city"]))
        return failure("input_invalid", "Provide a city.");
      if (!normalizeCity(value.city))
        return failure(
          "city_unsupported",
          "Only Taichung is available in this preview.",
        );
      return freeze({
        capabilities: freeze([
          "bounded_nearby_tree_discovery",
          "source_language_species_exact_match",
          "ephemeral_map_focus",
        ]),
        cityDisplayName: TAICHUNG_CHALLENGE_CONFIG.displayName,
        cityId: TAICHUNG_CHALLENGE_CONFIG.id,
        coverageDescription:
          "Taichung street-tree records from the admitted preview package.",
        officialRecordCount: TAICHUNG_CHALLENGE_CONFIG.officialRecordCount,
        sourceAttribution: TAICHUNG_CHALLENGE_CONFIG.provider,
        sourceOrganization: TAICHUNG_CHALLENGE_CONFIG.provider,
        sourceUrl: TAICHUNG_CHALLENGE_CONFIG.datasetUrl,
        status: "ok" as const,
      });
    },
    async findTrees(value, context = {}) {
      if (context.signal?.aborted) return aborted();
      const parsed = parseFindTrees(value);
      if ("status" in parsed) return parsed;
      try {
        await input.session.loadViewport({
          bounds: parsed.bounds,
          zoom: WEB_MCP_ZOOM,
        });
      } catch {
        return failure(
          "query_unavailable",
          "The bounded tree query is unavailable.",
        );
      }
      if (context.signal?.aborted) return aborted();
      const map = input.session.getSnapshot().map;
      if (map.status !== "ready" || map.result.mode !== "points")
        return failure(
          "query_unavailable",
          "The bounded tree query is unavailable.",
        );
      const trees = (map.result.points ?? [])
        .filter((point) =>
          parsed.species === undefined
            ? true
            : normalizeSpeciesExactValue(point.speciesDisplayValue ?? "") ===
              parsed.species,
        )
        .filter(
          (point) =>
            !parsed.distanceFrom ||
            distanceMeters(
              parsed.distanceFrom.latitude,
              parsed.distanceFrom.longitude,
              point.coordinates.latitude,
              point.coordinates.longitude,
            ) <= parsed.distanceFrom.radiusMeters,
        )
        .map((point) => {
          const distance = parsed.distanceFrom
            ? Math.round(
                distanceMeters(
                  parsed.distanceFrom.latitude,
                  parsed.distanceFrom.longitude,
                  point.coordinates.latitude,
                  point.coordinates.longitude,
                ),
              )
            : undefined;
          return freeze({
            canonicalTreeId: point.canonicalTreeId,
            coordinates: freeze({ ...point.coordinates }),
            ...(distance === undefined ? {} : { distanceMeters: distance }),
            sourceRecordId: point.sourceRecordId,
            speciesDisplayValue: point.speciesDisplayValue,
          });
        })
        .toSorted((left, right) => {
          if ((left.distanceMeters ?? 0) !== (right.distanceMeters ?? 0))
            return (left.distanceMeters ?? 0) - (right.distanceMeters ?? 0);
          return left.canonicalTreeId.localeCompare(right.canonicalTreeId);
        })
        .slice(0, parsed.limit);
      latestCandidates = new Map(
        trees.map((tree) => [tree.canonicalTreeId, tree]),
      );
      return freeze({
        cityId: "taichung",
        sourceAttribution: TAICHUNG_CHALLENGE_CONFIG.provider,
        sourceUrl: TAICHUNG_CHALLENGE_CONFIG.datasetUrl,
        status: "ok" as const,
        trees: freeze(trees),
      });
    },
    showTreesOnMap(value) {
      if (
        !isRecord(value) ||
        !onlyKeys(value, ["selectTreeId", "treeIds"]) ||
        !Array.isArray(value.treeIds)
      )
        return failure(
          "input_invalid",
          "Provide treeIds and an optional selectTreeId.",
        );
      if (
        value.treeIds.length < 1 ||
        value.treeIds.length > TAICHUNG_WEBMCP_MAX_TREE_IDS ||
        !value.treeIds.every((id) => typeof id === "string")
      )
        return failure(
          "tree_ids_invalid",
          `treeIds must contain 1 to ${String(TAICHUNG_WEBMCP_MAX_TREE_IDS)} IDs.`,
        );
      if (
        value.selectTreeId !== undefined &&
        typeof value.selectTreeId !== "string"
      )
        return failure(
          "select_tree_invalid",
          "selectTreeId must be a tree ID.",
        );
      const uniqueIds = [...new Set(value.treeIds)];
      const acceptedTrees = uniqueIds.flatMap((id) => {
        const tree = latestCandidates.get(id);
        return tree ? [tree] : [];
      });
      const acceptedIds = acceptedTrees.map((tree) => tree.canonicalTreeId);
      const rejectedIds = uniqueIds.filter((id) => !latestCandidates.has(id));
      const selectedId =
        typeof value.selectTreeId === "string" &&
        acceptedIds.includes(value.selectTreeId)
          ? value.selectTreeId
          : null;
      if (acceptedTrees.length === 0)
        return failure(
          "no_valid_tree_ids",
          "None of the supplied tree IDs are available from the latest bounded query.",
          {
            acceptedIds: freeze([]),
            rejectedIds: freeze(rejectedIds),
            selectedId,
          },
        );
      input.mapController.showTrees(freeze(acceptedTrees), selectedId);
      return freeze({
        acceptedIds: freeze(acceptedIds),
        focusedBounds: focusedBounds(acceptedTrees),
        rejectedIds: freeze(rejectedIds),
        selectedId,
        status: "ok" as const,
      });
    },
  });
}

function toolDefinitions(
  tools: TaichungWebMcpTools,
): readonly WebMcpToolDefinition[] {
  return freeze([
    freeze({
      annotations: freeze({ readOnlyHint: true, untrustedContentHint: false }),
      description:
        "Get truthful coverage metadata for a supported Tree Radar city.",
      execute: (input) => Promise.resolve(tools.getCityCoverage(input)),
      inputSchema: freeze({
        additionalProperties: false,
        properties: {
          city: { description: "Taichung city alias.", type: "string" },
        },
        required: ["city"],
        type: "object",
      }),
      name: "get_city_coverage",
    }),
    freeze({
      annotations: freeze({ readOnlyHint: true, untrustedContentHint: false }),
      description:
        "Find a bounded set of Taichung trees near supplied coordinates or inside supplied bounds. Named places are not supported.",
      execute: (input, context) => tools.findTrees(input, context),
      inputSchema: freeze({
        additionalProperties: false,
        properties: {
          bounds: {
            description: "west, south, east, north geographic bounds.",
            type: "object",
          },
          city: { description: "Taichung city alias.", type: "string" },
          latitude: { type: "number" },
          limit: {
            maximum: TAICHUNG_WEBMCP_MAX_RESULTS,
            minimum: 1,
            type: "integer",
          },
          longitude: { type: "number" },
          radiusMeters: {
            maximum: TAICHUNG_WEBMCP_MAX_RADIUS_METERS,
            minimum: 1,
            type: "number",
          },
          species: {
            description: "Exact source-language species value only.",
            type: "string",
          },
        },
        required: ["city"],
        type: "object",
      }),
      name: "find_trees",
    }),
    freeze({
      annotations: freeze({ readOnlyHint: false, untrustedContentHint: false }),
      description:
        "Ephemerally highlight bounded tree candidates on the Taichung map and optionally open one existing detail panel.",
      execute: (input) => Promise.resolve(tools.showTreesOnMap(input)),
      inputSchema: freeze({
        additionalProperties: false,
        properties: {
          selectTreeId: { type: "string" },
          treeIds: {
            items: { type: "string" },
            maxItems: TAICHUNG_WEBMCP_MAX_TREE_IDS,
            minItems: 1,
            type: "array",
          },
        },
        required: ["treeIds"],
        type: "object",
      }),
      name: "show_trees_on_map",
    }),
  ]);
}

export async function registerTaichungWebMcpTools(
  input: Readonly<{
    documentLike: WebMcpDocumentLike | undefined;
    signal: AbortSignal;
    tools: TaichungWebMcpTools;
  }>,
): Promise<
  Readonly<{ dispose(): void; status: "registered" | "unavailable" }>
> {
  const context = input.documentLike?.modelContext;
  if (
    !context ||
    signalAborted(input.signal) ||
    registeredContexts.has(context)
  )
    return freeze({ dispose: () => undefined, status: "unavailable" });
  try {
    for (const tool of toolDefinitions(input.tools)) {
      if (signalAborted(input.signal))
        return freeze({ dispose: () => undefined, status: "unavailable" });
      await context.registerTool(tool, { signal: input.signal });
    }
    if (signalAborted(input.signal))
      return freeze({ dispose: () => undefined, status: "unavailable" });
    registeredContexts.add(context);
    return freeze({
      dispose() {
        registeredContexts.delete(context);
      },
      status: "registered",
    });
  } catch {
    return freeze({ dispose: () => undefined, status: "unavailable" });
  }
}
