import { createAnalytics, validDate, dayInZone } from "./analytics.js";
import { PRICING } from "./pricing.js";
import { loadPublishedSnapshot, refreshUsage } from "./refresh-client.js";
import { FILLS, tokens, exact, money, escape as e, dateLabel, rangeLabel,
  renderFixedMetrics, renderBoard, renderRecent, projectRows, renderModels, renderBreakdown } from "./view.js";

const $ = (id) => document.getElementById(id);
const RELEASE = "work-cost-3";
const state = {
  snapshot: null, analysis: null, report: null, params: readUrl(), sort: "cost",
  search: "", limit: 12, selectedDay: null, detailStack: [], boardKey: null,
  returnFocus: null, refreshing: false, source: "published", annotations: {}
};

function readUrl() {
  const query = new URLSearchParams(location.search);
  return {
    days: query.get("days") || "30", workspace: query.get("workspace") || "all",
    includeSubagents: !["0", "false"].includes(query.get("include_subagents")),
    startDate: query.get("start_date") || null, endDate: query.get("end_date") || null
  };
}

function writeUrl() {
  const url = new URL(location.href);
  for (const key of ["days", "workspace", "include_subagents", "start_date", "end_date", "refresh_ts"]) url.searchParams.delete(key);
  if (state.params.startDate && state.params.endDate) {
    url.searchParams.set("start_date", state.params.startDate);
    url.searchParams.set("end_date", state.params.endDate);
  } else url.searchParams.set("days", state.params.days);
  url.searchParams.set("workspace", state.params.workspace);
  url.searchParams.set("include_subagents", state.params.includeSubagents ? "1" : "0");
  history.replaceState(null, "", url);
}

function notice(message = "", warning = false) {
  $("notice").textContent = message;
  $("notice").classList.toggle("warning", warning);
}

function showError(error) {
  $("error-state").hidden = false;
  $("error-state").textContent = error instanceof Error ? error.message : String(error);
}

function hideError() { $("error-state").hidden = true; }

function applySnapshot(snapshot, source = "published") {
  const analysis = createAnalytics(snapshot, { annotations: state.annotations });
  let report;
  try { report = analysis.dashboard(state.params); }
  catch {
    state.params = { days: "30", workspace: "all", includeSubagents: true, startDate: null, endDate: null };
    report = analysis.dashboard(state.params);
    notice("The saved range was invalid. Showing the last 30 days instead.", true);
  }
  Object.assign(state, { snapshot, analysis, report, source });
  $("workspace").innerHTML = '<option value="all">All workspaces</option>' + report.workspaces.map((workspace) =>
    '<option value="' + e(workspace.workspace_key) + '">' + e(workspace.workspace_label) + '</option>').join("");
  if (![...$("workspace").options].some((option) => option.value === state.params.workspace)) state.params.workspace = "all";
  render();
  $("dashboard").setAttribute("aria-busy", "false");
  hideError();
}

