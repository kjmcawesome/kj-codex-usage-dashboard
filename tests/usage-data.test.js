import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, cp, rm } from "node:fs/promises";
import os from "node:os";
import { join, resolve } from "node:path";
import { buildDashboardPayload, buildDayPayload, createPublicSnapshot, loadUsageIndex, parseSessionLog, reconcileSessions, createUsageService } from "../lib/usage-data.js";
import { createAnalytics, heatLevel, resolveRange, dayInZone } from "../public/analytics.js";
import { priceEvent, resolveModel, PRICING } from "../public/pricing.js";
import { createAppServer } from "../server.js";

const fixtureRoot = resolve("./tests/fixtures/codex-root");
const publicRoot = resolve("./public");
const fixedNow = () => new Date("2026-03-25T12:00:00.000Z");
const close = (a, b, eps = 1e-8) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const fields = ["total_tokens", "input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens", "cache_write_input_tokens"];
const counts = (total) => ({ total_tokens: total, input_tokens: total * .8, cached_input_tokens: total * .4, output_tokens: total * .2, reasoning_output_tokens: total * .1, cache_write_input_tokens: 0 });
const cumulative = (total) => fields.map((key) => counts(total)[key]);
const event = (date, total, extra = {}) => ({ date, timestamp: `${date}T12:00:00Z`, model: "gpt-5.4", context_input_tokens: total * .8, ...counts(total), ...extra });
const session = (id, events, extra = {}) => ({ session_id: id, thread_name: id, parent_session_id: null,
  session_started_at: "2026-01-01T12:00:00Z", workspace_key: "ws_a", workspace_label: "Workspace A", is_subagent: false, events,
  ...Object.fromEntries(fields.map((key) => [key, events.reduce((sum, row) => sum + row[key], 0)])),
  quality: {}, ...extra });
const snapshot = (sessions, generated = "2026-08-26T20:00:00Z") => ({
  snapshot_version: 3, counting_version: 3, generated_at: generated, timezone: "America/Los_Angeles",
  earliest_date: "2026-01-01", sessions, workspaces: [{ workspace_key: "ws_a", workspace_label: "Workspace A" }, { workspace_key: "ws_b", workspace_label: "Workspace B" }], quality: {}
});
async function fixtures() {
  const dir = await mkdtemp(join(os.tmpdir(), "kj-usage-fixtures-"));
  return loadUsageIndex({ codexRoot: fixtureRoot, cacheFilePath: join(dir, "cache.json") });
}

test("one snapshot, duplicate emissions, info:null, and multi-day deltas stay exact", async () => {
  const one = await parseSessionLog(join(fixtureRoot, "sessions", "rollout-2026-03-20-session-one.jsonl"));
  assert.equal(one.total_tokens, 150);
  assert.equal(one.input_tokens, 120);
  assert.equal(one.cached_input_tokens, 20);
  assert.equal(one.output_tokens, 30);
  assert.equal(one.reasoning_output_tokens, 10);
  assert.equal(one.primary_model, "gpt-5.4");
  const duplicate = await parseSessionLog(join(fixtureRoot, "sessions", "rollout-2026-03-21-session-duplicate.jsonl"));
  assert.deepEqual(duplicate.events.map((row) => row.total_tokens), [100, 90]);
  assert.equal(duplicate.total_tokens, 190);
  const emptyInfo = await parseSessionLog(join(fixtureRoot, "sessions", "rollout-2026-03-24-session-null.jsonl"));
  assert.equal(emptyInfo.total_tokens, 50);
  assert.equal(emptyInfo.events.length, 1);
  const index = await fixtures();
  const multi = index.sessions.find((row) => row.session_id === "session-multiday");
  assert.equal(multi.total_tokens, 200);
  assert.equal(multi.events.reduce((sum, row) => sum + row.total_tokens, 0), multi.total_tokens);
  assert.equal(new Set(multi.events.map((row) => row.date)).size, 2);
});

