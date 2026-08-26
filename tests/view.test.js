import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAnalytics } from "../public/analytics.js";
import { escape, money, renderFixedMetrics, renderBoard, renderRecent, projectRows, renderModels, renderModelUsage, renderBreakdown } from "../public/view.js";

function engine() {
  return createAnalytics({ counting_version: 3, generated_at: "2026-08-26T20:00:00Z", timezone: "America/Los_Angeles", earliest_date: "2026-01-01", sessions: [{
    session_id: "a", thread_name: '<img src=x onerror="alert(1)"> Project', session_started_at: "2026-08-25T20:00:00Z", workspace_key: "test", workspace_label: "Test", is_subagent: false,
    events: [{ date: "2026-08-26", timestamp: "2026-08-26T19:00:00Z", model: "gpt-5.6-sol", total_tokens: 150000, input_tokens: 100000, cached_input_tokens: 50000, output_tokens: 50000, context_input_tokens: 100000 }]
  }], workspaces: [] });
}

test("Every UI id referenced by the app exists and is unique", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const match of app.matchAll(/\$\("([^"$]+)"\)/g)) assert.ok(ids.includes(match[1]), match[1]);
  assert.match(html, /grid-row:2">Mon/);
  assert.match(html, /grid-row:4">Wed/);
  assert.match(html, /grid-row:6">Fri/);
  assert.match(html, /<dialog[^>]+aria-labelledby="drawer-title"/);
  assert.match(html, /id="methodology"(?![^>]*\bopen\b)/);
  assert.match(html, /href="#model-usage"/);
  assert.ok(html.indexOf('id="projects"') < html.indexOf('id="model-usage"'));
  assert.ok(html.indexOf('id="model-usage"') < html.indexOf('id="methodology"'));
});

test("All major token surfaces include USD costs, never credits or undefined values", () => {
  const data = engine();
  const report = data.dashboard();
  const outputs = [renderFixedMetrics(report), renderBoard(report.habit_board), renderRecent(report.trend_days),
    projectRows(report.projects), renderModels(report.models), renderModelUsage(report.models), renderBreakdown(data.breakdown("day", "2026-08-26"), "America/Los_Angeles")];
  for (const html of outputs) {
    assert.match(html, /\$/);
    assert.doesNotMatch(html, /NaN|undefined|\[object Object\]|credits/i);
  }
});

test("Work names and annotations are escaped before rendering", () => {
  const data = engine();
  const html = projectRows(data.dashboard().projects) + renderBreakdown(data.breakdown("project", "a"), "America/Los_Angeles");
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.equal(escape('a"b<c'), "a&quot;b&lt;c");
});

test("Tiny nonzero costs do not masquerade as zero; stale snapshots do not say Today", () => {
  assert.equal(money(.004), "<$0.01");
  assert.equal(money(0), "$0.00");
  assert.equal(money(1234.56), "$1,234.56");
  const html = renderFixedMetrics(engine().dashboard(), true);
  assert.match(html, /Latest snapshot day/);
  assert.doesNotMatch(html, /Lit today/);
});

test("A day remains selectable outside the range and zero days still have a detail state", () => {
  const data = engine();
  const report = data.dashboard({ days: 1 });
  const html = renderBoard(report.habit_board, "2026-08-01");
  assert.match(html, /is-selected[^>]*[\s\S]*?data-date="2026-08-01"/);
  const detail = renderBreakdown(data.breakdown("day", "2026-08-01", { days: 1 }), "America/Los_Angeles");
  assert.match(detail, /No usage recorded/);
  assert.match(detail, /\$0.00/);
});

test("Project drawer distinguishes the selected-period amount from all recorded project cost", () => {
  const data = engine();
  const detail = renderBreakdown(data.breakdown("project", "a"), "America/Los_Angeles");
  assert.match(detail, /Total recorded for this project/);
  assert.match(detail, /Direct work/);
  assert.match(detail, /Additional helper work/);
  assert.match(detail, /Model usage/);
  assert.match(detail, /of tokens/);
  assert.match(detail, /of est\. cost/);
  assert.match(detail, /Contributing runs/);
});