function render() {
  const report = state.analysis.dashboard(state.params);
  state.report = report;
  $("workspace").value = state.params.workspace;
  $("include-helpers").checked = state.params.includeSubagents;
  document.querySelectorAll("[data-days]").forEach((button) =>
    button.setAttribute("aria-pressed", String(!state.params.startDate && button.dataset.days === String(state.params.days))));
  $("custom-toggle").setAttribute("aria-pressed", String(Boolean(state.params.startDate)));
  $("start-date").value = state.params.startDate || report.selection.start_date;
  $("end-date").value = state.params.endDate || report.selection.end_date;
  $("start-date").max = report.today;
  $("end-date").max = report.today;

  const time = new Date(report.generated_at);
  $("updated-at").dateTime = report.generated_at;
  $("updated-at").textContent = time.toLocaleString("en-US", { timeZone: report.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const staleDay = dayInZone(new Date(), report.timezone) !== report.today;
  $("freshness-label").textContent = staleDay ? "Data as of" : state.source === "collector" ? "Collected on this Mac" : "Snapshot collected";
  $("coverage-note").textContent = "History since " + dateLabel(report.available_range.start_date, { year: "numeric" }) + " · " + report.timezone;
  if (staleDay && !$("notice").textContent) notice("This snapshot is from " + dateLabel(report.today, { year: "numeric" }) + ". Refresh to check for newer usage.", true);

  $("fixed-metrics").innerHTML = renderFixedMetrics(report, staleDay);
  const metrics = report.habit_board.metrics;
  $("streak-line").textContent = metrics.current_streak + "-day streak · best " + metrics.best_streak + " · workweek " + metrics.workweek_green_days + "/5";
  $("month-cadence-label").textContent = metrics.active_days_this_month + "/" + metrics.elapsed_days_this_month + " active days";
  $("month-progress").value = metrics.active_days_this_month / Math.max(1, metrics.elapsed_days_this_month) * 100;
  $("month-progress").setAttribute("aria-valuetext", $("month-cadence-label").textContent + " this month");

  const boardKey = report.generated_at + "|" + state.params.workspace + "|" + state.params.includeSubagents;
  if (boardKey !== state.boardKey) {
    state.boardKey = boardKey;
    const board = report.habit_board;
    $("board-range").textContent = "365 days · " + rangeLabel(board);
    $("heatmap-legend").innerHTML = '<span>Less</span>' + FILLS.map((fill) => '<i style="--level-fill:' + fill + '"></i>').join("") + "<span>More</span>";
    $("heatmap-legend").title = "Intensity is relative to active days, so a single spike does not wash out normal work. Exact counts are unchanged.";
    $("heatmap-grid").innerHTML = renderBoard(board, state.selectedDay);
    $("heatmap-months").innerHTML = board.month_labels.map((month) =>
      '<span style="--week:' + month.week + '">' + month.label + "</span>").join("");
    $("recent-days").innerHTML = renderRecent(report.trend_days, state.selectedDay);
    const recent = report.snapshot_windows.trailing_14d;
    $("recent-total").textContent = tokens(recent.total_tokens) + " tokens · " + money(recent.estimated_cost_usd) + " estimated";
    requestAnimationFrame(() => { $("heatmap-scroll").scrollLeft = $("heatmap-scroll").scrollWidth; });
  }
  syncSelection();

  $("period-label").textContent = report.selection.mode === "custom" ? "Selected dates" : report.selection.label;
  $("period-cost").textContent = money(report.summary.estimated_cost_usd);
  $("period-tokens").textContent = tokens(report.summary.total_tokens) + " tokens";
  $("period-work").textContent = report.summary.project_count + " projects · " + report.summary.workflow_count + " contributing runs";
  $("period-dates").textContent = rangeLabel(report.selection);
  $("project-count").textContent = report.summary.project_count + " projects in this period";
  $("period-note").textContent = state.params.includeSubagents
    ? "Includes direct work + " + money(report.summary.helper_cost_usd) + " of additional helper work. Replayed history is counted once."
    : "Direct work only. Additional helper usage is excluded by your filter.";
  renderProjects();

  $("pricing-note").textContent = "Rates checked " + dateLabel(PRICING.checked_at, { year: "numeric" }) +
    ". Fresh input, reused input, cache writes, and output are priced separately. Reasoning is already included in output." +
    (report.summary.proxy_tokens ? " " + tokens(report.summary.proxy_tokens) + " tokens in this period use your Sol-rate assumption for unreleased or unidentified models." : "");
  const quality = report.quality;
  $("quality-note").textContent = exact(quality.inherited_tokens_removed) + " replayed tokens excluded across the recorded history. " +
    exact(quality.duplicate_snapshots) + " repeated snapshots ignored. " +
    (quality.invalid_records ? exact(quality.invalid_records) + " malformed log records were skipped; local logs are not a billing ledger. " : "") +
    (report.summary.unallocated_tokens ? exact(report.summary.unallocated_tokens) + " tokens lack a priceable input/output split. Their cost is excluded. " : "") +
    (quality.missing_parents ? quality.missing_parents + " parent conversations are missing; attribution may be incomplete. " : "") +
    (report.summary.unknown_context_tokens ? tokens(report.summary.unknown_context_tokens) + " tokens lack request context size and use short-context rates." : "");
  if ($("methodology").open) $("model-breakdown").innerHTML = renderModels(report.models);
  if ($("breakdown-drawer").open) renderDrawer();
  writeUrl();
}

function renderProjects() {
  const query = state.search.trim().toLocaleLowerCase();
  const projects = state.report.projects.filter((project) => project.name.toLocaleLowerCase().includes(query));
  projects.sort((a, b) => {
    if (state.sort === "tokens") return b.total_tokens - a.total_tokens || a.name.localeCompare(b.name);
    if (state.sort === "recent") return b.last_active_at.localeCompare(a.last_active_at) || b.estimated_cost_usd - a.estimated_cost_usd;
    return b.estimated_cost_usd - a.estimated_cost_usd || b.total_tokens - a.total_tokens || a.name.localeCompare(b.name);
  });
  const shown = projects.slice(0, state.limit);
  $("project-list").innerHTML = shown.length ? projectRows(shown) :
    '<div class="empty-state">' + (query ? "No projects match that name." : "No usage recorded in this period and these filters.") + "</div>";
  $("list-count").textContent = "Showing " + shown.length + " of " + projects.length + " projects" + (query ? " matching your search" : "");
  $("show-more").hidden = shown.length >= projects.length;
  $("show-more").textContent = "Show all " + projects.length + " projects";
}

function syncSelection() {
  document.querySelectorAll("[data-date]").forEach((node) => {
    const selected = node.dataset.date === state.selectedDay;
    node.classList.toggle("is-selected", selected);
    node.setAttribute("aria-pressed", String(selected));
  });
}

function openBreakdown(type, id, scopeDate = null) {
  if (!state.analysis) return;
  if (type === "day") { state.selectedDay = id; syncSelection(); }
  if (!$("breakdown-drawer").open) {
    state.detailStack = [];
    state.returnFocus = document.activeElement;
  }
  state.detailStack.push({ type, id, scopeDate });
  renderDrawer();
  if (!$("breakdown-drawer").open) $("breakdown-drawer").showModal();
}

function renderDrawer() {
  const target = state.detailStack.at(-1);
  if (!target) return;
  const params = { ...state.params };
  if (target.scopeDate) { params.startDate = target.scopeDate; params.endDate = target.scopeDate; }
  const detail = state.analysis.breakdown(target.type, target.id, params);
  $("drawer-kicker").textContent = target.type === "day" ? "Day breakdown" : "Project breakdown";
  $("drawer-back").hidden = state.detailStack.length < 2;
  $("drawer-content").innerHTML = renderBreakdown(detail, state.report.timezone);
  $("breakdown-drawer").scrollTop = 0;
}

function updateParams(changes) {
  Object.assign(state.params, changes);
  state.limit = 12;
  try { render(); hideError(); } catch (error) { showError(error); }
}

async function refresh() {
  if (state.refreshing) return;
  state.refreshing = true;
  $("refresh-button").disabled = true;
  hideError();
  try {
    const result = await refreshUsage({
      publish: location.hostname === "kjmcawesome.github.io",
      minimumGeneratedAt: state.snapshot?.generated_at,
      onProgress: (message) => { $("refresh-label").textContent = message; notice(message); }
    });
    applySnapshot(result.snapshot, result.source);
    notice(result.message, !result.rebuilt);
  } catch (error) {
    showError(new Error("Refresh did not complete. " + error.message));
    notice("Your previous data has not been replaced.", true);
  } finally {
    state.refreshing = false;
    $("refresh-button").disabled = false;
    $("refresh-label").textContent = "Refresh";
  }
}

$("filters").addEventListener("submit", (event) => event.preventDefault());
document.querySelectorAll("[data-days]").forEach((button) => button.addEventListener("click", () => {
  $("custom-range").hidden = true;
  $("custom-toggle").setAttribute("aria-expanded", "false");
  updateParams({ days: button.dataset.days, startDate: null, endDate: null });
}));
$("custom-toggle").addEventListener("click", () => {
  $("custom-range").hidden = !$("custom-range").hidden;
  $("custom-toggle").setAttribute("aria-expanded", String(!$("custom-range").hidden));
});
$("apply-range").addEventListener("click", () => {
  const startDate = $("start-date").value;
  const endDate = $("end-date").value;
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate || endDate > state.report.today) {
    showError(new Error("Choose a valid start and end date within the snapshot history.")); return;
  }
  updateParams({ startDate, endDate });
  $("custom-range").hidden = true;
  $("custom-toggle").setAttribute("aria-expanded", "false");
});
$("workspace").addEventListener("change", (event) => updateParams({ workspace: event.target.value }));
$("include-helpers").addEventListener("change", (event) => updateParams({ includeSubagents: event.target.checked }));
$("project-sort").addEventListener("change", (event) => { state.sort = event.target.value; renderProjects(); });
$("project-search").addEventListener("input", (event) => { state.search = event.target.value; state.limit = 12; renderProjects(); });
$("show-more").addEventListener("click", () => { state.limit = Infinity; renderProjects(); });
$("project-list").addEventListener("click", (event) => {
  const project = event.target.closest("[data-project-id]");
  if (project) openBreakdown("project", project.dataset.projectId);
});
for (const id of ["heatmap-grid", "recent-days"]) $(id).addEventListener("click", (event) => {
  const day = event.target.closest("[data-date]");
  if (day && !day.disabled) openBreakdown("day", day.dataset.date);
});
$("heatmap-grid").addEventListener("keydown", (event) => {
  const offsets = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
  const cells = [...$("heatmap-grid").querySelectorAll("button")];
  const index = cells.indexOf(event.target);
  if (index < 0 || !(event.key in offsets || ["Home", "End"].includes(event.key))) return;
  event.preventDefault();
  const target = event.key === "Home" ? cells.find((cell) => !cell.disabled) :
    event.key === "End" ? cells.findLast((cell) => !cell.disabled) : cells[index + offsets[event.key]];
  if (target && !target.disabled) {
    cells.forEach((cell) => { cell.tabIndex = -1; });
    target.tabIndex = 0; target.focus();
  }
});
$("drawer-close").addEventListener("click", () => $("breakdown-drawer").close());
$("drawer-back").addEventListener("click", () => { state.detailStack.pop(); renderDrawer(); });
$("drawer-content").addEventListener("click", (event) => {
  const project = event.target.closest("[data-open-project]");
  if (project) openBreakdown("project", project.dataset.openProject, project.dataset.scopeDate);
});
$("breakdown-drawer").addEventListener("click", (event) => {
  if (event.target !== $("breakdown-drawer")) return;
  const rect = event.target.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close();
});
$("breakdown-drawer").addEventListener("close", () => {
  state.detailStack = [];
  if (state.returnFocus?.isConnected) state.returnFocus.focus({ preventScroll: true });
  else $("project-search").focus({ preventScroll: true });
});
$("methodology").addEventListener("toggle", () => {
  if ($("methodology").open && state.report) $("model-breakdown").innerHTML = renderModels(state.report.models);
});
$("refresh-button").addEventListener("click", refresh);
window.addEventListener("popstate", () => { state.params = readUrl(); if (state.analysis) render(); });

async function boot() {
  try {
    // Annotations are optional and human-authored; never infer an outcome from tokens.
    try {
      const response = await fetch("./data/project-impact.json", { cache: "no-store", signal: AbortSignal.timeout(2500) });
      if (response.ok) state.annotations = (await response.json()).projects || {};
    } catch { /* Missing annotations do not block usage. */ }
    const snapshot = await loadPublishedSnapshot();
    notice();
    applySnapshot(snapshot);
    document.documentElement.dataset.release = RELEASE;
  } catch (error) {
    notice();
    $("dashboard").setAttribute("aria-busy", "false");
    showError(error);
  }
}

if (location.protocol !== "file:") boot();
