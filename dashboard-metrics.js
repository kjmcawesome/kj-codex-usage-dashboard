const RATE_CARD_PUBLISHED_AT = "2026-05-02";
const RATE_CARD_MODE = "codex_credits";
const CURRENT_WORK_WINDOW_HOURS = 72;
const PROXY_PRICED_MODEL = "gpt-5.4 estimate";
const MODEL_ALIASES = Object.freeze({
  arcanine: "gpt-5.5",
  "codex-auto-review": "gpt-5.3-codex"
});
const RATE_CARD = Object.freeze({
  "gpt-5.5": {
    input: 125.0,
    cached_input: 12.5,
    output: 750.0
  },
  "gpt-5.2": {
    input: 43.75,
    cached_input: 4.375,
    output: 350.0
  },
  "gpt-5.2-codex": {
    input: 43.75,
    cached_input: 4.375,
    output: 350.0
  },
  "gpt-5.3-codex": {
    input: 43.75,
    cached_input: 4.375,
    output: 350.0
  },
  "gpt-5.4": {
    input: 62.5,
    cached_input: 6.25,
    output: 375.0
  },
  "gpt-5.4-mini": {
    input: 18.75,
    cached_input: 1.875,
    output: 113.0
  },
  [PROXY_PRICED_MODEL]: {
    input: 62.5,
    cached_input: 6.25,
    output: 375.0
  }
});
const RATE_CARD_SOURCES = Object.freeze([
  {
    label: "Codex rate card",
    url: "https://help.openai.com/en/articles/20001106-codex-rate-card"
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
  return model === baseModel
    || model.startsWith(`${baseModel}-20`)
    || model.startsWith(`${baseModel}-`);
}

function canonicalizePricedModel(model) {
  if (!model) {
    return null;
  }

  const explicitAlias = MODEL_ALIASES[model];
  if (explicitAlias) {
    return explicitAlias;
  }

  if (isSnapshotAlias(model, "gpt-5.5")) {
    return "gpt-5.5";
  }

  if (isSnapshotAlias(model, "gpt-5.4-mini")) {
    return "gpt-5.4-mini";
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

  if (isSnapshotAlias(model, "gpt-5.2")) {
    return "gpt-5.2";
  }

  return null;
}

function estimateCost(totals, model) {
  const canonicalPricedModel = canonicalizePricedModel(model);
  const pricedModel = canonicalPricedModel || PROXY_PRICED_MODEL;
  const rates = RATE_CARD[pricedModel];

  const uncachedInputTokens = Math.max(0, (totals.input_tokens || 0) - (totals.cached_input_tokens || 0));
  const billedOutputTokens = (totals.output_tokens || 0) + (totals.reasoning_output_tokens || 0);
  const estimatedCostUsd =
    ((uncachedInputTokens / 1000000) * rates.input) +
    (((totals.cached_input_tokens || 0) / 1000000) * rates.cached_input) +
    ((billedOutputTokens / 1000000) * rates.output);

  return {
    estimated_cost_usd: estimatedCostUsd,
    unpriced_total_tokens: canonicalPricedModel ? 0 : (totals.total_tokens || 0),
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
    return `Estimated credits use the Codex token-based rate card as of ${RATE_CARD_PUBLISHED_AT}. Treat this as a directional planning lens, not billed spend. ${unpricedTotalTokens.toLocaleString("en-US")} tokens in this view used the ${PROXY_PRICED_MODEL} proxy rate because their log model did not match a direct rate-card entry.`;
  }

  return `Estimated credits use the Codex token-based rate card as of ${RATE_CARD_PUBLISHED_AT}. Treat this as a directional planning lens, not billed spend.`;
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

function createHabitBoardRange(now = new Date()) {
  const endDate = todayDate(now);
  const startDate = addDays(endDate, -364);

  return {
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

function buildHabitMetrics(dayMap, range, now = new Date()) {
  function sumWindowTotals(startDate, endDate) {
    const totals = emptyTotals();
    for (let cursor = new Date(startDate); cursor <= endDate; cursor = addDays(cursor, 1)) {
      addTotals(totals, dayMap.get(dateKeyFromDate(cursor)) || emptyTotals());
    }
    return totals;
  }

  const today = todayDate(now);
  const todayKey = dateKeyFromDate(today);
  const todayTotals = dayMap.get(todayKey) || emptyTotals();
  const trailingFourteenStart = addDays(today, -13);
  const trailingSevenStart = addDays(today, -6);
  const previousSevenStart = addDays(today, -13);
  const previousSevenEnd = addDays(today, -7);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const previousMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const previousMonthLastDay = new Date(today.getFullYear(), today.getMonth(), 0);
  const previousMonthComparableDay = Math.min(today.getDate(), previousMonthLastDay.getDate());
  const previousMonthComparableEnd = new Date(
    previousMonthStart.getFullYear(),
    previousMonthStart.getMonth(),
    previousMonthComparableDay
  );
  const trailingFourteenTotals = sumWindowTotals(trailingFourteenStart, today);
  const trailingSevenTotals = sumWindowTotals(trailingSevenStart, today);
  const previousSevenTotals = sumWindowTotals(previousSevenStart, previousSevenEnd);
  const monthToDateTotals = sumWindowTotals(monthStart, today);
  const previousMonthComparableTotals = sumWindowTotals(previousMonthStart, previousMonthComparableEnd);
  let currentStreak = 0;
  let bestStreak = 0;
  let runningStreak = 0;

  for (let cursor = new Date(range.endDate); cursor >= range.startDate; cursor = addDays(cursor, -1)) {
    const totals = dayMap.get(dateKeyFromDate(cursor));
    if ((totals?.total_tokens || 0) <= 0) {
      break;
    }
    currentStreak += 1;
  }

  for (let cursor = new Date(range.startDate); cursor <= range.endDate; cursor = addDays(cursor, 1)) {
    const totals = dayMap.get(dateKeyFromDate(cursor));
    if ((totals?.total_tokens || 0) > 0) {
      runningStreak += 1;
      bestStreak = Math.max(bestStreak, runningStreak);
    } else {
      runningStreak = 0;
    }
  }

  const mondayOffset = (today.getDay() + 6) % 7;
  const workweekStart = addDays(today, -mondayOffset);
  let workweekGreenDays = 0;

  for (let index = 0; index < 5; index += 1) {
    const dateKey = dateKeyFromDate(addDays(workweekStart, index));
    if ((dayMap.get(dateKey)?.total_tokens || 0) > 0) {
      workweekGreenDays += 1;
    }
  }

  return {
    today_has_usage: (todayTotals.total_tokens || 0) > 0,
    today_tokens: todayTotals.total_tokens || 0,
    today_estimated_cost_usd: todayTotals.estimated_cost_usd || 0,
    last_14_days_tokens: trailingFourteenTotals.total_tokens || 0,
    last_14_days_estimated_cost_usd: trailingFourteenTotals.estimated_cost_usd || 0,
    last_7_days_tokens: trailingSevenTotals.total_tokens || 0,
    last_7_days_estimated_cost_usd: trailingSevenTotals.estimated_cost_usd || 0,
    previous_7_days_tokens: previousSevenTotals.total_tokens || 0,
    previous_7_days_estimated_cost_usd: previousSevenTotals.estimated_cost_usd || 0,
    month_to_date_tokens: monthToDateTotals.total_tokens || 0,
    month_to_date_estimated_cost_usd: monthToDateTotals.estimated_cost_usd || 0,
    previous_month_comparable_tokens: previousMonthComparableTotals.total_tokens || 0,
    previous_month_comparable_estimated_cost_usd: previousMonthComparableTotals.estimated_cost_usd || 0,
    current_streak: currentStreak,
    best_streak: bestStreak,
    workweek_green_days: workweekGreenDays,
    workweek_goal: 5
  };
}

function calculateCostPerMillion(totalCost, totalTokens) {
  if (!totalTokens) {
    return null;
  }

  return (totalCost / totalTokens) * 1000000;
}

function calculatePctChange(currentValue, previousValue) {
  if (!previousValue) {
    return null;
  }

  return (currentValue - previousValue) / previousValue;
}

function countRangeDays(startDate, endDate) {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((todayDate(endDate).getTime() - todayDate(startDate).getTime()) / millisecondsPerDay) + 1;
}

function sumWindowTotals(dayMap, startDate, endDate) {
  const totals = emptyTotals();
  for (let cursor = new Date(startDate); cursor <= endDate; cursor = addDays(cursor, 1)) {
    addTotals(totals, dayMap.get(dateKeyFromDate(cursor)) || emptyTotals());
  }
  return totals;
}

function buildWindowSnapshot(dayMap, currentStart, currentEnd, previousStart = null, previousEnd = null) {
  const currentTotals = sumWindowTotals(dayMap, currentStart, currentEnd);
  const previousTotals = previousStart && previousEnd
    ? sumWindowTotals(dayMap, previousStart, previousEnd)
    : emptyTotals();

  return {
    start_date: dateKeyFromDate(currentStart),
    end_date: dateKeyFromDate(currentEnd),
    total_tokens: currentTotals.total_tokens || 0,
    estimated_cost_usd: currentTotals.estimated_cost_usd || 0,
    previous_total_tokens: previousTotals.total_tokens || 0,
    previous_estimated_cost_usd: previousTotals.estimated_cost_usd || 0,
    token_change_pct: calculatePctChange(
      currentTotals.total_tokens || 0,
      previousTotals.total_tokens || 0
    ),
    cost_change_pct: calculatePctChange(
      currentTotals.estimated_cost_usd || 0,
      previousTotals.estimated_cost_usd || 0
    ),
    effective_cost_per_million: calculateCostPerMillion(
      currentTotals.estimated_cost_usd || 0,
      currentTotals.total_tokens || 0
    )
  };
}

function buildMomentumSnapshots(dayMap, now = new Date()) {
  const today = todayDate(now);
  const trailingFourteenStart = addDays(today, -13);
  const previousFourteenStart = addDays(today, -27);
  const previousFourteenEnd = addDays(today, -14);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const previousMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const previousMonthLastDay = new Date(today.getFullYear(), today.getMonth(), 0);
  const previousMonthComparableDay = Math.min(today.getDate(), previousMonthLastDay.getDate());
  const previousMonthComparableEnd = new Date(
    previousMonthStart.getFullYear(),
    previousMonthStart.getMonth(),
    previousMonthComparableDay
  );

  return {
    today: buildWindowSnapshot(dayMap, today, today),
    trailing_14d: buildWindowSnapshot(
      dayMap,
      trailingFourteenStart,
      today,
      previousFourteenStart,
      previousFourteenEnd
    ),
    month_to_date: buildWindowSnapshot(
      dayMap,
      monthStart,
      today,
      previousMonthStart,
      previousMonthComparableEnd
    )
  };
}

function buildRangeComparison(dayMap, range, summary) {
  if (range.requestedDays === "all") {
    return {
      available: false,
      label: "All time has no prior comparable window",
      previous_start_date: null,
      previous_end_date: null,
      previous_total_tokens: 0,
      previous_estimated_cost_usd: 0,
      token_change_pct: null,
      cost_change_pct: null
    };
  }

  const rangeLengthDays = countRangeDays(range.startDate, range.endDate);
  const previousEndDate = addDays(range.startDate, -1);
  const previousStartDate = addDays(previousEndDate, -(rangeLengthDays - 1));
  const previousTotals = sumWindowTotals(dayMap, previousStartDate, previousEndDate);

  return {
    available: true,
    label: `${formatDisplayDate(previousStartDate)} - ${formatDisplayDate(previousEndDate)}`,
    previous_start_date: dateKeyFromDate(previousStartDate),
    previous_end_date: dateKeyFromDate(previousEndDate),
    previous_total_tokens: previousTotals.total_tokens || 0,
    previous_estimated_cost_usd: previousTotals.estimated_cost_usd || 0,
    token_change_pct: calculatePctChange(
      summary.total_tokens || 0,
      previousTotals.total_tokens || 0
    ),
    cost_change_pct: calculatePctChange(
      summary.estimated_cost_usd || 0,
      previousTotals.estimated_cost_usd || 0
    )
  };
}

function modelFamilyForDisplay(model) {
  return canonicalizePricedModel(model) || model || "Other";
}

function determineDominantModelFamily(modelTotals) {
  if (!modelTotals || modelTotals.size === 0) {
    return "Other";
  }

  let dominant = null;
  for (const [model, totalTokens] of modelTotals.entries()) {
    if (!dominant || totalTokens > dominant.total_tokens) {
      dominant = {
        model,
        total_tokens: totalTokens
      };
    }
  }

  return dominant?.model || "Other";
}

function shareOfTotal(total, value) {
  if (!total) {
    return 0;
  }

  return value / total;
}

function buildEfficiencyMetrics(summary, dayMap, habitMetrics, costBreakdownByModel) {
  let peakDay = null;

  for (const [date, totals] of dayMap.entries()) {
    if (!peakDay || (totals.total_tokens || 0) > peakDay.total_tokens) {
      peakDay = {
        date,
        total_tokens: totals.total_tokens || 0,
        estimated_cost_usd: totals.estimated_cost_usd || 0
      };
    }
  }

  const topModel = costBreakdownByModel[0] || null;
  const tokenGrowthPct = calculatePctChange(
    habitMetrics.month_to_date_tokens,
    habitMetrics.previous_month_comparable_tokens
  );
  const spendGrowthPct = calculatePctChange(
    habitMetrics.month_to_date_estimated_cost_usd,
    habitMetrics.previous_month_comparable_estimated_cost_usd
  );
  const recentSevenDayChangePct = calculatePctChange(
    habitMetrics.last_7_days_tokens,
    habitMetrics.previous_7_days_tokens
  );

  return {
    effective_cost_per_million: calculateCostPerMillion(
      summary.estimated_cost_usd,
      summary.total_tokens
    ),
    input_output_ratio: summary.output_tokens > 0
      ? summary.input_tokens / summary.output_tokens
      : null,
    peak_day_share: summary.total_tokens > 0 && peakDay
      ? peakDay.total_tokens / summary.total_tokens
      : 0,
    peak_day: peakDay,
    month_to_date_token_growth_pct: tokenGrowthPct,
    month_to_date_spend_growth_pct: spendGrowthPct,
    last_7_day_change_pct: recentSevenDayChangePct,
    top_model: topModel
      ? {
        model: topModel.model,
        share_of_total_cost: topModel.share_of_total_cost || 0,
        share_of_total_tokens: topModel.share_of_total_tokens || 0,
        estimated_cost_usd: topModel.estimated_cost_usd || 0,
        total_tokens: topModel.total_tokens || 0
      }
      : null
  };
}

function buildInsights(efficiencyMetrics) {
  const insights = [];

  if (efficiencyMetrics.month_to_date_token_growth_pct !== null) {
    if (efficiencyMetrics.month_to_date_token_growth_pct >= 0.4) {
      insights.push({
        title: "Usage pace is up",
        body: `${Math.round(efficiencyMetrics.month_to_date_token_growth_pct * 100)}% more tokens than the same point last month.`
      });
    } else if (efficiencyMetrics.month_to_date_token_growth_pct <= -0.3) {
      insights.push({
        title: "Usage pace is down",
        body: `${Math.abs(Math.round(efficiencyMetrics.month_to_date_token_growth_pct * 100))}% fewer tokens than the same point last month.`
      });
    }
  }

  if (
    efficiencyMetrics.month_to_date_spend_growth_pct !== null &&
    efficiencyMetrics.month_to_date_token_growth_pct !== null &&
    efficiencyMetrics.month_to_date_spend_growth_pct >
      efficiencyMetrics.month_to_date_token_growth_pct + 0.15
  ) {
    insights.push({
      title: "Spend is rising faster than usage",
      body: "Month-to-date credit use is growing faster than tokens, which usually means a pricier model mix or more output-heavy sessions."
    });
  }

  if (efficiencyMetrics.peak_day_share >= 0.25 && efficiencyMetrics.peak_day) {
    insights.push({
      title: "One day is driving the range",
      body: `${Math.round(efficiencyMetrics.peak_day_share * 100)}% of selected-range tokens came from ${formatDisplayDate(parseDateKey(efficiencyMetrics.peak_day.date))}.`
    });
  }

  if (
    efficiencyMetrics.top_model &&
    efficiencyMetrics.top_model.share_of_total_cost >= 0.65
  ) {
    insights.push({
      title: "Credits are concentrated in one model",
      body: `${efficiencyMetrics.top_model.model} drove ${Math.round(efficiencyMetrics.top_model.share_of_total_cost * 100)}% of estimated credits on ${Math.round(efficiencyMetrics.top_model.share_of_total_tokens * 100)}% of tokens.`
    });
  }

  if (efficiencyMetrics.last_7_day_change_pct !== null && efficiencyMetrics.last_7_day_change_pct <= -0.4) {
    insights.push({
      title: "Recent usage dropped sharply",
      body: `The last 7 days are down ${Math.abs(Math.round(efficiencyMetrics.last_7_day_change_pct * 100))}% versus the prior 7 days.`
    });
  }

  if (!insights.length) {
    insights.push({
      title: "Usage looks steady",
      body: "No major efficiency or credit anomalies stand out in the current selection."
    });
  }

  return insights;
}

function buildTrendDays(dayMap, now = new Date()) {
  const trendEnd = todayDate(now);
  const trendStart = addDays(trendEnd, -13);
  const trend = [];

  for (let cursor = new Date(trendStart); cursor <= trendEnd; cursor = addDays(cursor, 1)) {
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
  const habitDayMap = new Map();
  const sessionMap = new Map();
  const modelCostMap = new Map();
  const currentWorkSessionMap = new Map();
  const summary = emptyTotals();
  const activeSessionIds = new Set();
  const daySessionKeys = new Set();
  const habitDaySessionKeys = new Set();

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
      const pricedEvent = priceEvent(event);
      const isInCurrentWorkWindow =
        eventTimestamp &&
        eventTimestamp >= currentWorkRangeStart &&
        eventTimestamp <= currentWorkRangeEnd;

      if (!habitDayMap.has(event.date)) {
        habitDayMap.set(event.date, { ...emptyTotals(), sessions: 0 });
      }
      const habitDayTotals = habitDayMap.get(event.date);
      addTotals(habitDayTotals, pricedEvent);
      const habitDaySessionKey = `${event.date}:${session.session_id}`;
      if (!habitDaySessionKeys.has(habitDaySessionKey)) {
        habitDaySessionKeys.add(habitDaySessionKey);
        habitDayTotals.sessions += 1;
      }

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
        addTotals(currentWorkTotals, pricedEvent);
        currentWorkTotals.active_days.add(event.date);
        if (!currentWorkTotals.last_active_at || event.timestamp > currentWorkTotals.last_active_at) {
          currentWorkTotals.last_active_at = event.timestamp;
        }
      }

      if (eventDate < range.startDate || eventDate > range.endDate) {
        continue;
      }

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
          model_totals: new Map(),
          ...emptyTotals()
        });
      }
      const sessionTotals = sessionMap.get(session.session_id);
      addTotals(sessionTotals, pricedEvent);
      const modelFamily = modelFamilyForDisplay(event.model);
      sessionTotals.model_totals.set(
        modelFamily,
        (sessionTotals.model_totals.get(modelFamily) || 0) + (pricedEvent.total_tokens || 0)
      );

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
    sessionTotals.dominant_model_family = determineDominantModelFamily(sessionTotals.model_totals);
    sessionTotals.input_output_ratio = sessionTotals.output_tokens > 0
      ? sessionTotals.input_tokens / sessionTotals.output_tokens
      : null;
  }

  const threads = [...sessionMap.values()]
    .sort((left, right) =>
      (right.estimated_cost_usd - left.estimated_cost_usd) ||
      (right.total_tokens - left.total_tokens)
    )
    .slice(0, 8)
    .map((entry) => ({
      session_id: entry.session_id,
      thread_name: entry.thread_name,
      workspace_key: entry.workspace_key,
      workspace_label: entry.workspace_label,
      cwd: entry.cwd,
      is_subagent: entry.is_subagent,
      session_started_at: entry.session_started_at,
      active_days: entry.active_days,
      total_tokens: entry.total_tokens,
      input_tokens: entry.input_tokens,
      cached_input_tokens: entry.cached_input_tokens,
      output_tokens: entry.output_tokens,
      reasoning_output_tokens: entry.reasoning_output_tokens,
      estimated_cost_usd: entry.estimated_cost_usd,
      unpriced_total_tokens: entry.unpriced_total_tokens,
      dominant_model_family: entry.dominant_model_family,
      input_output_ratio: entry.input_output_ratio,
      token_share: shareOfTotal(summary.total_tokens, entry.total_tokens),
      cost_share: shareOfTotal(summary.estimated_cost_usd, entry.estimated_cost_usd)
    }));
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
  const habitBoardRange = createHabitBoardRange(now);
  const {
    days: habitDays,
    monthLabels: habitMonthLabels,
    scale: habitScale
  } = buildHeatmapDays(habitDayMap, habitBoardRange);
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
      share_of_total_tokens: summary.total_tokens > 0
        ? entry.total_tokens / summary.total_tokens
        : 0,
      effective_cost_per_million: calculateCostPerMillion(
        entry.estimated_cost_usd,
        entry.total_tokens
      ),
      rates: entry.rates
    }))
    .sort((left, right) => right.estimated_cost_usd - left.estimated_cost_usd);
  const derivedSummary = {
    ...summary,
    cached_share: summary.input_tokens > 0
      ? summary.cached_input_tokens / summary.input_tokens
      : 0,
    active_days: [...dayMap.values()].filter((day) => day.total_tokens > 0).length,
    sessions: activeSessionIds.size,
    credits_spent: null
  };
  const habitMetrics = buildHabitMetrics(habitDayMap, habitBoardRange, now);
  const efficiencyMetrics = buildEfficiencyMetrics(
    derivedSummary,
    dayMap,
    habitMetrics,
    costBreakdownByModel
  );
  const rangeComparison = buildRangeComparison(habitDayMap, range, derivedSummary);
  const snapshotWindows = buildMomentumSnapshots(habitDayMap, now);

  return {
    range,
    selection: buildSelectionSummary(range),
    summary: derivedSummary,
    habit_board: {
      start_date: dateKeyFromDate(habitBoardRange.startDate),
      end_date: dateKeyFromDate(habitBoardRange.endDate),
      days: habitDays,
      month_labels: habitMonthLabels,
      scale: habitScale
    },
    habit_metrics: habitMetrics,
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
    trend_days: buildTrendDays(habitDayMap, now),
    efficiency_metrics: efficiencyMetrics,
    range_comparison: rangeComparison,
    snapshot_windows: snapshotWindows,
    insights: buildInsights(efficiencyMetrics),
    day_map: dayMap,
    habit_day_map: habitDayMap,
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
    habit_board: filtered.habit_board,
    habit_metrics: filtered.habit_metrics,
    heatmap_days: filtered.heatmap_days,
    heatmap_month_labels: filtered.heatmap_month_labels,
    heatmap_scale: filtered.heatmap_scale,
    current_work_range: filtered.current_work_range,
    current_work_sessions: filtered.current_work_sessions,
    trend_days: filtered.trend_days,
    efficiency_metrics: filtered.efficiency_metrics,
    range_comparison: filtered.range_comparison,
    snapshot_windows: filtered.snapshot_windows,
    insights: filtered.insights,
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
  const workspace = options.workspace ?? "all";
  const includeSubagents = options.includeSubagents ?? true;
  const dayTotals = filtered.habit_day_map.get(dateKey) || { ...emptyTotals(), sessions: 0 };
  const sessions = [];

  for (const session of index.sessions) {
    if (!includeSubagents && session.is_subagent) {
      continue;
    }
    if (workspace !== "all" && session.workspace_key !== workspace) {
      continue;
    }

    const totals = emptyTotals();
    const modelTotals = new Map();
    for (const event of session.events) {
      if (event.date !== dateKey) {
        continue;
      }
      const pricedEvent = priceEvent(event);
      addTotals(totals, pricedEvent);
      const modelFamily = modelFamilyForDisplay(event.model);
      modelTotals.set(
        modelFamily,
        (modelTotals.get(modelFamily) || 0) + (pricedEvent.total_tokens || 0)
      );
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
      dominant_model_family: determineDominantModelFamily(modelTotals),
      input_output_ratio: totals.output_tokens > 0
        ? totals.input_tokens / totals.output_tokens
        : null,
      token_share: dayTotals.total_tokens > 0 ? totals.total_tokens / dayTotals.total_tokens : 0,
      cost_share: dayTotals.estimated_cost_usd > 0 ? totals.estimated_cost_usd / dayTotals.estimated_cost_usd : 0,
      ...totals
    });
  }

  sessions.sort((left, right) =>
    (right.estimated_cost_usd - left.estimated_cost_usd) ||
    (right.total_tokens - left.total_tokens)
  );

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
