import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

type Descriptor = Readonly<{
  bytes: number;
  path: string;
  recordCount: number;
  sha256: string;
}>;
type Manifest = Readonly<{
  artifactSha256: string;
  files: readonly Descriptor[];
  packageHash: string;
}>;

const packageRoot = new URL("../public/runtime-package/", import.meta.url);
const expectedArtifact =
  "5daa914bef435fdce88728949465d88c99ab1eb0d3fb11e2127e057fcbe620fa";
const expectedPackage =
  "f714861dea2a7eed0b58e24952d6405867da595cc21f5fd5d3bad4217c214bf6";

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function main() {
  const manifestBytes = await readFile(new URL("manifest.json", packageRoot));
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as Manifest;
  if (manifest.artifactSha256 !== expectedArtifact)
    throw new Error("Unexpected static-package artifact identity.");
  if (manifest.packageHash !== expectedPackage)
    throw new Error("Unexpected static-package package identity.");
  if (manifest.files.length !== 659)
    throw new Error(
      `Expected 659 package descriptors, found ${String(manifest.files.length)}.`,
    );
  const accounting = manifest.files.find(
    (file) => file.path === "accounting.json",
  );
  if (accounting?.recordCount !== 118_403)
    throw new Error("The package does not declare 118,403 official records.");
  const speciesNames = manifest.files.find(
    (file) => file.path === "search/species-names.json",
  );
  if (speciesNames?.recordCount !== 440)
    throw new Error("The package does not declare 440 public species names.");
  for (const descriptor of manifest.files) {
    const file = new URL(descriptor.path, packageRoot);
    const [bytes, metadata] = await Promise.all([
      readFile(file),
      stat(fileURLToPath(file)),
    ]);
    if (
      metadata.size !== descriptor.bytes ||
      sha256(bytes) !== descriptor.sha256
    )
      throw new Error(`Descriptor integrity mismatch: ${descriptor.path}`);
  }
  console.log(
    `Validated ${String(manifest.files.length + 1)} package files and 118,403 records.`,
  );
}

await main();
