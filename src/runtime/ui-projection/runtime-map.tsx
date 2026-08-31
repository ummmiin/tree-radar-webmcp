"use client";

import { useEffect, useRef } from "react";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapStyleImageMissingEvent,
} from "maplibre-gl";

import {
  handleMissingStyleImage,
  TREE_MAP_LOCALE,
  TREE_MAP_STYLE_URL,
} from "../../challenge/map-style.ts";
import type { RuntimeUiProjection } from "./runtime-ui-projection.ts";

export const RUNTIME_MAP_STYLE_URL = TREE_MAP_STYLE_URL;
export const RUNTIME_CLUSTER_ICON_ID = "tree-radar-cluster-canopy";
export const RUNTIME_CLUSTER_ICON_SIZE = [
  "get",
  "localClusterIconSize",
] as const;
export const RUNTIME_CLUSTER_ICON_SIZE_BUCKETS = Object.freeze([
  0.62, 0.78, 0.94, 1.1, 1.26,
] as const);
export const RUNTIME_AGENT_CANDIDATE_SOURCE_ID = "runtime-agent-candidates";

export type RuntimeMapCandidate = Readonly<{
  canonicalTreeId: string;
  coordinates: Readonly<{ latitude: number; longitude: number }>;
}>;

export function formatRuntimeClusterRecordCount(recordCount: number): string {
  if (!Number.isFinite(recordCount) || recordCount < 0) return "0";
  if (recordCount < 1_000) return Math.round(recordCount).toLocaleString("en");
  const compact = Math.round((recordCount / 1_000) * 10) / 10;
  return `${Number.isInteger(compact) ? String(compact) : compact.toFixed(1)}k`;
}

export type RuntimeViewportRequest = Readonly<{
  bounds: Readonly<{
    east: number;
    north: number;
    south: number;
    west: number;
  }>;
  zoom: 10 | 12 | 14 | 15;
}>;
type RuntimeViewportMap = Readonly<{
  getBounds(): Readonly<{
    getEast(): number;
    getNorth(): number;
    getSouth(): number;
    getWest(): number;
  }>;
  getZoom(): number;
}>;

function runtimeZoom(zoom: number): 10 | 12 | 14 | 15 {
  if (zoom < 11) return 10;
  if (zoom < 13) return 12;
  if (zoom < 14.5) return 14;
  return 15;
}

export function runtimeViewportRequest(
  map: RuntimeViewportMap,
): RuntimeViewportRequest {
  const bounds = map.getBounds();
  return Object.freeze({
    bounds: Object.freeze({
      east: bounds.getEast(),
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      west: bounds.getWest(),
    }),
    zoom: runtimeZoom(map.getZoom()),
  });
}

/** Advances one package resolution tier; points are requested only at z15. */
export function runtimeClusterDrillZoom(currentZoom: number): number {
  if (currentZoom < 12) return 11;
  if (currentZoom < 14) return 13;
  return 15;
}

/**
 * Maps counts to five stable, bounded ranks within one viewport response.
 * It deliberately has no city-wide total input, so icon area communicates local
 * hierarchy only and cannot make sparse cities visually subordinate to Taichung.
 */
export function runtimeLocalClusterIconSizes(
  clusters: readonly Readonly<{ clusterId: string; recordCount: number }>[],
): Readonly<Record<string, number>> {
  const uniqueCounts = [
    ...new Set(clusters.map((cluster) => cluster.recordCount)),
  ].toSorted((left, right) => left - right);
  if (uniqueCounts.length === 0) return Object.freeze({});
  const sizes: Record<string, number> = {};
  for (const cluster of clusters) {
    const rank = uniqueCounts.indexOf(cluster.recordCount);
    const bucket =
      uniqueCounts.length === 1
        ? Math.floor(RUNTIME_CLUSTER_ICON_SIZE_BUCKETS.length / 2)
        : Math.round(
            (rank / (uniqueCounts.length - 1)) *
              (RUNTIME_CLUSTER_ICON_SIZE_BUCKETS.length - 1),
          );
    sizes[cluster.clusterId] =
      RUNTIME_CLUSTER_ICON_SIZE_BUCKETS[bucket] ?? 0.94;
  }
  return Object.freeze(sizes);
}

