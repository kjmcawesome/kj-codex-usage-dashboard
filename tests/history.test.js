import test from "node:test";
import assert from "node:assert/strict";
import { mergeRecordedHistory, readHistoryBaseline, readPreviousSnapshot } from "../lib/history.js";
import { createAnalytics } from "../public/analytics.js";

const workspace = (id, label = id) => ({ workspace_key: id, workspace_label: label });
const session = (id, total, date, extra = {}) => ({
  session_id: id, parent_session_id: null, thread_name: id, session_started_at: `${date}T12:00:00Z`,
  workspace_key: "ws_a", workspace_label: "A", is_subagent: false,
  total_tokens: total, input_tokens: total, output_tokens: 0, events: [{
    date, timestamp: `${date}T12:00:00Z`, last_timestamp: `${date}T12:00:00Z`,
    model: "gpt-5.4", is_proxy: false, pricing_context: "short", total_tokens: total,
    input_tokens: total, cached_input_tokens: 0, cache_write_input_tokens: 0,
    output_tokens: 0, reasoning_output_tokens: 0
  }], ...extra
});
const snapshot = (sessions, generated = "2026-09-22T20:00:00Z", extra = {}) => ({
  snapshot_version: 3, counting_version: 3, generated_at: generated, timezone: "America/Los_Angeles",
  latest_event_at: generated, earliest_date: "2026-01-01", sessions,
  workspaces: [workspace("ws_a", "A")], quality: { duplicate_snapshots: 1 },
  source: { log_files: sessions.length, named_tasks: 10, named_tasks_without_logs: 8 }, ...extra
});

test("history preservation replaces overlapping sessions whole and never adds their counters", () => {
  const old = snapshot([session("old-only", 100, "2026-01-02"), session("overlap", 900, "2026-01-01")],
    "2026-09-20T20:00:00Z", { quality: { duplicate_snapshots: 99 } });
  const local = snapshot([session("overlap", 20, "2026-09-22"), session("new", 30, "2026-09-22")]);
  const before = JSON.stringify({ old, local });
  const merged = mergeRecordedHistory(local, old);
  assert.deepEqual(merged.sessions.map((row) => row.session_id), ["old-only", "overlap", "new"]);
  assert.deepEqual(merged.sessions.find((row) => row.session_id === "overlap"), { ...local.sessions[0], collected_at: local.generated_at });
  const report = createAnalytics(merged).dashboard({ days: "all" });
  assert.equal(report.summary.total_tokens, 150);
  assert.equal(merged.earliest_date, "2026-01-02", "discarded overlapping history must not extend coverage");
  assert.equal(merged.generated_at, local.generated_at);
  assert.equal(merged.latest_event_at, local.latest_event_at);
  assert.deepEqual(merged.quality, local.quality);
  assert.deepEqual(merged.source, { ...local.source, recorded_sessions: 3,
    local_recorded_sessions: 2, historical_sessions_preserved: 1,
    historical_generated_at: old.generated_at, quality_scope: "current_local_logs" });
  assert.equal(JSON.stringify({ old, local }), before, "inputs stay immutable");
  assert.equal(mergeRecordedHistory(merged, old).sessions.length, 3, "repeated merging cannot duplicate sessions");
});

test("preserved parents and cross-workspace helpers reconcile into the same project", () => {
  const old = snapshot([session("parent", 100, "2026-09-20")], "2026-09-20T20:00:00Z",
    { workspaces: [workspace("ws_a", "Old label"), workspace("ws_b", "B")] });
  const local = snapshot([session("helper", 40, "2026-09-22", {
    parent_session_id: "parent", is_subagent: true, workspace_key: "ws_b", workspace_label: "B"
  })], undefined, { workspaces: [workspace("ws_a", "Current label"), workspace("ws_b", "B")] });
  const merged = mergeRecordedHistory(local, old);
  assert.equal(merged.workspaces.length, 2);
  assert.equal(merged.workspaces.find((row) => row.workspace_key === "ws_a").workspace_label, "Current label");
  const engine = createAnalytics(merged);
  const report = engine.dashboard({ days: "all" });
  assert.equal(report.projects.length, 1);
  assert.equal(report.summary.total_tokens, 140);
  assert.equal(report.summary.helper_tokens, 40);
  assert.equal(engine.dashboard({ days: "all", includeSubagents: false }).summary.total_tokens, 100);
  assert.equal(engine.dashboard({ days: "all", workspace: "ws_a" }).summary.total_tokens, 140);
});

