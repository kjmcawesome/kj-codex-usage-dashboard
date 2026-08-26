import { summarizeModelUsage } from "./model-usage.js";

export const FILLS = ["#222637", "#414b7f", "#5565ad", "#647be0", "#7b78f2", "#9681fa", "#b394ff", "#d0b3ff"];
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const tokens = (value) => compact.format(value || 0);
export const exact = (value) => new Intl.NumberFormat("en-US").format(value || 0);
export const money = (value) => !Number.isFinite(value) ? "Unavailable" : value > 0 && value < 0.01 ? "<$0.01" : usd.format(value);
export const share = (value) => value > 0 && value < 0.01 ? "<1%" : `${Math.round((value || 0) * 100)}%`;
export const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const e = escape;
export function dateLabel(date, options = {}) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC", ...options });
}
export const rangeLabel = (range) => `${dateLabel(range.start_date, { year: "numeric" })} - ${dateLabel(range.end_date, { year: "numeric" })}`;
export const dayTitle = (day) => `${dateLabel(day.date, { weekday: "long", year: "numeric" })}: ${exact(day.total_tokens)} tokens, ${money(day.estimated_cost_usd)} estimated API cost`;

export function renderFixedMetrics(report, staleDay = false) {
  const windows = report.snapshot_windows;
  return [
    { name: staleDay ? "Latest snapshot day" : "Today", data: windows.today, note: staleDay ? dateLabel(report.today, { year: "numeric" }) : windows.today.total_tokens ? "Lit today" : "No usage recorded today" },
    { name: "Last 30 days", data: windows.trailing_30d, note: `${dateLabel(windows.trailing_30d.start_date)} - ${dateLabel(report.today)}` },
    { name: "Month to date", data: windows.month_to_date, note: `${dateLabel(windows.month_to_date.start_date)} - ${dateLabel(report.today)}` }
  ].map(({ name, data, note }) => `<div class="fixed-metric">
    <span class="fixed-metric-label">${name} <span class="sr-only">estimated cost</span></span>
    <div class="fixed-metric-main"><strong>${e(money(data.estimated_cost_usd))}</strong><span>${tokens(data.total_tokens)} tokens</span></div>
    <span class="fixed-metric-foot">${name === "Today" && data.total_tokens ? '<i class="lit-dot" aria-hidden="true"></i>' : ""}${e(note)}${name === "Today" ? " · est. cost" : ""}</span>
  </div>`).join("");
}

export function renderBoard(board, selected) {
  return board.days.map((day) => `<button type="button" class="day-cell${day.in_range ? "" : " is-padding"}${day.is_today ? " is-today" : ""}${day.date === selected ? " is-selected" : ""}"
    style="--level-fill:${FILLS[day.level]}" data-date="${day.date}" title="${e(dayTitle(day))}" aria-label="${e(dayTitle(day))}"
    aria-pressed="${day.date === selected}" ${day.is_today ? 'aria-current="date"' : ""}
    tabindex="${day.is_today ? "0" : "-1"}" ${day.in_range ? "" : "disabled"}></button>`).join("");
}

export function renderRecent(days, selected) {
  return days.map((day) => `<button type="button" class="recent-day${day.is_today ? " is-today" : ""}${day.date === selected ? " is-selected" : ""}"
    data-date="${day.date}" aria-pressed="${day.date === selected}" aria-label="${e(dayTitle(day))}" title="${e(dayTitle(day))}">
    <span>${dateLabel(day.date, { weekday: "short", month: undefined, day: undefined })}</span>
    <span class="recent-square" style="--level-fill:${FILLS[day.level]}" aria-hidden="true"></span>
    <span>${dateLabel(day.date)}</span><span class="recent-cost">${e(money(day.estimated_cost_usd))}</span>
  </button>`).join("");
}

export function projectRows(projects) {
  return projects.map((project) => `<button type="button" class="project-row" data-project-id="${e(project.id)}"
    title="${e(`${project.name}: ${exact(project.total_tokens)} tokens, ${money(project.estimated_cost_usd)} estimated cost`)}">
    <span class="project-info"><span class="project-title">${e(project.name)}</span>
      <span class="project-foot"><span>${project.active_days} active ${project.active_days === 1 ? "day" : "days"}</span><span aria-hidden="true">·</span><span>${project.workflow_count} contributing ${project.workflow_count === 1 ? "run" : "runs"}</span>${project.impact_label ? `<span class="badge">${e(project.impact_label)}</span>` : ""}</span>
      <span class="project-bar" aria-hidden="true"><span style="--share:${Math.max(0, Math.min(100, project.cost_share * 100)).toFixed(3)}%"></span></span>
    </span>
    <span class="project-number"><strong>${tokens(project.total_tokens)}</strong><small>tokens · ${e(share(project.token_share))} of total</small></span>
    <span class="project-number cost"><strong>${e(money(project.estimated_cost_usd))}</strong><small>${e(share(project.cost_share))} of cost${project.unallocated_tokens ? " · partial" : ""}</small></span>
    <span class="row-arrow" aria-hidden="true">&#8250;</span>
  </button>`).join("");
}