export function runtimeMapFeatures(projection: RuntimeUiProjection) {
  if (projection.map.status !== "ready") return [];
  if (projection.map.result.mode === "clusters") {
    const clusters = projection.map.result.clusters ?? [];
    const localIconSizes = runtimeLocalClusterIconSizes(clusters);
    return clusters.map((cluster) => ({
      geometry: {
        coordinates: [
          cluster.displayCoordinates.longitude,
          cluster.displayCoordinates.latitude,
        ],
        type: "Point" as const,
      },
      properties: {
        clusterId: cluster.clusterId,
        kind: "cluster",
        localClusterLabel: formatRuntimeClusterRecordCount(cluster.recordCount),
        localClusterIconSize: localIconSizes[cluster.clusterId],
        recordCount: cluster.recordCount,
      },
      type: "Feature" as const,
    }));
  }
  return (
    projection.map.result.points?.map((point) => ({
      geometry: {
        coordinates: [point.coordinates.longitude, point.coordinates.latitude],
        type: "Point" as const,
      },
      properties: { canonicalTreeId: point.canonicalTreeId, kind: "point" },
      type: "Feature" as const,
    })) ?? []
  );
}

export function runtimeAgentCandidateFeatures(
  candidates: readonly RuntimeMapCandidate[],
) {
  return candidates.map((candidate) => ({
    geometry: {
      coordinates: [
        candidate.coordinates.longitude,
        candidate.coordinates.latitude,
      ],
      type: "Point" as const,
    },
    properties: { canonicalTreeId: candidate.canonicalTreeId },
    type: "Feature" as const,
  }));
}

function isGeoJsonSource(value: unknown): value is GeoJSONSource {
  return (
    typeof value === "object" &&
    value !== null &&
    "setData" in value &&
    typeof (value as { setData?: unknown }).setData === "function"
  );
}

function setRuntimeAgentCandidateData(
  map: MapLibreMap,
  candidates: readonly RuntimeMapCandidate[],
): void {
  const source = map.getSource(RUNTIME_AGENT_CANDIDATE_SOURCE_ID);
  if (!isGeoJsonSource(source)) return;
  source.setData({
    features: runtimeAgentCandidateFeatures(candidates),
    type: "FeatureCollection",
  });
}

function focusRuntimeAgentCandidates(
  map: MapLibreMap,
  candidates: readonly RuntimeMapCandidate[],
): void {
  if (candidates.length === 0) return;
  const longitudes = candidates.map(
    (candidate) => candidate.coordinates.longitude,
  );
  const latitudes = candidates.map(
    (candidate) => candidate.coordinates.latitude,
  );
  const west = Math.min(...longitudes);
  const east = Math.max(...longitudes);
  const south = Math.min(...latitudes);
  const north = Math.max(...latitudes);
  if (west === east && south === north) {
    map.easeTo({ center: [west, south], zoom: Math.max(map.getZoom(), 15) });
    return;
  }
  map.fitBounds(
    [
      [west, south],
      [east, north],
    ],
    { maxZoom: 15, padding: 72 },
  );
}

/** Deterministic first-party canopy geometry; no image request participates in map readiness. */
export function createRuntimeClusterCanopyImage() {
  const logicalSize = 64;
  const pixelRatio = 2;
  const size = logicalSize * pixelRatio;
  const data = new Uint8Array(size * size * 4);
  const blendPixel = (
    x: number,
    y: number,
    color: readonly [number, number, number, number],
    coverage: number,
  ) => {
    const offset = (y * size + x) * 4;
    const sourceAlpha = (color[3] / 255) * coverage;
    const destinationAlpha = (data[offset + 3] ?? 0) / 255;
    const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
    if (outputAlpha === 0) return;
    for (let channel = 0; channel < 3; channel += 1) {
      const output =
        ((color[channel] ?? 0) * sourceAlpha +
          (data[offset + channel] ?? 0) *
            destinationAlpha *
            (1 - sourceAlpha)) /
        outputAlpha;
      data[offset + channel] = Math.round(output);
    }
    data[offset + 3] = Math.round(outputAlpha * 255);
  };
  const within = (
    x: number,
    y: number,
    centerX: number,
    centerY: number,
    radius: number,
  ) => (x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2;
  const withinEllipse = (
    x: number,
    y: number,
    centerX: number,
    centerY: number,
    radiusX: number,
    radiusY: number,
  ) =>
    (x - centerX) ** 2 / radiusX ** 2 + (y - centerY) ** 2 / radiusY ** 2 <= 1;
  const coverage = (
    contains: (x: number, y: number) => boolean,
    x: number,
    y: number,
  ) => {
    let coveredSamples = 0;
    const samplesPerAxis = 4;
    for (let sampleY = 0; sampleY < samplesPerAxis; sampleY += 1) {
      for (let sampleX = 0; sampleX < samplesPerAxis; sampleX += 1) {
        const logicalX = (x + (sampleX + 0.5) / samplesPerAxis) / pixelRatio;
        const logicalY = (y + (sampleY + 0.5) / samplesPerAxis) / pixelRatio;
        if (contains(logicalX, logicalY)) coveredSamples += 1;
      }
    }
    return coveredSamples / samplesPerAxis ** 2;
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      blendPixel(
        x,
        y,
        [245, 251, 246, 255],
        coverage(
          (sampleX, sampleY) => within(sampleX, sampleY, 32, 31, 24),
          x,
          y,
        ),
      );
      blendPixel(
        x,
        y,
        [42, 111, 70, 255],
        coverage(
          (sampleX, sampleY) => withinEllipse(sampleX, sampleY, 32, 28, 19, 16),
          x,
          y,
        ),
      );
      blendPixel(
        x,
        y,
        [120, 184, 140, 255],
        coverage(
          (sampleX, sampleY) => within(sampleX, sampleY, 40, 21, 1.65),
          x,
          y,
        ),
      );
      blendPixel(
        x,
        y,
        [124, 78, 51, 255],
        coverage(
          (sampleX, sampleY) =>
            sampleX >= 29 && sampleX <= 34 && sampleY >= 38 && sampleY <= 48,
          x,
          y,
        ),
      );
      blendPixel(
        x,
        y,
        [101, 62, 42, 255],
        coverage(
          (sampleX, sampleY) =>
            sampleX >= 26 && sampleX <= 37 && sampleY >= 47 && sampleY <= 50,
          x,
          y,
        ),
      );
    }
  }
  return { data, height: size, width: size };
}

