import {
  buildDashboardPayload,
  buildDayPayload
} from "./dashboard-metrics.js";

const RANGE_OPTIONS = [
  { label: "30d", value: 30 },
  { label: "90d", value: 90 },
  { label: "365d", value: 365 },
  { label: "All", value: "all" }
];

const DEFAULT_DAYS = 30;
const WEEKDAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];
const REFRESH_HELPER_URL = "http://127.0.0.1:3185";
const REFRESH_CHECK_LABEL = "Check for updates";
const REFRESH_FORCE_LABEL = "Force rebuild";
const REFRESH_REBUILDING_LABEL = "Rebuilding...";
const REFRESH_WAITING_LABEL = "Waiting for publish...";
const REFRESH_POLL_INTERVAL_MS = 2500;
const REFRESH_POLL_TIMEOUT_MS = 60000;

const state = {
  rangeMode: "preset",
  days: DEFAULT_DAYS,
  startDate: null,
  endDate: null,
  workspace: "all",
  includeSubagents: true,
  selectedDate: null,
  snapshot: null,
  snapshotNow: null,
  dashboard: null,
  datePicker: null,
  shouldResetHeatmapViewport: true,
  refreshHelperAvailable: false,
  refreshHelperUrl: null
};

const elements = {
  lastRefresh: document.querySelector("#last-refresh"),
  sourceNote: document.querySelector("#source-note"),
  selectedRangeTitle: document.querySelector("#selected-range-title"),
  selectedRangeNote: document.querySelector("#selected-range-note"),
  rangeChips: document.querySelector("#range-chips"),
  customRangeButton: document.querySelector("#custom-range-button"),
  customRangeInput: document.querySelector("#custom-range-input"),
  activeRangePill: document.querySelector("#active-range-pill"),
  workspaceFilter: document.querySelector("#workspace-filter"),
  subagentToggle: document.querySelector("#subagent-toggle"),
  refreshButton: document.querySelector("#refresh-button"),
  summaryTotal: document.querySelector("#summary-total"),
  summaryTotalFoot: document.querySelector("#summary-total-foot"),
  summaryCost: document.querySelector("#summary-cost"),
  summaryCostFoot: document.querySelector("#summary-cost-foot"),
  summaryDays: document.querySelector("#summary-days"),
  summaryDaysFoot: document.querySelector("#summary-days-foot"),
  summaryBurst: document.querySelector("#summary-burst"),
  summaryBurstFoot: document.querySelector("#summary-burst-foot"),
  efficiencyNote: document.querySelector("#efficiency-note"),
  efficiencyGrid: document.querySelector("#efficiency-grid"),
  modelMixList: document.querySelector("#model-mix-list"),
  insightList: document.querySelector("#insight-list"),
  costNote: document.querySelector("#cost-note"),
  costBreakdownBody: document.querySelector("#cost-breakdown-body"),
  costBreakdownFoot: document.querySelector("#cost-breakdown-foot"),
  heatmapSummary: document.querySelector("#heatmap-summary"),
  heatmapWeekdays: document.querySelector("#heatmap-weekdays"),
  heatmapShell: document.querySelector(".heatmap-shell"),
  heatmapMonths: document.querySelector("#heatmap-months"),
  heatmapGrid: document.querySelector("#heatmap-grid"),
  todayStatusPill: document.querySelector("#today-status-pill"),
  todayStatusHeadline: document.querySelector("#today-status-headline"),
  todayStatusNote: document.querySelector("#today-status-note"),
  habitCurrentStreak: document.querySelector("#habit-current-streak"),
  habitCurrentNote: document.querySelector("#habit-current-note"),
  habitBestStreak: document.querySelector("#habit-best-streak"),
  habitBestNote: document.querySelector("#habit-best-note"),
  habitWorkweek: document.querySelector("#habit-workweek"),
  habitWorkweekNote: document.querySelector("#habit-workweek-note"),
  costToday: document.querySelector("#cost-today"),
  costTodayFoot: document.querySelector("#cost-today-foot"),
  cost14d: document.querySelector("#cost-14d"),
  cost14dFoot: document.querySelector("#cost-14d-foot"),
  costMonth: document.querySelector("#cost-month"),
  costMonthFoot: document.querySelector("#cost-month-foot"),
  trendTotalTokens: document.querySelector("#trend-total-tokens"),
  trendTotalCost: document.querySelector("#trend-total-cost"),
  trendSparkline: document.querySelector("#trend-sparkline"),
  threadTable: document.querySelector("#thread-table"),
  dayTitle: document.querySelector("#day-title"),
  dayTotal: document.querySelector("#day-total"),
  dayCost: document.querySelector("#day-cost"),
  dayInput: document.querySelector("#day-input"),
  dayCached: document.querySelector("#day-cached"),
  dayOutput: document.querySelector("#day-output"),
  dayReasoning: document.querySelector("#day-reasoning"),
  daySessions: document.querySelector("#day-sessions"),
  dayDetails: document.querySelector("#day-details"),
  dayDetailsLabel: document.querySelector("#day-details-label"),
  dayCostNote: document.querySelector("#day-cost-note"),
  daySessionList: document.querySelector("#day-session-list")
};

function formatCompactNumber(value) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: value >= 1000000 ? 1 : 0
  }).format(value || 0);
}

function formatFullNumber(value) {
  return (value || 0).toLocaleString("en-US");
}

function formatPercent(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

function formatSignedPercent(value) {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }

  const rounded = Math.round(value * 100);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function formatUsd(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value || 0);
}

function formatRate(value) {
  return `${formatUsd(value)}/1M`;
}

function formatCompactUsd(value) {
  if ((value || 0) >= 100) {
    return `$${Math.round(value || 0)}`;
  }

  return formatUsd(value || 0);
}

function formatAxisUsd(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value || 0);
}

