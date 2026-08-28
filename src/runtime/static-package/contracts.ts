import { z } from "zod";

export const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
export const SHARD_KEY_PATTERN = /^[a-f0-9]{2}$/u;
export const STATIC_PACKAGE_VERSION = "1.0.0" as const;
export const CANONICAL_SCHEMA_VERSION = "2.0.0" as const;

const sha256 = z.string().regex(SHA256_PATTERN);
const nonnegativeInteger = z.number().int().nonnegative();

export const StaticPackageDescriptorSchema = z.strictObject({
  bytes: nonnegativeInteger,
  gzipBytes: nonnegativeInteger,
  path: z.string().min(1),
  recordCount: nonnegativeInteger,
  sha256,
});

export const StaticPackageManifestStructureSchema = z.strictObject({
  artifactSha256: sha256,
  canonicalSchemaVersion: z.string(),
  clusterVersion: z.string(),
  detailVersion: z.string(),
  files: z.array(StaticPackageDescriptorSchema),
  packageHash: sha256,
  packageVersion: z.string(),
  recordCount: nonnegativeInteger,
  searchVersion: z.string(),
  shardCounts: z.strictObject({
    clusters: nonnegativeInteger,
    detail: nonnegativeInteger,
    point: nonnegativeInteger,
    search: nonnegativeInteger,
  }),
});

export const StaticPackageManifestSchema =
  StaticPackageManifestStructureSchema.extend({
    canonicalSchemaVersion: z.literal(CANONICAL_SCHEMA_VERSION),
    clusterVersion: z.literal(STATIC_PACKAGE_VERSION),
    detailVersion: z.literal(STATIC_PACKAGE_VERSION),
    packageVersion: z.literal(STATIC_PACKAGE_VERSION),
    searchVersion: z.literal(STATIC_PACKAGE_VERSION),
  });

export type StaticPackageDescriptor = Readonly<
  z.infer<typeof StaticPackageDescriptorSchema>
>;
export type StaticPackageManifest = Readonly<
  z.infer<typeof StaticPackageManifestSchema>
>;

export const OverviewPayloadSchema = z.strictObject({
  artifactSha256: sha256,
  canonicalSchemaVersion: z.literal(CANONICAL_SCHEMA_VERSION),
  cityId: z.literal("taichung"),
  datasetKey: z.literal("street-trees"),
  packageVersion: z.literal(STATIC_PACKAGE_VERSION),
  recordCount: nonnegativeInteger,
  sourceSnapshot: z.strictObject({
    identifier: z.string().min(1),
    retrievedAt: z.iso.datetime({ offset: true }),
    sha256,
  }),
});

const CoordinatesSchema = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
const PointSchema = z.strictObject({
  canonicalTreeId: z.string().min(1),
  coordinates: CoordinatesSchema,
  sourceRecordId: z.string().min(1),
  speciesDisplayValue: z.string().min(1).nullable(),
});
const TileSchema = z.strictObject({
  x: nonnegativeInteger,
  y: nonnegativeInteger,
  zoom: nonnegativeInteger,
});

export const ClusterPayloadSchema = z.strictObject({
  artifactSha256: sha256,
  clusterVersion: z.literal(STATIC_PACKAGE_VERSION),
  clusters: z.array(
    z.strictObject({
      clusterId: z.string().min(1),
      representativeCoordinates: CoordinatesSchema,
      recordCount: z.number().int().positive(),
      tile: TileSchema,
    }),
  ),
  zoom: nonnegativeInteger,
});
export const PointPayloadSchema = z.strictObject({
  artifactSha256: sha256,
  pointVersion: z.literal(STATIC_PACKAGE_VERSION),
  records: z.array(PointSchema),
  tile: TileSchema,
});
export const DetailPayloadSchema = z.strictObject({
  artifactSha256: sha256,
  detailVersion: z.literal(STATIC_PACKAGE_VERSION),
  records: z.array(PointSchema),
  shard: z.string().regex(SHARD_KEY_PATTERN),
});
export const SpeciesSearchPayloadSchema = z.strictObject({
  artifactSha256: sha256,
  entries: z.record(z.string(), z.array(z.string().min(1))),
  searchVersion: z.literal(STATIC_PACKAGE_VERSION),
  shard: z.string().regex(SHARD_KEY_PATTERN),
  type: z.literal("species"),
});

export type OverviewPayload = Readonly<z.infer<typeof OverviewPayloadSchema>>;
export type ClusterPayload = Readonly<z.infer<typeof ClusterPayloadSchema>>;
export type PointPayload = Readonly<z.infer<typeof PointPayloadSchema>>;
export type DetailPayload = Readonly<z.infer<typeof DetailPayloadSchema>>;
export type SpeciesSearchPayload = Readonly<
  z.infer<typeof SpeciesSearchPayloadSchema>
>;
export type RuntimePayload =
  | OverviewPayload
  | ClusterPayload
  | PointPayload
  | DetailPayload
  | SpeciesSearchPayload;

export type DescriptorSelector =
  | Readonly<{ capability: "overview" }>
  | Readonly<{ capability: "cluster"; zoom: 10 | 12 | 14 }>
  | Readonly<{
      capability: "point";
      tile: Readonly<{ x: number; y: number; zoom: 15 }>;
    }>
  | Readonly<{ capability: "detail"; shard: string }>
  | Readonly<{ capability: "species-search"; shard: string }>;

export type RuntimeCapability = DescriptorSelector["capability"];
