import { createRuntimeActivationAdmission } from "../runtime/active-result-set/contracts.ts";
import { createRuntimeBindingResolver } from "../runtime/binding/resolver.ts";
import { createRuntimeCoordinator } from "../runtime/coordinator/runtime-coordinator.ts";
import { createRuntimeStaticPackageDataSource } from "../runtime/data-source/static-package-data-source.ts";
import {
  createRuntimeUiSession,
  type RuntimeUiProjection,
  type RuntimeUiSession,
} from "../runtime/ui-projection/runtime-ui-projection.ts";

const PACKAGE_ARTIFACT_SHA256 =
  "5daa914bef435fdce88728949465d88c99ab1eb0d3fb11e2127e057fcbe620fa";
const PACKAGE_HASH =
  "0ae437413cac58a6401b1c66d8829faeb0e0dbf3b397a0ee737fe265e4f21d0d";
const MANIFEST_SHA256 =
  "c5942b3aa6a5128d8a5d7eb5a76d902ccce741cdfbcfeefe51987fc24be1bc98";

export type TaichungChallengeRuntimeOpenResult =
  | Readonly<{
      dispose(): void;
      projection: RuntimeUiProjection;
      session: RuntimeUiSession;
      status: "ready";
    }>
  | Readonly<{ status: "rejected" | "unavailable" }>;

/** Opens the exact admitted package copied into this standalone challenge. */
export async function openTaichungChallengeRuntime(): Promise<TaichungChallengeRuntimeOpenResult> {
  const origin = window.location.origin;
  const fixedBinding = Object.freeze({
    bindingId: "taichung-challenge-runtime-v1",
    canonicalSchemaVersion: "2.0.0",
    cityId: "taichung",
    datasetKey: "street-trees",
    expectedRuntimePackage: Object.freeze({
      artifactSha256: PACKAGE_ARTIFACT_SHA256,
      packageHash: PACKAGE_HASH,
      packageVersion: "1.0.0",
    }),
    strategy: "static-package-v1",
    target: Object.freeze({
      allowedOrigin: origin,
      expectedManifestSha256: MANIFEST_SHA256,
      manifestPath: "manifest.json" as const,
      packageRoot: `${origin}/runtime-package/`,
    }),
  });
  const resolverCreated = createRuntimeBindingResolver({
    bindings: [fixedBinding],
  });
  if (resolverCreated.status !== "created")
    return Object.freeze({ status: "rejected" });
  const binding = resolverCreated.resolver.resolve({
    bindingId: fixedBinding.bindingId,
  });
  if (binding.status !== "resolved")
    return Object.freeze({ status: "rejected" });
  const dataSource = createRuntimeStaticPackageDataSource({ binding });
  const opened = await dataSource.open();
  if (opened.status !== "opened")
    return Object.freeze({ status: opened.status });
  const admission = createRuntimeActivationAdmission();
  const admitted = admission.admit({
    attribution: opened.attribution,
    binding,
    context: { activationContextId: "taichung-challenge-runtime" },
    opened,
    requiredCapabilities: {
      canonicalDetail: true,
      speciesExactValueSearch: true,
      viewportClusters: true,
      viewportPoints: true,
    },
  });
  if (admitted.status !== "admitted")
    return Object.freeze({ status: admitted.status });
  const active = admission.activate(admitted.resultSet);
  if (active.status !== "active") return Object.freeze({ status: "rejected" });
  const coordinator = createRuntimeCoordinator({
    dataSource,
    resultSet: active.resultSet,
  });
  const sessionHost = createRuntimeUiSession({ coordinator });
  return Object.freeze({
    dispose() {
      sessionHost.session.dispose();
      dataSource.replaceBinding({
        failure: {
          code: "binding_unknown",
          field: "bindingId",
          message: "Challenge runtime disposed.",
        },
        status: "rejected",
      });
    },
    projection: sessionHost.session.getSnapshot(),
    session: sessionHost.session,
    status: "ready",
  });
}
