import { join } from "node:path";
import os from "node:os";
import { loadUsageIndex, createPublicSnapshot } from "./telemetry.js";
import { buildDashboardPayload, buildDayPayload } from "../public/analytics.js";

export { parseSessionLog, loadUsageIndex, createPublicSnapshot, reconcileSessions } from "./telemetry.js";
export { buildDashboardPayload, buildDayPayload } from "../public/analytics.js";

export function createUsageService(options = {}) {
  const codexRoot = options.codexRoot || join(os.homedir(), ".codex");
  const cacheFilePath = options.cacheFilePath || join(codexRoot, "cache", "usage-dashboard-index.json");
  const nowProvider = options.nowProvider || (() => new Date());
  return {
    async getDashboard(params = {}) {
      return buildDashboardPayload(createPublicSnapshot(await loadUsageIndex({ codexRoot, cacheFilePath })), { ...params, now: nowProvider() });
    },
    async getDay(date, params = {}) {
      return buildDayPayload(createPublicSnapshot(await loadUsageIndex({ codexRoot, cacheFilePath })), date, { ...params, now: nowProvider() });
    },
    async refresh() {
      const index = await loadUsageIndex({ codexRoot, cacheFilePath, forceReparse: true });
      return { ok: true, generated_at: index.generated_at, source: index.source };
    }
  };
}
