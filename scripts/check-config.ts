// Run with: npm run check-config
// Validates every file in /config (shapes, rubric totals, scenario -> module links).
// Importing the config module runs the validation; it throws with a clear message on mistakes.
// `server-only` throws outside Next.js, so we stub it first.
import Module from "node:module";

const originalLoad = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: (...a: unknown[]) => unknown })._load = function (request: unknown, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, ...rest);
};

async function main() {
  const { config } = await import("../src/lib/config/index");
  const modules = Object.keys(config.rubric.modules).length;
  console.log(`Config OK: ${Object.keys(config.scenarios).length} scenarios, ${modules} rubric modules, ${config.objections.length} objections.`);
  if (!config.business.monday_pricing.last_verified) {
    console.log("Reminder: business.json monday_pricing.last_verified is empty - verify pricing against monday.com.");
  }
}
main();
