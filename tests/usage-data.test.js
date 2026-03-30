import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import { join, resolve } from "node:path";

import {
  buildDashboardPayload,
  buildDayPayload,
  createPublicSnapshot,
  loadUsageIndex,
  parseSessionLog
} from "../lib/usage-data.js";
import { createUsageService } from "../lib/usage-data.js";
import { createAppServer } from "../server.js";

const fixtureRoot = resolve("./tests/fixtures/codex-root");
const publicRoot = resolve("./public");

function fixedNow() {
  return new Date("2026-03-25T12:00:00.000Z");
}

function assertClose(actual, expected, epsilon = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `Expected ${actual} to be within ${epsilon} of ${expected}`
  );
}

function heatmapDayByDate(dashboard, date) {
  return dashboard.heatmap_days.find((day) => day.date === date);
}

function habitBoardDayByDate(dashboard, date) {
  return dashboard.habit_board.days.find((day) => day.date === date);
}

async function withTestServer(callback) {
  const tempRoot = await mkdtemp(join(os.tmpdir(), "codex-usage-server-"));
  const cacheFilePath = join(tempRoot, "usage-dashboard-index.json");
  const usageService = createUsageService({
    codexRoot: fixtureRoot,
    cacheFilePath,
    nowProvider: fixedNow
  });
  const server = createAppServer({
    usageService,
    staticRoot: publicRoot
  });

  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    await callback({ baseUrl });
  } finally {
    await new Promise((resolvePromise, rejectPromise) =>
      server.close((error) => (error ? rejectPromise(error) : resolvePromise()))
    );
  }
}

test("parseSessionLog handles one-snapshot sessions", async () => {
  const session = await parseSessionLog(join(fixtureRoot, "sessions", "rollout-2026-03-20-session-one.jsonl"));

  assert.equal(session.session_id, "session-one");
  assert.equal(session.total_tokens, 150);
  assert.equal(session.input_tokens, 120);
  assert.equal(session.cached_input_tokens, 20);
  assert.equal(session.output_tokens, 30);
  assert.equal(session.reasoning_output_tokens, 10);
  assert.equal(session.events.length, 1);
  assert.equal(session.primary_model, "gpt-5.4");
  assert.deepEqual(session.models_used, ["gpt-5.4"]);
  assert.equal(session.events[0].model, "gpt-5.4");
});

test("parseSessionLog ignores duplicate token snapshots", async () => {
  const session = await parseSessionLog(join(fixtureRoot, "sessions", "rollout-2026-03-21-session-duplicate.jsonl"));

  assert.equal(session.total_tokens, 190);
  assert.equal(session.events.length, 2);
  assert.deepEqual(
    session.events.map((event) => event.total_tokens),
    [100, 90]
  );
});

test("parseSessionLog ignores info:null and preserves first real snapshot", async () => {
  const session = await parseSessionLog(join(fixtureRoot, "sessions", "rollout-2026-03-24-session-null.jsonl"));

  assert.equal(session.total_tokens, 50);
  assert.equal(session.events.length, 1);
});

test("parseSessionLog marks subagent sessions", async () => {
  const session = await parseSessionLog(join(fixtureRoot, "archived_sessions", "rollout-2026-03-23-session-subagent.jsonl"));

  assert.equal(session.session_id, "session-subagent");
  assert.equal(session.is_subagent, true);
  assert.equal(session.parent_session_id, "session-multiday");
  assert.equal(session.agent_role, "worker");
});

test("loadUsageIndex reuses cached per-file summaries and supports forced refresh", async () => {
  const tempRoot = await mkdtemp(join(os.tmpdir(), "codex-usage-cache-"));
  const cacheFilePath = join(tempRoot, "usage-dashboard-index.json");

  const cold = await loadUsageIndex({ codexRoot: fixtureRoot, cacheFilePath, forceReparse: true });
  assert.equal(cold.source.reparsed_files, 6);
  assert.equal(cold.source.reused_files, 0);
  assert.equal(cold.sessions.filter((session) => session.session_id === "session-multiday").length, 1);
  assert.equal(
    cold.sessions.find((session) => session.session_id === "session-multiday").total_tokens,
    200
  );

  const warm = await loadUsageIndex({ codexRoot: fixtureRoot, cacheFilePath });
  assert.equal(warm.source.reparsed_files, 0);
  assert.equal(warm.source.reused_files, 6);

  const forced = await loadUsageIndex({ codexRoot: fixtureRoot, cacheFilePath, forceReparse: true });
  assert.equal(forced.source.reparsed_files, 6);
});

