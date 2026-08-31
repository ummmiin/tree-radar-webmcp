import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { readFile, writeFile } from "node:fs/promises";

type Descriptor = Readonly<{
  bytes: number;
  gzipBytes: number;
  path: string;
  recordCount: number;
  sha256: string;
}>;
type Manifest = Readonly<{
  artifactSha256: string;
  files: readonly Descriptor[];
  packageHash: string;
  packageVersion: string;
  shardCounts: Readonly<{
    clusters: number;
    detail: number;
    point: number;
    search: number;
  }>;
}>;
type SpeciesPayload = Readonly<{ entries: Readonly<Record<string, unknown>> }>;

const packageRoot = new URL("../public/runtime-package/", import.meta.url);
const indexPath = "search/species-names.json";

function normalizeSpeciesName(value: string): string {
  return value.trim().normalize("NFKC").replaceAll(/\s+/gu, " ");
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function bytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function packageHash(manifest: Manifest): string {
  return sha256(
    bytes({
      artifactSha256: manifest.artifactSha256,
      files: manifest.files.map(({ path, sha256: fileSha256 }) => ({
        path,
        sha256: fileSha256,
      })),
      packageVersion: manifest.packageVersion,
    }),
  );
}

async function main() {
  const manifestUrl = new URL("manifest.json", packageRoot);
  const manifest = JSON.parse(
    (await readFile(manifestUrl)).toString("utf8"),
  ) as Manifest;
  const speciesDescriptors = manifest.files.filter(({ path }) =>
    /^search\/species\/[a-f0-9]{2}\.json$/u.test(path),
  );
  const names = [
    ...new Set(
      (
        await Promise.all(
          speciesDescriptors.map(async ({ path }) => {
            const payload = JSON.parse(
              (await readFile(new URL(path, packageRoot))).toString("utf8"),
            ) as SpeciesPayload;
            return Object.keys(payload.entries);
          }),
        )
      ).flat(),
    ),
  ]
    .map(normalizeSpeciesName)
    .sort(compare);
  if (
    names.some((name, index) => index > 0 && name <= (names[index - 1] ?? ""))
  )
    throw new Error("Species names must be unique and sorted.");
  const payload = {
    artifactSha256: manifest.artifactSha256,
    names,
    searchVersion: "1.0.0",
    type: "species-name-index",
  };
  const indexBytes = bytes(payload);
  await writeFile(new URL(indexPath, packageRoot), indexBytes);
  const indexDescriptor = {
    bytes: indexBytes.byteLength,
    gzipBytes: gzipSync(indexBytes).byteLength,
    path: indexPath,
    recordCount: names.length,
    sha256: sha256(indexBytes),
  };
  const files = [
    ...manifest.files.filter(({ path }) => path !== indexPath),
    indexDescriptor,
  ].sort((left, right) => compare(left.path, right.path));
  const nextManifest = {
    ...manifest,
    files,
    packageHash: "",
    shardCounts: {
      ...manifest.shardCounts,
      search: speciesDescriptors.length + 1,
    },
  };
  nextManifest.packageHash = packageHash(nextManifest);
  await writeFile(manifestUrl, bytes(nextManifest));
  console.log(
    `Generated ${String(names.length)} public species names (${String(indexBytes.byteLength)} bytes).`,
  );
}

await main();