function formatDate(value) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function formatCountLabel(value, singular, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function formatComparisonFootline(changePct, label) {
  if (changePct === null || Number.isNaN(changePct)) {
    return `No prior comparison · ${label}`;
  }

  return `${formatSignedPercent(changePct)} vs ${label}`;
}

function formatAxisTokens(value) {
  if (value >= 1000000000) {
    return `${(value / 1000000000).toFixed(1)}B`;
  }
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(value >= 100000000 ? 0 : 1)}M`;
  }
  if (value >= 1000) {
    return `${Math.round(value / 1000)}K`;
  }
  return String(Math.round(value));
}

function formatTrendDayLabel(value) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

function formatTrendDayShort(value) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short"
  });
}

function formatTrendDayNumber(value) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric"
  });
}

function buildEstimatedCostNote(unpricedTotalTokens) {
  if (unpricedTotalTokens > 0) {
    return `Estimated cost uses published OpenAI API pricing as a directional planning lens, not billed spend. ${formatFullNumber(unpricedTotalTokens)} tokens in this view used a GPT-5.4-equivalent proxy rate because their log model did not match a direct public-rate entry.`;
  }

  return "Estimated cost uses published OpenAI API pricing as a directional planning lens, not billed spend.";
}

function todayDate(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function buildStreakStartDate(streakCount) {
  if (!streakCount) {
    return null;
  }

  return dateKeyFromDate(addDays(todayDate(state.snapshotNow), -(streakCount - 1)));
}

function formatWorkflowName(item) {
  return item.thread_name || "Untitled workflow";
}

function formatWorkflowContext(item) {
  const parts = [];
  if (item.workspace_label) {
    parts.push(item.workspace_label);
  }
  if (item.is_subagent) {
    parts.push("Helper run");
  }
  return parts.join(" · ") || "Workflow";
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isPublicPagesSite() {
  return window.location.hostname === "kjmcawesome.github.io";
}

function setRefreshButtonLabel(label, title) {
  elements.refreshButton.textContent = label;
  elements.refreshButton.title = title;
}

function syncRefreshButtonMode() {
  if (elements.refreshButton.disabled) {
    return;
  }

  if (isPublicPagesSite()) {
    setRefreshButtonLabel(
      REFRESH_FORCE_LABEL,
      "Open the local helper on this machine to rebuild from ~/.codex and republish the snapshot"
    );
    return;
  }

  if (state.refreshHelperAvailable) {
    setRefreshButtonLabel(
      REFRESH_FORCE_LABEL,
      "Rebuild the snapshot from local ~/.codex logs and publish it if anything changed"
    );
    return;
  }

  setRefreshButtonLabel(
    REFRESH_CHECK_LABEL,
    "Fetch the latest published snapshot from the static site"
  );
}

function launchRefreshBridge() {
  const bridgeUrl = new URL("/bridge", `${REFRESH_HELPER_URL}/`);
  bridgeUrl.searchParams.set("return_to", window.location.href);

  const bridgeWindow = window.open(
    bridgeUrl.toString(),
    "kj-codex-usage-refresh",
    "popup,width=540,height=720"
  );

  if (!bridgeWindow) {
    window.location.assign(bridgeUrl.toString());
  }
}

async function probeRefreshHelper() {
  try {
    const response = await fetch(`${REFRESH_HELPER_URL}/status`, {
      cache: "no-store",
      mode: "cors"
    });

    if (!response.ok) {
      throw new Error(`Refresh helper probe failed: ${response.status}`);
    }

    state.refreshHelperAvailable = true;
    state.refreshHelperUrl = REFRESH_HELPER_URL;
  } catch {
    state.refreshHelperAvailable = false;
    state.refreshHelperUrl = null;
  } finally {
    syncRefreshButtonMode();
  }
}

function setDayDetailsOpen(open) {
  elements.dayDetails.open = open;
  elements.dayDetailsLabel.textContent = open ? "Hide details" : "Expand details";
}

async function waitForSnapshotGeneration(targetGeneratedAt, timeoutMs) {
  const targetTime = new Date(targetGeneratedAt).getTime();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    await loadDashboard(true, { suppressButtonToggle: true });
    const currentTime = new Date(state.dashboard?.generated_at || 0).getTime();
    if (currentTime >= targetTime) {
      return true;
    }

    await sleep(REFRESH_POLL_INTERVAL_MS);
  }

  return false;
}

async function forceRefreshViaHelper() {
  if (!state.refreshHelperAvailable || !state.refreshHelperUrl) {
    state.shouldResetHeatmapViewport = true;
    await loadDashboard(true, { suppressButtonToggle: true });
    return;
  }

  setRefreshButtonLabel(
    REFRESH_REBUILDING_LABEL,
    "Running a fresh local rebuild from ~/.codex and publishing the result"
  );

  const response = await fetch(`${state.refreshHelperUrl}/refresh`, {
    method: "POST",
    mode: "cors",
    cache: "no-store"
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || payload.error || `Refresh helper failed: ${response.status}`);
  }

  const payload = await response.json();
  setRefreshButtonLabel(
    REFRESH_WAITING_LABEL,
    payload.pushed
      ? "Waiting for the published snapshot to become visible on the static site"
      : "Waiting for the rebuilt snapshot to be visible"
  );

  const observed = await waitForSnapshotGeneration(
    payload.generated_at,
    payload.pushed ? REFRESH_POLL_TIMEOUT_MS : 10000
  );

  if (!observed) {
    await loadDashboard(true, { suppressButtonToggle: true });
  }
}

function isDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function dateKeyFromDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function parseBooleanFlag(value, defaultValue = true) {
  if (value == null) {
    return defaultValue;
  }

  return value !== "0" && value !== "false";
}

function initializeStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const startDate = params.get("start_date");
  const endDate = params.get("end_date");

  if (startDate && endDate && isDateKey(startDate) && isDateKey(endDate) && startDate <= endDate) {
    state.rangeMode = "custom";
    state.startDate = startDate;
    state.endDate = endDate;
  } else {
    const daysParam = params.get("days");
    const parsedDays = daysParam && daysParam.toLowerCase() === "all"
      ? "all"
      : Number(daysParam || DEFAULT_DAYS);
    state.rangeMode = "preset";
    state.days = parsedDays === "all" || Number.isFinite(parsedDays) ? parsedDays : DEFAULT_DAYS;
    state.startDate = null;
    state.endDate = null;
  }

  state.workspace = params.get("workspace") || "all";
  state.includeSubagents = parseBooleanFlag(params.get("include_subagents"), true);
  elements.subagentToggle.checked = state.includeSubagents;
}

function buildQueryString() {
  const query = new URLSearchParams();

  if (state.rangeMode === "custom" && state.startDate && state.endDate) {
    query.set("start_date", state.startDate);
    query.set("end_date", state.endDate);
  } else {
    query.set("days", String(state.days));
  }

  query.set("workspace", state.workspace);
  query.set("include_subagents", state.includeSubagents ? "1" : "0");
  return query.toString();
}

function syncUrl() {
  const queryString = buildQueryString();
  const nextUrl = `${window.location.pathname}?${queryString}`;
  window.history.replaceState({}, "", nextUrl);
}

async function fetchJson(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || payload.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

async function loadSnapshot(forceReload = false) {
  const snapshotUrl = new URL("data/usage-snapshot.json", document.baseURI);
  if (forceReload) {
    snapshotUrl.searchParams.set("ts", String(Date.now()));
  }

  const snapshot = await fetchJson(snapshotUrl.toString(), {
    cache: forceReload ? "no-store" : "default"
  });
  state.snapshot = snapshot;
  state.snapshotNow = new Date(snapshot.generated_at);
  return snapshot;
}

function updateRangeSelectionLabel(label) {
  elements.activeRangePill.textContent = label;
  elements.activeRangePill.title = label;
}

function renderRangeControls() {
  elements.rangeChips.innerHTML = "";

  for (const option of RANGE_OPTIONS) {
    const isActive = state.rangeMode === "preset" && state.days === option.value;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chip${isActive ? " is-active" : ""}`;
    button.textContent = option.label;
    button.addEventListener("click", () => {
      if (state.rangeMode === "preset" && state.days === option.value) {
        return;
      }

      state.rangeMode = "preset";
      state.days = option.value;
      state.startDate = null;
      state.endDate = null;
      syncUrl();
      syncDatePicker(null);
      renderRangeControls();
      loadDashboard();
    });
    elements.rangeChips.append(button);
  }

  elements.customRangeButton.classList.toggle("is-active", state.rangeMode === "custom");
}

