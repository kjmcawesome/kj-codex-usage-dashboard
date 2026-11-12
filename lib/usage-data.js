import { join } from "node:path";
import os from "node:os";
import { loadUsageIndex, createPublicSnapshot } from "./telemetry.js";
import { mergeRecordedHistory, readHistoryBaseline, readPreviousSnapshot } from "./history.js";
import { buildDashboardPayload, buildDayPayload } from "../public/analytics.js";

export { parseSessionLog, loadUsageIndex, createPublicSnapshot, reconcileSessions } from "./telemetry.js";
export { buildDashboardPayload, buildDayPayload } from "../public/analytics.js";

export function createUsageService(options = {}) {
  const codexRoot = options.codexRoot || join(os.homedir(), ".codex");
  const cacheFilePath = options.cacheFilePath || join(codexRoot, "cache", "usage-dashboard-index.json");
  const nowProvider = options.nowProvider || (() => new Date());
  async function collect(forceReparse = false) {
    const baseline = await readHistoryBaseline(options.historyFilePath);
    const previous = await readPreviousSnapshot(options.previousSnapshotPath);
    const index = await loadUsageIndex({codexRoot, cacheFilePath, forceReparse, timezone:baseline?.timezone || previous?.timezone});
    return {snapshot:mergeRecordedHistory(createPublicSnapshot(index), baseline, previous), source:index.source};
  }
  return {
    async getDashboard(params = {}) {
      return buildDashboardPayload((await collect()).snapshot, { ...params, now: nowProvider() });
    },
    async getDay(date, params = {}) {
      return buildDayPayload((await collect()).snapshot, date, { ...params, now: nowProvider() });
    },
    async refresh() {
      const {snapshot,source} = await collect(true);
      return { ok: true, generated_at: snapshot.generated_at, source: {...source, ...snapshot.source} };
    }
  };
}