test("buildDashboardPayload computes range summaries and filter reconciliation", async () => {
  const tempRoot = await mkdtemp(join(os.tmpdir(), "codex-usage-range-"));
  const cacheFilePath = join(tempRoot, "usage-dashboard-index.json");
  const index = await loadUsageIndex({ codexRoot: fixtureRoot, cacheFilePath, forceReparse: true });

  const allSessions = buildDashboardPayload(index, {
    days: 365,
    includeSubagents: true,
    workspace: "all",
    now: fixedNow()
  });
  const noSubagents = buildDashboardPayload(index, {
    days: 365,
    includeSubagents: false,
    workspace: "all",
    now: fixedNow()
  });

  assert.equal(allSessions.summary.total_tokens, 650);
  assert.equal(noSubagents.summary.total_tokens, 590);
  assert.equal(allSessions.summary.total_tokens - noSubagents.summary.total_tokens, 60);
  assert.equal(allSessions.summary.input_tokens, 490);
  assert.equal(allSessions.summary.output_tokens, 160);
  assert.equal(allSessions.summary.cached_input_tokens, 100);
  assert.equal(allSessions.summary.reasoning_output_tokens, 34);
  assert.equal(allSessions.summary.unpriced_total_tokens, 50);
  assertClose(allSessions.summary.estimated_cost_usd, 0.0032305);
  assertClose(noSubagents.summary.estimated_cost_usd, 0.00278175);
  assert.equal(allSessions.cost_mode, "estimated");
  assert.equal(allSessions.selection.mode, "preset");
  assert.equal(allSessions.selection.days, 365);
  assert.equal(allSessions.available_range.start_date, "2026-03-20");
  assert.equal(allSessions.available_range.end_date, "2026-03-25");
  assert.equal(allSessions.current_work_range.start_at, "2026-03-22T12:00:00.000Z");
  assert.equal(allSessions.current_work_range.end_at, "2026-03-25T12:00:00.000Z");
  assert.equal(allSessions.current_work_range.hours, 72);
  assert.equal(allSessions.current_work_sessions[0].thread_name, "Multi-day thread");
  assert.equal(allSessions.current_work_sessions[0].total_tokens, 200);
  assert.equal(allSessions.current_work_sessions[1].thread_name, "Subagent thread");
  assert.equal(allSessions.current_work_sessions[1].total_tokens, 60);
  assert.equal(allSessions.current_work_sessions[2].thread_name, "Null-info thread");
  assert.equal(allSessions.current_work_sessions[2].total_tokens, 50);
  assert.equal(allSessions.habit_board.start_date, "2025-03-26");
  assert.equal(allSessions.habit_board.end_date, "2026-03-25");
  assert.equal(allSessions.habit_metrics.today_has_usage, false);
  assert.equal(allSessions.habit_metrics.today_tokens, 0);
  assertClose(allSessions.habit_metrics.today_estimated_cost_usd, 0);
  assert.equal(allSessions.habit_metrics.last_14_days_tokens, 650);
  assertClose(allSessions.habit_metrics.last_14_days_estimated_cost_usd, 0.0032305);
  assert.equal(allSessions.habit_metrics.last_7_days_tokens, 650);
  assert.equal(allSessions.habit_metrics.previous_7_days_tokens, 0);
  assert.equal(allSessions.habit_metrics.month_to_date_tokens, 650);
  assertClose(allSessions.habit_metrics.month_to_date_estimated_cost_usd, 0.0032305);
  assert.equal(allSessions.habit_metrics.previous_month_comparable_tokens, 0);
  assert.equal(allSessions.habit_metrics.current_streak, 0);
  assert.equal(allSessions.habit_metrics.best_streak, 5);
  assert.equal(allSessions.habit_metrics.workweek_green_days, 2);
  assert.equal(allSessions.habit_metrics.workweek_goal, 5);
  assert.equal(allSessions.snapshot_windows.today.total_tokens, 0);
  assert.equal(allSessions.snapshot_windows.trailing_14d.total_tokens, 650);
  assert.equal(allSessions.snapshot_windows.trailing_14d.token_change_pct, null);
  assert.equal(allSessions.snapshot_windows.month_to_date.total_tokens, 650);
  assert.equal(allSessions.snapshot_windows.month_to_date.cost_change_pct, null);
  assertClose(allSessions.efficiency_metrics.effective_cost_per_million, 4.970000000000001);
  assertClose(allSessions.efficiency_metrics.input_output_ratio, 3.0625);
  assertClose(allSessions.efficiency_metrics.peak_day_share, 190 / 650);
  assert.equal(allSessions.efficiency_metrics.month_to_date_token_growth_pct, null);
  assert.equal(allSessions.efficiency_metrics.last_7_day_change_pct, null);
  assert.ok(allSessions.efficiency_metrics.top_model);
  assert.equal(allSessions.range_comparison.available, true);
  assert.equal(allSessions.range_comparison.previous_total_tokens, 0);
  assert.equal(allSessions.range_comparison.token_change_pct, null);
  assert.equal(allSessions.insights[0].title, "One day is driving the range");
  assertClose(allSessions.habit_board.scale.max_total_tokens, 190);
  assertClose(allSessions.heatmap_scale.max_total_tokens, 190);
  assertClose(allSessions.heatmap_scale.thresholds[0], 47.5);
  assertClose(allSessions.heatmap_scale.thresholds[1], 95);
  assertClose(allSessions.heatmap_scale.thresholds[2], 142.5);
  assertClose(allSessions.heatmap_scale.thresholds[3], 190);
  assert.equal(heatmapDayByDate(allSessions, "2026-03-20").level, 4);
  assert.equal(heatmapDayByDate(allSessions, "2026-03-22").level, 2);
  assert.equal(heatmapDayByDate(allSessions, "2026-03-24").level, 2);
  assert.equal(habitBoardDayByDate(allSessions, "2026-03-20").level, 4);
  assert.equal(allSessions.cost_breakdown_by_model.length, 3);
  assert.ok("share_of_total_tokens" in allSessions.cost_breakdown_by_model[0]);
  assert.ok("effective_cost_per_million" in allSessions.cost_breakdown_by_model[0]);
  assertClose(
    allSessions.cost_breakdown_by_model.reduce((sum, row) => sum + row.estimated_cost_usd, 0),
    allSessions.summary.estimated_cost_usd
  );
  assert.ok("dominant_model_family" in allSessions.top_threads[0]);
  assert.ok("token_share" in allSessions.top_threads[0]);
  assert.ok("cost_share" in allSessions.top_threads[0]);
  assert.equal(allSessions.trend_days.length, 14);
  assert.equal(allSessions.trend_days[0].date, "2026-03-12");
  assert.equal(allSessions.trend_days.at(-1).date, "2026-03-25");
  assert.equal(
    allSessions.trend_days.reduce((sum, day) => sum + day.total_tokens, 0),
    650
  );
  assert.equal(allSessions.heatmap_days.filter((day) => day.in_range).length, 365);
  assert.equal(allSessions.habit_board.days.filter((day) => day.in_range).length, 365);
});

