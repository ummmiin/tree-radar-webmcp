"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { normalizeSpeciesExactValue } from "../../domain/static-package-shard-contract.ts";
import type {
  RuntimeUiLifecycleCategory,
  RuntimeUiProjection,
  RuntimeUiSession,
} from "./runtime-ui-projection.ts";
import { RuntimeMap } from "./runtime-map.tsx";

export const INITIAL_VISIBLE_SPECIES_RESULTS = 20;

export function visibleSpeciesResultReferences(
  projection: RuntimeUiProjection,
) {
  return projection.search.resultReferences.slice(
    0,
    INITIAL_VISIBLE_SPECIES_RESULTS,
  );
}

export function isEmptySpeciesSearch(query: string): boolean {
  return normalizeSpeciesExactValue(query) === null;
}

export type RuntimeUiHostOpenResult =
  | Readonly<{
      dispose(): void;
      projection: RuntimeUiProjection;
      session: RuntimeUiSession;
      status: "ready";
    }>
  | Readonly<{ status: "rejected" | "unavailable" }>;

function lifecycleText(
  status: RuntimeUiLifecycleCategory | "opening" | "rejected" | "unavailable",
): string {
  const labels: Record<string, string> = {
    capability_unsupported: "此資料套件不支援這項操作。",
    idle: "等待操作。",
    invalid_request: "輸入不符合 runtime 資料要求。",
    loading: "正在載入。",
    no_result: "沒有符合的樹木。",
    not_found: "找不到這棵樹木。",
    opening: "正在整理官方樹木資訊。",
    ready: "資料已就緒。",
    rejected: "Runtime 資料無法啟用。",
    superseded: "先前結果已失效。",
    unavailable: "Runtime 資料暫時無法使用。",
  };
  return labels[status] ?? "Runtime 資料暫時無法使用。";
}

