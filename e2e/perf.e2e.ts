import { test, expect } from "@playwright/test";

test.describe("AirMileX Performance Measurement", () => {
  test("Measure Cold and Warm Home Page Performance (Desktop & Mobile)", async ({ browser }) => {
    const configs = [
      { name: "Desktop", width: 1280, height: 800, isMobile: false },
      { name: "Mobile", width: 375, height: 667, isMobile: true },
    ];

    const results: any[] = [];
    const routeTransitionLogs: string[] = [];

    for (const config of configs) {
      // 1. Cold Cache
      const contextCold = await browser.newContext({
        viewport: { width: config.width, height: config.height },
        isMobile: config.isMobile,
      });
      const pageCold = await contextCold.newPage();

      const coldResources: { url: string; transfer: number; decoded: number; type: string }[] = [];
      pageCold.on("response", async (res) => {
        try {
          const headers = res.headers();
          const url = res.url();
          const buffer = await res.body().catch(() => Buffer.from(""));
          const decoded = buffer.length;
          const cl = headers["content-length"];
          const transfer = cl ? parseInt(cl, 10) : decoded;
          let type = "other";
          if (url.endsWith(".html") || url.endsWith("/")) type = "html";
          else if (url.endsWith(".css") || url.includes(".css")) type = "css";
          else if (url.endsWith(".js") || url.includes(".js")) type = "js";
          coldResources.push({ url, transfer, decoded, type });
        } catch (e) {}
      });

      await pageCold.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle" });

      const timingCold = await pageCold.evaluate(() => {
        const perf = window.performance;
        const nav = perf.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
        const paints = perf.getEntriesByType("paint");
        const fcp = paints.find((p) => p.name === "first-contentful-paint")?.startTime || null;
        const resources = perf.getEntriesByType("resource") as PerformanceResourceTiming[];
        const jsEntries = resources.filter((r) => r.name.includes(".js") || r.initiatorType === "script");

        return {
          fcp,
          domContentLoaded: nav ? nav.domContentLoadedEventEnd - nav.startTime : 0,
          loadEvent: nav ? nav.loadEventEnd - nav.startTime : 0,
          resources: jsEntries.map((r) => ({
            name: r.name.split("/").pop() || r.name,
            transferSize: r.transferSize,
            encodedBodySize: r.encodedBodySize,
            decodedBodySize: r.decodedBodySize,
            duration: r.duration,
          })),
        };
      });

      const jsCold = coldResources.filter((r) => r.type === "js");
      const cssCold = coldResources.filter((r) => r.type === "css");
      const htmlCold = coldResources.filter((r) => r.type === "html");

      results.push({
        viewport: config.name,
        cache: "cold",
        htmlTransferredBytes: htmlCold.reduce((s, r) => s + r.transfer, 0),
        cssTransferredBytes: cssCold.reduce((s, r) => s + r.transfer, 0),
        jsTransferredBytes: jsCold.reduce((s, r) => s + r.transfer, 0),
        jsDecodedBytes: jsCold.reduce((s, r) => s + r.decoded, 0),
        totalTransferredBytes: coldResources.reduce((s, r) => s + r.transfer, 0),
        totalDecodedBytes: coldResources.reduce((s, r) => s + r.decoded, 0),
        jsRequestCount: jsCold.length,
        totalRequestCount: coldResources.length,
        jsFiles: jsCold.map((r) => ({
          name: r.url.split("/").pop()?.split("?")[0] || r.url,
          transfer: r.transfer,
          decoded: r.decoded,
        })),
        fcpMs: timingCold.fcp ? Math.round(timingCold.fcp) : null,
        domContentLoadedMs: Math.round(timingCold.domContentLoaded),
        loadEventMs: Math.round(timingCold.loadEvent),
        mainThreadJsDurationSumMs: Math.round(
          timingCold.resources.reduce((sum, r) => sum + r.duration, 0)
        ),
      });

      // 2. Warm Cache (reload on existing page)
      coldResources.length = 0;
      await pageCold.reload({ waitUntil: "networkidle" });

      const jsWarm = coldResources.filter((r) => r.type === "js");
      const cssWarm = coldResources.filter((r) => r.type === "css");
      const htmlWarm = coldResources.filter((r) => r.type === "html");

      const timingWarm = await pageCold.evaluate(() => {
        const perf = window.performance;
        const nav = perf.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
        const paints = perf.getEntriesByType("paint");
        const fcp = paints.find((p) => p.name === "first-contentful-paint")?.startTime || null;
        return {
          fcp,
          domContentLoaded: nav ? nav.domContentLoadedEventEnd - nav.startTime : 0,
          loadEvent: nav ? nav.loadEventEnd - nav.startTime : 0,
        };
      });

      results.push({
        viewport: config.name,
        cache: "warm",
        htmlTransferredBytes: htmlWarm.reduce((s, r) => s + r.transfer, 0),
        cssTransferredBytes: cssWarm.reduce((s, r) => s + r.transfer, 0),
        jsTransferredBytes: jsWarm.reduce((s, r) => s + r.transfer, 0),
        jsDecodedBytes: jsWarm.reduce((s, r) => s + r.decoded, 0),
        totalTransferredBytes: coldResources.reduce((s, r) => s + r.transfer, 0),
        totalDecodedBytes: coldResources.reduce((s, r) => s + r.decoded, 0),
        jsRequestCount: jsWarm.length,
        totalRequestCount: coldResources.length,
        fcpMs: timingWarm.fcp ? Math.round(timingWarm.fcp) : null,
        domContentLoadedMs: Math.round(timingWarm.domContentLoaded),
        loadEventMs: Math.round(timingWarm.loadEvent),
      });

      // 3. Route transitions on Desktop
      if (config.name === "Desktop") {
        const targetRoutes = ["/pricing", "/refund", "/privacy", "/terms", "/new-job"];
        for (const route of targetRoutes) {
          coldResources.length = 0;
          await pageCold.goto(`http://127.0.0.1:8080${route}`, { waitUntil: "networkidle" });
          const newChunks = coldResources.filter((r) => r.type === "js");
          routeTransitionLogs.push(
            `Route ${route}: requested ${newChunks.length} new JS chunks (${newChunks.map((c) => c.url.split("/").pop()?.split("?")[0]).join(", ")}) totaling ${(newChunks.reduce((s, c) => s + c.decoded, 0) / 1024).toFixed(1)} kB decoded`
          );
        }
      }

      await contextCold.close();
    }

    console.log("\n=== DETAILED PERFORMANCE REPORT ===");
    console.log(JSON.stringify({ results, routeTransitionLogs }, null, 2));
    expect(results.length).toBe(4);
  });
});