test("buildDashboardPayload supports custom date ranges", async () => {
  const tempRoot = await mkdtemp(join(os.tmpdir(), "codex-usage-custom-range-"));
  const cacheFilePath = join(tempRoot, "usage-dashboard-index.json");
  const index = await loadUsageIndex({ codexRoot: fixtureRoot, cacheFilePath, forceReparse: true });

  const dashboard = buildDashboardPayload(index, {
    startDate: "2026-03-21",
    endDate: "2026-03-23",
    includeSubagents: true,
    workspace: "all",
    now: fixedNow()
  });

  assert.equal(dashboard.range.days, null);
  assert.equal(dashboard.range.start_date, "2026-03-21");
  assert.equal(dashboard.range.end_date, "2026-03-23");
  assert.equal(dashboard.selection.mode, "custom");
  assert.equal(dashboard.selection.label, "Mar 21, 2026 - Mar 23, 2026");
  assert.equal(dashboard.summary.total_tokens, 450);
  assertClose(dashboard.summary.estimated_cost_usd, 0.0023755);
  assertClose(dashboard.efficiency_metrics.effective_cost_per_million, 5.278888888888889);
  assertClose(dashboard.efficiency_metrics.peak_day_share, 190 / 450);
  assert.equal(dashboard.range_comparison.available, true);
  assert.equal(dashboard.range_comparison.previous_start_date, "2026-03-18");
  assert.equal(dashboard.range_comparison.previous_end_date, "2026-03-20");
  assert.equal(dashboard.range_comparison.previous_total_tokens, 150);
  assert.equal(dashboard.range_comparison.previous_estimated_cost_usd > 0, true);
  assertClose(dashboard.range_comparison.token_change_pct, 2);
  assertClose(dashboard.heatmap_scale.max_total_tokens, 190);
  assert.equal(dashboard.trend_days.length, 14);
  assert.equal(dashboard.trend_days[0].date, "2026-03-12");
  assert.equal(dashboard.trend_days.at(-1).date, "2026-03-25");
});

