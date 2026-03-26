const RATE_CARD_PUBLISHED_AT = "2026-03-25";
const RATE_CARD_MODE = "standard";
const CURRENT_WORK_WINDOW_HOURS = 72;
const RATE_CARD = Object.freeze({
  "gpt-5.2-codex": {
    input: 1.75,
    cached_input: 0.175,
    output: 14.0
  },
  "gpt-5.3-codex": {
    input: 1.75,
    cached_input: 0.175,
    output: 14.0
  },
  "gpt-5.4": {
    input: 2.5,
    cached_input: 0.25,
    output: 15.0
  }
});
const RATE_CARD_SOURCES = Object.freeze([
  {
    label: "OpenAI API pricing",
    url: "https://developers.openai.com/api/docs/pricing"
  },
  {
    label: "OpenAI API pricing overview",
    url: "https://openai.com/api/pricing/"
  },
  {
    label: "GPT-5.2-codex model pricing",
    url: "https://developers.openai.com/api/docs/models/gpt-5.2-codex"
  }
]);

function todayDate(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function dateKeyFromDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Invalid date: ${value}`);
  }

  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (dateKeyFromDate(parsed) !== value) {
    throw new Error(`Invalid date: ${value}`);
  }

  return parsed;
}

function emptyTotals() {
  return {
    total_tokens: 0,
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    estimated_cost_usd: 0,
    unpriced_total_tokens: 0
  };
}

function addTotals(target, source) {
  target.total_tokens += source.total_tokens || 0;
  target.input_tokens += source.input_tokens || 0;
  target.cached_input_tokens += source.cached_input_tokens || 0;
  target.output_tokens += source.output_tokens || 0;
  target.reasoning_output_tokens += source.reasoning_output_tokens || 0;
  target.estimated_cost_usd += source.estimated_cost_usd || 0;
  target.unpriced_total_tokens += source.unpriced_total_tokens || 0;
}

function isSnapshotAlias(model, baseModel) {
  return model === baseModel || model.startsWith(`${baseModel}-20`);
}

function canonicalizePricedModel(model) {
  if (!model) {
    return null;
  }

  if (isSnapshotAlias(model, "gpt-5.4")) {
    return "gpt-5.4";
  }

  if (isSnapshotAlias(model, "gpt-5.3-codex")) {
    return "gpt-5.3-codex";
  }

  if (isSnapshotAlias(model, "gpt-5.2-codex")) {
    return "gpt-5.2-codex";
  }

  return null;
}

function estimateCost(totals, model) {
  const pricedModel = canonicalizePricedModel(model);
  const rates = pricedModel ? RATE_CARD[pricedModel] : null;

  if (!rates) {
    return {
      estimated_cost_usd: 0,
      unpriced_total_tokens: totals.total_tokens || 0,
      priced_model: null
    };
  }

  const uncachedInputTokens = Math.max(0, (totals.input_tokens || 0) - (totals.cached_input_tokens || 0));
  const billedOutputTokens = (totals.output_tokens || 0) + (totals.reasoning_output_tokens || 0);
  const estimatedCostUsd =
    ((uncachedInputTokens / 1000000) * rates.input) +
    (((totals.cached_input_tokens || 0) / 1000000) * rates.cached_input) +
    ((billedOutputTokens / 1000000) * rates.output);

  return {
    estimated_cost_usd: estimatedCostUsd,
    unpriced_total_tokens: 0,
    priced_model: pricedModel
  };
}

function priceEvent(event) {
  return {
    ...event,
    ...estimateCost(event, event.model)
  };
}

function buildRateCardPayload() {
  return {
    mode: RATE_CARD_MODE,
    published_at: RATE_CARD_PUBLISHED_AT,
    models: RATE_CARD,
    sources: RATE_CARD_SOURCES
  };
}

function buildCostNote(unpricedTotalTokens) {
  if (unpricedTotalTokens > 0) {
    return `Public-rate equivalent using published OpenAI API pricing as of ${RATE_CARD_PUBLISHED_AT}. Treat it as a rough value proxy, not your billed spend. ${unpricedTotalTokens.toLocaleString("en-US")} tokens in this view did not match a priced model and are excluded.`;
  }

  return `Public-rate equivalent using published OpenAI API pricing as of ${RATE_CARD_PUBLISHED_AT}. Treat it as a rough value proxy, not your billed spend.`;
}

function formatDisplayDate(date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function describePresetRange(days) {
  if (days === "all") {
    return "All time";
  }

  return `Last ${days} days`;
}

function createRange(requested, now = new Date(), earliestDateKey = dateKeyFromDate(todayDate(now))) {
  if (requested.startDate && requested.endDate) {
    const startDate = parseDateKey(requested.startDate);
    const endDate = parseDateKey(requested.endDate);
    return {
      mode: "custom",
      requestedDays: null,
      label: `${formatDisplayDate(startDate)} - ${formatDisplayDate(endDate)}`,
      startDate,
      endDate
    };
  }

  const days = requested.days === "all" ? "all" : Math.max(1, Number(requested.days || 365));
  const endDate = todayDate(now);
  const startDate = days === "all"
    ? parseDateKey(earliestDateKey)
    : addDays(endDate, -(days - 1));

  return {
    mode: "preset",
    requestedDays: days,
    label: describePresetRange(days),
    startDate,
    endDate
  };
}

function buildHeatmapDays(dayMap, range) {
  const alignedStart = addDays(range.startDate, -range.startDate.getDay());
  const alignedEnd = addDays(range.endDate, 6 - range.endDate.getDay());
  let maxTotalTokens = 0;

  for (let cursor = new Date(range.startDate); cursor <= range.endDate; cursor = addDays(cursor, 1)) {
    const date = dateKeyFromDate(cursor);
    const day = dayMap.get(date);
    maxTotalTokens = Math.max(maxTotalTokens, day?.total_tokens || 0);
  }

  const thresholds = [
    maxTotalTokens * 0.25,
    maxTotalTokens * 0.5,
    maxTotalTokens * 0.75,
    maxTotalTokens
  ];

  const days = [];
  const monthLabels = [];
  let weekIndex = 0;

  for (let cursor = new Date(alignedStart); cursor <= alignedEnd; cursor = addDays(cursor, 1)) {
    const date = dateKeyFromDate(cursor);
    const inRange = cursor >= range.startDate && cursor <= range.endDate;
    const aggregate = dayMap.get(date) || emptyTotals();
    const value = inRange ? aggregate.total_tokens : 0;
    let level = 0;

    if (value > 0) {
      if (value <= thresholds[0] || maxTotalTokens === 0) {
        level = 1;
      } else if (value <= thresholds[1]) {
        level = 2;
      } else if (value <= thresholds[2]) {
        level = 3;
      } else {
        level = 4;
      }
    }

    if (cursor.getDay() === 0) {
      weekIndex = Math.floor(days.length / 7);
    }

    if (inRange && cursor.getDate() === 1) {
      monthLabels.push({
        label: cursor.toLocaleString("en-US", { month: "short" }),
        week_index: weekIndex
      });
    }

    days.push({
      date,
      day_of_week: cursor.getDay(),
      week_index: weekIndex,
      in_range: inRange,
      level,
      total_tokens: value,
      input_tokens: inRange ? aggregate.input_tokens || 0 : 0,
      cached_input_tokens: inRange ? aggregate.cached_input_tokens || 0 : 0,
      output_tokens: inRange ? aggregate.output_tokens || 0 : 0,
      reasoning_output_tokens: inRange ? aggregate.reasoning_output_tokens || 0 : 0,
      estimated_cost_usd: inRange ? aggregate.estimated_cost_usd || 0 : 0,
      unpriced_total_tokens: inRange ? aggregate.unpriced_total_tokens || 0 : 0,
      sessions: inRange ? aggregate.sessions || 0 : 0
    });
  }

  return {
    days,
    monthLabels,
    scale: {
      max_total_tokens: maxTotalTokens,
      thresholds
    }
  };
}

function buildSelectionSummary(range) {
  return {
    mode: range.mode,
    label: range.label,
    days: range.requestedDays
  };
}

function buildTrendDays(dayMap, range) {
  const totalDays = Math.round((range.endDate - range.startDate) / 86400000) + 1;
  const trendStart = addDays(range.endDate, -(Math.min(totalDays, 14) - 1));
  const trend = [];

  for (let cursor = new Date(trendStart); cursor <= range.endDate; cursor = addDays(cursor, 1)) {
    const date = dateKeyFromDate(cursor);
    const aggregate = dayMap.get(date) || emptyTotals();
    trend.push({
      date,
      total_tokens: aggregate.total_tokens || 0,
      estimated_cost_usd: aggregate.estimated_cost_usd || 0
    });
  }

  return trend;
}

function filterContributions(index, options) {
  const earliestDate = index.earliest_date || dateKeyFromDate(todayDate());
  const now = options.now ?? new Date();
  const range = createRange({
    days: options.days,
    startDate: options.startDate,
    endDate: options.endDate
  }, now, earliestDate);
  const currentWorkRangeStart = new Date(now.getTime() - (CURRENT_WORK_WINDOW_HOURS * 60 * 60 * 1000));
  const currentWorkRangeEnd = new Date(now);
  const workspace = options.workspace || "all";
  const includeSubagents = options.includeSubagents ?? true;
  const dayMap = new Map();
  const sessionMap = new Map();
  const modelCostMap = new Map();
  const currentWorkSessionMap = new Map();
  const summary = emptyTotals();
  const activeSessionIds = new Set();
  const daySessionKeys = new Set();

  for (const session of index.sessions) {
    if (!includeSubagents && session.is_subagent) {
      continue;
    }
    if (workspace !== "all" && session.workspace_key !== workspace) {
      continue;
    }

    for (const event of session.events) {
      const eventDate = parseDateKey(event.date);
      const eventTimestamp = event.timestamp ? new Date(event.timestamp) : null;
      const isInCurrentWorkWindow =
        eventTimestamp &&
        eventTimestamp >= currentWorkRangeStart &&
        eventTimestamp <= currentWorkRangeEnd;

      if (isInCurrentWorkWindow) {
        if (!currentWorkSessionMap.has(session.session_id)) {
          currentWorkSessionMap.set(session.session_id, {
            session_id: session.session_id,
            thread_name: session.thread_name,
            workspace_key: session.workspace_key,
            workspace_label: session.workspace_label,
            cwd: session.cwd,
            is_subagent: session.is_subagent,
            session_started_at: session.session_started_at,
            last_active_at: null,
            active_days: new Set(),
            ...emptyTotals()
          });
        }

        const currentWorkTotals = currentWorkSessionMap.get(session.session_id);
        const currentWorkPricedEvent = priceEvent(event);
        addTotals(currentWorkTotals, currentWorkPricedEvent);
        currentWorkTotals.active_days.add(event.date);
        if (!currentWorkTotals.last_active_at || event.timestamp > currentWorkTotals.last_active_at) {
          currentWorkTotals.last_active_at = event.timestamp;
        }
      }

      if (eventDate < range.startDate || eventDate > range.endDate) {
        continue;
      }

      const pricedEvent = priceEvent(event);
      activeSessionIds.add(session.session_id);

      if (pricedEvent.priced_model) {
        if (!modelCostMap.has(pricedEvent.priced_model)) {
          modelCostMap.set(pricedEvent.priced_model, {
            model: pricedEvent.priced_model,
            rates: RATE_CARD[pricedEvent.priced_model],
            sessions: new Set(),
            uncached_input_tokens: 0,
            billed_output_tokens: 0,
            ...emptyTotals()
          });
        }

        const modelEntry = modelCostMap.get(pricedEvent.priced_model);
        addTotals(modelEntry, pricedEvent);
        modelEntry.sessions.add(session.session_id);
        modelEntry.uncached_input_tokens += Math.max(
          0,
          (pricedEvent.input_tokens || 0) - (pricedEvent.cached_input_tokens || 0)
        );
        modelEntry.billed_output_tokens +=
          (pricedEvent.output_tokens || 0) + (pricedEvent.reasoning_output_tokens || 0);
      }

      if (!dayMap.has(event.date)) {
        dayMap.set(event.date, { ...emptyTotals(), sessions: 0 });
      }
      const dayTotals = dayMap.get(event.date);
      addTotals(dayTotals, pricedEvent);
      const daySessionKey = `${event.date}:${session.session_id}`;
      if (!daySessionKeys.has(daySessionKey)) {
        daySessionKeys.add(daySessionKey);
        dayTotals.sessions += 1;
      }

      if (!sessionMap.has(session.session_id)) {
        sessionMap.set(session.session_id, {
          session_id: session.session_id,
          thread_name: session.thread_name,
          workspace_key: session.workspace_key,
          workspace_label: session.workspace_label,
          cwd: session.cwd,
          is_subagent: session.is_subagent,
          session_started_at: session.session_started_at,
          active_days: 0,
          ...emptyTotals()
        });
      }
      const sessionTotals = sessionMap.get(session.session_id);
      addTotals(sessionTotals, pricedEvent);

      addTotals(summary, pricedEvent);
    }
  }

  for (const session of index.sessions) {
    if (!sessionMap.has(session.session_id)) {
      continue;
    }
    const sessionTotals = sessionMap.get(session.session_id);
    const dates = new Set();
    for (const event of session.events) {
      if (!dayMap.has(event.date)) {
        continue;
      }
      dates.add(event.date);
    }
    sessionTotals.active_days = dates.size;
  }

  const threads = [...sessionMap.values()]
    .sort((left, right) => right.total_tokens - left.total_tokens)
    .slice(0, 8);
  const currentWorkSessions = [...currentWorkSessionMap.values()]
    .map((entry) => ({
      session_id: entry.session_id,
      thread_name: entry.thread_name,
      workspace_key: entry.workspace_key,
      workspace_label: entry.workspace_label,
      cwd: entry.cwd,
      is_subagent: entry.is_subagent,
      session_started_at: entry.session_started_at,
      last_active_at: entry.last_active_at,
      total_tokens: entry.total_tokens,
      input_tokens: entry.input_tokens,
      cached_input_tokens: entry.cached_input_tokens,
      output_tokens: entry.output_tokens,
      reasoning_output_tokens: entry.reasoning_output_tokens,
      estimated_cost_usd: entry.estimated_cost_usd,
      unpriced_total_tokens: entry.unpriced_total_tokens,
      active_days: entry.active_days.size
    }))
    .sort((left, right) =>
      (right.total_tokens - left.total_tokens) ||
      (right.last_active_at || "").localeCompare(left.last_active_at || "")
    )
    .slice(0, 8);

  const { days, monthLabels, scale } = buildHeatmapDays(dayMap, range);
  const totalEstimatedCost = summary.estimated_cost_usd || 0;
  const costBreakdownByModel = [...modelCostMap.values()]
    .map((entry) => ({
      model: entry.model,
      sessions: entry.sessions.size,
      total_tokens: entry.total_tokens,
      input_tokens: entry.input_tokens,
      uncached_input_tokens: entry.uncached_input_tokens,
      cached_input_tokens: entry.cached_input_tokens,
      output_tokens: entry.output_tokens,
      reasoning_output_tokens: entry.reasoning_output_tokens,
      billed_output_tokens: entry.billed_output_tokens,
      estimated_cost_usd: entry.estimated_cost_usd,
      share_of_total_cost: totalEstimatedCost > 0
        ? entry.estimated_cost_usd / totalEstimatedCost
        : 0,
      rates: entry.rates
    }))
    .sort((left, right) => right.estimated_cost_usd - left.estimated_cost_usd);

  return {
    range,
    selection: buildSelectionSummary(range),
    summary: {
      ...summary,
      cached_share: summary.input_tokens > 0
        ? summary.cached_input_tokens / summary.input_tokens
        : 0,
      active_days: [...dayMap.values()].filter((day) => day.total_tokens > 0).length,
      sessions: activeSessionIds.size,
      credits_spent: null
    },
    heatmap_days: days,
    heatmap_month_labels: monthLabels,
    heatmap_scale: scale,
    current_work_range: {
      start_at: currentWorkRangeStart.toISOString(),
      end_at: currentWorkRangeEnd.toISOString(),
      hours: CURRENT_WORK_WINDOW_HOURS
    },
    current_work_sessions: currentWorkSessions,
    top_threads: threads,
    cost_breakdown_by_model: costBreakdownByModel,
    trend_days: buildTrendDays(dayMap, range),
    day_map: dayMap,
    session_map: sessionMap
  };
}

export function buildDashboardPayload(index, options = {}) {
  const now = options.now ?? new Date();
  const filtered = filterContributions(index, {
    days: options.days ?? 365,
    startDate: options.startDate ?? null,
    endDate: options.endDate ?? null,
    workspace: options.workspace ?? "all",
    includeSubagents: options.includeSubagents ?? true,
    now
  });
  const availableRangeStartDate = index.earliest_date || dateKeyFromDate(todayDate(now));
  const availableRangeEndDate = dateKeyFromDate(todayDate(now));

  return {
    generated_at: index.generated_at,
    timezone: index.timezone,
    credits_mode: "none",
    credits_spent: null,
    credits_note: "Local Codex session logs expose exact tokens but not exact billed credits.",
    cost_mode: "estimated",
    estimated_cost_note: buildCostNote(filtered.summary.unpriced_total_tokens),
    rate_card: buildRateCardPayload(),
    range: {
      days: filtered.range.requestedDays,
      start_date: dateKeyFromDate(filtered.range.startDate),
      end_date: dateKeyFromDate(filtered.range.endDate)
    },
    available_range: {
      start_date: availableRangeStartDate,
      end_date: availableRangeEndDate
    },
    selection: filtered.selection,
    filters: {
      workspace: options.workspace ?? "all",
      include_subagents: options.includeSubagents ?? true
    },
    summary: filtered.summary,
    workspaces: index.workspaces,
    heatmap_days: filtered.heatmap_days,
    heatmap_month_labels: filtered.heatmap_month_labels,
    heatmap_scale: filtered.heatmap_scale,
    current_work_range: filtered.current_work_range,
    current_work_sessions: filtered.current_work_sessions,
    trend_days: filtered.trend_days,
    cost_breakdown_by_model: filtered.cost_breakdown_by_model,
    top_threads: filtered.top_threads,
    source: index.source
  };
}

export function buildDayPayload(index, date, options = {}) {
  const requestedDate = parseDateKey(date);
  const now = options.now ?? new Date();
  const filtered = filterContributions(index, {
    days: options.days ?? 365,
    startDate: options.startDate ?? null,
    endDate: options.endDate ?? null,
    workspace: options.workspace ?? "all",
    includeSubagents: options.includeSubagents ?? true,
    now
  });
  const dateKey = dateKeyFromDate(requestedDate);
  const dayTotals = filtered.day_map.get(dateKey) || { ...emptyTotals(), sessions: 0 };
  const sessions = [];

  for (const session of index.sessions) {
    if (!filtered.session_map.has(session.session_id)) {
      continue;
    }

    const totals = emptyTotals();
    for (const event of session.events) {
      if (event.date !== dateKey) {
        continue;
      }
      addTotals(totals, priceEvent(event));
    }

    if (totals.total_tokens <= 0) {
      continue;
    }

    sessions.push({
      session_id: session.session_id,
      thread_name: session.thread_name,
      workspace_key: session.workspace_key,
      workspace_label: session.workspace_label,
      cwd: session.cwd,
      is_subagent: session.is_subagent,
      session_started_at: session.session_started_at,
      ...totals
    });
  }

  sessions.sort((left, right) => right.total_tokens - left.total_tokens);

  return {
    date: dateKey,
    credits_mode: "none",
    credits_spent: null,
    summary: {
      ...dayTotals,
      cached_share: dayTotals.input_tokens > 0
        ? dayTotals.cached_input_tokens / dayTotals.input_tokens
        : 0
    },
    available_range: {
      start_date: index.earliest_date || dateKeyFromDate(todayDate(now)),
      end_date: dateKeyFromDate(todayDate(now))
    },
    selection: filtered.selection,
    cost_mode: "estimated",
    estimated_cost_note: buildCostNote(dayTotals.unpriced_total_tokens),
    rate_card: buildRateCardPayload(),
    sessions
  };
}
