import type {
  DescriptorSelector,
  RuntimeCapability,
  StaticPackageDescriptor,
  StaticPackageManifest,
} from "./contracts.ts";
import { SHARD_KEY_PATTERN } from "./contracts.ts";
import { runtimeError } from "./errors.ts";

export type SelectedDescriptor = Readonly<{
  capability: RuntimeCapability;
  descriptor: StaticPackageDescriptor;
}>;

function pathFor(selector: DescriptorSelector): string {
  switch (selector.capability) {
    case "overview":
      return "overview.json";
    case "cluster":
      return `clusters/z${String(selector.zoom)}.json`;
    case "point": {
      const { x, y } = selector.tile;
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0)
        throw runtimeError({
          code: "descriptor_capability_denied",
          phase: "descriptor",
        });
      return `points/z15/${String(x)}-${String(y)}.json`;
    }
    case "detail":
      if (!SHARD_KEY_PATTERN.test(selector.shard))
        throw runtimeError({
          code: "descriptor_capability_denied",
          phase: "descriptor",
        });
      return `details/${selector.shard}.json`;
    case "species-search":
      if (!SHARD_KEY_PATTERN.test(selector.shard))
        throw runtimeError({
          code: "descriptor_capability_denied",
          phase: "descriptor",
        });
      return `search/species/${selector.shard}.json`;
    default:
      throw runtimeError({
        code: "descriptor_capability_denied",
        phase: "descriptor",
      });
  }
}

export function selectDescriptor(
  manifest: StaticPackageManifest,
  selector: DescriptorSelector,
): SelectedDescriptor {
  const path = pathFor(selector);
  const descriptor = manifest.files.find((item) => item.path === path);
  if (!descriptor)
    throw runtimeError({ code: "descriptor_not_found", phase: "descriptor" });
  return Object.freeze({ capability: selector.capability, descriptor });
}
