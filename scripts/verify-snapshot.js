import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAnalytics } from "../public/analytics.js";

const file = resolve(process.argv[2] || "public/data/usage-snapshot.json");
const raw = await readFile(file, "utf8");
const snapshot = JSON.parse(raw);
const analysis = createAnalytics(snapshot);
const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-6, `${label}: ${a} != ${b}`);
assert.equal(snapshot.counting_version, 3);
assert.ok(!raw.includes("/Users/") && !raw.includes('"cumulative"') && !raw.includes('"base_instructions"'), "Private source fields leaked");
let checks = 0;
for (const days of [1, 7, 30, 90, 365, "all"]) {
  for (const includeSubagents of [true, false]) {
    const report = analysis.dashboard({ days, includeSubagents });
    const total = report.summary;
    for (const rows of [report.projects, report.models]) {
      near(rows.reduce((sum, row) => sum + row.total_tokens, 0), total.total_tokens, "Token rollup");
      near(rows.reduce((sum, row) => sum + row.estimated_cost_usd, 0), total.estimated_cost_usd, "Cost rollup");
    }
    near(total.direct_cost_usd + total.helper_cost_usd, total.estimated_cost_usd, "Direct/helper reconciliation");
    assert.equal(report.projects.length, total.project_count);
    assert.equal(report.habit_board.days.filter((day) => day.in_range).length, 365);
    const windows = report.snapshot_windows;
    assert.ok(windows.trailing_30d.total_tokens >= windows.trailing_14d.total_tokens);
    if (Number(report.today.slice(-2)) <= 30) {
      assert.ok(windows.trailing_30d.total_tokens >= windows.month_to_date.total_tokens);
      assert.ok(windows.trailing_30d.estimated_cost_usd + 1e-6 >= windows.month_to_date.estimated_cost_usd);
    }
    checks++;
  }
}
const report = analysis.dashboard();
const sum = { total_tokens: 0, estimated_cost_usd: 0 };
for (const workspace of snapshot.workspaces) {
  const totals = analysis.dashboard({ workspace: workspace.workspace_key }).summary;
  sum.total_tokens += totals.total_tokens;
  sum.estimated_cost_usd += totals.estimated_cost_usd;
}
near(sum.total_tokens, report.summary.total_tokens, "Workspace reconciliation");
near(sum.estimated_cost_usd, report.summary.estimated_cost_usd, "Workspace dollars");
for (const project of report.projects) {
  const detail = analysis.breakdown("project", project.id);
  near(detail.summary.estimated_cost_usd, project.estimated_cost_usd, "Project drawer");
  near(detail.workflows.reduce((sum, row) => sum + row.estimated_cost_usd, 0), project.estimated_cost_usd, "Workflow dollars");
}
for (const day of report.trend_days) {
  const detail = analysis.breakdown("day", day.date);
  near(detail.summary.total_tokens, day.total_tokens, "Day drawer tokens");
  near(detail.summary.estimated_cost_usd, day.estimated_cost_usd, "Day drawer dollars");
}
console.log(JSON.stringify({ verified: true, generated_at: report.generated_at, checks,
  projects: report.projects.length, sessions: snapshot.sessions.length,
  tokens: report.summary.total_tokens, estimated_cost_usd: report.summary.estimated_cost_usd,
  excluded_inherited_tokens: snapshot.quality?.inherited_tokens_removed,
  pricing_checked_at: report.pricing.checked_at }, null, 2));
