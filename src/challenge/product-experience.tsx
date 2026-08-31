"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { RuntimeMap } from "../runtime/ui-projection/runtime-map.tsx";
import {
  type RuntimeUiProjection,
  type RuntimeUiSession,
} from "../runtime/ui-projection/runtime-ui-projection.ts";
import { isEmptySpeciesSearch } from "../runtime/ui-projection/runtime-ui-screen.tsx";
import { ExternalLinkIcon } from "./external-link-icon.tsx";
import { openTaichungChallengeRuntime } from "./taichung-runtime.ts";
import { TaichungWebMcpAdapter } from "./taichung-webmcp-adapter.tsx";
import type { TaichungWebMcpTree } from "./taichung-webmcp.ts";

const MAX_VISIBLE_SEARCH_RESULTS = 20;
const TAICHUNG_CANONICAL_ID_PREFIX = "taichung:data.gov.tw:109853:";

export type TaichungProductSearchRow = Readonly<{
  canonicalTreeId: string;
  sourceRecordId: string;
  speciesDisplayValue: string;
}>;

export function taichungSourceRecordId(canonicalTreeId: string): string {
  return canonicalTreeId.startsWith(TAICHUNG_CANONICAL_ID_PREFIX)
    ? canonicalTreeId.slice(TAICHUNG_CANONICAL_ID_PREFIX.length)
    : "官方資料編號未提供";
}

export function taichungProductSearchRows(
  projection: RuntimeUiProjection,
): readonly TaichungProductSearchRow[] {
  if (projection.search.status !== "ready") return [];
  return projection.search.resultReferences
    .slice(0, MAX_VISIBLE_SEARCH_RESULTS)
    .map((reference) =>
      Object.freeze({
        canonicalTreeId: reference.canonicalTreeId,
        sourceRecordId: taichungSourceRecordId(reference.canonicalTreeId),
        speciesDisplayValue: reference.speciesDisplayValue,
      }),
    );
}

export function TaichungRuntimeTreeDetail({
  onClear,
  projection,
}: Readonly<{ onClear(): void; projection: RuntimeUiProjection }>) {
  const detail = projection.detail;
  if (detail.status !== "ready" || !detail.record)
    return (
      <div className="selection-prompt">
        <p className="eyebrow">從地圖或搜尋開始</p>
        <h2>選擇一棵樹</h2>
        <p>查看官方提供的樹種、資料編號與地圖位置</p>
      </div>
    );
  const record = detail.record;
  return (
    <article aria-labelledby="selected-tree-title" className="detail-panel">
      <div className="detail-heading-row">
        <div>
          <p className="eyebrow">樹木編號 {record.sourceRecordId}</p>
          <h2 id="selected-tree-title">
            {record.speciesDisplayValue ?? "未提供樹種名稱"}
          </h2>
        </div>
        <div className="detail-heading-actions">
          <button className="clear-selection" onClick={onClear} type="button">
            關閉詳細資料
          </button>
        </div>
      </div>
      <dl className="detail-grid">
        <div>
          <dt>緯度</dt>
          <dd>{record.coordinates.latitude}</dd>
        </div>
        <div>
          <dt>經度</dt>
          <dd>{record.coordinates.longitude}</dd>
        </div>
      </dl>
      <section aria-labelledby="source-title" className="source-box">
        <h3 id="source-title">官方來源</h3>
        <p>臺中市行道樹分佈圖</p>
        <a
          aria-label="查看臺中市行道樹官方資料集（於新分頁開啟）"
          className="external-link"
          href="https://data.gov.tw/dataset/109853"
          rel="noopener noreferrer"
          target="_blank"
        >
          查看官方資料集
          <ExternalLinkIcon />
        </a>
      </section>
    </article>
  );
}

