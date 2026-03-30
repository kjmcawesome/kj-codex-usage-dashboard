import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import readline from "node:readline";

const CACHE_VERSION = 2;
const CURRENT_WORK_WINDOW_HOURS = 72;

const RATE_CARD_PUBLISHED_AT = "2026-03-25";
const RATE_CARD_MODE = "standard";
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

function toNumber(value) {
  return Number.isFinite(value) ? value : Number(value || 0);
}

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

function isoTimestamp(value) {
  return value ? new Date(value).toISOString() : null;
}

function dateKeyFromTimestamp(timestamp) {
  return dateKeyFromDate(new Date(timestamp));
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

function deriveWorkspace(cwd) {
  if (!cwd) {
    return {
      workspace_key: "unknown",
      workspace_label: "Unknown"
    };
  }

  const resolvedHome = resolve(os.homedir());
  const resolvedCwd = resolve(cwd);
  const relativeToHome = relative(resolvedHome, resolvedCwd);

  if (!relativeToHome || relativeToHome.startsWith("..")) {
    return {
      workspace_key: resolvedCwd,
      workspace_label: resolvedCwd
    };
  }

  const segments = relativeToHome.split(sep).filter(Boolean);
  const prefixLength = segments[0] === "Documents" && segments[1] === "Codex projects"
    ? Math.min(3, segments.length)
    : Math.min(2, segments.length);
  const scopedSegments = segments.slice(0, prefixLength);
  const workspacePath = join(resolvedHome, ...scopedSegments);

  return {
    workspace_key: workspacePath,
    workspace_label: scopedSegments[scopedSegments.length - 1] || resolvedCwd
  };
}

function normalizeUsageSnapshot(info) {
  return {
    total_tokens: toNumber(info.total_tokens),
    input_tokens: toNumber(info.input_tokens),
    cached_input_tokens: toNumber(info.cached_input_tokens),
    output_tokens: toNumber(info.output_tokens),
    reasoning_output_tokens: toNumber(info.reasoning_output_tokens)
  };
}

function diffSnapshots(previous, current) {
  const totalDelta = current.total_tokens - previous.total_tokens;

  if (totalDelta <= 0) {
    return null;
  }

  return {
    total_tokens: totalDelta,
    input_tokens: Math.max(0, current.input_tokens - previous.input_tokens),
    cached_input_tokens: Math.max(0, current.cached_input_tokens - previous.cached_input_tokens),
    output_tokens: Math.max(0, current.output_tokens - previous.output_tokens),
    reasoning_output_tokens: Math.max(0, current.reasoning_output_tokens - previous.reasoning_output_tokens)
  };
}

function sortSessionsByName(sessions) {
  return [...sessions].sort((left, right) => {
    const leftName = left.thread_name || left.session_id;
    const rightName = right.thread_name || right.session_id;
    return leftName.localeCompare(rightName);
  });
}

function dedupeSessionsById(sessions) {
  const deduped = new Map();

  for (const session of sessions) {
    const existing = deduped.get(session.session_id);
    if (!existing) {
      deduped.set(session.session_id, session);
      continue;
    }

    const shouldReplace =
      session.total_tokens > existing.total_tokens ||
      (
        session.total_tokens === existing.total_tokens &&
        session.events.length > existing.events.length
      ) ||
      (
        session.total_tokens === existing.total_tokens &&
        session.events.length === existing.events.length &&
        (session.session_started_at || "") > (existing.session_started_at || "")
      );

    if (shouldReplace) {
      deduped.set(session.session_id, session);
    }
  }

  return [...deduped.values()];
}

async function walkJsonlFiles(rootPath) {
  try {
    const entries = await readdir(rootPath, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
      const entryPath = join(rootPath, entry.name);
      if (entry.isDirectory()) {
        return walkJsonlFiles(entryPath);
      }
      return entry.isFile() && entry.name.endsWith(".jsonl") ? [entryPath] : [];
    }));

    return files.flat().sort();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function parseSessionIndex(sessionIndexPath) {
  try {
    const content = await readFile(sessionIndexPath, "utf8");
    const threadNames = new Map();

    for (const line of content.split("\n")) {
      if (!line.trim()) {
        continue;
      }

      const record = JSON.parse(line);
      if (record.id && record.thread_name) {
        threadNames.set(record.id, record.thread_name);
      }
    }

    return threadNames;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return new Map();
    }
    throw error;
  }
}