test("a helper is attributed to its parent, but a user fork is not labeled a helper", async () => {
  const helper = await parseSessionLog(join(fixtureRoot, "archived_sessions", "rollout-2026-03-23-session-subagent.jsonl"));
  assert.equal(helper.is_subagent, true);
  assert.equal(helper.parent_session_id, "session-multiday");
  assert.equal(helper.agent_nickname, "Lovelace");
  const temp = await mkdtemp(join(os.tmpdir(), "kj-fork-"));
  const file = join(temp, "fork.jsonl");
  await writeFile(file, JSON.stringify({ type: "session_meta", timestamp: "2026-03-24T12:00:00Z",
    payload: { id: "fork", forked_from_id: "parent", source: "vscode", timestamp: "2026-03-24T12:00:00Z" } }) + "\n");
  const fork = await parseSessionLog(file);
  assert.equal(fork.is_fork, true);
  assert.equal(fork.is_subagent, false);
});

test("fork replay with rewritten timestamps is excluded while new helper work remains", () => {
  const parent = session("parent", [
    event("2026-03-20", 100, { cumulative: cumulative(100), turn_id: "parent-turn" }),
    event("2026-03-20", 100, { cumulative: cumulative(200), turn_id: "parent-turn" })
  ]);
  const child = session("child", [
    event("2026-03-21", 100, { cumulative: cumulative(100), turn_id: "parent-turn" }),
    event("2026-03-21", 100, { cumulative: cumulative(200), turn_id: "parent-turn" }),
    event("2026-03-21", 50, { cumulative: cumulative(250), turn_id: "child-turn" })
  ], { parent_session_id: "parent", is_subagent: true, session_started_at: "2026-03-21T10:00:00Z" });
  const fixed = reconcileSessions([parent, child]);
  assert.equal(fixed[0].total_tokens, 200);
  assert.equal(fixed[1].total_tokens, 50);
  assert.equal(fixed[1].events.length, 1);
  assert.equal(fixed[1].quality.inherited_tokens_removed, 200);
  assert.equal(child.total_tokens, 250, "raw cache remains immutable");
});

test("fork without replay subtracts a provable inherited baseline", () => {
  const parent = session("parent", [event("2026-03-20", 200, { cumulative: cumulative(200), turn_id: "p" })]);
  const child = session("child", [event("2026-03-21", 250, { cumulative: cumulative(250), last_usage: cumulative(50), turn_id: "c" })],
    { parent_session_id: "parent", session_started_at: "2026-03-21T10:00:00Z" });
  const fixed = reconcileSessions([parent, child])[1];
  assert.equal(fixed.total_tokens, 50);
  assert.equal(fixed.quality.inherited_tokens_removed, 200);
  assert.equal(fixed.events[0].context_input_tokens, 40);
});

test("nested helpers exclude ancestor replay and group under one real project", () => {
  const parent = session("p", [event("2026-03-20", 100, { cumulative: cumulative(100), turn_id: "p" })]);
  const child = session("c", [
    event("2026-03-21", 100, { cumulative: cumulative(100), turn_id: "p" }),
    event("2026-03-21", 50, { cumulative: cumulative(150), turn_id: "c" })
  ], { parent_session_id: "p", session_started_at: "2026-03-21T10:00:00Z", is_subagent: true });
  const grandchild = session("g", [
    event("2026-03-22", 100, { cumulative: cumulative(100), turn_id: "p" }),
    event("2026-03-22", 50, { cumulative: cumulative(150), turn_id: "c" }),
    event("2026-03-22", 20, { cumulative: cumulative(170), turn_id: "g" })
  ], { parent_session_id: "c", session_started_at: "2026-03-22T10:00:00Z", is_subagent: true });
  const fixed = reconcileSessions([parent, child, grandchild]);
  assert.deepEqual(fixed.map((row) => row.total_tokens), [100, 50, 20]);
  const report = createAnalytics(snapshot(fixed, "2026-03-25T12:00:00Z")).dashboard();
  assert.equal(report.projects.length, 1);
  assert.equal(report.projects[0].total_tokens, 170);
  assert.equal(report.projects[0].helper_tokens, 70);
});

test("equal counters on unrelated turns are not blindly deduplicated across sessions", () => {
  const parent = session("p", [event("2026-03-20", 100, { cumulative: cumulative(100), turn_id: "p" })]);
  const child = session("c", [event("2026-03-21", 100, { cumulative: cumulative(100), turn_id: "c" })],
    { parent_session_id: "p", session_started_at: "2026-03-21T10:00:00Z" });
  assert.equal(reconcileSessions([parent, child])[1].total_tokens, 100);
});