/** Product presentation over the fixed lazy runtime; diagnostics stay in the harness. */
export function TaichungChallengeExperience() {
  const [projection, setProjection] = useState<RuntimeUiProjection>();
  const sessionRef = useRef<RuntimeUiSession | undefined>(undefined);
  const [webMcpSession, setWebMcpSession] = useState<RuntimeUiSession>();
  const [agentCandidateTrees, setAgentCandidateTrees] = useState<
    readonly TaichungWebMcpTree[]
  >([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let disposed = false;
    let close = () => undefined;
    void openTaichungChallengeRuntime()
      .then((opened) => {
        if (disposed) {
          if (opened.status === "ready") opened.dispose();
          return;
        }
        if (opened.status !== "ready") return;
        sessionRef.current = opened.session;
        setWebMcpSession(opened.session);
        setProjection(opened.projection);
        const unsubscribe = opened.session.subscribe(() => {
          setProjection(opened.session.getSnapshot());
        });
        close = () => {
          unsubscribe();
          opened.dispose();
        };
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      sessionRef.current = undefined;
      close();
    };
  }, []);

  const selectTree = useCallback((canonicalTreeId: string) => {
    setSelectedId(canonicalTreeId);
    void sessionRef.current?.loadDetail(canonicalTreeId);
  }, []);
  const clearSelection = useCallback(() => {
    setSelectedId(null);
    sessionRef.current?.clearDetail();
  }, []);
  const showAgentCandidates = useCallback(
    (trees: readonly TaichungWebMcpTree[], selectTreeId: string | null) => {
      setAgentCandidateTrees(trees);
      if (selectTreeId) selectTree(selectTreeId);
    },
    [selectTree],
  );
  const submitSearch = useCallback(() => {
    if (isEmptySpeciesSearch(query)) {
      sessionRef.current?.clearSpeciesSearch();
      return;
    }
    void sessionRef.current?.searchSpecies(query);
  }, [query]);

  if (!projection)
    return (
      <section
        aria-busy="true"
        className="experience"
        aria-label="臺中市行道樹地圖"
      >
        <div className="map-column">
          <div className="map-canvas-shell" />
        </div>
      </section>
    );

  const searchRows = taichungProductSearchRows(projection);
  const officialCount = projection.statistics.find(
    (statistic) => statistic.scope === "package_official_total",
  )?.value;
  return (
    <section aria-label="臺中市行道樹地圖" className="experience">
      {webMcpSession ? (
        <TaichungWebMcpAdapter
          onShowTrees={showAgentCandidates}
          session={webMcpSession}
        />
      ) : null}
      <div className="map-column">
        <div className="map-summary">
          <span>臺中市行道樹</span>
          {officialCount === undefined ? null : (
            <span>官方資料共 {officialCount.toLocaleString("zh-TW")} 筆</span>
          )}
        </div>
        <RuntimeMap
          candidateTrees={agentCandidateTrees}
          onSelect={selectTree}
          onViewport={(request) => {
            void sessionRef.current?.loadViewport(request);
          }}
          presentation="product"
          projection={projection}
          selectedId={selectedId}
        />
      </div>
      <aside aria-label="樹木搜尋與詳細資料" className="records-column">
        <TaichungRuntimeTreeDetail
          onClear={clearSelection}
          projection={projection}
        />
        <div className="tree-list-wrap">
          <section className="tree-search">
            <label htmlFor="taichung-tree-search">搜尋樹種</label>
            <form
              className="tree-search-controls"
              onSubmit={(event) => {
                event.preventDefault();
                submitSearch();
              }}
            >
              <input
                id="taichung-tree-search"
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                }}
                placeholder="輸入完整樹種名稱"
                type="search"
                value={query}
              />
              <button className="clear-tree-search" type="submit">
                搜尋
              </button>
            </form>
            {projection.search.status === "ready" ? (
              <p aria-live="polite">
                顯示前 {searchRows.length} 筆，共{" "}
                {projection.search.resultCount ?? 0} 筆
              </p>
            ) : projection.search.status === "no_result" ? (
              <p aria-live="polite">沒有符合的樹種。</p>
            ) : (
              <p>輸入完整樹種名稱後搜尋。</p>
            )}
          </section>
          {searchRows.length > 0 ? (
            <ul className="tree-list">
              {searchRows.map((row) => (
                <li key={row.canonicalTreeId}>
                  <button
                    aria-pressed={selectedId === row.canonicalTreeId}
                    onClick={() => {
                      selectTree(row.canonicalTreeId);
                    }}
                    type="button"
                  >
                    <strong>{row.speciesDisplayValue}</strong>
                    <small>資料編號：{row.sourceRecordId}</small>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </aside>
    </section>
  );
}
