import { readFile } from "node:fs/promises";

export const DEFAULT_PREVIOUS_SNAPSHOT = new URL("../public/data/usage-snapshot.json", import.meta.url);

export const DEFAULT_HISTORY_FILE = new URL("../config/history-baseline.json", import.meta.url);

function validateSnapshot(snapshot, label) {
  if (snapshot?.snapshot_version !== 3 || snapshot?.counting_version !== 3 ||
      !Array.isArray(snapshot.sessions) || !Array.isArray(snapshot.workspaces) ||
      !Number.isFinite(Date.parse(snapshot.generated_at))) {
    throw new Error(`${label} must be a complete version 3 usage snapshot.`);
  }
  const ids = new Set();
  for (const session of snapshot.sessions) {
    if (!session.session_id || ids.has(session.session_id) || !Array.isArray(session.events)) {
      throw new Error(`${label} contains a missing or duplicate session ID, or incomplete events.`);
    }
    ids.add(session.session_id);
  }
}

// The configured baseline is required. A missing or corrupt file must not silently
// replace a broader published history with whichever logs happen to be local today.
// Tests and explicitly local-only callers may pass null to disable preservation.
export async function readHistoryBaseline(filePath = DEFAULT_HISTORY_FILE) {
  if (filePath === null) return null;
  const snapshot = JSON.parse(await readFile(filePath, "utf8"));
  return snapshot.source?.is_demo === true ? null : snapshot;
}

export async function readPreviousSnapshot(filePath = DEFAULT_PREVIOUS_SNAPSHOT) {
  if (filePath === null) return null;
  try { const snapshot = JSON.parse(await readFile(filePath, "utf8")); return snapshot.source?.is_demo === true ? null : snapshot; }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

export function mergeRecordedHistory(local, historical = null, previous = null) {
  validateSnapshot(local, "Local collection");
  const histories = [historical, previous].filter(Boolean);
  for (const historical of histories) {
    validateSnapshot(historical, "Historical baseline");
    if (Date.parse(historical.generated_at) > Date.parse(local.generated_at)) {
      throw new Error("Historical baseline is newer than the local collection. Recollect local usage before rebuilding.");
    }
    if (historical.timezone !== local.timezone) {
      throw new Error("Historical baseline and local collection must use the same timezone.");
    }
  }
  const localIds = new Set(local.sessions.map((session) => session.session_id));
  const recorded = new Map();
  for (const prior of histories.sort((a, b) => Date.parse(a.generated_at) - Date.parse(b.generated_at))) {
    // Legacy mixed snapshots lack per-session dates. Keep their oldest known
    // capture conservatively instead of assigning the latest refresh time.
    const fallback = prior.source?.historical_generated_at || prior.generated_at;
    for (const session of prior.sessions) recorded.set(session.session_id, {
      ...session, collected_at: session.collected_at || fallback
    });
  }
  const preserved = [...recorded.values()].filter((session) => !localIds.has(session.session_id));
  // A locally present session replaces its historical version in full. Adding
  // their cumulative records together would count the same work twice.
  const sessions = [...preserved, ...local.sessions.map((session) => ({ ...session, collected_at: local.generated_at }))];
  const workspaces = [...new Map([...histories.flatMap((prior) => prior.workspaces), ...local.workspaces]
    .map((workspace) => [workspace.workspace_key, workspace])).values()]
    .sort((a, b) => a.workspace_label.localeCompare(b.workspace_label));
  let earliestDate = null;
  for (const session of sessions) {
    for (const event of session.events) {
      if (event.total_tokens > 0 && /^\d{4}-\d{2}-\d{2}$/.test(event.date) &&
          (!earliestDate || event.date < earliestDate)) earliestDate = event.date;
    }
  }
  return {
    ...local,
    earliest_date: earliestDate,
    sessions,
    workspaces,
    // Collection time, latest local event, and diagnostic counts remain local.
    // Baseline diagnostics cannot be allocated to only the preserved sessions.
    quality: { ...(local.quality || {}) },
    source: {
      ...(local.source || {}),
      recorded_sessions: sessions.length,
      local_recorded_sessions: local.sessions.length,
      historical_sessions_preserved: preserved.length,
      historical_generated_at: preserved.map((session) => session.collected_at).sort()[0] || null,
      quality_scope: "current_local_logs"
    }
  };
}
