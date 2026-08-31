import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createRuntimeBindingResolver } from "../src/runtime/binding/resolver.ts";
import { createRuntimeStaticPackageDataSource } from "../src/runtime/data-source/static-package-data-source.ts";
import { runtimeError } from "../src/runtime/static-package/errors.ts";
import type {
  DescriptorSelector,
  RuntimePayload,
} from "../src/runtime/static-package/contracts.ts";
import type { StaticPackageLoader } from "../src/runtime/static-package/loader.ts";
import type { VerifiedManifest } from "../src/runtime/static-package/manifest-reader.ts";

const artifactSha256 = "a".repeat(64);
const packageHash = "b".repeat(64);
const robinLabel = "羅比親王海棗";
const robinIds = (
  JSON.parse(
    readFileSync(
      new URL(
        "../public/runtime-package/search/species/25.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as { entries: Record<string, string[]> }
).entries[robinLabel];
const publicSpeciesNames = (
  JSON.parse(
    readFileSync(
      new URL(
        "../public/runtime-package/search/species-names.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as { names: string[] }
).names;

if (!robinIds) throw new Error("The public Robin species shard is missing.");
if (!publicSpeciesNames.includes(robinLabel))
  throw new Error("The public species-name index is missing Robin.");

function fixture() {
  const descriptorCalls: DescriptorSelector[] = [];
  const verified = {
    compatibility: {
      canonicalSchemaVersion: "2.0.0",
      clusterVersion: "1.0.0",
      detailVersion: "1.0.0",
      packageVersion: "1.0.0",
      searchVersion: "1.0.0",
    },
    manifest: {
      artifactSha256,
      canonicalSchemaVersion: "2.0.0",
      clusterVersion: "1.0.0",
      detailVersion: "1.0.0",
      files: [
        {
          bytes: 1,
          gzipBytes: 1,
          path: "overview.json",
          recordCount: 0,
          sha256: artifactSha256,
        },
        {
          bytes: 1,
          gzipBytes: 1,
          path: "search/species-names.json",
          recordCount: publicSpeciesNames.length,
          sha256: artifactSha256,
        },
        {
          bytes: 1,
          gzipBytes: 1,
          path: "search/species/25.json",
          recordCount: 1,
          sha256: artifactSha256,
        },
      ],
      packageHash,
      packageVersion: "1.0.0",
      recordCount: 118403,
      searchVersion: "1.0.0",
      shardCounts: { clusters: 0, detail: 0, point: 0, search: 2 },
    },
    manifestSha256: "c".repeat(64),
    runtimePackage: {
      artifactSha256,
      canonicalSchemaVersion: "2.0.0",
      packageHash,
      packageVersion: "1.0.0",
    },
    trust: {
      allowedOrigin: "https://example.test",
      expectedManifestSha256: "c".repeat(64),
      manifestPath: "manifest.json",
      packageRoot: "https://example.test/runtime-package/",
    },
  } as unknown as VerifiedManifest;
  const loader = {
    cancelGeneration: () => undefined,
    clearCache: () => undefined,
    dispose: () => undefined,
    getDiagnostics: () => ({ generation: 1 }),
    loadDescriptor: (selector: DescriptorSelector): Promise<RuntimePayload> => {
      descriptorCalls.push(selector);
      if (selector.capability === "overview")
        return Promise.resolve({
          artifactSha256,
          canonicalSchemaVersion: "2.0.0",
          cityId: "taichung",
          datasetKey: "street-trees",
          packageVersion: "1.0.0",
          recordCount: 118403,
          sourceSnapshot: {
            identifier: "sha256:source",
            retrievedAt: "2026-08-02T07:42:05.255Z",
            sha256: artifactSha256,
          },
        } as RuntimePayload);
      if (selector.capability === "species-name-index")
        return Promise.resolve({
          artifactSha256,
          names: publicSpeciesNames,
          searchVersion: "1.0.0",
          type: "species-name-index",
        } as RuntimePayload);
      if (selector.capability === "species-search" && selector.shard === "25")
        return Promise.resolve({
          artifactSha256,
          entries: { [robinLabel]: robinIds },
          searchVersion: "1.0.0",
          shard: "25",
          type: "species",
        } as RuntimePayload);
      return Promise.reject(
        runtimeError({ code: "descriptor_not_found", phase: "descriptor" }),
      );
    },
    loadManifest: () => Promise.resolve(verified),
    replaceBinding: () => undefined,
  } as unknown as StaticPackageLoader;
  const resolved = createRuntimeBindingResolver({
    bindings: [
      {
        bindingId: "public-species-test",
        canonicalSchemaVersion: "2.0.0",
        cityId: "taichung",
        datasetKey: "street-trees",
        expectedRuntimePackage: {
          artifactSha256,
          packageHash,
          packageVersion: "1.0.0",
        },
        strategy: "static-package-v1",
        target: {
          allowedOrigin: "https://example.test",
          expectedManifestSha256: "c".repeat(64),
          manifestPath: "manifest.json",
          packageRoot: "https://example.test/runtime-package/",
        },
      },
    ],
  });
  if (resolved.status !== "created")
    throw new Error("Test binding was rejected.");
  const binding = resolved.resolver.resolve({
    bindingId: "public-species-test",
  });
  if (binding.status !== "resolved")
    throw new Error("Test binding was unresolved.");
  return {
    descriptorCalls,
    source: createRuntimeStaticPackageDataSource({
      binding,
      createLoader: () => loader,
    }),
  };
}

function searchCalls(calls: readonly DescriptorSelector[]) {
  return calls.filter(({ capability }) => capability === "species-search");
}

describe("public compact species-name index", () => {
  it("uses the existing exact shard fast path and preserves its canonical label", async () => {
    const { descriptorCalls, source } = fixture();
    await expect(source.open()).resolves.toMatchObject({ status: "opened" });
    const result = await source.searchSpecies(robinLabel);
    expect(robinIds).toHaveLength(254);
    expect(result).toMatchObject({
      canonicalTreeIds: robinIds,
      semantics: "species-exact-value",
      status: "found",
    });
    if (result.status === "found")
      expect(new Set(Object.values(result.speciesDisplayValues))).toEqual(
        new Set([robinLabel]),
      );
    expect(searchCalls(descriptorCalls)).toEqual([
      { capability: "species-search", shard: "25" },
    ]);
    expect(descriptorCalls).not.toContainEqual({
      capability: "species-name-index",
    });
  });

  it("finds 羅比親王 through one compact index read and the matched exact shard", async () => {
    const { descriptorCalls, source } = fixture();
    await source.open();
    const exact = await source.searchSpecies(robinLabel);
    const partial = await source.searchSpecies("羅比親王");
    expect(partial).toMatchObject({
      canonicalTreeIds: robinIds,
      semantics: "species-partial-value",
      status: "found",
    });
    expect(
      partial.status === "found" &&
        exact.status === "found" &&
        partial.canonicalTreeIds,
    ).toEqual(exact.status === "found" ? exact.canonicalTreeIds : []);
    if (partial.status === "found")
      expect(new Set(Object.values(partial.speciesDisplayValues))).toEqual(
        new Set([robinLabel]),
      );
    expect(searchCalls(descriptorCalls).slice(1)).toEqual([
      { capability: "species-search", shard: "06" },
      { capability: "species-search", shard: "25" },
    ]);
    expect(descriptorCalls).toContainEqual({
      capability: "species-name-index",
    });
  });

  it("returns no result after a compact-index miss without reading all species shards", async () => {
    const { descriptorCalls, source } = fixture();
    await source.open();
    await expect(source.searchSpecies("不存在的樹種")).resolves.toMatchObject({
      semantics: "species-partial-value",
      status: "not_found",
    });
    expect(searchCalls(descriptorCalls)).toHaveLength(1);
    expect(descriptorCalls).toContainEqual({
      capability: "species-name-index",
    });
  });
});