function Statistics({
  projection,
}: Readonly<{ projection: RuntimeUiProjection }>) {
  return (
    <section aria-label="Runtime statistics" className="runtime-statistics">
      <h2>統計</h2>
      <dl>
        {projection.statistics.map((statistic) => (
          <div
            data-scope={statistic.scope}
            data-status={statistic.status}
            key={statistic.scope}
          >
            <dt>{statistic.scope}</dt>
            <dd>
              {statistic.status === "ready" && statistic.value !== undefined
                ? statistic.value.toLocaleString("zh-TW")
                : lifecycleText(statistic.status)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Shared presentation layer. Hosts supply the already-bounded runtime opener only. */
export function RuntimeUiScreen({
  eyebrow,
  heading,
  openRuntimeHost,
}: Readonly<{
  eyebrow: string;
  heading: string;
  openRuntimeHost: () => Promise<RuntimeUiHostOpenResult>;
}>) {
  const [hostStatus, setHostStatus] = useState<
    "opening" | "ready" | "rejected" | "unavailable"
  >("opening");
  const [projection, setProjection] = useState<RuntimeUiProjection>();
  const [selection, setSelection] = useState<Readonly<{
    activationEpoch: number;
    activeResultSetId: string;
    canonicalTreeId: string;
  }> | null>(null);
  const sessionRef = useRef<RuntimeUiSession | undefined>(undefined);
  const composingRef = useRef(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let disposed = false;
    let stop: () => void = () => {
      return undefined;
    };
    void openRuntimeHost()
      .then((opened) => {
        if (disposed) {
          if (opened.status === "ready") opened.dispose();
          return;
        }
        if (opened.status !== "ready") {
          setHostStatus(opened.status);
          return;
        }
        sessionRef.current = opened.session;
        setProjection(opened.projection);
        setHostStatus("ready");
        const unsubscribe = opened.session.subscribe(() => {
          setProjection(opened.session.getSnapshot());
        });
        stop = () => {
          unsubscribe();
          opened.dispose();
        };
      })
      .catch(() => {
        if (!disposed) setHostStatus("unavailable");
      });
    return () => {
      disposed = true;
      sessionRef.current = undefined;
      stop();
    };
  }, [openRuntimeHost]);

  const loadViewport = useCallback((request: unknown) => {
    void sessionRef.current?.loadViewport(request);
  }, []);
  const select = useCallback(
    (canonicalTreeId: string) => {
      if (!projection) return;
      setSelection({
        activationEpoch: projection.identity.activationEpoch,
        activeResultSetId: projection.identity.activeResultSetId,
        canonicalTreeId,
      });
      void sessionRef.current?.loadDetail(canonicalTreeId);
    },
    [projection],
  );
  const submitSearch = useCallback(() => {
    if (composingRef.current) return;
    if (isEmptySpeciesSearch(query)) {
      sessionRef.current?.clearSpeciesSearch();
      return;
    }
    void sessionRef.current?.searchSpecies(query);
  }, [query]);

  if (hostStatus !== "ready" || !projection)
    return (
      <main aria-busy="true" className="runtime-harness-main">
        <section aria-live="polite" role="status">
          <p>正在整理</p>
          <p>官方樹木資訊</p>
          <small>{lifecycleText(hostStatus)}</small>
        </section>
      </main>
    );
  const selectedId =
    selection?.activeResultSetId === projection.identity.activeResultSetId &&
    selection.activationEpoch === projection.identity.activationEpoch
      ? selection.canonicalTreeId
      : null;
  return (
    <main
      aria-busy={projection.accessibility.ariaBusy}
      className="runtime-harness-main"
    >
      <header>
        <p>{eyebrow}</p>
        <h1>{heading}</h1>
        <small aria-live="polite">
          {lifecycleText(
            projection.accessibility.announcement === "active"
              ? "ready"
              : projection.map.status,
          )}
        </small>
      </header>
      <div className="runtime-identity">
        <span>{projection.identity.cityId}</span>
        <span>{projection.identity.datasetKey}</span>
        <span>{projection.identity.activeResultSetId}</span>
        <span>epoch {projection.identity.activationEpoch}</span>
      </div>
      <div className="runtime-grid">
        <section aria-label="Runtime map">
          <RuntimeMap
            onSelect={select}
            onViewport={loadViewport}
            projection={projection}
            selectedId={selectedId}
          />
        </section>
        <aside>
          <section className="runtime-search">
            <h2>樹種精確搜尋</h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitSearch();
              }}
            >
              <label htmlFor="runtime-species-search">樹種名稱</label>
              <input
                id="runtime-species-search"
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                }}
                onCompositionEnd={() => {
                  composingRef.current = false;
                }}
                onCompositionStart={() => {
                  composingRef.current = true;
                }}
                type="search"
                value={query}
              />
              <button type="submit">搜尋</button>
            </form>
            <p aria-live="polite">
              {projection.search.status === "idle"
                ? "請輸入樹種名稱後搜尋。"
                : lifecycleText(projection.search.status)}
            </p>
            {projection.search.status === "ready" ? (
              <>
                <p>
                  顯示前{" "}
                  {Math.min(
                    INITIAL_VISIBLE_SPECIES_RESULTS,
                    projection.search.resultCount ?? 0,
                  )}{" "}
                  筆，共 {projection.search.resultCount ?? 0} 筆。
                </p>
                <ul>
                  {visibleSpeciesResultReferences(projection).map(
                    (reference) => (
                      <li key={reference.canonicalTreeId}>
                        <button
                          onClick={() => {
                            select(reference.canonicalTreeId);
                          }}
                          type="button"
                        >
                          {reference.canonicalTreeId}
                        </button>
                      </li>
                    ),
                  )}
                </ul>
              </>
            ) : null}
          </section>
          <section className="runtime-detail" aria-live="polite">
            <h2>樹木詳情</h2>
            <p>
              {projection.detail.status === "idle"
                ? "尚未選取樹木。"
                : lifecycleText(projection.detail.status)}
            </p>
            {projection.detail.status === "ready" &&
            projection.detail.record ? (
              <dl>
                <div>
                  <dt>樹種</dt>
                  <dd>
                    {projection.detail.record.speciesDisplayValue ?? "未提供"}
                  </dd>
                </div>
                <div>
                  <dt>來源 ID</dt>
                  <dd>{projection.detail.record.sourceRecordId}</dd>
                </div>
                <div>
                  <dt>座標</dt>
                  <dd>
                    {projection.detail.record.coordinates.latitude},{" "}
                    {projection.detail.record.coordinates.longitude}
                  </dd>
                </div>
                <div>
                  <dt>Canonical ID</dt>
                  <dd>{projection.detail.record.canonicalTreeId}</dd>
                </div>
              </dl>
            ) : null}
          </section>
          <Statistics projection={projection} />
        </aside>
      </div>
    </main>
  );
}
