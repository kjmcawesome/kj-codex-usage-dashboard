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
  trendSparkline: document.querySelector("#trend-sparkline"),
  trendTokens: document.querySelector("#trend-tokens"),
  trendCost: document.querySelector("#trend-cost"),
  currentWorkNote: document.querySelector("#current-work-note"),
  currentWorkTable: document.querySelector("#current-work-table"),
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

function formatTrendDate(value) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric"
  });
}

function buildEstimatedCostNote(unpricedTotalTokens) {
  if (unpricedTotalTokens > 0) {
    return `Estimated cost uses published OpenAI API pricing as a directional planning lens, not billed spend. ${formatFullNumber(unpricedTotalTokens)} tokens in this view did not match a priced model.`;
  }

  return "Estimated cost uses published OpenAI API pricing as a directional planning lens, not billed spend.";
}

function findRangeDay(dashboard, dateKey) {
  return dashboard.heatmap_days.find((day) => day.in_range && day.date === dateKey) || null;
}

function findPeakDay(days) {
  return days.reduce((peak, day) => {
    if (!peak) {
      return day;
    }
    if (day.total_tokens > peak.total_tokens) {
      return day;
    }
    if (day.total_tokens === peak.total_tokens && day.date > peak.date) {
      return day;
    }
    return peak;
  }, null);
}

function computeCurrentStreak(lifetimeDashboard, todayKey) {
  const inRangeDays = lifetimeDashboard.heatmap_days
    .filter((day) => day.in_range && day.date <= todayKey)
    .sort((left, right) => left.date.localeCompare(right.date));
  let count = 0;
  let startDate = null;

  for (let index = inRangeDays.length - 1; index >= 0; index -= 1) {
    const day = inRangeDays[index];
    if ((day.total_tokens || 0) <= 0) {
      break;
    }
    count += 1;
    startDate = day.date;
  }

  return {
    count,
    startDate
  };
}

function buildLifetimeDashboard() {
  return buildDashboardPayload(state.snapshot, {
    workspace: state.workspace,
    includeSubagents: state.includeSubagents,
    now: state.snapshotNow,
    days: "all"
  });
}

function buildMomentumMetrics(lifetimeDashboard) {
  const today = new Date(state.snapshotNow);
  const todayKey = dateKeyFromDate(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const todayDay = findRangeDay(lifetimeDashboard, todayKey) || {
    date: todayKey,
    total_tokens: 0,
    estimated_cost_usd: 0
  };
  const streak = computeCurrentStreak(lifetimeDashboard, todayKey);

  return {
    today: {
      date: todayKey,
      total_tokens: todayDay.total_tokens || 0,
      estimated_cost_usd: todayDay.estimated_cost_usd || 0,
      has_usage: (todayDay.total_tokens || 0) > 0
    },
    streak
  };
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

function buildTrendLabelIndexes(length) {
  if (length <= 0) {
    return [];
  }

  if (length <= 3) {
    return [...Array(length).keys()];
  }

  return [...new Set([
    0,
    Math.floor((length - 1) / 2),
    length - 1
  ])];
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
      state.shouldResetHeatmapViewport = true;
      syncUrl();
      syncDatePicker(null);
      renderRangeControls();
      loadDashboard();
    });
    elements.rangeChips.append(button);
  }

  elements.customRangeButton.classList.toggle("is-active", state.rangeMode === "custom");
}

function renderHeroMomentum(momentum) {
  const todayStatusLabel = momentum.today.has_usage ? "Green today" : "No usage yet today";
  elements.todayStatusPill.textContent = todayStatusLabel;
  elements.todayStatusPill.classList.toggle("is-live", momentum.today.has_usage);
  elements.todayStatusPill.classList.toggle("is-idle", !momentum.today.has_usage);

  if (momentum.today.has_usage) {
    elements.todayStatusHeadline.textContent = `${formatCompactNumber(momentum.today.total_tokens)} tokens so far today`;
    elements.todayStatusNote.textContent = `${formatCompactUsd(momentum.today.estimated_cost_usd)} estimated cost today${momentum.streak.count > 0 ? ` · ${formatCountLabel(momentum.streak.count, "day")} streak alive` : ""}`;
  } else {
    elements.todayStatusHeadline.textContent = "Today’s square is still open";
    elements.todayStatusNote.textContent = "No usage yet today. One more workflow keeps the streak alive.";
  }
}

