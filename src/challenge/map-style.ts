import type { Map as MapLibreMap } from "maplibre-gl";

export const TREE_MAP_LOCALE = Object.freeze({
  "Map.Title": "臺中市行道樹互動地圖",
  "NavigationControl.ZoomIn": "放大地圖",
  "NavigationControl.ZoomOut": "縮小地圖",
});

export const TREE_MAP_STYLE_URL =
  "https://tiles.openfreemap.org/styles/liberty";

const MISSING_IMAGE_IDS = new Set(["athletics", "ferry_terminal", "gate"]);

export function handleMissingStyleImage(
  map: Pick<MapLibreMap, "addImage" | "hasImage">,
  imageId: string,
): boolean {
  if (map.hasImage(imageId) || !MISSING_IMAGE_IDS.has(imageId)) return false;
  const size = 1;
  map.addImage(imageId, {
    data: new Uint8Array([35, 103, 71, 255]),
    height: size,
    width: size,
  });
  return true;
}
