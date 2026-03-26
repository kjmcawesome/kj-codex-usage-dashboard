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

const DEFAULT_DAYS = 365;
const WEEKDAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

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
  shouldResetHeatmapViewport: true
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
  summaryPeak: document.querySelector("#summary-peak"),
  summaryPeakFoot: document.querySelector("#summary-peak-foot"),
  summaryDays: document.querySelector("#summary-days"),
  summarySessions: document.querySelector("#summary-sessions"),
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
  trendSparkline: document.querySelector("#trend-sparkline"),
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

function buildPeakDaySummary(dashboard) {
  const peakDay = dashboard.heatmap_days
    .filter((day) => day.in_range)
    .reduce((peak, day) => {
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

  if (!peakDay || peakDay.total_tokens <= 0) {
    return {
      value: "0",
      title: "0",
      foot: "No token activity in this range"
    };
  }

  return {
    value: formatCompactNumber(peakDay.total_tokens),
    title: formatFullNumber(peakDay.total_tokens),
    foot: `${formatDate(peakDay.date)} · ${formatUsd(peakDay.estimated_cost_usd)} API equiv.`
  };
}

function buildCurrentBurstSummary(dashboard) {
  const totals = (dashboard.current_work_sessions || []).reduce((accumulator, session) => {
    accumulator.total_tokens += session.total_tokens || 0;
    accumulator.estimated_cost_usd += session.estimated_cost_usd || 0;
    return accumulator;
  }, {
    total_tokens: 0,
    estimated_cost_usd: 0
  });

  const sessionCount = dashboard.current_work_sessions?.length || 0;
  if (totals.total_tokens <= 0) {
    return {
      value: "0",
      title: "0",
      foot: "No session activity in the last 72 hours"
    };
  }

  return {
    value: formatCompactNumber(totals.total_tokens),
    title: formatFullNumber(totals.total_tokens),
    foot: `Last 72 hours · ${formatCountLabel(sessionCount, "session")} · ${formatUsd(totals.estimated_cost_usd)} API equiv.`
  };
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

function renderSummary(dashboard) {
  const peakDay = buildPeakDaySummary(dashboard);
  const currentBurst = buildCurrentBurstSummary(dashboard);
  elements.lastRefresh.textContent = new Date(dashboard.generated_at).toLocaleString();
  elements.sourceNote.textContent = `${dashboard.source.log_files} logs · ${dashboard.timezone} snapshot`;
  elements.summaryTotal.textContent = formatCompactNumber(dashboard.summary.total_tokens);
  elements.summaryTotal.title = formatFullNumber(dashboard.summary.total_tokens);
  elements.summaryTotalFoot.textContent = `${formatDate(dashboard.range.start_date)} to ${formatDate(dashboard.range.end_date)}`;
  elements.summaryCost.textContent = formatUsd(dashboard.summary.estimated_cost_usd);
  elements.summaryCost.title = formatUsd(dashboard.summary.estimated_cost_usd);
  elements.summaryCostFoot.textContent = `Standard public rates · published ${formatDate(dashboard.rate_card.published_at)}`;
  elements.summaryPeak.textContent = peakDay.value;
  elements.summaryPeak.title = peakDay.title;
  elements.summaryPeakFoot.textContent = peakDay.foot;
  elements.summaryDays.textContent = formatFullNumber(dashboard.summary.active_days);
  elements.summarySessions.textContent = formatFullNumber(dashboard.summary.sessions);
  elements.summaryBurst.textContent = currentBurst.value;
  elements.summaryBurst.title = currentBurst.title;
  elements.summaryBurstFoot.textContent = currentBurst.foot;
  elements.costNote.textContent = dashboard.estimated_cost_note;
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
      return `${formatFullNumber(dashboard.summary.total_tokens)} total tokens across all time`;
    }

    return `${formatFullNumber(dashboard.summary.total_tokens)} total tokens in the last ${dashboard.selection.days} days`;
  }

  return `${formatFullNumber(dashboard.summary.total_tokens)} total tokens from ${formatDate(dashboard.range.start_date)} to ${formatDate(dashboard.range.end_date)}`;
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
    if (state.selectedDate === day.date) {
      button.classList.add("is-selected");
    }
    button.title = `${formatDate(day.date)}\n${formatFullNumber(day.total_tokens)} total tokens\n${formatUsd(day.estimated_cost_usd)} API equivalent`;
    button.setAttribute(
      "aria-label",
      `${formatDate(day.date)}: ${formatFullNumber(day.total_tokens)} total tokens and ${formatUsd(day.estimated_cost_usd)} public API equivalent`
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
  const trendCost = costValues.reduce((total, value) => total + value, 0);
  const width = 560;
  const height = 220;
  const margin = {
    top: 18,
    right: 62,
    bottom: 34,
    left: 58
  };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxTokens = Math.max(...tokenValues, 0);
  const maxCost = Math.max(...costValues, 0);
  const tokenScaleMax = maxTokens || 1;
  const costScaleMax = maxCost || 1;

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
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="14 day token and API equivalent trend">
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
        <rect
          class="trend-bar"
          x="${point.barX}"
          y="${point.barY}"
          width="${point.barWidth}"
          height="${Math.max(point.costHeight, 1)}"
          rx="4"
        >
          <title>${formatTrendDate(point.date)}: ${formatUsd(point.costValue)} API equivalent</title>
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
      <span class="trend-legend-item"><span class="trend-legend-bar"></span>API equiv. / day</span>
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
  elements.currentWorkNote.textContent = `Most active sessions over the last ${windowHours} hours`;

  renderRankRows(elements.currentWorkTable, dashboard.current_work_sessions, (session) => {
    const row = document.createElement("div");
    row.className = "rank-row";
    const badge = session.is_subagent ? " · subagent" : "";
    row.innerHTML = `
      <div class="rank-main">
        <span class="rank-title">${session.thread_name || session.session_id}</span>
        <span class="rank-sub">${session.workspace_label}${badge} · ${formatCountLabel(session.active_days, "active day")}</span>
      </div>
      <div class="rank-metrics">
        <span class="rank-value">${formatUsd(session.estimated_cost_usd)}</span>
        <span class="rank-value-sub">${formatCompactNumber(session.total_tokens)} tokens</span>
      </div>
    `;
    row.title = `${session.thread_name || session.session_id}: ${formatFullNumber(session.total_tokens)} total tokens in the last ${windowHours} hours · ${formatUsd(session.estimated_cost_usd)} public API equivalent`;
    return row;
  });
}

function renderTopThreads(dashboard) {
  renderRankRows(elements.threadTable, dashboard.top_threads, (thread) => {
    const row = document.createElement("div");
    row.className = "rank-row";
    const badge = thread.is_subagent ? " · subagent" : "";
    row.innerHTML = `
      <div class="rank-main">
        <span class="rank-title">${thread.thread_name || thread.session_id}</span>
        <span class="rank-sub">${thread.workspace_label}${badge}</span>
      </div>
      <div class="rank-metrics">
        <span class="rank-value">${formatUsd(thread.estimated_cost_usd)}</span>
        <span class="rank-value-sub">${formatCompactNumber(thread.total_tokens)} tokens</span>
      </div>
    `;
    row.title = `${thread.thread_name || thread.session_id}: ${formatFullNumber(thread.total_tokens)} total tokens · ${formatUsd(thread.estimated_cost_usd)} public API equivalent`;
    return row;
  });
}

function renderDayPanel(dayPayload) {
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
  elements.dayCostNote.textContent = dayPayload.estimated_cost_note;

  if (!dayPayload.sessions.length) {
    elements.daySessionList.innerHTML = '<div class="empty-state">No sessions contributed tokens on this day.</div>';
    return;
  }

  elements.daySessionList.innerHTML = "";
  for (const session of dayPayload.sessions) {
    const card = document.createElement("article");
    card.className = "session-card";
    card.innerHTML = `
      <div class="session-head">
        <div class="session-main">
          <span class="session-title">${session.thread_name || session.session_id}</span>
          <span class="session-sub">${session.workspace_label} · ${session.cwd || "Unknown cwd"}</span>
        </div>
        ${session.is_subagent ? '<span class="session-badge">Subagent</span>' : ""}
      </div>
      <div class="session-metrics">
        <div class="metric-pair"><span>Total</span><strong>${formatFullNumber(session.total_tokens)}</strong></div>
        <div class="metric-pair"><span>API equiv.</span><strong>${formatUsd(session.estimated_cost_usd)}</strong></div>
        <div class="metric-pair"><span>Input</span><strong>${formatFullNumber(session.input_tokens)}</strong></div>
        <div class="metric-pair"><span>Cached</span><strong>${formatFullNumber(session.cached_input_tokens)}</strong></div>
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

async function loadDashboard(forceReloadSnapshot = false) {
  elements.refreshButton.disabled = true;
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
    renderSummary(dashboard);
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
    elements.heatmapSummary.textContent = detail;
    elements.heatmapGrid.innerHTML = "";
    elements.heatmapMonths.innerHTML = "";
  } finally {
    elements.refreshButton.disabled = false;
  }
}

async function refreshDashboard() {
  state.shouldResetHeatmapViewport = true;
  await loadDashboard(true);
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

initializeStateFromUrl();
renderRangeControls();
renderWeekdayLabels();
syncDatePicker(null);
loadDashboard(true);