function renderSummary(dashboard, momentum) {
  elements.lastRefresh.textContent = new Date(dashboard.generated_at).toLocaleString();
  elements.sourceNote.textContent = dashboard.selection.label;
  elements.summaryTotal.textContent = formatCompactNumber(dashboard.summary.total_tokens);
  elements.summaryTotal.title = formatFullNumber(dashboard.summary.total_tokens);
  elements.summaryTotalFoot.textContent = `${dashboard.selection.label} · ${formatCountLabel(dashboard.summary.active_days, "active day")}`;
  elements.summaryCost.textContent = formatUsd(dashboard.summary.estimated_cost_usd);
  elements.summaryCost.title = formatUsd(dashboard.summary.estimated_cost_usd);
  elements.summaryCostFoot.textContent = `${formatCountLabel(dashboard.summary.sessions, "workflow")} in range`;
  elements.summaryDays.textContent = formatFullNumber(momentum.streak.count);
  elements.summaryDaysFoot.textContent = momentum.streak.startDate
    ? `Live since ${formatDate(momentum.streak.startDate)}`
    : "No streak until today turns green";
  elements.summaryBurst.textContent = formatCompactNumber(momentum.today.total_tokens);
  elements.summaryBurst.title = formatFullNumber(momentum.today.total_tokens);
  elements.summaryBurstFoot.textContent = momentum.today.has_usage
    ? `Green today · ${formatCompactUsd(momentum.today.estimated_cost_usd)} estimated cost`
    : "No usage yet today";
  elements.costNote.textContent = buildEstimatedCostNote(dashboard.summary.unpriced_total_tokens);
  updateRangeSelectionLabel(dashboard.selection.label);
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
  if (dashboard.selection.mode === "preset") {
    if (dashboard.selection.days === "all") {
      return `${formatFullNumber(dashboard.summary.total_tokens)} tokens across all time`;
    }

    return `${formatFullNumber(dashboard.summary.total_tokens)} tokens across the last ${dashboard.selection.days} days`;
  }

  return `${formatFullNumber(dashboard.summary.total_tokens)} tokens from ${formatDate(dashboard.range.start_date)} to ${formatDate(dashboard.range.end_date)}`;
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
  const weekWidth = 18;
  const totalWeeks = (dashboard.heatmap_days.at(-1)?.week_index || 0) + 1;
  const todayKey = state.snapshotNow ? dateKeyFromDate(state.snapshotNow) : null;

  elements.heatmapSummary.textContent = buildHeatmapHeadline(dashboard);
  elements.heatmapMonths.innerHTML = "";
  elements.heatmapGrid.innerHTML = "";
  elements.heatmapMonths.style.width = `${Math.max(weekWidth * totalWeeks, 120)}px`;

  for (const label of dashboard.heatmap_month_labels) {
    const span = document.createElement("span");
    span.className = "month-label";
    span.style.left = `${label.week_index * weekWidth}px`;
    span.textContent = label.label;
    elements.heatmapMonths.append(span);
  }

  for (const day of dashboard.heatmap_days) {
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
  const tokenValues = trendDays.map((day) => day.total_tokens || 0);
  const costValues = trendDays.map((day) => day.estimated_cost_usd || 0);
  const trendTokens = tokenValues.reduce((total, value) => total + value, 0);
  const trendCost = costValues.reduce((total, value) => total + value, 0);
  const width = 520;
  const height = 240;
  const margin = {
    top: 14,
    right: 54,
    bottom: 30,
    left: 50
  };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxTokens = Math.max(...tokenValues, 0);
  const maxCost = Math.max(...costValues, 0);
  const tokenScaleMax = maxTokens || 1;
  const costScaleMax = maxCost || 1;

  elements.trendTokens.textContent = formatCompactNumber(trendTokens);
  elements.trendTokens.title = formatFullNumber(trendTokens);
  elements.trendCost.textContent = formatUsd(trendCost);
  elements.trendCost.title = formatUsd(trendCost);

  if (!trendDays.length) {
    elements.trendSparkline.innerHTML = '<div class="empty-state">No trend data for this range.</div>';
    return;
  }

  const tickRatios = [1, 0.5, 0];
  const tokenTicks = tickRatios.map((ratio) => tokenScaleMax * ratio);
  const costTicks = tickRatios.map((ratio) => costScaleMax * ratio);

  const chartPoints = trendDays.map((day, index) => {
    const x = trendDays.length === 1
      ? margin.left + (plotWidth / 2)
      : margin.left + ((index / (trendDays.length - 1)) * plotWidth);
    const tokenY = margin.top + plotHeight - ((day.total_tokens || 0) / tokenScaleMax) * plotHeight;
    const costHeight = ((day.estimated_cost_usd || 0) / costScaleMax) * plotHeight;
    const barWidth = Math.min(24, plotWidth / Math.max(trendDays.length, 1) * 0.58);
    const barX = x - (barWidth / 2);
    const barY = margin.top + plotHeight - costHeight;

    return {
      date: day.date,
      x,
      tokenY,
      tokenValue: day.total_tokens || 0,
      costValue: day.estimated_cost_usd || 0,
      barWidth,
      barX,
      barY,
      costHeight
    };
  });

  const linePoints = chartPoints.map((point) => `${point.x},${point.tokenY}`);
  const xLabelIndexes = buildTrendLabelIndexes(trendDays.length);

  elements.trendSparkline.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="14 day token and estimated cost trend">
      ${tokenTicks.map((tickValue, index) => {
        const y = margin.top + (plotHeight * (index / (tokenTicks.length - 1)));
        const matchingCost = costTicks[index];
        return `
          <line class="trend-grid-line" x1="${margin.left}" y1="${y}" x2="${margin.left + plotWidth}" y2="${y}"></line>
          <text class="trend-axis-label" x="${margin.left - 10}" y="${y + 4}">${formatAxisTokens(tickValue)}</text>
          <text class="trend-axis-label is-right" x="${width - 6}" y="${y + 4}">${formatAxisUsd(matchingCost)}</text>
        `;
      }).join("")}
      <line class="trend-axis-line" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotHeight}"></line>
      <line class="trend-axis-line" x1="${margin.left + plotWidth}" y1="${margin.top}" x2="${margin.left + plotWidth}" y2="${margin.top + plotHeight}"></line>
      <line class="trend-axis-line" x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${margin.left + plotWidth}" y2="${margin.top + plotHeight}"></line>
      ${chartPoints.map((point) => `
        <rect class="trend-bar" x="${point.barX}" y="${point.barY}" width="${point.barWidth}" height="${Math.max(point.costHeight, 1)}" rx="4">
          <title>${formatTrendDate(point.date)}: ${formatUsd(point.costValue)} estimated cost</title>
        </rect>
      `).join("")}
      <polyline class="sparkline-line" points="${linePoints.join(" ")}"></polyline>
      ${chartPoints.map((point) => `
        <circle class="trend-point" cx="${point.x}" cy="${point.tokenY}" r="3.8">
          <title>${formatTrendDate(point.date)}: ${formatFullNumber(point.tokenValue)} tokens</title>
        </circle>
      `).join("")}
      ${xLabelIndexes.map((index) => {
        const point = chartPoints[index];
        return `
          <text class="trend-axis-label is-x" x="${point.x}" y="${height - 8}">${formatTrendDate(point.date)}</text>
        `;
      }).join("")}
    </svg>
    <div class="trend-legend" aria-hidden="true">
      <span class="trend-legend-item"><span class="trend-legend-line"></span>Tokens / day</span>
      <span class="trend-legend-item"><span class="trend-legend-bar"></span>Est. cost / day</span>
    </div>
  `;
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

function renderCurrentWork(dashboard) {
  const currentWorkRange = dashboard.current_work_range;
  const windowHours = currentWorkRange?.hours || 72;
  elements.currentWorkNote.textContent = `Most-used workflows over the last ${windowHours} hours`;

  renderRankRows(elements.currentWorkTable, dashboard.current_work_sessions, (session) => {
    const row = document.createElement("div");
    row.className = "rank-row";
    row.innerHTML = `
      <div class="rank-main">
        <span class="rank-title">${formatWorkflowName(session)}</span>
        <span class="rank-sub">${formatWorkflowContext(session)} · ${formatCountLabel(session.active_days, "active day")}</span>
      </div>
      <div class="rank-metrics">
        <span class="rank-value">${formatUsd(session.estimated_cost_usd)}</span>
        <span class="rank-value-sub">${formatCompactNumber(session.total_tokens)} tokens</span>
      </div>
    `;
    row.title = `${formatWorkflowName(session)}: ${formatFullNumber(session.total_tokens)} total tokens in the last ${windowHours} hours · ${formatUsd(session.estimated_cost_usd)} estimated cost`;
    return row;
  });
}

function renderTopThreads(dashboard) {
  renderRankRows(elements.threadTable, dashboard.top_threads, (thread) => {
    const row = document.createElement("div");
    row.className = "rank-row";
    row.innerHTML = `
      <div class="rank-main">
        <span class="rank-title">${formatWorkflowName(thread)}</span>
        <span class="rank-sub">${formatWorkflowContext(thread)}</span>
      </div>
      <div class="rank-metrics">
        <span class="rank-value">${formatUsd(thread.estimated_cost_usd)}</span>
        <span class="rank-value-sub">${formatCompactNumber(thread.total_tokens)} tokens</span>
      </div>
    `;
    row.title = `${formatWorkflowName(thread)}: ${formatFullNumber(thread.total_tokens)} total tokens · ${formatUsd(thread.estimated_cost_usd)} estimated cost`;
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
  const activeDays = dashboard.heatmap_days.filter((day) => day.in_range && day.total_tokens > 0);
  return activeDays.at(-1)?.date || dashboard.range.end_date;
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
        state.shouldResetHeatmapViewport = true;
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
    const validDates = new Set(dashboard.heatmap_days.filter((day) => day.in_range).map((day) => day.date));
    if (!state.selectedDate || !validDates.has(state.selectedDate)) {
      state.selectedDate = chooseDefaultDay(dashboard);
    }

    state.dashboard = dashboard;
    const lifetimeDashboard = buildLifetimeDashboard();
    const momentum = buildMomentumMetrics(lifetimeDashboard);
    renderHeroMomentum(momentum);
    renderSummary(dashboard, momentum);
    renderWorkspaceFilter(dashboard);
    renderHeatmap(dashboard);
    renderTrend(dashboard);
    renderCostBreakdown(dashboard);
    renderCurrentWork(dashboard);
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
    elements.currentWorkTable.innerHTML = message;
    elements.threadTable.innerHTML = message;
    elements.daySessionList.innerHTML = message;
    elements.trendTokens.textContent = "-";
    elements.trendCost.textContent = "-";
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