test("missing parents and lineage cycles do not hang or silently lose usage", () => {
  const a = session("a", [event("2026-08-26", 100)], { parent_session_id: "missing" });
  const b = session("b", [event("2026-08-26", 200)], { parent_session_id: "c" });
  const c = session("c", [event("2026-08-26", 300)], { parent_session_id: "b" });
  const fixed = reconcileSessions([a, b, c]);
  assert.equal(fixed[0].quality.missing_parent, true);
  assert.equal(fixed[1].quality.lineage_cycle, true);
  const report = createAnalytics(snapshot(fixed)).dashboard();
  assert.equal(report.summary.total_tokens, 600);
  close(report.projects.reduce((sum, row) => sum + row.total_tokens, 0), 600);
});

test("cache warm loads, forced loads, removed files, and corrupted caches are safe", async () => {
  const temp = await mkdtemp(join(os.tmpdir(), "kj-cache-"));
  const root = join(temp, "codex");
  await cp(fixtureRoot, root, { recursive: true });
  const options = { codexRoot: root, cacheFilePath: join(temp, "cache.json") };
  const cold = await loadUsageIndex(options);
  assert.equal(cold.source.reparsed_files, 6);
  assert.equal(cold.sessions.length, 5);
  const warm = await loadUsageIndex(options);
  assert.equal(warm.source.reused_files, 6);
  const forced = await loadUsageIndex({ ...options, forceReparse: true });
  assert.equal(forced.source.reparsed_files, 6);
  await rm(join(root, "sessions", "rollout-2026-03-20-session-one.jsonl"));
  const removed = await loadUsageIndex(options);
  assert.equal(removed.source.log_files, 5);
  assert.equal(removed.sessions.some((row) => row.session_id === "session-one"), false);
  await writeFile(options.cacheFilePath, "{broken");
  assert.equal((await loadUsageIndex(options)).source.reparsed_files, 5);
});

test("fixture totals reconcile by projects, days, models, and helper filter", async () => {
  const index = await fixtures();
  const report = buildDashboardPayload(index, { now: fixedNow() });
  assert.equal(report.summary.total_tokens, 650);
  assert.equal(report.summary.input_tokens, 490);
  assert.equal(report.summary.output_tokens, 160);
  assert.equal(report.summary.cached_input_tokens, 100);
  assert.equal(report.summary.reasoning_output_tokens, 34);
  assert.equal(report.summary.proxy_tokens, 50);
  close(report.summary.estimated_cost_usd, .0032705);
  const direct = buildDashboardPayload(index, { now: fixedNow(), includeSubagents: false });
  assert.equal(direct.summary.total_tokens, 590);
  assert.equal(report.summary.total_tokens - direct.summary.total_tokens, 60);
  close(report.summary.estimated_cost_usd - direct.summary.estimated_cost_usd, report.summary.helper_cost_usd);
  for (const rows of [report.projects, report.models, report.habit_board.days.filter((day) => day.in_range)]) {
    close(rows.reduce((sum, row) => sum + row.total_tokens, 0), report.summary.total_tokens);
    close(rows.reduce((sum, row) => sum + row.estimated_cost_usd, 0), report.summary.estimated_cost_usd);
  }
  assert.equal(report.summary.project_count, 4);
  assert.equal(report.summary.workflow_count, 5);
});

test("browser snapshot compression and HTTP transformation use the same counts and rates", async () => {
  const index = await fixtures();
  const publicData = createPublicSnapshot(index);
  const raw = buildDashboardPayload(index, { now: fixedNow() });
  const client = buildDashboardPayload(publicData, { now: fixedNow() });
  for (const key of ["total_tokens", "input_tokens", "cached_input_tokens", "output_tokens", "estimated_cost_usd", "proxy_tokens"]) {
    close(raw.summary[key], client.summary[key]);
  }
  const serialized = JSON.stringify(publicData);
  for (const forbidden of ["cumulative", "last_usage", "turn_id", "base_instructions", "cwd", "/Users/"]) {
    assert.ok(!serialized.includes('"' + forbidden + '"') && (forbidden !== "/Users/" || !serialized.includes(forbidden)), forbidden);
  }
  assert.equal(publicData.snapshot_version, 3);
});

