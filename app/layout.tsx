import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

import "./globals.css";

export const metadata: Metadata = {
  description:
    "A standalone WebMCP challenge surface for Taichung street-tree exploration.",
  title: "Tree Radar WebMCP Challenge",
};

export const viewport: Viewport = {
  initialScale: 1,
  themeColor: "#f3f5ef",
  width: "device-width",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-Hant-TW">
      <body>{children}</body>
    </html>
  );
}