test("buildDashboardPayload supports workspace-specific filtering", async () => {
  const tempRoot = await mkdtemp(join(os.tmpdir(), "codex-usage-workspace-"));
  const cacheFilePath = join(tempRoot, "usage-dashboard-index.json");
  const index = await loadUsageIndex({ codexRoot: fixtureRoot, cacheFilePath, forceReparse: true });
  const meetingPrepWorkspace = index.workspaces.find((workspace) => workspace.workspace_label === "meeting-prep-ops");

  assert.ok(meetingPrepWorkspace);

  const dashboard = buildDashboardPayload(index, {
    days: 365,
    includeSubagents: true,
    workspace: meetingPrepWorkspace.workspace_key,
    now: fixedNow()
  });

  assert.equal(dashboard.summary.total_tokens, 190);
  assert.equal(dashboard.summary.sessions, 1);
  assertClose(dashboard.summary.estimated_cost_usd, 0.0008995);
  assert.equal(dashboard.current_work_sessions.length, 0);
});

test("buildDayPayload returns per-day session drilldown", async () => {
  const tempRoot = await mkdtemp(join(os.tmpdir(), "codex-usage-day-"));
  const cacheFilePath = join(tempRoot, "usage-dashboard-index.json");
  const index = await loadUsageIndex({ codexRoot: fixtureRoot, cacheFilePath, forceReparse: true });

  const withSubagents = buildDayPayload(index, "2026-03-23", {
    days: 365,
    includeSubagents: true,
    workspace: "all",
    now: fixedNow()
  });
  const withoutSubagents = buildDayPayload(index, "2026-03-23", {
    days: 365,
    includeSubagents: false,
    workspace: "all",
    now: fixedNow()
  });

  assert.equal(withSubagents.summary.total_tokens, 180);
  assert.equal(withSubagents.sessions.length, 2);
  assertClose(withSubagents.summary.estimated_cost_usd, 0.00106475);
  assert.equal(withSubagents.sessions[0].estimated_cost_usd >= withSubagents.sessions[1].estimated_cost_usd, true);
  assert.ok("dominant_model_family" in withSubagents.sessions[0]);
  assert.ok("token_share" in withSubagents.sessions[0]);
  assert.ok("cost_share" in withSubagents.sessions[0]);
  assert.equal(withoutSubagents.summary.total_tokens, 120);
  assert.equal(withoutSubagents.sessions.length, 1);
  assertClose(withoutSubagents.summary.estimated_cost_usd, 0.000616);
});

test("buildDayPayload still returns a clicked habit-board day outside the selected range", async () => {
  const tempRoot = await mkdtemp(join(os.tmpdir(), "codex-usage-day-outside-range-"));
  const cacheFilePath = join(tempRoot, "usage-dashboard-index.json");
  const index = await loadUsageIndex({ codexRoot: fixtureRoot, cacheFilePath, forceReparse: true });

  const payload = buildDayPayload(index, "2026-03-20", {
    startDate: "2026-03-23",
    endDate: "2026-03-24",
    includeSubagents: true,
    workspace: "all",
    now: fixedNow()
  });

  assert.equal(payload.selection.mode, "custom");
  assert.equal(payload.summary.total_tokens, 150);
  assert.equal(payload.sessions.length, 1);
  assert.equal(payload.sessions[0].thread_name, "One snapshot thread");
  assert.equal(payload.sessions[0].dominant_model_family, "gpt-5.4");
});

test("createPublicSnapshot strips local source paths and keeps usage data", async () => {
  const tempRoot = await mkdtemp(join(os.tmpdir(), "codex-usage-public-snapshot-"));
  const cacheFilePath = join(tempRoot, "usage-dashboard-index.json");
  const index = await loadUsageIndex({ codexRoot: fixtureRoot, cacheFilePath, forceReparse: true });

  const snapshot = createPublicSnapshot(index);

  assert.equal(snapshot.snapshot_version, 1);
  assert.equal(snapshot.generated_at, index.generated_at);
  assert.equal(snapshot.sessions.length, index.sessions.length);
  assert.equal(snapshot.workspaces.length, index.workspaces.length);
  assert.deepEqual(snapshot.source, { log_files: index.source.log_files });
  assert.equal("codex_root" in snapshot.source, false);
  assert.equal("cache_file" in snapshot.source, false);
});