function renderHabitRail(dashboard) {
  const metrics = dashboard.habit_metrics;
  const todayStatusLabel = metrics.today_has_usage ? "Green today" : "Not green yet";
  elements.todayStatusPill.textContent = todayStatusLabel;
  elements.todayStatusPill.classList.toggle("is-live", metrics.today_has_usage);
  elements.todayStatusPill.classList.toggle("is-idle", !metrics.today_has_usage);

  if (metrics.today_has_usage) {
    elements.todayStatusHeadline.textContent = `${formatCompactNumber(metrics.today_tokens)} tokens so far today`;
    elements.todayStatusNote.textContent = metrics.current_streak > 1
      ? `${formatCompactUsd(metrics.today_estimated_cost_usd)} estimated cost today · ${formatCountLabel(metrics.current_streak, "day")} streak is live`
      : `${formatCompactUsd(metrics.today_estimated_cost_usd)} estimated cost today · streak is live`;
  } else {
    elements.todayStatusHeadline.textContent = "One workflow starts the streak";
    elements.todayStatusNote.textContent = "No usage yet today. Get the square green.";
  }

  const streakStartDate = buildStreakStartDate(metrics.current_streak);
  elements.habitCurrentStreak.textContent = formatFullNumber(metrics.current_streak);
  elements.habitCurrentNote.textContent = streakStartDate
    ? `Live since ${formatDate(streakStartDate)}`
    : "Start with one green day";
  elements.habitBestStreak.textContent = formatFullNumber(metrics.best_streak);
  elements.habitBestNote.textContent = metrics.best_streak > 0
    ? "Best run in the last 365 days"
    : "No streak on the board yet";
  elements.habitWorkweek.textContent = `${metrics.workweek_green_days}/${metrics.workweek_goal}`;
  const workweekRemaining = Math.max(metrics.workweek_goal - metrics.workweek_green_days, 0);
  elements.habitWorkweekNote.textContent = workweekRemaining === 0
    ? "Workweek goal hit"
    : `${workweekRemaining} green day${workweekRemaining === 1 ? "" : "s"} to go`;
}

function renderInsightCosts(dashboard) {
  const snapshots = dashboard.snapshot_windows;

  elements.costToday.textContent = formatUsd(snapshots.today.estimated_cost_usd);
  elements.costToday.title = formatUsd(snapshots.today.estimated_cost_usd);
  elements.costTodayFoot.textContent = `${formatCompactNumber(snapshots.today.total_tokens)} tokens today`;
  elements.costTodayFoot.title = formatFullNumber(snapshots.today.total_tokens);

  elements.cost14d.textContent = formatUsd(snapshots.trailing_14d.estimated_cost_usd);
  elements.cost14d.title = formatUsd(snapshots.trailing_14d.estimated_cost_usd);
  elements.cost14dFoot.textContent = `${formatCompactNumber(snapshots.trailing_14d.total_tokens)} tokens · ${formatComparisonFootline(
    snapshots.trailing_14d.cost_change_pct,
    "prior 14 days"
  )}`;
  elements.cost14dFoot.title = `${formatFullNumber(snapshots.trailing_14d.total_tokens)} tokens`;

  elements.costMonth.textContent = formatUsd(snapshots.month_to_date.estimated_cost_usd);
  elements.costMonth.title = formatUsd(snapshots.month_to_date.estimated_cost_usd);
  elements.costMonthFoot.textContent = `${formatCompactNumber(snapshots.month_to_date.total_tokens)} tokens · ${formatComparisonFootline(
    snapshots.month_to_date.cost_change_pct,
    "same point last month"
  )}`;
  elements.costMonthFoot.title = `${formatFullNumber(snapshots.month_to_date.total_tokens)} tokens`;
}

