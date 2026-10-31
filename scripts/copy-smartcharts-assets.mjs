import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageDist = dirname(require.resolve("@deriv-com/smartcharts-champion"));
const publicSmartCharts = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "smartcharts");
const flutterServiceWorkerFiles = ["flutter_bootstrap.js", "flutter_service_worker.js"];

await mkdir(publicSmartCharts, { recursive: true });
await cp(packageDist, publicSmartCharts, {
  recursive: true,
  filter: (source) =>
    !source.endsWith(".map") && !flutterServiceWorkerFiles.includes(basename(source)),
});

await Promise.all(
  flutterServiceWorkerFiles.map((file) =>
    rm(join(publicSmartCharts, "chart", file), { force: true }),
  ),
);

console.log("Copied Deriv SmartCharts runtime assets to public/smartcharts.");