function modelFormula(model) {
  const buckets = [
    ["Fresh input", model.fresh_input_tokens, model.rates.input, model.cost_components.input],
    ["Reused input", model.cached_input_tokens, model.rates.cached_input, model.cost_components.cached_input],
    ["Cache writes", model.cache_write_input_tokens, model.rates.cache_write, model.cost_components.cache_write],
    ["Output", model.output_tokens, model.rates.output, model.cost_components.output]
  ];
  return buckets.map(([label, count, rate, cost]) => `<div class="formula-row"><span>${label}<small>${exact(count)} tokens × $${rate.toLocaleString("en-US", { maximumFractionDigits: 5 })}/1M</small></span><strong>${e(money(cost))}</strong></div>`).join("");
}

export function renderModels(models) {
  if (!models.length) return '<p class="quiet">No model usage in this period.</p>';
  return models.map((model) => `<details class="model-detail"><summary class="model-cost-row">
    <span>${e(model.name)}<small>${tokens(model.total_tokens)} tokens · ${e(share(model.cost_share))} of cost${model.context === "long" ? " · long context" : model.context === "unknown" ? " · short-context assumption" : ""}</small></span>
    <strong>${e(money(model.estimated_cost_usd))}</strong>
    <span class="project-bar" aria-hidden="true"><span style="--share:${(model.cost_share * 100).toFixed(3)}%"></span></span>
    </summary><div class="model-formula">${modelFormula(model)}<p>Reasoning is included in output, not charged again.${model.is_proxy ? " This is the Sol proxy you selected for unreleased or unidentified models." : ""}</p></div></details>`).join("");
}

export function renderModelUsage(models, { compact = false } = {}) {
  const groups = summarizeModelUsage(models);
  if (!groups.length) return '<p class="empty-state">No model usage in this period and these filters.</p>';
  const bar = (fraction) => `<span class="model-share-track" aria-hidden="true"><span style="--share:${Math.max(0, Math.min(100, fraction * 100)).toFixed(3)}%"></span></span>`;
  const context = (model) => model.context === "long" ? "Long-context requests" : model.context === "unknown" ? "Context size not recorded" : "Standard-context requests";
  return `<div class="model-usage-list${compact ? " is-compact" : ""}">${groups.map((group) => `<details class="model-usage-row${group.is_proxy ? " is-proxy" : ""}">
    <summary>
      <span class="model-identity"><strong>${e(group.name)}</strong><small>${group.is_proxy ? "Priced as Sol · estimate" : e(group.model)}${group.unallocated_tokens ? " · partially priced" : ""}</small></span>
      <span class="model-usage-number"><strong title="${exact(group.total_tokens)} tokens">${tokens(group.total_tokens)}</strong><small>${e(share(group.token_share))} of tokens</small>${bar(group.token_share)}</span>
      <span class="model-usage-number cost"><strong>${e(money(group.estimated_cost_usd))}</strong><small>${e(share(group.cost_share))} of est. cost</small>${bar(group.cost_share)}</span>
      <span class="model-expand" aria-hidden="true"></span>
    </summary>
    <div class="model-usage-details">
      <div class="model-token-split"><span>Input<strong>${tokens(group.input_tokens)} tokens</strong></span><span>Output<strong>${tokens(group.output_tokens)} tokens</strong></span></div>
      <p>Reused input is part of input. Reasoning is part of output, not an extra charge.${group.is_proxy ? " This group uses your Sol-rate assumption; it does not identify which unreleased model was used." : ""}${group.unallocated_tokens ? ` ${exact(group.unallocated_tokens)} tokens lack an input/output split and are excluded from cost.` : ""}</p>
      ${group.variants.map((model) => `<section class="model-rate-tier"><h4>${context(model)}<span>${tokens(model.total_tokens)} tokens · ${e(money(model.estimated_cost_usd))}</span></h4>${model.context === "unknown" ? '<p>Short-context rates assumed.</p>' : ""}${modelFormula(model)}</section>`).join("")}
    </div>
  </details>`).join("")}</div>`;
}