function renderSummary(dashboard) {
  elements.lastRefresh.textContent = new Date(dashboard.generated_at).toLocaleString();
  elements.sourceNote.textContent = `${formatDate(dashboard.habit_board.start_date)} - ${formatDate(dashboard.habit_board.end_date)}`;
  elements.selectedRangeTitle.textContent = dashboard.selection.label;
  elements.selectedRangeNote.textContent = `Filters here only change the selected-range KPIs, coaching view, workflows, and day details.`;
  elements.summaryTotal.textContent = formatCompactNumber(dashboard.summary.total_tokens);
  elements.summaryTotal.title = formatFullNumber(dashboard.summary.total_tokens);
  elements.summaryTotalFoot.textContent = `${dashboard.selection.label} · ${formatCountLabel(dashboard.summary.active_days, "active day")}`;
  elements.summaryCost.textContent = formatUsd(dashboard.summary.estimated_cost_usd);
  elements.summaryCost.title = formatUsd(dashboard.summary.estimated_cost_usd);
  elements.summaryCostFoot.textContent = `${formatCountLabel(dashboard.summary.sessions, "workflow")} in range`;
  elements.summaryDays.textContent = dashboard.efficiency_metrics.effective_cost_per_million !== null
    ? formatRate(dashboard.efficiency_metrics.effective_cost_per_million)
    : "—";
  elements.summaryDays.title = dashboard.efficiency_metrics.effective_cost_per_million !== null
    ? formatRate(dashboard.efficiency_metrics.effective_cost_per_million)
    : "No priced usage in range";
  elements.summaryDaysFoot.textContent = dashboard.efficiency_metrics.input_output_ratio !== null
    ? `Input/output ${dashboard.efficiency_metrics.input_output_ratio.toFixed(1)}x`
    : "No output in range";
  const rangeComparison = dashboard.range_comparison;
  elements.summaryBurst.textContent = rangeComparison.token_change_pct !== null
    ? formatSignedPercent(rangeComparison.token_change_pct)
    : "—";
  elements.summaryBurst.title = rangeComparison.available
    ? `${formatFullNumber(dashboard.summary.total_tokens)} tokens vs ${formatFullNumber(rangeComparison.previous_total_tokens)} in ${rangeComparison.label}`
    : rangeComparison.label;
  elements.summaryBurstFoot.textContent = rangeComparison.available
    ? `${rangeComparison.cost_change_pct !== null ? `Cost ${formatSignedPercent(rangeComparison.cost_change_pct)}` : "No prior cost comparison"} · ${rangeComparison.label}`
    : rangeComparison.label;
  elements.costNote.textContent = buildEstimatedCostNote(dashboard.summary.unpriced_total_tokens);
  updateRangeSelectionLabel(dashboard.selection.label);
}

function renderEfficiencyPanel(dashboard) {
  const metrics = dashboard.efficiency_metrics;
  const selectedRangeLabel = dashboard.selection.label;
  elements.efficiencyNote.textContent = `Signals for ${selectedRangeLabel.toLowerCase()}.`;

  elements.efficiencyGrid.innerHTML = `
    <div class="efficiency-stat">
      <span class="efficiency-stat-label">Eff. cost / 1M</span>
      <strong>${metrics.effective_cost_per_million !== null ? formatRate(metrics.effective_cost_per_million) : "—"}</strong>
      <span class="efficiency-stat-foot">Selected range</span>
    </div>
    <div class="efficiency-stat">
      <span class="efficiency-stat-label">Month pace</span>
      <strong>${formatSignedPercent(metrics.month_to_date_token_growth_pct)}</strong>
      <span class="efficiency-stat-foot">Tokens vs same point last month</span>
    </div>
    <div class="efficiency-stat">
      <span class="efficiency-stat-label">Peak day share</span>
      <strong>${formatPercent(metrics.peak_day_share)}</strong>
      <span class="efficiency-stat-foot">${metrics.peak_day ? formatDate(metrics.peak_day.date) : "No peak day yet"}</span>
    </div>
    <div class="efficiency-stat">
      <span class="efficiency-stat-label">Input / output</span>
      <strong>${metrics.input_output_ratio !== null ? `${metrics.input_output_ratio.toFixed(1)}x` : "—"}</strong>
      <span class="efficiency-stat-foot">Prompt load vs response load</span>
    </div>
  `;

  const modelMixRows = dashboard.cost_breakdown_by_model || [];
  if (!modelMixRows.length) {
    elements.modelMixList.innerHTML = '<div class="empty-state">No priced model mix for this selection.</div>';
  } else {
    const totalCost = dashboard.summary.estimated_cost_usd || 0;
    const palette = {
      "gpt-5.4": "rgba(40, 72, 54, 0.82)",
      "gpt-5.3-codex": "rgba(69, 155, 89, 0.7)",
      "gpt-5.2-codex": "rgba(166, 214, 175, 0.95)"
    };
    elements.modelMixList.innerHTML = `
      <div class="efficiency-section-title">Model mix</div>
      ${modelMixRows.map((row) => {
        const color = palette[row.model] || "rgba(35, 49, 39, 0.42)";
        const costShare = totalCost > 0 ? row.share_of_total_cost : 0;
        const tokenShare = row.share_of_total_tokens || 0;
        return `
          <div class="mix-row" title="${row.model}: ${formatUsd(row.estimated_cost_usd)} estimated cost · ${formatFullNumber(row.total_tokens)} tokens · ${formatRate(row.effective_cost_per_million || 0)}">
            <div class="mix-copy">
              <span class="mix-label">${row.model}</span>
              <span class="mix-sub">${formatUsd(row.estimated_cost_usd)} · ${formatRate(row.effective_cost_per_million || 0)}</span>
            </div>
            <div class="mix-bars">
              <div class="mix-track">
                <span class="mix-track-label">Tokens</span>
                <div class="mix-bar-shell">
                  <span class="mix-bar" style="width:${Math.max(tokenShare * 100, tokenShare > 0 ? 6 : 0)}%; background:${color};"></span>
                </div>
                <span class="mix-track-value">${formatPercent(tokenShare)}</span>
              </div>
              <div class="mix-track">
                <span class="mix-track-label">Cost</span>
                <div class="mix-bar-shell">
                  <span class="mix-bar" style="width:${Math.max(costShare * 100, costShare > 0 ? 6 : 0)}%; background:${color}; opacity:0.78;"></span>
                </div>
                <span class="mix-track-value">${formatPercent(costShare)}</span>
              </div>
            </div>
          </div>
        `;
      }).join("")}
    `;
  }

  const insights = dashboard.insights || [];
  elements.insightList.innerHTML = `
    <div class="efficiency-section-title">Insights</div>
    <div class="insight-stack">
      ${insights.map((insight) => `
        <article class="insight-card">
          <strong>${insight.title}</strong>
          <p>${insight.body}</p>
        </article>
      `).join("")}
    </div>
  `;
}

