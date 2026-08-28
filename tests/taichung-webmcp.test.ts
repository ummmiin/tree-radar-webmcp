import { describe, expect, it, vi } from "vitest";

import type { RuntimeUiProjection } from "../src/runtime/ui-projection/runtime-ui-projection.ts";
import {
  createTaichungWebMcpTools,
  registerTaichungWebMcpTools,
  type WebMcpDocumentLike,
} from "../src/challenge/taichung-webmcp.ts";

const firstId = "taichung:data.gov.tw:109853:a";
const secondId = "taichung:data.gov.tw:109853:b";
const thirdId = "taichung:data.gov.tw:109853:c";

type Point = Readonly<{
  canonicalTreeId: string;
  coordinates: Readonly<{ latitude: number; longitude: number }>;
  sourceRecordId: string;
  speciesDisplayValue: string | null;
}>;

function projection(points: readonly Point[]): RuntimeUiProjection {
  const identity = {
    activationEpoch: 1,
    activeResultSetId: "set-1",
    cityId: "taichung",
    datasetKey: "street-trees",
    lifecycle: "active" as const,
  };
  return {
    accessibility: {
      announcement: "active",
      ariaBusy: false,
      detailSelectionInvalidated: false,
    },
    detail: {
      fieldAvailability: {
        canonicalTreeId: "available",
        coordinates: "available",
        productionDetailFields: "unavailable",
        sourceRecordId: "available",
        speciesDisplayValue: "available",
      },
      identity,
      selection: undefined,
      status: "idle",
    },
    identity,
    map: {
      identity,
      request: {
        activationEpoch: 1,
        activeResultSetId: "set-1",
        requestSequence: 1,
        zoom: 15,
      },
      result: { mode: "points", points },
      status: "ready",
    },
    search: {
      identity,
      normalizedQuery: null,
      query: null,
      resultCount: 0,
      resultReferences: [],
      semantics: "species-exact-value",
      speciesDisplayValue: null,
      status: "idle",
    },
    statistics: [],
  };
}

function fixture(points: readonly Point[]) {
  const loadViewport = vi.fn(() =>
    Promise.resolve({ status: "ready" as const }),
  );
  const session = {
    clearDetail: () => undefined,
    clearSpeciesSearch: () => undefined,
    dispose: () => undefined,
    getSnapshot: () => projection(points),
    loadDetail: () => Promise.resolve({ status: "ready" as const }),
    loadViewport,
    searchSpecies: () => Promise.resolve({ status: "ready" as const }),
    subscribe: () => () => undefined,
  };
  const showTrees = vi.fn();
  return {
    loadViewport,
    showTrees,
    tools: createTaichungWebMcpTools({
      mapController: { showTrees },
      session: session as never,
    }),
  };
}

const points = Object.freeze([
  {
    canonicalTreeId: secondId,
    coordinates: { latitude: 24.15, longitude: 120.66 },
    sourceRecordId: "b",
    speciesDisplayValue: "樟樹",
  },
  {
    canonicalTreeId: firstId,
    coordinates: { latitude: 24.1501, longitude: 120.6601 },
    sourceRecordId: "a",
    speciesDisplayValue: "臺灣欒樹",
  },
  {
    canonicalTreeId: thirdId,
    coordinates: { latitude: 24.1502, longitude: 120.6602 },
    sourceRecordId: "c",
    speciesDisplayValue: "榕樹",
  },
] satisfies readonly Point[]);