export async function parseSessionLog(filePath) {
  const session = {
    session_id: null,
    thread_name: null,
    parent_session_id: null,
    session_started_at: null,
    cwd: null,
    workspace_key: "unknown",
    workspace_label: "Unknown",
    originator: null,
    cli_version: null,
    model_provider: null,
    primary_model: null,
    models_used: [],
    agent_role: null,
    agent_nickname: null,
    is_subagent: false,
    total_tokens: 0,
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    events: []
  };

  let previousSnapshot = emptyTotals();
  let currentModel = null;
  const modelsUsed = new Set();

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }

      if (record.type === "session_meta" && record.payload) {
        if (!session.session_id) {
          const meta = record.payload;
          const workspace = deriveWorkspace(meta.cwd);

          session.session_id = meta.id || session.session_id;
          session.parent_session_id = meta.forked_from_id || session.parent_session_id;
          session.session_started_at = isoTimestamp(meta.timestamp || record.timestamp);
          session.cwd = meta.cwd || session.cwd;
          session.workspace_key = workspace.workspace_key;
          session.workspace_label = workspace.workspace_label;
          session.originator = meta.originator || session.originator;
          session.cli_version = meta.cli_version || session.cli_version;
          session.model_provider = meta.model_provider || session.model_provider;
          session.agent_role = meta.agent_role || session.agent_role;
          session.agent_nickname = meta.agent_nickname || session.agent_nickname;
          session.is_subagent = Boolean(meta.source?.subagent || meta.forked_from_id);
        }
        continue;
      }

      if (record.type === "turn_context" && record.payload) {
        const turnModel = record.payload.model;
        if (turnModel) {
          currentModel = turnModel;
          session.primary_model = session.primary_model || turnModel;
          modelsUsed.add(turnModel);
        }
        continue;
      }

      if (record.type !== "event_msg" || record.payload?.type !== "token_count") {
        continue;
      }

      const usage = record.payload?.info?.total_token_usage;
      if (!usage) {
        continue;
      }

      const snapshot = normalizeUsageSnapshot(usage);
      const delta = diffSnapshots(previousSnapshot, snapshot);
      previousSnapshot = snapshot;

      if (!delta) {
        continue;
      }

      const eventDate = dateKeyFromTimestamp(record.timestamp);
      const eventModel = currentModel || session.primary_model || null;
      if (eventModel) {
        modelsUsed.add(eventModel);
      }
      session.events.push({
        timestamp: isoTimestamp(record.timestamp),
        date: eventDate,
        model: eventModel,
        ...delta
      });
      addTotals(session, delta);
    }
  } finally {
    lines.close();
    stream.destroy();
  }

  session.models_used = [...modelsUsed];

  return session;
}

async function readCache(cacheFilePath) {
  try {
    const raw = await readFile(cacheFilePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed.version !== CACHE_VERSION || typeof parsed.files !== "object") {
      return null;
    }
    return parsed;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeCache(cacheFilePath, payload) {
  await mkdir(dirname(cacheFilePath), { recursive: true });
  await writeFile(cacheFilePath, JSON.stringify(payload), "utf8");
}

function createRange(options = {}, now = new Date(), earliestDate = null) {
  const today = todayDate(now);

  if (options.startDate && options.endDate) {
    const startDate = parseDateKey(options.startDate);
    const endDate = parseDateKey(options.endDate);
    return {
      startDate,
      endDate,
      mode: "custom",
      requestedDays: null,
      label: `${formatDisplayDate(startDate)} - ${formatDisplayDate(endDate)}`
    };
  }

  if (options.days === "all") {
    const startDate = earliestDate ? parseDateKey(earliestDate) : today;
    return {
      startDate,
      endDate: today,
      mode: "preset",
      requestedDays: "all",
      label: describePresetRange("all")
    };
  }

  const normalizedDays = Number.isFinite(options.days) && options.days > 0
    ? Math.trunc(options.days)
    : 365;

  return {
    startDate: addDays(today, -(normalizedDays - 1)),
    endDate: today,
    mode: "preset",
    requestedDays: normalizedDays,
    label: describePresetRange(normalizedDays)
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
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const trailingFourteenTotals = sumWindowTotals(trailingFourteenStart, today);
  const monthToDateTotals = sumWindowTotals(monthStart, today);
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
    month_to_date_tokens: monthToDateTotals.total_tokens || 0,
    month_to_date_estimated_cost_usd: monthToDateTotals.estimated_cost_usd || 0,
    current_streak: currentStreak,
    best_streak: bestStreak,
    workweek_green_days: workweekGreenDays,
    workweek_goal: 5
  };
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
  const workspaceMap = new Map();
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
          ...emptyTotals()
        });
      }
      const sessionTotals = sessionMap.get(session.session_id);
      addTotals(sessionTotals, pricedEvent);

      if (!workspaceMap.has(session.workspace_key)) {
        workspaceMap.set(session.workspace_key, {
          workspace_key: session.workspace_key,
          workspace_label: session.workspace_label,
          active_days: new Set(),
          sessions: new Set(),
          ...emptyTotals()
        });
      }
      const workspaceTotals = workspaceMap.get(session.workspace_key);
      addTotals(workspaceTotals, pricedEvent);
      workspaceTotals.active_days.add(event.date);
      workspaceTotals.sessions.add(session.session_id);

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

  const workspaces = [...workspaceMap.values()]
    .map((entry) => ({
      workspace_key: entry.workspace_key,
      workspace_label: entry.workspace_label,
      total_tokens: entry.total_tokens,
      input_tokens: entry.input_tokens,
      cached_input_tokens: entry.cached_input_tokens,
      output_tokens: entry.output_tokens,
      reasoning_output_tokens: entry.reasoning_output_tokens,
      estimated_cost_usd: entry.estimated_cost_usd,
      unpriced_total_tokens: entry.unpriced_total_tokens,
      active_days: entry.active_days.size,
      sessions: entry.sessions.size
    }))
    .sort((left, right) => right.total_tokens - left.total_tokens)
    .slice(0, 6);

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
    habit_board: {
      start_date: dateKeyFromDate(habitBoardRange.startDate),
      end_date: dateKeyFromDate(habitBoardRange.endDate),
      days: habitDays,
      month_labels: habitMonthLabels,
      scale: habitScale
    },
    habit_metrics: buildHabitMetrics(habitDayMap, habitBoardRange, now),
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
    day_map: dayMap,
    habit_day_map: habitDayMap,
    session_map: sessionMap
  };
}