function renderWorkspaceFilter(dashboard) {
  const previousValue = state.workspace;
  elements.workspaceFilter.innerHTML = '<option value="all">All workspaces</option>';

  for (const workspace of dashboard.workspaces) {
    const option = document.createElement("option");
    option.value = workspace.workspace_key;
    option.textContent = workspace.workspace_label;
    elements.workspaceFilter.append(option);
  }

  const availableValues = new Set(["all", ...dashboard.workspaces.map((workspace) => workspace.workspace_key)]);
  state.workspace = availableValues.has(previousValue) ? previousValue : "all";
  elements.workspaceFilter.value = state.workspace;
}

function renderWeekdayLabels() {
  elements.heatmapWeekdays.innerHTML = "";

  for (const label of WEEKDAY_LABELS) {
    const span = document.createElement("span");
    span.className = "weekday-label";
    span.textContent = label;
    elements.heatmapWeekdays.append(span);
  }
}

function buildHeatmapHeadline(dashboard) {
  const totalTokens = dashboard.habit_board.days.reduce((sum, day) =>
    sum + (day.in_range ? (day.total_tokens || 0) : 0), 0
  );

  return `${formatFullNumber(totalTokens)} tokens across the last 365 days`;
}

function heatmapWeekWidth() {
  const styles = window.getComputedStyle(elements.heatmapGrid);
  const cellSize = parseFloat(styles.gridAutoColumns) || parseFloat(styles.getPropertyValue("--cell-size")) || 14;
  const gap = parseFloat(styles.columnGap || styles.gap) || 4;
  return cellSize + gap;
}

function resetHeatmapViewportIfNeeded() {
  if (!state.shouldResetHeatmapViewport) {
    return;
  }

  state.shouldResetHeatmapViewport = false;
  const applyViewport = () => {
    const shell = elements.heatmapShell;
    if (!shell) {
      return;
    }

    const maxScrollLeft = Math.max(shell.scrollWidth - shell.clientWidth, 0);
    shell.scrollLeft = maxScrollLeft;
  };

  applyViewport();
  window.requestAnimationFrame(applyViewport);
}

function renderHeatmap(dashboard) {
  const weekWidth = heatmapWeekWidth();
  const board = dashboard.habit_board;
  const totalWeeks = (board.days.at(-1)?.week_index || 0) + 1;
  const todayKey = state.snapshotNow ? dateKeyFromDate(state.snapshotNow) : null;

  elements.heatmapSummary.textContent = buildHeatmapHeadline(dashboard);
  elements.heatmapMonths.innerHTML = "";
  elements.heatmapGrid.innerHTML = "";
  elements.heatmapMonths.style.width = `${Math.max(weekWidth * totalWeeks, 120)}px`;

  for (const label of board.month_labels) {
    const span = document.createElement("span");
    span.className = "month-label";
    span.style.left = `${label.week_index * weekWidth}px`;
    span.textContent = label.label;
    elements.heatmapMonths.append(span);
  }

  for (const day of board.days) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `day-cell level-${day.level}`;
    button.style.setProperty("--day-fill", `var(--level-${day.level})`);
    button.dataset.date = day.date;
    if (!day.in_range) {
      button.classList.add("is-outside");
      button.disabled = true;
    }
    if (todayKey && day.in_range && day.date === todayKey) {
      button.classList.add("is-today");
    }
    if (state.selectedDate === day.date) {
      button.classList.add("is-selected");
    }
    button.title = `${formatDate(day.date)}\n${formatFullNumber(day.total_tokens)} total tokens\n${formatUsd(day.estimated_cost_usd)} estimated cost`;
    button.setAttribute(
      "aria-label",
      `${formatDate(day.date)}: ${formatFullNumber(day.total_tokens)} total tokens and ${formatUsd(day.estimated_cost_usd)} estimated cost`
    );
    button.addEventListener("click", () => {
      if (!day.in_range) {
        return;
      }
      state.selectedDate = day.date;
      elements.heatmapGrid.querySelector(".day-cell.is-selected")?.classList.remove("is-selected");
      button.classList.add("is-selected");
      loadDay(day.date);
    });
    elements.heatmapGrid.append(button);
  }

  resetHeatmapViewportIfNeeded();
}