/** Sets up source and layers synchronously once MapLibre reports style readiness. */
export function installRuntimeMapStyle(
  map: Pick<
    MapLibreMap,
    "addImage" | "addLayer" | "addSource" | "getBounds" | "getZoom" | "hasImage"
  >,
  onViewport: (request: RuntimeViewportRequest) => void,
): void {
  if (!map.hasImage(RUNTIME_CLUSTER_ICON_ID))
    map.addImage(RUNTIME_CLUSTER_ICON_ID, createRuntimeClusterCanopyImage(), {
      pixelRatio: 2,
    });
  map.addSource("runtime-geometry", {
    data: { features: [], type: "FeatureCollection" },
    type: "geojson",
  });
  map.addLayer({
    id: "runtime-clusters",
    filter: ["==", ["get", "kind"], "cluster"],
    layout: {
      "icon-allow-overlap": true,
      "icon-image": RUNTIME_CLUSTER_ICON_ID,
      "icon-size": RUNTIME_CLUSTER_ICON_SIZE as never,
      "text-allow-overlap": true,
      "text-field": ["get", "localClusterLabel"],
      "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
      "text-offset": [0, 2.15],
      "text-size": 11,
    },
    paint: {
      "text-color": "#173f30",
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.25,
    },
    source: "runtime-geometry",
    type: "symbol",
  });
  map.addLayer({
    id: "runtime-points",
    filter: ["==", ["get", "kind"], "point"],
    paint: {
      "circle-color": "#236747",
      "circle-radius": 6,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
    },
    source: "runtime-geometry",
    type: "circle",
  });
  map.addSource(RUNTIME_AGENT_CANDIDATE_SOURCE_ID, {
    data: { features: [], type: "FeatureCollection" },
    type: "geojson",
  });
  map.addLayer({
    id: "runtime-agent-candidates",
    paint: {
      "circle-color": "rgba(255, 196, 69, 0.22)",
      "circle-radius": 11,
      "circle-stroke-color": "#a05a00",
      "circle-stroke-width": 2.5,
    },
    source: RUNTIME_AGENT_CANDIDATE_SOURCE_ID,
    type: "circle",
  });
  map.addLayer({
    id: "runtime-selected",
    filter: ["==", ["get", "canonicalTreeId"], ""],
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-radius": 11,
      "circle-stroke-color": "#173f30",
      "circle-stroke-width": 3,
    },
    source: "runtime-geometry",
    type: "circle",
  });
  onViewport(runtimeViewportRequest(map));
}

