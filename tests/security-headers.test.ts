import { describe, expect, it } from "vitest";

import nextConfig from "../next.config.ts";

async function configuredHeaders(): Promise<ReadonlyMap<string, string>> {
  const routes = await nextConfig.headers?.();
  const route = routes?.find((candidate) => candidate.source === "/:path*");
  if (!route) throw new Error("Missing all-routes security-header config.");
  return new Map(
    route.headers.map((header) => [header.key.toLowerCase(), header.value]),
  );
}

describe("security headers", () => {
  it("configures every expected header on all routes", async () => {
    const headers = await configuredHeaders();

    expect(typeof headers.get("content-security-policy")).toBe("string");
    expect(typeof headers.get("permissions-policy")).toBe("string");
    expect(headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(headers.get("strict-transport-security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-frame-options")).toBe("DENY");
  });

  it("allows only the required CSP sources and directives", async () => {
    const headers = await configuredHeaders();
    const policy = headers.get("content-security-policy");
    if (!policy) throw new Error("Missing Content-Security-Policy.");

    const directives = new Map(
      policy.split(";").map((directive) => {
        const [name, ...sources] = directive.trim().split(/\s+/);
        return [name ?? "", sources];
      }),
    );

    const expectedDirectives = new Map<string, readonly string[]>([
      ["base-uri", ["'self'"]],
      ["connect-src", ["'self'", "https://tiles.openfreemap.org"]],
      ["default-src", ["'self'"]],
      ["font-src", ["'self'"]],
      ["form-action", ["'self'"]],
      ["frame-ancestors", ["'none'"]],
      ["frame-src", ["'none'"]],
      [
        "img-src",
        ["'self'", "blob:", "data:", "https://tiles.openfreemap.org"],
      ],
      ["object-src", ["'none'"]],
      ["script-src", ["'self'", "'unsafe-inline'"]],
      ["style-src", ["'self'", "'unsafe-inline'"]],
      ["worker-src", ["blob:"]],
    ]);
    for (const [name, sources] of expectedDirectives)
      expect(directives.get(name)).toEqual(sources);
    expect(directives.has("upgrade-insecure-requests")).toBe(true);
    expect(policy).not.toContain("unsafe-eval");

    for (const [name, sources] of directives) {
      if (!name.endsWith("-src") && name !== "default-src") continue;
      expect(sources).not.toContain("*");
    }
  });

  it("disables each non-required browser capability", async () => {
    const headers = await configuredHeaders();
    const policy = headers.get("permissions-policy");
    if (!policy) throw new Error("Missing Permissions-Policy.");

    expect(policy).toBe(
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), clipboard-read=(), clipboard-write=(), browsing-topics=()",
    );
  });
});