function renderTrend(dashboard) {
  const trendDays = dashboard.trend_days || [];
  const snapshots = dashboard.snapshot_windows || {};
  const trailingSnapshot = snapshots.trailing_14d || null;
  const tokenValues = trendDays.map((day) => day.total_tokens || 0);
  const tokenScaleMax = Math.max(...tokenValues, 0) || 1;

  if (elements.trendTotalTokens) {
    elements.trendTotalTokens.textContent = trailingSnapshot
      ? formatCompactNumber(trailingSnapshot.total_tokens)
      : "—";
    elements.trendTotalTokens.title = trailingSnapshot
      ? formatFullNumber(trailingSnapshot.total_tokens)
      : "";
  }

  if (elements.trendTotalCost) {
    elements.trendTotalCost.textContent = trailingSnapshot
      ? formatUsd(trailingSnapshot.estimated_cost_usd)
      : "—";
    elements.trendTotalCost.title = trailingSnapshot
      ? formatUsd(trailingSnapshot.estimated_cost_usd)
      : "";
  }

  if (!trendDays.length) {
    elements.trendSparkline.innerHTML = '<div class="empty-state">No trend data for this range.</div>';
    return;
  }

  const peakTokens = Math.max(...tokenValues, 0);
  const todayKey = dateKeyFromDate(todayDate(state.snapshotNow || new Date()));

  elements.trendSparkline.innerHTML = trendDays.map((day, index) => {
    const totalTokens = day.total_tokens || 0;
    const estimatedCost = day.estimated_cost_usd || 0;
    const ratio = totalTokens / tokenScaleMax;
    const level = totalTokens === 0
      ? 0
      : ratio <= 0.25
        ? 1
        : ratio <= 0.5
          ? 2
          : ratio <= 0.75
            ? 3
            : 4;
    const isToday = day.date === todayKey;
    const isPeak = peakTokens > 0 && totalTokens === peakTokens;
    const classes = [
      "trend-day-chip",
      `level-${level}`,
      totalTokens === 0 ? "is-zero" : "",
      isPeak ? "is-peak" : "",
      isToday ? "is-today" : ""
    ].filter(Boolean).join(" ");
    const hoverTitle = `${formatTrendDayLabel(day.date)}: ${formatFullNumber(totalTokens)} tokens · ${formatUsd(estimatedCost)} estimated cost`;

    return `
      <button
        type="button"
        class="${classes}"
        data-date="${day.date}"
        title="${hoverTitle}"
        aria-label="${hoverTitle}"
      >
        <span class="trend-day-weekday">${formatTrendDayShort(day.date)}</span>
        <span class="trend-day-swatch" style="--day-fill:var(--level-${level});"></span>
        <span class="trend-day-date">${formatTrendDayNumber(day.date)}</span>
      </button>
    `;
  }).join("");

  for (const chip of elements.trendSparkline.querySelectorAll(".trend-day-chip")) {
    chip.addEventListener("click", () => {
      const selectedDate = chip.dataset.date;
      if (!selectedDate) {
        return;
      }

      state.selectedDate = selectedDate;
      elements.heatmapGrid.querySelector(".day-cell.is-selected")?.classList.remove("is-selected");
      elements.heatmapGrid.querySelector(`.day-cell[data-date="${selectedDate}"]`)?.classList.add("is-selected");
      loadDay(selectedDate);
    });
  }
}

function renderCostBreakdown(dashboard) {
  const rows = dashboard.cost_breakdown_by_model || [];

  if (!rows.length) {
    elements.costBreakdownBody.innerHTML = '<tr><td colspan="10" class="cost-empty">No priced model usage in this selection.</td></tr>';
    elements.costBreakdownFoot.innerHTML = "";
    return;
  }

  elements.costBreakdownBody.innerHTML = rows.map((row) => `
    <tr>
      <th scope="row">${row.model}</th>
      <td>${formatFullNumber(row.sessions)}</td>
      <td>${formatFullNumber(row.uncached_input_tokens)}</td>
      <td>${formatFullNumber(row.cached_input_tokens)}</td>
      <td>${formatFullNumber(row.billed_output_tokens)}</td>
      <td>${formatRate(row.rates.input)}</td>
      <td>${formatRate(row.rates.cached_input)}</td>
      <td>${formatRate(row.rates.output)}</td>
      <td class="cost-cell-strong">${formatUsd(row.estimated_cost_usd)}</td>
      <td>${formatPercent(row.share_of_total_cost)}</td>
    </tr>
  `).join("");

  const totals = rows.reduce((accumulator, row) => {
    accumulator.uncached_input_tokens += row.uncached_input_tokens || 0;
    accumulator.cached_input_tokens += row.cached_input_tokens || 0;
    accumulator.billed_output_tokens += row.billed_output_tokens || 0;
    return accumulator;
  }, {
    uncached_input_tokens: 0,
    cached_input_tokens: 0,
    billed_output_tokens: 0
  });

  elements.costBreakdownFoot.innerHTML = `
    <tr>
      <th scope="row">Total</th>
      <td>${formatFullNumber(dashboard.summary.sessions)}</td>
      <td>${formatFullNumber(totals.uncached_input_tokens)}</td>
      <td>${formatFullNumber(totals.cached_input_tokens)}</td>
      <td>${formatFullNumber(totals.billed_output_tokens)}</td>
      <td>&mdash;</td>
      <td>&mdash;</td>
      <td>&mdash;</td>
      <td class="cost-cell-strong">${formatUsd(dashboard.summary.estimated_cost_usd)}</td>
      <td>100%</td>
    </tr>
  `;
}