test("custom dates apply only to project costs, not the fixed board or fixed snapshots", () => {
  const data = snapshot([session("p", [event("2026-08-01", 100), event("2026-08-20", 200), event("2026-08-26", 300)])]);
  const engine = createAnalytics(data);
  const custom = engine.dashboard({ startDate: "2026-08-01", endDate: "2026-08-01" });
  const all = engine.dashboard({ days: "all" });
  assert.equal(custom.summary.total_tokens, 100);
  assert.equal(all.summary.total_tokens, 600);
  assert.deepEqual(custom.habit_board, all.habit_board);
  assert.deepEqual(custom.snapshot_windows, all.snapshot_windows);
  assert.equal(custom.projects[0].recorded.total_tokens, 600);
  assert.equal(custom.trend_days.length, 14);
});

test("day breakdown can open outside the selected range and reconciles all contributors", async () => {
  const index = await fixtures();
  const detail = buildDayPayload(index, "2026-03-20", { days: 1, now: fixedNow() });
  assert.equal(detail.summary.total_tokens, 150);
  const busy = buildDayPayload(index, "2026-03-23", { now: fixedNow() });
  close(busy.workflows.reduce((sum, row) => sum + row.estimated_cost_usd, 0), busy.summary.estimated_cost_usd);
  assert.ok(busy.workflows.every((row, index, rows) => !index || rows[index - 1].estimated_cost_usd >= row.estimated_cost_usd));
  const empty = buildDayPayload(index, "2026-03-19", { now: fixedNow() });
  assert.equal(empty.summary.total_tokens, 0);
  assert.equal(empty.summary.estimated_cost_usd, 0);
  assert.deepEqual(empty.workflows, []);
});

test("project roots, not generic workspace names, identify the work; all projects are counted", () => {
  const sessions = Array.from({ length: 24 }, (_, index) => session("Project " + index, [event("2026-08-26", (index + 1) * 100)]));
  const engine = createAnalytics(snapshot(sessions));
  const report = engine.dashboard();
  assert.equal(report.projects.length, 24);
  assert.equal(report.summary.project_count, 24);
  assert.equal(report.projects[0].name, "Project 23");
  const detail = engine.breakdown("project", "Project 23");
  assert.equal(detail.summary.total_tokens, 2400);
  assert.equal(detail.workflows.length, 1);
});

test("workspace filters follow the root project, including helpers in another working directory", () => {
  const data = snapshot([
    session("A", [event("2026-08-26", 100)]),
    session("A-helper", [event("2026-08-26", 200)], { parent_session_id: "A", is_subagent: true, workspace_key: "ws_b" }),
    session("B", [event("2026-08-26", 400)], { workspace_key: "ws_b" })
  ]);
  const engine = createAnalytics(data);
  const a = engine.dashboard({ workspace: "ws_a" });
  const b = engine.dashboard({ workspace: "ws_b" });
  const all = engine.dashboard();
  assert.equal(a.summary.total_tokens, 300);
  assert.equal(b.summary.total_tokens, 400);
  close(a.summary.estimated_cost_usd + b.summary.estimated_cost_usd, all.summary.estimated_cost_usd);
  assert.equal(engine.dashboard({ workspace: "ws_a", includeSubagents: false }).summary.total_tokens, 100);
  assert.equal(a.habit_board.summary.total_tokens, 300);
});

test("human annotations are optional, and absent outcomes are not invented", () => {
  const data = snapshot([session("p", [event("2026-08-26", 100)])]);
  const without = createAnalytics(data).breakdown("project", "p");
  assert.equal(without.outcome, null);
  const engine = createAnalytics(data, { annotations: { p: { project_label: "Usage dashboard", business_outcome: "Shared reporting prototype", impact_label: "Reporting" } } });
  assert.equal(engine.dashboard().projects[0].name, "Usage dashboard");
  assert.equal(engine.breakdown("project", "p").outcome, "Shared reporting prototype");
});

test("today is included in the 30-day window, which contains MTD before month day 31", () => {
  const engine = createAnalytics(snapshot([session("p", [
    event("2026-07-27", 5000), event("2026-07-28", 100), event("2026-08-01", 200), event("2026-08-26", 9000)
  ])]));
  const report = engine.dashboard();
  assert.equal(report.snapshot_windows.today.total_tokens, 9000);
  assert.equal(report.snapshot_windows.month_to_date.total_tokens, 9200);
  assert.equal(report.snapshot_windows.trailing_30d.total_tokens, 9300);
  assert.equal(report.summary.total_tokens, 9300);
  assert.ok(report.snapshot_windows.trailing_30d.estimated_cost_usd >= report.snapshot_windows.month_to_date.estimated_cost_usd);
});

