# Tree Radar × WebMCP Challenge

A small, runnable public challenge surface for agent-assisted exploration of Taichung street trees. It retains the same admitted static package and the three browser-exposed WebMCP tools used by the challenge application.

## Challenge disclosure

Pre-existing Tree Radar behavior is the human-facing map, exact species search, tree detail view, governed Taichung static runtime/package, and official-data presentation.

Added for this WebMCP challenge are `document.modelContext` registration and the read-only `get_city_coverage`, `find_trees`, and `show_trees_on_map` tools. They provide bounded agent discovery and an ephemeral candidate-map handoff: a human can explore, an agent can discover permitted candidates, and the human remains in the normal map/detail loop. The tools do not perform named-place geocoding, persistent agent mutation, or Production WebMCP operations.

## Run locally

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`.

## Use WebMCP in Chrome

WebMCP is experimental. Use a current Chrome release that exposes the testing flag, open `chrome://flags/#enable-webmcp-testing`, set it to **Enabled**, and relaunch Chrome. Then visit the local app and inspect the registered tools in DevTools:

```js
const tools = await document.modelContext.getTools();
tools.map((tool) => tool.name);
```

Expected tools: `get_city_coverage`, `find_trees`, and `show_trees_on_map`.

Example calls:

```js
await document.modelContext.executeTool("get_city_coverage", { city: "Taichung" });
await document.modelContext.executeTool("find_trees", {
  city: "Taichung",
  latitude: 24.15,
  longitude: 120.66,
  radiusMeters: 100,
  limit: 5,
});
```

The tool surface is read-only and bounded: coordinate searches allow a maximum 1,000 m radius and return at most 20 trees; map focus accepts at most five IDs. WebMCP enhances the page when supported, while the map and search UI remain usable without it.

## Verify

```bash
npm run validate:static-package
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

## Data source

Tree Radar uses data derived from “臺中市行道樹分佈圖” (Taichung City Street Tree Distribution Map), provided by the Construction Bureau of Taichung City Government (臺中市政府建設局).

National dataset: <https://data.gov.tw/dataset/109853>

The source data is made available under the Taiwan Open Government Data License 1.0 (政府資料開放授權條款－第1版). Attribution is retained here for the provider and dataset title. Tree Radar transforms the source data for search, spatial exploration, and agent-assisted interaction. The original government source remains authoritative.

The extracted challenge package is the admitted 118,403-record package derived from dataset 109853. Dataset 108167 was investigated; it is a distinct Taichung tree dataset and was not substituted into this challenge surface. This project does not imply endorsement by the data provider.

## Scope and license

This repository contains only the runnable Taichung WebMCP challenge: its Next.js entry point, bounded runtime, WebMCP contract/adapter, MapLibre dependency, integrity-checked static package, tests, and documentation. It excludes private operations, credentials, deployment configuration, production infrastructure, governance evidence, and unrelated application features.

Code in this repository is licensed under the [MIT License](LICENSE). The included government data remains subject to the Taiwan Open Government Data License 1.0 and its attribution requirements; the data license does not change merely because the surrounding code is MIT-licensed.

## Challenge hosting plan

Deploy this clean extracted repository as a separate public Vercel project only after review. It has no remote configured by this extraction. The current protected preview deployment is unsuitable for public challenge access because its access policy and governance are intentionally private; a separate public project keeps the challenge surface isolated. This repository is local-only and uncommitted until a maintainer performs the final publication review.