function renderRankRows(container, rows, formatter) {
  if (!rows.length) {
    container.innerHTML = '<div class="empty-state">No usage in this selection.</div>';
    return;
  }

  container.innerHTML = "";
  for (const row of rows) {
    container.append(formatter(row));
  }
}

function renderTopThreads(dashboard) {
  renderRankRows(elements.threadTable, dashboard.top_threads, (thread) => {
    const row = document.createElement("div");
    row.className = "rank-row";
    row.innerHTML = `
      <div class="rank-main">
        <span class="rank-title">${formatWorkflowName(thread)}</span>
        <span class="rank-sub">${formatWorkflowContext(thread)} · ${formatCountLabel(thread.active_days || 0, "active day")} · ${thread.dominant_model_family || "Other"} dominant</span>
      </div>
      <div class="rank-metrics">
        <span class="rank-value">${formatUsd(thread.estimated_cost_usd)}</span>
        <span class="rank-value-sub">${formatCompactNumber(thread.total_tokens)} tokens · ${formatPercent(thread.cost_share || 0)} cost share</span>
      </div>
    `;
    row.title = `${formatWorkflowName(thread)}: ${formatFullNumber(thread.total_tokens)} total tokens · ${formatUsd(thread.estimated_cost_usd)} estimated cost · ${thread.dominant_model_family || "Other"} dominant model`;
    return row;
  });
}

function renderDayPanel(dayPayload) {
  setDayDetailsOpen(false);
  elements.dayTitle.textContent = formatDate(dayPayload.date);
  elements.dayTotal.textContent = formatCompactNumber(dayPayload.summary.total_tokens);
  elements.dayTotal.title = formatFullNumber(dayPayload.summary.total_tokens);
  elements.dayCost.textContent = formatUsd(dayPayload.summary.estimated_cost_usd);
  elements.dayCost.title = formatUsd(dayPayload.summary.estimated_cost_usd);
  elements.dayInput.textContent = formatCompactNumber(dayPayload.summary.input_tokens);
  elements.dayCached.textContent = formatCompactNumber(dayPayload.summary.cached_input_tokens);
  elements.dayOutput.textContent = formatCompactNumber(dayPayload.summary.output_tokens);
  elements.dayReasoning.textContent = formatCompactNumber(dayPayload.summary.reasoning_output_tokens);
  elements.daySessions.textContent = formatFullNumber(dayPayload.sessions.length);
  elements.dayCostNote.textContent = buildEstimatedCostNote(dayPayload.summary.unpriced_total_tokens);

  if (!dayPayload.sessions.length) {
    elements.daySessionList.innerHTML = '<div class="empty-state">No workflows contributed usage on this day.</div>';
    return;
  }

  elements.daySessionList.innerHTML = "";
  for (const session of dayPayload.sessions) {
    const card = document.createElement("article");
    card.className = "session-card";
    card.innerHTML = `
      <div class="session-head">
        <div class="session-main">
          <span class="session-title">${formatWorkflowName(session)}</span>
          <span class="session-sub">${formatWorkflowContext(session)}</span>
        </div>
        ${session.is_subagent ? '<span class="session-badge">Helper run</span>' : ""}
      </div>
      <div class="session-metrics">
        <div class="metric-pair"><span>Total</span><strong>${formatFullNumber(session.total_tokens)}</strong></div>
        <div class="metric-pair"><span>Est. cost</span><strong>${formatUsd(session.estimated_cost_usd)}</strong></div>
        <div class="metric-pair"><span>Token share</span><strong>${formatPercent(session.token_share)}</strong></div>
        <div class="metric-pair"><span>Cost share</span><strong>${formatPercent(session.cost_share)}</strong></div>
        <div class="metric-pair"><span>Dominant model</span><strong>${session.dominant_model_family || "Other"}</strong></div>
        <div class="metric-pair"><span>Input / output</span><strong>${session.input_output_ratio !== null ? `${session.input_output_ratio.toFixed(1)}x` : "—"}</strong></div>
        <div class="metric-pair"><span>Input</span><strong>${formatFullNumber(session.input_tokens)}</strong></div>
        <div class="metric-pair"><span>Reused input</span><strong>${formatFullNumber(session.cached_input_tokens)}</strong></div>
        <div class="metric-pair"><span>Output</span><strong>${formatFullNumber(session.output_tokens)}</strong></div>
        <div class="metric-pair"><span>Reasoning</span><strong>${formatFullNumber(session.reasoning_output_tokens)}</strong></div>
        <div class="metric-pair"><span>Started</span><strong>${session.session_started_at ? new Date(session.session_started_at).toLocaleString() : "-"}</strong></div>
      </div>
    `;
    elements.daySessionList.append(card);
  }
}

async function loadDay(date) {
  try {
    const payload = buildDayPayload(state.snapshot, date, {
      days: state.rangeMode === "preset" ? state.days : undefined,
      startDate: state.rangeMode === "custom" ? state.startDate : null,
      endDate: state.rangeMode === "custom" ? state.endDate : null,
      workspace: state.workspace,
      includeSubagents: state.includeSubagents,
      now: state.snapshotNow
    });
    renderDayPanel(payload);
  } catch (error) {
    setDayDetailsOpen(false);
    elements.daySessionList.innerHTML = `<div class="empty-state">${error.message}</div>`;
  }
}

function chooseDefaultDay(dashboard) {
  const activeDays = dashboard.habit_board.days.filter((day) => day.in_range && day.total_tokens > 0);
  return activeDays.at(-1)?.date || dashboard.habit_board.end_date;
}