test("a 31-day month can legitimately have MTD larger than a 30-day window", () => {
  const report = createAnalytics(snapshot([session("p", [event("2026-08-01", 100), event("2026-08-31", 100)])], "2026-08-31T20:00:00Z")).dashboard();
  assert.equal(report.snapshot_windows.month_to_date.total_tokens, 200);
  assert.equal(report.snapshot_windows.trailing_30d.total_tokens, 100);
});

test("snapshot timezone, UTC midnight, DST, and leap dates do not move the selected day", () => {
  assert.equal(dayInZone("2026-08-27T02:00:00Z", "America/Los_Angeles"), "2026-08-26");
  assert.equal(dayInZone("2026-03-08T09:59:00Z", "America/Los_Angeles"), "2026-03-08");
  assert.equal(dayInZone("2026-03-08T10:01:00Z", "America/Los_Angeles"), "2026-03-08");
  assert.throws(() => resolveRange({ startDate: "2026-02-29", endDate: "2026-03-01" }, "2026-08-26", "2026-01-01"), RangeError);
  assert.equal(resolveRange({ startDate: "2024-02-29", endDate: "2024-03-01" }, "2026-08-26").start_date, "2024-02-29");
});

test("the board has exactly 365 selectable dates, Sunday-first rows, and monotonic honest color bins", () => {
  const sessions = [session("p", Array.from({ length: 20 }, (_, i) => event("2026-08-" + String(i + 1).padStart(2, "0"), (i + 1) * 100)))];
  const board = createAnalytics(snapshot(sessions)).dashboard().habit_board;
  assert.equal(board.days.filter((day) => day.in_range).length, 365);
  assert.equal(board.days.length % 7, 0);
  for (const day of board.days) assert.equal(day.weekday, new Date(day.date + "T12:00:00Z").getUTCDay());
  assert.equal(board.days.find((day) => day.date === "2026-08-24").weekday, 1);
  assert.equal(board.days.find((day) => day.date === "2026-08-26").weekday, 3);
  assert.equal(heatLevel(0, board.scale.thresholds, board.scale.max_total_tokens), 0);
  assert.equal(heatLevel(2000, board.scale.thresholds, board.scale.max_total_tokens), 7);
  let previous = 0;
  for (let value = 1; value <= 2000; value++) {
    const level = heatLevel(value, board.scale.thresholds, board.scale.max_total_tokens);
    assert.ok(level >= previous && level >= 1);
    previous = level;
  }
  assert.ok(board.month_labels.every((month, i, rows) => !i || month.week - rows[i - 1].week >= 3));
});

test("streaks and Monday-Friday workweek use actual calendar days", () => {
  const rows = ["2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26"].map((day) => event(day, 100));
  const report = createAnalytics(snapshot([session("p", rows)])).dashboard();
  assert.equal(report.habit_board.metrics.current_streak, 6);
  assert.equal(report.habit_board.metrics.best_streak, 6);
  assert.equal(report.habit_board.metrics.workweek_green_days, 3);
  const empty = createAnalytics(snapshot([])).dashboard();
  assert.equal(empty.habit_board.metrics.current_streak, 0);
  assert.equal(empty.habit_board.scale.max_total_tokens, 0);
  assert.ok(empty.habit_board.days.every((day) => day.level === 0));
});

test("current Sol pricing splits cache writes, reused input, fresh input, and output once", () => {
  const priced = priceEvent({ model: "gpt-5.6-sol", input_tokens: 1000000, cached_input_tokens: 500000,
    cache_write_input_tokens: 200000, output_tokens: 100000, reasoning_output_tokens: 90000,
    total_tokens: 1100000, context_input_tokens: 200000 });
  close(priced.estimated_cost_usd, 1.2 + .2 + 1 + 2);
  assert.equal(priced.fresh_input_tokens, 300000);
  assert.equal(PRICING.checked_at, "2026-08-26");
});

