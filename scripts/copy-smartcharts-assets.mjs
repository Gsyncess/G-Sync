import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageDist = dirname(require.resolve("@deriv-com/smartcharts-champion"));
const publicSmartCharts = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "smartcharts");

await mkdir(publicSmartCharts, { recursive: true });
await cp(packageDist, publicSmartCharts, {
  recursive: true,
  filter: (source) => !source.endsWith(".map"),
});

console.log("Copied Deriv SmartCharts runtime assets to public/smartcharts.");