test("server returns 200 for GET and HEAD on /", async () => {
  await withTestServer(async ({ baseUrl }) => {
    const getResponse = await fetch(`${baseUrl}/`);
    assert.equal(getResponse.status, 200);
    assert.match(getResponse.headers.get("content-type") || "", /text\/html/);
    const html = await getResponse.text();
    assert.match(html, /KJ Codex Usage Dashboard/);

    const headResponse = await fetch(`${baseUrl}/`, { method: "HEAD" });
    assert.equal(headResponse.status, 200);
    assert.match(headResponse.headers.get("content-type") || "", /text\/html/);
    const headBody = await headResponse.text();
    assert.equal(headBody, "");
  });
});

test("server serves static snapshot files even with cache-busting query params", async () => {
  await withTestServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/data/usage-snapshot.json?ts=12345`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /application\/json/);
    const payload = await response.json();
    assert.equal(payload.snapshot_version, 1);
  });
});

test("server returns 200 for GET and HEAD on dashboard API", async () => {
  await withTestServer(async ({ baseUrl }) => {
    const url = `${baseUrl}/api/dashboard?days=30&workspace=all&include_subagents=1`;
    const getResponse = await fetch(url);
    assert.equal(getResponse.status, 200);
    assert.match(getResponse.headers.get("content-type") || "", /application\/json/);
    const payload = await getResponse.json();
    assert.equal(payload.credits_mode, "none");
    assert.equal(payload.cost_mode, "estimated");
    assert.ok(payload.summary.estimated_cost_usd > 0);
    assert.equal(payload.selection.mode, "preset");
    assert.ok(Array.isArray(payload.cost_breakdown_by_model));
    assert.ok(Array.isArray(payload.current_work_sessions));

    const headResponse = await fetch(url, { method: "HEAD" });
    assert.equal(headResponse.status, 200);
    assert.match(headResponse.headers.get("content-type") || "", /application\/json/);
    const headBody = await headResponse.text();
    assert.equal(headBody, "");
  });
});

test("server supports explicit custom ranges on dashboard API", async () => {
  await withTestServer(async ({ baseUrl }) => {
    const response = await fetch(
      `${baseUrl}/api/dashboard?start_date=2026-03-21&end_date=2026-03-23&workspace=all&include_subagents=1`
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.selection.mode, "custom");
    assert.equal(payload.range.start_date, "2026-03-21");
    assert.equal(payload.range.end_date, "2026-03-23");
    assert.equal(payload.summary.total_tokens, 450);
  });
});

test("server returns 200 for HEAD on day API", async () => {
  await withTestServer(async ({ baseUrl }) => {
    const response = await fetch(
      `${baseUrl}/api/day/2026-03-23?days=365&workspace=all&include_subagents=1`,
      { method: "HEAD" }
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /application\/json/);
    assert.equal(await response.text(), "");
  });
});

test("server returns 400 for invalid date range params", async () => {
  await withTestServer(async ({ baseUrl }) => {
    const missingEnd = await fetch(
      `${baseUrl}/api/dashboard?start_date=2026-03-21&workspace=all&include_subagents=1`
    );
    assert.equal(missingEnd.status, 400);
    assert.equal((await missingEnd.json()).error, "Bad request");

    const reversed = await fetch(
      `${baseUrl}/api/dashboard?start_date=2026-03-24&end_date=2026-03-21&workspace=all&include_subagents=1`
    );
    assert.equal(reversed.status, 400);
    assert.equal((await reversed.json()).error, "Bad request");

    const invalidDay = await fetch(`${baseUrl}/api/day/not-a-date?days=30&workspace=all&include_subagents=1`);
    assert.equal(invalidDay.status, 400);
    assert.equal((await invalidDay.json()).error, "Bad request");
  });
});

test("server keeps unsupported methods at 405", async () => {
  await withTestServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/`, { method: "PUT" });
    assert.equal(response.status, 405);
    const payload = await response.json();
    assert.equal(payload.error, "Method not allowed");
  });
});