describe("Taichung WebMCP bounded discovery tools", () => {
  it.each(["taichung", "Taichung", "Taichung City", "臺中", "台中"])(
    "normalizes the supported city alias %s",
    (city) => {
      const { tools } = fixture(points);
      expect(tools.getCityCoverage({ city })).toMatchObject({
        cityId: "taichung",
        officialRecordCount: 118403,
        sourceOrganization: "臺中市政府建設局",
        status: "ok",
      });
    },
  );

  it("rejects unsupported city coverage cleanly", () => {
    const { tools } = fixture(points);
    expect(tools.getCityCoverage({ city: "Taipei" })).toMatchObject({
      error: { code: "city_unsupported" },
      status: "rejected",
    });
  });

  it("performs one bounded coordinate query and deterministically orders nearby trees", async () => {
    const { loadViewport, tools } = fixture(points);
    const result = await tools.findTrees({
      city: "Taichung",
      latitude: 24.15,
      limit: 3,
      longitude: 120.66,
      radiusMeters: 100,
    });
    expect(loadViewport).toHaveBeenCalledTimes(1);
    expect(loadViewport).toHaveBeenCalledWith(
      expect.objectContaining({ zoom: 15 }),
    );
    expect(result).toMatchObject({ status: "ok" });
    expect(result).toMatchObject({
      trees: [
        { canonicalTreeId: secondId, distanceMeters: 0 },
        { canonicalTreeId: firstId },
        { canonicalTreeId: thirdId },
      ],
    });
  });

  it("supports bounded rectangle and source-language exact species filtering", async () => {
    const { tools } = fixture(points);
    const result = await tools.findTrees({
      bounds: { east: 120.67, north: 24.16, south: 24.14, west: 120.65 },
      city: "臺中",
      species: " 臺灣欒樹 ",
    });
    expect(result).toMatchObject({
      status: "ok",
      trees: [{ canonicalTreeId: firstId, speciesDisplayValue: "臺灣欒樹" }],
    });
  });

  it("rejects oversized radius, oversized bounds, malformed input, and cancellation before loading", async () => {
    const { loadViewport, tools } = fixture(points);
    await expect(
      tools.findTrees({
        city: "taichung",
        latitude: 24.15,
        longitude: 120.66,
        radiusMeters: 1001,
      }),
    ).resolves.toMatchObject({ error: { code: "radius_invalid" } });
    await expect(
      tools.findTrees({
        bounds: { east: 180, north: 80, south: -80, west: -180 },
        city: "taichung",
      }),
    ).resolves.toMatchObject({ error: { code: "bounds_too_large" } });
    await expect(tools.findTrees({ city: "taichung" })).resolves.toMatchObject({
      error: { code: "location_invalid" },
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      tools.findTrees(
        {
          city: "taichung",
          latitude: 24.15,
          longitude: 120.66,
          radiusMeters: 100,
        },
        { signal: controller.signal },
      ),
    ).resolves.toMatchObject({ error: { code: "aborted" } });
    expect(loadViewport).not.toHaveBeenCalled();
  });

  it("replaces candidates, focuses accepted IDs, and preserves rejected IDs without persistence", async () => {
    const { showTrees, tools } = fixture(points);
    await tools.findTrees({
      bounds: { east: 120.67, north: 24.16, south: 24.14, west: 120.65 },
      city: "taichung",
    });
    expect(
      tools.showTreesOnMap({
        selectTreeId: firstId,
        treeIds: [firstId, secondId, "unknown"],
      }),
    ).toMatchObject({
      acceptedIds: [firstId, secondId],
      rejectedIds: ["unknown"],
      selectedId: firstId,
      status: "ok",
    });
    expect(showTrees).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ canonicalTreeId: firstId }),
      ]),
      firstId,
    );
    await tools.findTrees({
      bounds: { east: 120.67, north: 24.16, south: 24.14, west: 120.65 },
      city: "taichung",
      species: "榕樹",
    });
    expect(tools.showTreesOnMap({ treeIds: [firstId] })).toMatchObject({
      error: { code: "no_valid_tree_ids" },
      status: "rejected",
    });
    expect(
      tools.showTreesOnMap({ treeIds: Array(6).fill(firstId) }),
    ).toMatchObject({
      error: { code: "tree_ids_invalid" },
      status: "rejected",
    });
  });

  it("does not register when WebMCP is unavailable and registers exactly three tools once", async () => {
    const { tools } = fixture(points);
    const controller = new AbortController();
    await expect(
      registerTaichungWebMcpTools({
        documentLike: undefined,
        signal: controller.signal,
        tools,
      }),
    ).resolves.toMatchObject({ status: "unavailable" });
    const names: string[] = [];
    const documentLike: WebMcpDocumentLike = {
      modelContext: {
        registerTool: (tool, options) => {
          names.push(tool.name);
          expect(options?.signal).toBe(controller.signal);
          return Promise.resolve();
        },
      },
    };
    const registered = await registerTaichungWebMcpTools({
      documentLike,
      signal: controller.signal,
      tools,
    });
    expect(registered.status).toBe("registered");
    expect(names).toEqual([
      "get_city_coverage",
      "find_trees",
      "show_trees_on_map",
    ]);
    await expect(
      registerTaichungWebMcpTools({
        documentLike,
        signal: controller.signal,
        tools,
      }),
    ).resolves.toMatchObject({ status: "unavailable" });
    registered.dispose();
  });
});