function syncDatePicker(dashboard) {
  if (!window.flatpickr) {
    return;
  }

  if (!state.datePicker) {
    state.datePicker = window.flatpickr(elements.customRangeInput, {
      mode: "range",
      dateFormat: "Y-m-d",
      monthSelectorType: "static",
      showMonths: 2,
      disableMobile: true,
      clickOpens: false,
      onChange(selectedDates) {
        if (selectedDates.length !== 2) {
          return;
        }

        state.rangeMode = "custom";
        state.startDate = dateKeyFromDate(selectedDates[0]);
        state.endDate = dateKeyFromDate(selectedDates[1]);
        syncUrl();
        renderRangeControls();
        loadDashboard();
        state.datePicker.close();
      }
    });
  }

  if (dashboard) {
    state.datePicker.set("minDate", dashboard.available_range.start_date);
    state.datePicker.set("maxDate", dashboard.available_range.end_date);
  }

  if (state.rangeMode === "custom" && state.startDate && state.endDate) {
    state.datePicker.setDate([state.startDate, state.endDate], false, "Y-m-d");
  } else {
    state.datePicker.clear(false);
  }
}

async function loadDashboard(forceReloadSnapshot = false, { suppressButtonToggle = false } = {}) {
  if (!suppressButtonToggle) {
    elements.refreshButton.disabled = true;
  }
  syncUrl();

  try {
    if (!state.snapshot || forceReloadSnapshot) {
      await loadSnapshot(forceReloadSnapshot);
    }

    const dashboard = buildDashboardPayload(state.snapshot, {
      days: state.rangeMode === "preset" ? state.days : undefined,
      startDate: state.rangeMode === "custom" ? state.startDate : null,
      endDate: state.rangeMode === "custom" ? state.endDate : null,
      workspace: state.workspace,
      includeSubagents: state.includeSubagents,
      now: state.snapshotNow
    });
    const validDates = new Set(dashboard.habit_board.days.filter((day) => day.in_range).map((day) => day.date));
    if (!state.selectedDate || !validDates.has(state.selectedDate)) {
      state.selectedDate = chooseDefaultDay(dashboard);
    }

    state.dashboard = dashboard;
    renderHabitRail(dashboard);
    renderInsightCosts(dashboard);
    renderSummary(dashboard);
    renderWorkspaceFilter(dashboard);
    renderHeatmap(dashboard);
    renderTrend(dashboard);
    renderEfficiencyPanel(dashboard);
    renderCostBreakdown(dashboard);
    renderTopThreads(dashboard);
    syncDatePicker(dashboard);
    await loadDay(state.selectedDate);
  } catch (error) {
    const detail = error?.message?.includes("404")
      ? "No published usage snapshot was found. Run `npm run build:site` locally or publish a fresh snapshot."
      : error.message;
    const message = `<div class="empty-state">${detail}</div>`;
    elements.costBreakdownBody.innerHTML = `<tr><td colspan="10" class="cost-empty">${detail}</td></tr>`;
    elements.costBreakdownFoot.innerHTML = "";
    elements.efficiencyGrid.innerHTML = message;
    elements.modelMixList.innerHTML = message;
    elements.insightList.innerHTML = message;
    elements.threadTable.innerHTML = message;
    elements.daySessionList.innerHTML = message;
    elements.costToday.textContent = "-";
    elements.costTodayFoot.textContent = "-";
    elements.cost14d.textContent = "-";
    elements.cost14dFoot.textContent = "-";
    elements.costMonth.textContent = "-";
    elements.costMonthFoot.textContent = "-";
    elements.habitCurrentStreak.textContent = "-";
    elements.habitCurrentNote.textContent = "-";
    elements.habitBestStreak.textContent = "-";
    elements.habitBestNote.textContent = "-";
    elements.habitWorkweek.textContent = "-";
    elements.habitWorkweekNote.textContent = "-";
    elements.todayStatusHeadline.textContent = detail;
    elements.todayStatusNote.textContent = "A fresh snapshot is required before the momentum view can load.";
    elements.heatmapSummary.textContent = detail;
    elements.heatmapGrid.innerHTML = "";
    elements.heatmapMonths.innerHTML = "";
  } finally {
    if (!suppressButtonToggle) {
      elements.refreshButton.disabled = false;
      syncRefreshButtonMode();
    }
  }
}

async function refreshDashboard() {
  elements.refreshButton.disabled = true;

  try {
    if (isPublicPagesSite()) {
      launchRefreshBridge();
      return;
    }

    if (state.refreshHelperAvailable && state.refreshHelperUrl) {
      await forceRefreshViaHelper();
      return;
    }

    state.shouldResetHeatmapViewport = true;
    await loadDashboard(true, { suppressButtonToggle: true });
  } catch (error) {
    state.refreshHelperAvailable = false;
    state.refreshHelperUrl = null;
    await loadDashboard(true, { suppressButtonToggle: true });
    window.alert(error instanceof Error ? error.message : String(error));
  } finally {
    elements.refreshButton.disabled = false;
    syncRefreshButtonMode();
    probeRefreshHelper();
  }
}

elements.customRangeButton.addEventListener("click", () => {
  syncDatePicker(state.dashboard);
  state.datePicker?.open();
});

elements.workspaceFilter.addEventListener("change", () => {
  state.workspace = elements.workspaceFilter.value;
  state.shouldResetHeatmapViewport = true;
  loadDashboard();
});

elements.subagentToggle.addEventListener("change", () => {
  state.includeSubagents = elements.subagentToggle.checked;
  state.shouldResetHeatmapViewport = true;
  loadDashboard();
});

elements.refreshButton.addEventListener("click", refreshDashboard);
elements.dayDetails.addEventListener("toggle", () => {
  elements.dayDetailsLabel.textContent = elements.dayDetails.open ? "Hide details" : "Expand details";
});

initializeStateFromUrl();
renderRangeControls();
renderWeekdayLabels();
syncDatePicker(null);
setDayDetailsOpen(false);
syncRefreshButtonMode();
loadDashboard(true);
probeRefreshHelper();
window.addEventListener("focus", probeRefreshHelper);
