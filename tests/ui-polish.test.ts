import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TreeRadarChallengeHeader } from "../app/page.tsx";
import {
  taichungProductSearchRows,
  TaichungRuntimeTreeDetail,
} from "../src/challenge/product-experience.tsx";
import { createRuntimeClusterCanopyImage } from "../src/runtime/ui-projection/runtime-map.tsx";
import type { RuntimeUiProjection } from "../src/runtime/ui-projection/runtime-ui-projection.ts";

const identity = {
  activationEpoch: 1,
  activeResultSetId: "taichung-search",
  cityId: "taichung",
  datasetKey: "street-trees",
  lifecycle: "active" as const,
};

function readySearchProjection(): RuntimeUiProjection {
  return {
    accessibility: {
      announcement: "active",
      ariaBusy: false,
      detailSelectionInvalidated: false,
    },
    detail: {
      fieldAvailability: undefined,
      identity,
      selection: undefined,
      status: "idle",
    },
    identity,
    map: {
      identity,
      request: { ...identity, requestSequence: null, zoom: null },
      result: {},
      status: "idle",
    },
    search: {
      identity,
      normalizedQuery: "羅比親王",
      query: "羅比親王",
      resultCount: 1,
      resultReferences: [
        {
          canonicalTreeId: "taichung:data.gov.tw:109853:254",
          speciesDisplayValue: "羅比親王海棗",
        },
      ],
      semantics: "species-exact-value",
      status: "ready",
    },
    statistics: [],
  };
}

function rgbaAt(
  image: ReturnType<typeof createRuntimeClusterCanopyImage>,
  x: number,
  y: number,
): readonly number[] {
  const offset = (y * image.width + x) * 4;
  return [...image.data.slice(offset, offset + 4)];
}

describe("public WebMCP UI polish", () => {
  it("renders the compact Tree Radar header with an accessible Umin Labs link", () => {
    const markup = renderToStaticMarkup(
      createElement(TreeRadarChallengeHeader),
    );
    expect(markup).toContain("Tree Radar");
    expect(markup).toContain("WebMCP Challenge");
    expect(markup).toContain('href="https://www.uminlabs.com/"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('aria-label="Umin Labs（於新分頁開啟）"');
    expect(markup).toContain("external-link-icon");
  });

  it("uses each result reference's canonical species label instead of the partial query", () => {
    expect(taichungProductSearchRows(readySearchProjection())).toEqual([
      {
        canonicalTreeId: "taichung:data.gov.tw:109853:254",
        sourceRecordId: "254",
        speciesDisplayValue: "羅比親王海棗",
      },
    ]);
  });

  it("marks the official dataset link as a new-tab external link", () => {
    const markup = renderToStaticMarkup(
      createElement(TaichungRuntimeTreeDetail, {
        onClear: () => undefined,
        projection: {
          ...readySearchProjection(),
          detail: {
            fieldAvailability: {
              canonicalTreeId: "available",
              coordinates: "available",
              productionDetailFields: "unavailable",
              sourceRecordId: "available",
              speciesDisplayValue: "available",
            },
            identity,
            record: {
              canonicalTreeId: "taichung:data.gov.tw:109853:254",
              coordinates: { latitude: 24.15, longitude: 120.66 },
              sourceRecordId: "254",
              speciesDisplayValue: "羅比親王海棗",
            },
            selection: undefined,
            status: "ready",
          },
        },
      }),
    );
    expect(markup).toContain('href="https://data.gov.tw/dataset/109853"');
    expect(markup).toContain(
      'aria-label="查看臺中市行道樹官方資料集（於新分頁開啟）"',
    );
    expect(markup).toContain("external-link-icon");
  });

  it("renders a high-resolution anti-aliased canopy with highlight and trunk", () => {
    const image = createRuntimeClusterCanopyImage();
    expect(image).toMatchObject({ height: 128, width: 128 });
    expect(
      image.data.some(
        (channel, index) => index % 4 === 3 && channel > 0 && channel < 255,
      ),
    ).toBe(true);
    expect(rgbaAt(image, 80, 42)).toEqual([120, 184, 140, 255]);
    expect(rgbaAt(image, 58, 76)).toEqual([124, 78, 51, 255]);
  });
});