export function workflowRows(workflows, timezone) {
  return workflows.map((workflow) => `<details class="workflow"><summary>
    <span class="workflow-title">${e(workflow.name)}<small>${workflow.is_subagent ? "Parallel helper" : workflow.is_fork ? "Forked conversation" : "Main conversation"} · ${workflow.active_days} active ${workflow.active_days === 1 ? "day" : "days"}${workflow.agent_nickname ? ` · ${e(workflow.agent_nickname)}` : ""}</small></span>
    <span class="workflow-amount">${e(money(workflow.estimated_cost_usd))}<small>${tokens(workflow.total_tokens)} tokens</small></span>
    </summary><div class="workflow-body">
      <p>${e(share(workflow.cost_share))} of cost · ${e(share(workflow.token_share))} of tokens in this breakdown.</p>
      <div class="token-buckets">${[["Input", workflow.input_tokens], ["Reused input (part of input)", workflow.cached_input_tokens], ["Output", workflow.output_tokens], ["Reasoning (part of output)", workflow.reasoning_output_tokens]].map(([label, count]) => `<div><span>${label}</span><strong>${exact(count)}</strong></div>`).join("")}</div>
      ${renderModels(workflow.models)}
      <p>Started ${e(new Date(workflow.session_started_at).toLocaleString("en-US", { timeZone: timezone }))}</p>
    </div></details>`).join("");
}

export function renderBreakdown(detail, timezone) {
  const totals = detail.summary;
  const date = detail.type === "day" ? dateLabel(detail.id, { weekday: "long", year: "numeric" }) : detail.name;
  return `<h2 id="drawer-title">${e(date)}</h2><p class="drawer-period">${e(rangeLabel(detail.range))}</p>
    <div class="drawer-amount"><strong>${e(money(totals.estimated_cost_usd))}</strong><span>estimated API cost${totals.unallocated_tokens ? " (partial)" : ""}</span></div>
    <p class="drawer-token-total">${tokens(totals.total_tokens)} tokens <span class="quiet">· ${totals.workflow_count} contributing ${totals.workflow_count === 1 ? "run" : "runs"}</span></p>
    ${detail.type === "project" ? `<p class="drawer-recorded">Total recorded for this project: <strong>${e(money(detail.recorded.estimated_cost_usd))}</strong> · ${tokens(detail.recorded.total_tokens)} tokens<br>${e(rangeLabel(detail.recorded))}</p>` : ""}
    ${detail.outcome ? `<p class="outcome"><span class="eyebrow">Recorded outcome</span><br>${e(detail.outcome)}</p>` : ""}
    ${totals.total_tokens ? `<div class="drawer-split"><div><span>Direct work</span><strong>${e(money(totals.direct_cost_usd))}</strong><span>${tokens(totals.direct_tokens)} tokens</span></div><div><span>Additional helper work</span><strong>${e(money(totals.helper_cost_usd))}</strong><span>${tokens(totals.helper_tokens)} tokens</span></div></div>` : '<div class="empty-state">No usage recorded for this day and these filters.</div>'}
    ${detail.type === "day" && detail.projects.length ? `<section class="drawer-section"><h3>What I worked on</h3>${detail.projects.map((project) => `<button class="drawer-project" type="button" data-open-project="${e(project.id)}" data-scope-date="${detail.id}"><span>${e(project.name)}<small>${tokens(project.total_tokens)} tokens · ${e(share(project.cost_share))} of the day</small></span><strong>${e(money(project.estimated_cost_usd))}</strong></button>`).join("")}</section>` : ""}
    ${detail.models.length ? `<section class="drawer-section"><h3>Model usage</h3><p class="model-usage-helper">Tokens and cost for this breakdown. Expand a model for its rates.</p>${renderModelUsage(detail.models, { compact: true })}</section>` : ""}
    ${detail.workflows.length ? `<section class="drawer-section"><h3>Contributing runs</h3>${workflowRows(detail.workflows, timezone)}</section>` : ""}
    <p class="drawer-caveat">Current Standard API prices, not billed spend. Parent history replayed in helpers is excluded.${totals.proxy_tokens ? ` ${tokens(totals.proxy_tokens)} tokens use the Sol proxy for unreleased or unidentified models.` : ""}${totals.unallocated_tokens ? ` ${exact(totals.unallocated_tokens)} tokens have no input/output split; their cost is not included.` : ""} Usage alone cannot establish whether an outcome shipped.</p>`;
}