test("long-context premium applies per request, not to cumulative daily input", () => {
  const short = priceEvent({ ...counts(1000000), model: "gpt-5.6-sol", context_input_tokens: 272000 });
  const long = priceEvent({ ...counts(1000000), model: "gpt-5.6-sol", context_input_tokens: 272001 });
  assert.equal(short.rates.input, 4);
  assert.equal(long.rates.input, 8);
  assert.equal(long.rates.output, 30);
  const unknown = priceEvent({ ...counts(1000000), model: "gpt-5.6-sol" });
  assert.equal(unknown.unknown_context_tokens, 1000000);
  assert.equal(unknown.rates.input, 4);
});

test("Arcanine, dated models, old model pricing, and unreleased Sol proxies resolve explicitly", () => {
  assert.equal(resolveModel("arcanine").model, "gpt-5.5");
  assert.equal(resolveModel("gpt-5.4-2026-03-05").model, "gpt-5.4");
  assert.equal(resolveModel("unreleased-model").proxy, true);
  assert.equal(resolveModel("gpt-5.4-secret-experiment").proxy, true);
  const unknown = priceEvent({ ...counts(1000), model: "unreleased-model" });
  const sol = priceEvent({ ...counts(1000), model: "gpt-5.6-sol" });
  close(unknown.estimated_cost_usd, sol.estimated_cost_usd);
  assert.equal(unknown.proxy_tokens, 1000);
  assert.equal(priceEvent({ ...counts(1000), model: "gpt-5.2" }).rates.input, 1.75);
});

test("unpriceable token splits are surfaced, never silently represented as fully priced", () => {
  const priced = priceEvent({ total_tokens: 500, input_tokens: 0, output_tokens: 0, model: "gpt-5.4" });
  assert.equal(priced.unallocated_tokens, 500);
  assert.equal(priced.estimated_cost_usd, 0);
});

test("old uncorrected snapshots cannot silently populate the rebuilt dashboard", () => {
  assert.throws(() => createAnalytics({ snapshot_version: 1, sessions: [] }), /fresh count/);
});

async function withServer(callback) {
  const temp = await mkdtemp(join(os.tmpdir(), "kj-server-"));
  const server = createAppServer({ usageService: createUsageService({
    codexRoot: fixtureRoot, cacheFilePath: join(temp, "cache.json"), nowProvider: fixedNow
  }), staticRoot: publicRoot });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  try { await callback("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((done) => server.close(done)); }
}

test("GET and HEAD keep working for the app, data, and dashboard/day APIs", async () => {
  await withServer(async (url) => {
    for (const path of ["/", "/app.js?v=test", "/api/dashboard?days=365", "/api/day/2026-03-20"]) {
      const response = await fetch(url + path);
      assert.equal(response.status, 200, path);
      assert.ok((await response.text()).length > 0);
      const head = await fetch(url + path, { method: "HEAD" });
      assert.equal(head.status, 200, path);
      assert.equal(await head.text(), "");
    }
    const payload = await (await fetch(url + "/api/dashboard?days=365")).json();
    assert.equal(payload.summary.total_tokens, 650);
    const day = await (await fetch(url + "/api/day/2026-03-20?days=1")).json();
    assert.equal(day.summary.total_tokens, 150);
    const refresh = await (await fetch(url + "/api/refresh", { method: "POST" })).json();
    assert.equal(refresh.ok, true);
    assert.equal(refresh.source.reparsed_files, 6);
  });
});

test("API rejects invalid ranges and unsupported methods with useful JSON", async () => {
  await withServer(async (url) => {
    for (const query of ["start_date=2026-03-20", "end_date=2026-03-20", "start_date=20-03-2026&end_date=2026-03-21",
      "start_date=2026-03-25&end_date=2026-03-20", "start_date=2026-02-30&end_date=2026-03-01", "days=0", "days=-1", "days=invalid"]) {
      const response = await fetch(url + "/api/dashboard?" + query);
      assert.equal(response.status, 400, query);
      assert.equal((await response.json()).error, "Bad request");
    }
    for (const method of ["PUT", "PATCH", "DELETE"]) assert.equal((await fetch(url + "/", { method })).status, 405);
    const response = await fetch(url + "/api/dashboard?days=1&start_date=2026-03-20&end_date=2026-03-23");
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.selection.mode, "custom");
    assert.equal(data.summary.total_tokens, 600);
  });
});