test("unsafe versions, duplicates, future baselines, and timezone mismatch fail before merging", () => {
  const local = snapshot([session("a", 10, "2026-09-22")]);
  const old = snapshot([], "2026-09-20T20:00:00Z");
  assert.throws(() => mergeRecordedHistory(local, { ...old, counting_version: 2 }), /version 3/);
  assert.throws(() => mergeRecordedHistory({ ...local, sessions: [...local.sessions, ...local.sessions] }, old), /duplicate/);
  assert.throws(() => mergeRecordedHistory(local, { ...old, generated_at: "2026-09-23T20:00:00Z" }), /newer/);
  assert.throws(() => mergeRecordedHistory(local, { ...old, timezone: "UTC" }), /timezone/);
  assert.throws(() => mergeRecordedHistory(local, { ...old, generated_at: "invalid" }), /version 3/);
});

test("a configured missing baseline fails visibly, while null explicitly requests local-only data", async () => {
  await assert.rejects(readHistoryBaseline("/private/tmp/usage-no-such-history-baseline.json"), { code: "ENOENT" });
  assert.equal(await readHistoryBaseline(null), null);
  const local = snapshot([session("a", 10, "2026-09-22")]);
  const merged = mergeRecordedHistory(local);
  assert.equal(merged.source.historical_sessions_preserved, 0);
  assert.equal(merged.source.historical_generated_at, null);
  assert.equal(merged.source.local_recorded_sessions, 1);
});


test("a post-baseline task survives a later missing-log refresh without false freshness", () => {
  const baseline = snapshot([session("old", 100, "2026-09-20")], "2026-09-20T20:00:00Z");
  const firstLocal = snapshot([session("new", 50, "2026-09-22")]);
  const first = mergeRecordedHistory(firstLocal, baseline);
  const laterLocal = snapshot([session("later", 20, "2026-09-23")], "2026-09-23T20:00:00Z");
  const later = mergeRecordedHistory(laterLocal, baseline, first);
  assert.equal(createAnalytics(later).dashboard({ days: "all" }).summary.total_tokens, 170);
  assert.equal(later.source.local_recorded_sessions, 1);
  assert.equal(later.source.historical_sessions_preserved, 2);
  assert.equal(later.source.historical_generated_at, baseline.generated_at);
  assert.equal(later.sessions.find((row) => row.session_id === "new").collected_at, firstLocal.generated_at);
  assert.equal(later.sessions.find((row) => row.session_id === "old").collected_at, baseline.generated_at);
  assert.equal(later.sessions.find((row) => row.session_id === "later").collected_at, laterLocal.generated_at);
  const recollectedOld = snapshot([session("old", 120, "2026-09-24")], "2026-09-24T20:00:00Z");
  const third = mergeRecordedHistory(recollectedOld, baseline, later);
  assert.equal(createAnalytics(third).dashboard({ days: "all" }).summary.total_tokens, 190);
  assert.equal(third.source.historical_generated_at, firstLocal.generated_at);
});

test("previous snapshot absence is allowed but a newer previous capture is rejected", async () => {
  assert.equal(await readPreviousSnapshot(null), null);
  assert.equal(await readPreviousSnapshot("/private/tmp/usage-no-such-previous-snapshot.json"), null);
  assert.throws(() => mergeRecordedHistory(snapshot([]), null, snapshot([], "2026-09-23T20:00:00Z")), /newer/);
});