function listWorkspaces(sessions) {
  const seen = new Map();
  for (const session of sessions) {
    if (!seen.has(session.workspace_key)) {
      seen.set(session.workspace_key, {
        workspace_key: session.workspace_key,
        workspace_label: session.workspace_label
      });
    }
  }

  return [...seen.values()].sort((left, right) =>
    left.workspace_label.localeCompare(right.workspace_label)
  );
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

export function createPublicSnapshot(index) {
  return {
    snapshot_version: 1,
    generated_at: index.generated_at,
    timezone: index.timezone,
    earliest_date: index.earliest_date,
    sessions: index.sessions,
    workspaces: index.workspaces,
    source: {
      log_files: index.source?.log_files || 0
    }
  };
}

export async function loadUsageIndex({
  codexRoot = join(os.homedir(), ".codex"),
  cacheFilePath = join(os.homedir(), ".codex", "cache", "usage-dashboard-index.json"),
  forceReparse = false
} = {}) {
  const sessionsRoot = join(codexRoot, "sessions");
  const archivedRoot = join(codexRoot, "archived_sessions");
  const sessionIndexPath = join(codexRoot, "session_index.jsonl");
  const previousCache = await readCache(cacheFilePath);
  const threadNames = await parseSessionIndex(sessionIndexPath);
  const files = [
    ...(await walkJsonlFiles(sessionsRoot)),
    ...(await walkJsonlFiles(archivedRoot))
  ].sort();

  const nextCache = {
    version: CACHE_VERSION,
    generated_at: new Date().toISOString(),
    files: {},
    source: {
      codex_root: codexRoot,
      cache_file: cacheFilePath,
      log_files: files.length,
      reused_files: 0,
      reparsed_files: 0
    }
  };

  for (const filePath of files) {
    const fileStats = await stat(filePath);
    const fingerprint = {
      size: fileStats.size,
      mtime_ms: Math.trunc(fileStats.mtimeMs)
    };
    const cachedFile = previousCache?.files?.[filePath];

    if (
      !forceReparse &&
      cachedFile &&
      cachedFile.size === fingerprint.size &&
      cachedFile.mtime_ms === fingerprint.mtime_ms
    ) {
      nextCache.files[filePath] = cachedFile;
      nextCache.source.reused_files += 1;
      continue;
    }

    const session = await parseSessionLog(filePath);
    nextCache.files[filePath] = {
      ...fingerprint,
      session
    };
    nextCache.source.reparsed_files += 1;
  }

  await writeCache(cacheFilePath, nextCache);

  const sessions = Object.values(nextCache.files)
    .map((entry) => entry.session)
    .filter((session) => session.session_id);

  let earliestDate = null;
  for (const session of sessions) {
    session.thread_name = threadNames.get(session.session_id) || session.thread_name || session.session_id;
    for (const event of session.events) {
      if (!earliestDate || event.date < earliestDate) {
        earliestDate = event.date;
      }
    }
  }

  const sortedSessions = sortSessionsByName(dedupeSessionsById(sessions));

  return {
    generated_at: nextCache.generated_at,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    earliest_date: earliestDate,
    sessions: sortedSessions,
    workspaces: listWorkspaces(sortedSessions),
    source: nextCache.source
  };
}

export function createUsageService(options = {}) {
  const codexRoot = options.codexRoot || join(os.homedir(), ".codex");
  const cacheFilePath = options.cacheFilePath || join(codexRoot, "cache", "usage-dashboard-index.json");
  const nowProvider = options.nowProvider || (() => new Date());

  return {
    async getDashboard(params = {}) {
      const index = await loadUsageIndex({ codexRoot, cacheFilePath });
      return buildDashboardPayload(index, {
        ...params,
        now: nowProvider()
      });
    },

    async getDay(date, params = {}) {
      const index = await loadUsageIndex({ codexRoot, cacheFilePath });
      return buildDayPayload(index, date, {
        ...params,
        now: nowProvider()
      });
    },

    async refresh() {
      const index = await loadUsageIndex({ codexRoot, cacheFilePath, forceReparse: true });
      return {
        ok: true,
        generated_at: index.generated_at,
        source: index.source
      };
    }
  };
}