export function RuntimeMap({
  candidateTrees = [],
  onSelect,
  onViewport,
  presentation = "harness",
  projection,
  selectedId,
}: Readonly<{
  candidateTrees?: readonly RuntimeMapCandidate[];
  onSelect(canonicalTreeId: string): void;
  onViewport(request: RuntimeViewportRequest): void;
  presentation?: "harness" | "product";
  projection: RuntimeUiProjection;
  selectedId: string | null;
}>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastFocusedSelectionRef = useRef<string | null>(null);
  const candidateTreesRef = useRef(candidateTrees);
  const onSelectRef = useRef(onSelect);
  const onViewportRef = useRef(onViewport);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  useEffect(() => {
    onViewportRef.current = onViewport;
  }, [onViewport]);
  useEffect(() => {
    candidateTreesRef.current = candidateTrees;
  }, [candidateTrees]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let map: MapLibreMap | null = null;
    void import("maplibre-gl")
      .then(({ Map, NavigationControl }) => {
        if (disposed) return;
        map = new Map({
          attributionControl: { compact: true },
          center: [120.67, 24.16],
          container,
          locale: TREE_MAP_LOCALE,
          maxZoom: 18,
          minZoom: 9,
          style: RUNTIME_MAP_STYLE_URL,
          zoom: 10,
        });
        mapRef.current = map;
        map.addControl(
          new NavigationControl({ showCompass: false }),
          "top-right",
        );
        map.on("styleimagemissing", (event: MapStyleImageMissingEvent) => {
          if (map) handleMissingStyleImage(map, event.id);
        });
        map.on("load", () => {
          if (!map || disposed) return;
          installRuntimeMapStyle(map, onViewportRef.current);
          setRuntimeAgentCandidateData(map, candidateTreesRef.current);
          focusRuntimeAgentCandidates(map, candidateTreesRef.current);
          map.on("moveend", () => {
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
              if (map && !disposed)
                onViewportRef.current(runtimeViewportRequest(map));
            }, 160);
          });
          map.on("click", "runtime-points", (event) => {
            const properties: unknown = event.features?.[0]?.properties;
            const id =
              typeof properties === "object" && properties !== null
                ? (properties as Record<string, unknown>).canonicalTreeId
                : undefined;
            if (typeof id === "string") onSelectRef.current(id);
          });
          map.on("click", "runtime-agent-candidates", (event) => {
            const properties: unknown = event.features?.[0]?.properties;
            const id =
              typeof properties === "object" && properties !== null
                ? (properties as Record<string, unknown>).canonicalTreeId
                : undefined;
            if (typeof id === "string") onSelectRef.current(id);
          });
          map.on("click", "runtime-clusters", (event) => {
            const coordinates = event.features?.[0]?.geometry;
            if (coordinates?.type === "Point" && map)
              map.easeTo({
                center: coordinates.coordinates as [number, number],
                zoom: runtimeClusterDrillZoom(map.getZoom()),
              });
          });
          map.on("mouseenter", "runtime-clusters", () => {
            if (map) map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", "runtime-clusters", () => {
            if (map) map.getCanvas().style.cursor = "";
          });
        });
      })
      .catch(() => {
        return undefined;
      });
    return () => {
      disposed = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource("runtime-geometry");
    if (!map || !isGeoJsonSource(source)) return;
    source.setData({
      features: runtimeMapFeatures(projection),
      type: "FeatureCollection",
    });
    map
      .getCanvas()
      .setAttribute("aria-busy", String(projection.accessibility.ariaBusy));
    map.getCanvas().setAttribute("aria-label", "Runtime tree map");
  }, [projection]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setRuntimeAgentCandidateData(map, candidateTrees);
  }, [candidateTrees]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer("runtime-selected"))
      map.setFilter("runtime-selected", [
        "all",
        ["==", ["get", "kind"], "point"],
        ["==", ["get", "canonicalTreeId"], selectedId ?? ""],
      ]);
  }, [selectedId]);

  useEffect(() => {
    const detail = projection.detail;
    if (detail.status !== "ready" || !detail.record) return;
    const selectionKey = `${detail.identity.activeResultSetId}:${detail.record.canonicalTreeId}`;
    if (lastFocusedSelectionRef.current === selectionKey) return;
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({
      center: [
        detail.record.coordinates.longitude,
        detail.record.coordinates.latitude,
      ],
      zoom: Math.max(map.getZoom(), 15),
    });
    lastFocusedSelectionRef.current = selectionKey;
  }, [projection.detail]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    focusRuntimeAgentCandidates(map, candidateTrees);
  }, [candidateTrees]);

  return (
    <div
      className={
        presentation === "product" ? "map-canvas-shell" : "runtime-map-shell"
      }
    >
      <div
        className={presentation === "product" ? "map-canvas" : "runtime-map"}
        ref={containerRef}
      />
      {presentation === "harness" ? (
        <p className="runtime-map-status" role="status">
          {projection.map.status}
        </p>
      ) : (
        <p className="map-provider-note">
          底圖由 OpenFreeMap 提供，署名依地圖控制項顯示
        </p>
      )}
    </div>
  );
}
