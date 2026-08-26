import test from "node:test";
import assert from "node:assert/strict";
import { createAnalytics } from "../public/analytics.js";
import { summarizeModelUsage } from "../public/model-usage.js";
import { renderModels, renderModelUsage } from "../public/view.js";

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const row = (model, context, tokens, cost, proxy = false) => ({
  id: `${model}|${proxy}|${context}`, model, name: model, context, is_proxy: proxy,
  total_tokens: tokens, input_tokens: tokens * .8, cached_input_tokens: tokens * .4,
  fresh_input_tokens: tokens * .4, cache_write_input_tokens: 0, output_tokens: tokens * .2,
  reasoning_output_tokens: tokens * .1, estimated_cost_usd: cost,
  rates: { input: 4, cached_input: .4, cache_write: 5, output: 20 },
  cost_components: { input: cost * .4, cached_input: cost * .1, cache_write: 0, output: cost * .5 }
});

test("Model overview combines context tiers without merging confirmed models and proxy estimates", () => {
  const rows = [row("gpt-5.6-sol", "short", 100, 2), row("gpt-5.6-sol", "long", 200, 6),
    row("gpt-5.6-sol", "short", 400, 4, true), row("gpt-5.6-terra", "short", 100, 1)];
  const unchanged = structuredClone(rows);
  const groups = summarizeModelUsage(rows);
  assert.equal(groups.length, 3);
  const sol = groups.find((group) => group.name === "Sol");
  assert.equal(sol.total_tokens, 300);
  assert.equal(sol.estimated_cost_usd, 8);
  assert.equal(sol.variants.length, 2);
  const proxy = groups.find((group) => group.is_proxy);
  assert.equal(proxy.name, "Unreleased");
  assert.equal(proxy.total_tokens, 400);
  close(groups.reduce((total, group) => total + group.token_share, 0), 1);
  close(groups.reduce((total, group) => total + group.cost_share, 0), 1);
  close(groups.reduce((total, group) => total + group.estimated_cost_usd, 0), 13);
  assert.deepEqual(rows, unchanged, "presentation never mutates or reprices source rows");
});

test("Model usage order follows tokens, not prices", () => {
  const groups = summarizeModelUsage([row("gpt-5.5", "short", 10, 100), row("gpt-5.6-luna", "short", 1000, 1)]);
  assert.equal(groups[0].name, "Luna");
  close(groups[0].token_share, 1000 / 1010);
  close(groups[0].cost_share, 1 / 101);
});

test("Empty and zero-token periods stay finite and readable", () => {
  assert.deepEqual(summarizeModelUsage([]), []);
  assert.match(renderModelUsage([]), /No model usage/);
  const groups = summarizeModelUsage([row("gpt-5.5", "unknown", 0, 0)]);
  assert.equal(groups[0].token_share, 0);
  assert.equal(groups[0].cost_share, 0);
  const html = renderModelUsage([row("gpt-5.5", "unknown", 0, 0)]);
  assert.match(html, /\$0\.00/);
  assert.match(html, /--share:0\.000%/);
  assert.doesNotMatch(html, /NaN|Infinity|undefined/);
});

test("Model rows expose tokens and cost, with assumptions and formulas in native disclosures", () => {
  const html = renderModelUsage([row("gpt-5.6-sol", "long", 1000000, 9),
    row("gpt-5.6-sol", "unknown", 500000, .004, true)], { compact: true });
  assert.match(html, /model-usage-list is-compact/);
  assert.equal([...html.matchAll(/<details class="model-usage-row/g)].length, 2);
  assert.match(html, /67% of tokens/);
  assert.match(html, /of est\. cost/);
  assert.match(html, /\$9\.00/);
  assert.match(html, /&lt;\$0\.01/);
  assert.match(html, /Unreleased/);
  assert.match(html, /Sol-rate assumption/);
  assert.match(html, /Long-context requests/);
  assert.match(html, /Short-context rates assumed/);
  assert.match(html, /Reasoning is part of output, not an extra charge/);
  assert.doesNotMatch(html, /<details[^>]+\bopen\b|credits/i);
});

test("Unreleased usage never exposes an internal model name in overview or rate details", () => {
  const model = row("gpt-5.6-sol", "short", 100, 1, true);
  model.name = "private-model-codename";
  for (const html of [renderModelUsage([model]), renderModels([model])]) {
    assert.match(html, /Unreleased/);
    assert.doesNotMatch(html, /private-model-codename|gpt-5\.6-sol/);
  }
});

test("Model names are escaped and unpriceable token portions remain explicit", () => {
  const model = row('<img src=x onerror="alert(1)">', "short", 100, 0);
  model.unallocated_tokens = 100;
  const html = renderModelUsage([model]);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.match(html, /partially priced/);
  assert.match(html, /100 tokens lack an input\/output split/);
});

test("Model shares reconcile to each range, workspace, helper setting, project, and day", () => {
  const event = (date, model, tokens) => ({ date, timestamp: `${date}T18:00:00Z`, model,
    total_tokens: tokens, input_tokens: tokens * .8, cached_input_tokens: tokens * .4,
    output_tokens: tokens * .2, context_input_tokens: 10000 });
  const session = (id, workspace, events, extra = {}) => ({ session_id: id, thread_name: id,
    workspace_key: workspace, session_started_at: "2026-08-01T18:00:00Z", events, ...extra });
  const engine = createAnalytics({ counting_version: 3, generated_at: "2026-08-26T20:00:00Z",
    timezone: "America/Los_Angeles", earliest_date: "2026-08-01", sessions: [
      session("p", "a", [event("2026-08-01", "gpt-5.6-terra", 1000), event("2026-08-26", "gpt-5.6-sol", 2000)]),
      session("helper", "a", [event("2026-08-26", "gpt-5.5", 500)], { is_subagent: true, parent_session_id: "p" }),
      session("other", "b", [event("2026-08-26", "gpt-5.6-luna", 700)])
    ] });
  const reports = [{ days: 1 }, { days: 30 }, { days: 30, workspace: "a" }, { days: 30, includeSubagents: false },
    { startDate: "2026-08-01", endDate: "2026-08-01" }].map((params) => engine.dashboard(params));
  reports.push(engine.breakdown("project", "p", { days: 30 }), engine.breakdown("day", "2026-08-01", { days: 1 }));
  for (const report of reports) {
    const groups = summarizeModelUsage(report.models);
    assert.equal(groups.reduce((total, group) => total + group.total_tokens, 0), report.summary.total_tokens);
    close(groups.reduce((total, group) => total + group.estimated_cost_usd, 0), report.summary.estimated_cost_usd);
    close(groups.reduce((total, group) => total + group.token_share, 0), 1);
    close(groups.reduce((total, group) => total + group.cost_share, 0), 1);
  }
  const project = summarizeModelUsage(engine.breakdown("project", "p", { days: 1 }).models);
  assert.equal(project.length, 2);
  close(project.find((group) => group.name === "Sol").token_share, .8);
  assert.equal(summarizeModelUsage(engine.breakdown("day", "2026-08-01", { days: 1 }).models)[0].name, "Terra");
});
