"use client";

import { useEffect } from "react";

import type { RuntimeUiSession } from "../runtime/ui-projection/runtime-ui-projection.ts";
import {
  createTaichungWebMcpTools,
  registerTaichungWebMcpTools,
  type TaichungWebMcpTree,
  type WebMcpDocumentLike,
} from "./taichung-webmcp.ts";

/** Progressive enhancement: the product remains usable if WebMCP is absent. */
export function TaichungWebMcpAdapter({
  onShowTrees,
  session,
}: Readonly<{
  onShowTrees(
    trees: readonly TaichungWebMcpTree[],
    selectTreeId: string | null,
  ): void;
  session: RuntimeUiSession;
}>) {
  useEffect(() => {
    const controller = new AbortController();
    const tools = createTaichungWebMcpTools({
      mapController: { showTrees: onShowTrees },
      session,
    });
    let disposed = false;
    let release: () => void = () => undefined;
    void registerTaichungWebMcpTools({
      documentLike: document as unknown as WebMcpDocumentLike,
      signal: controller.signal,
      tools,
    }).then((registration) => {
      if (disposed || registration.status !== "registered") {
        registration.dispose();
        controller.abort();
      } else release = registration.dispose;
    });
    return () => {
      disposed = true;
      controller.abort();
      release();
    };
  }, [onShowTrees, session]);
  return null;
}
