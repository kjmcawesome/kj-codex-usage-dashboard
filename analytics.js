import { PRICING, priceEvent } from "./pricing.js";

export const TOTAL_FIELDS = ["total_tokens", "input_tokens", "cached_input_tokens", "cache_write_input_tokens",
  "output_tokens", "reasoning_output_tokens", "fresh_input_tokens", "estimated_cost_usd", "proxy_tokens",
  "unknown_context_tokens", "unallocated_tokens"];
const zero = () => Object.fromEntries(TOTAL_FIELDS.map((key) => [key, 0]));
const add = (target, row) => TOTAL_FIELDS.forEach((key) => { target[key] += row[key] || 0; });
const compareCost = (a, b) => b.estimated_cost_usd - a.estimated_cost_usd || b.total_tokens - a.total_tokens || a.name.localeCompare(b.name);
const isId = (value) => /^[a-f\d]{8}-[a-f\d-]{27,}$/i.test(value || "");

export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function shiftDay(value, count) {
  const day = new Date(`${value}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + count);
  return day.toISOString().slice(0, 10);
}

export function dayInZone(timestamp, timeZone = "America/Los_Angeles") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(timestamp));
  const part = (type) => parts.find((value) => value.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function resolveRange(params, today, earliest) {
  const start = params.startDate ?? params.start_date;
  const end = params.endDate ?? params.end_date;
  if (Boolean(start) !== Boolean(end)) throw new RangeError("Choose both a start and end date.");
  if (start || end) {
    if (!validDate(start) || !validDate(end)) throw new RangeError("Dates must use YYYY-MM-DD.");
    if (start > end) throw new RangeError("Start date must be on or before the end date.");
    return { mode: "custom", start_date: start, end_date: end, label: `${start} to ${end}` };
  }
  const days = params.days == null ? 30 : params.days;
  if (days === "all") return { mode: "preset", days: "all", start_date: earliest || today, end_date: today, label: "All recorded history" };
  if (!Number.isInteger(Number(days)) || Number(days) < 1 || Number(days) > 3660) throw new RangeError("Choose a valid day range.");
  return { mode: "preset", days: Number(days), start_date: shiftDay(today, 1 - Number(days)), end_date: today, label: `Last ${days} days` };
}

function inRange(event, range) {
  return event.date >= range.start_date && event.date <= range.end_date;
}

function displayName(session) {
  if (session.thread_name && !isId(session.thread_name)) return session.thread_name;
  if (session.agent_nickname) return `${session.agent_nickname} helper task`;
  const date = String(session.session_started_at || "").slice(0, 10);
  return `Untitled work${date ? ` · ${date}` : ""}`;
}

export function resolveProjects(sessions, annotations = {}) {
  const byId = new Map(sessions.map((session) => [session.session_id, session]));
  const mapping = new Map();
  for (const session of sessions) {
    let root = session;
    const visited = new Set([session.session_id]);
    let missing = false;
    while (root.parent_session_id) {
      const parent = byId.get(root.parent_session_id);
      if (!parent) {
        missing = true;
        root = { ...root, session_id: root.parent_session_id, parent_session_id: null,
          thread_name: root.parent_thread_name || null, agent_nickname: null };
        break;
      }
      if (visited.has(parent.session_id)) break;
      visited.add(parent.session_id);
      root = parent;
    }
    const annotation = annotations[root.session_id] || {};
    mapping.set(session.session_id, {
      id: root.session_id, name: typeof annotation.project_label === "string" && annotation.project_label.trim() ? annotation.project_label.trim() : displayName(root),
      workspace_key: root.workspace_key || session.workspace_key,
      workspace_label: root.workspace_label || session.workspace_label,
      outcome: typeof annotation.business_outcome === "string" ? annotation.business_outcome : null,
      impact_label: typeof annotation.impact_label === "string" ? annotation.impact_label : null,
      missing_parent: missing
    });
  }
  return mapping;
}

function summarize(records) {
  const totals = zero();
  const days = new Set();
  const sessions = new Set();
  const projects = new Set();
  let helperCost = 0;
  let helperTokens = 0;
  for (const record of records) {
    add(totals, record);
    if (record.total_tokens > 0) {
      days.add(record.date);
      sessions.add(record.session_id);
      projects.add(record.project.id);
    }
    if (record.is_subagent) { helperCost += record.estimated_cost_usd; helperTokens += record.total_tokens; }
  }
  return { ...totals, active_days: days.size, workflow_count: sessions.size, project_count: projects.size,
    helper_cost_usd: helperCost, helper_tokens: helperTokens,
    direct_cost_usd: totals.estimated_cost_usd - helperCost, direct_tokens: totals.total_tokens - helperTokens };
}

function groupProjects(records, recordedRecords = records) {
  const groups = new Map();
  const recorded = new Map();
  for (const row of recordedRecords) {
    if (!recorded.has(row.project.id)) recorded.set(row.project.id, []);
    recorded.get(row.project.id).push(row);
  }
  for (const row of records) {
    if (!groups.has(row.project.id)) groups.set(row.project.id, []);
    groups.get(row.project.id).push(row);
  }
  const total = summarize(records);
  return [...groups.values()].map((rows) => {
    const summary = summarize(rows);
    return { ...rows[0].project, ...summary,
      last_active_at: rows.reduce((last, row) => (row.last_timestamp || row.timestamp) > last ? row.last_timestamp || row.timestamp : last, ""),
      first_date: rows.reduce((first, row) => row.date < first ? row.date : first, rows[0].date),
      token_share: total.total_tokens ? summary.total_tokens / total.total_tokens : 0,
      cost_share: total.estimated_cost_usd ? summary.estimated_cost_usd / total.estimated_cost_usd : 0,
      recorded: summarize(recorded.get(rows[0].project.id) || []) };
  }).sort(compareCost);
}

function groupModels(records) {
  const groups = new Map();
  const totalCost = summarize(records).estimated_cost_usd;
  for (const row of records) {
    const key = `${row.priced_model}|${row.is_proxy}|${row.pricing_context}`;
    if (!groups.has(key)) groups.set(key, { id: key, name: row.model_label, model: row.priced_model,
      is_proxy: row.is_proxy, context: row.pricing_context, rates: row.rates, ...zero(),
      cost_components: { input: 0, cached_input: 0, cache_write: 0, output: 0 } });
    const group = groups.get(key);
    add(group, row);
    for (const component of Object.keys(group.cost_components)) group.cost_components[component] += row.cost_components[component];
  }
  return [...groups.values()].map((group) => ({ ...group, cost_share: totalCost ? group.estimated_cost_usd / totalCost : 0 })).sort(compareCost);
}

function groupWorkflows(records) {
  const groups = new Map();
  const total = summarize(records);
  for (const row of records) {
    if (!groups.has(row.session_id)) groups.set(row.session_id, []);
    groups.get(row.session_id).push(row);
  }
  return [...groups.values()].map((rows) => {
    const first = rows[0];
    const summary = summarize(rows);
    const models = groupModels(rows);
    return { id: first.session_id, session_id: first.session_id, name: first.session_name,
      project_id: first.project.id, project_name: first.project.name, is_subagent: first.is_subagent,
      is_fork: first.is_fork, agent_nickname: first.agent_nickname, session_started_at: first.session_started_at,
      last_active_at: rows.reduce((last, row) => (row.last_timestamp || row.timestamp) > last ? row.last_timestamp || row.timestamp : last, ""),
      ...summary, token_share: total.total_tokens ? summary.total_tokens / total.total_tokens : 0,
      cost_share: total.estimated_cost_usd ? summary.estimated_cost_usd / total.estimated_cost_usd : 0,
      models, dominant_model: models[0]?.name || "Unknown model" };
  }).sort(compareCost);
}

function quantile(sorted, position) {
  if (!sorted.length) return 0;
  return sorted[Math.floor((sorted.length - 1) * position)];
}

export function heatLevel(tokens, thresholds, max) {
  if (tokens <= 0 || !max) return 0;
  if (tokens >= max) return 7;
  const index = thresholds.findIndex((threshold) => tokens <= threshold);
  return index < 0 ? 7 : index + 1;
}

function buildBoard(records, today) {
  const start = shiftDay(today, -364);
  const byDay = new Map();
  for (const row of records) {
    if (row.date < start || row.date > today) continue;
    if (!byDay.has(row.date)) byDay.set(row.date, []);
    byDay.get(row.date).push(row);
  }
  const summaries = new Map([...byDay].map(([date, rows]) => [date, summarize(rows)]));
  const positive = [...summaries.values()].map((day) => day.total_tokens).filter((value) => value > 0).sort((a, b) => a - b);
  const max = positive.at(-1) || 0;
  const thresholds = [0.15, 0.35, 0.55, 0.75, 0.9, 0.98].map((value) => quantile(positive, value));
  const firstWeekday = new Date(`${start}T12:00:00Z`).getUTCDay();
  const lastWeekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const gridStart = shiftDay(start, -firstWeekday);
  const gridEnd = shiftDay(today, 6 - lastWeekday);
  const days = [];
  for (let date = gridStart; date <= gridEnd; date = shiftDay(date, 1)) {
    const summary = summaries.get(date) || summarize([]);
    days.push({ date, ...summary, in_range: date >= start && date <= today,
      weekday: days.length % 7, week: Math.floor(days.length / 7),
      is_today: date === today, level: heatLevel(summary.total_tokens, thresholds, max) });
  }
  const monthLabels = [];
  for (const day of days) {
    if (!day.in_range || (day.date.slice(-2) !== "01" && day.date !== start)) continue;
    const label = new Date(`${day.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    if (monthLabels.length && day.week - monthLabels.at(-1).week < 3) monthLabels.pop();
    monthLabels.push({ label, week: day.week, date: day.date });
  }
  let best = 0;
  let run = 0;
  for (const day of days.filter((day) => day.in_range)) {
    run = day.total_tokens > 0 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const monday = shiftDay(today, -((lastWeekday + 6) % 7));
  const month = today.slice(0, 7);
  const workweek = days.filter((day) => day.date >= monday && day.date <= today && day.weekday >= 1 && day.weekday <= 5 && day.total_tokens > 0).length;
  return { start_date: start, end_date: today, days, month_labels: monthLabels, weeks: days.length / 7,
    scale: { mode: "active_day_quantiles", max_total_tokens: max, thresholds },
    summary: summarize(records.filter((row) => row.date >= start && row.date <= today)),
    metrics: { current_streak: run, best_streak: best, workweek_green_days: workweek, workweek_goal: 5,
      active_days_this_month: [...summaries].filter(([date, totals]) => date.startsWith(month) && totals.total_tokens > 0).length,
      elapsed_days_this_month: Number(today.slice(-2)) } };
}

export function createAnalytics(snapshot, { annotations = {} } = {}) {
  if (snapshot.counting_version !== 3) throw new Error("This snapshot needs a fresh count. Refresh from the local collector before using the rebuilt dashboard.");
  if (!Array.isArray(snapshot.sessions) || !Number.isFinite(new Date(snapshot.generated_at).getTime())) throw new Error("The usage snapshot is incomplete.");
  const today = dayInZone(snapshot.generated_at, snapshot.timezone);
  const projectMap = resolveProjects(snapshot.sessions, annotations);
  const records = [];
  for (const session of snapshot.sessions) {
    for (const event of session.events || []) {
      if (event.total_tokens <= 0 || !validDate(event.date) || event.date > today) continue;
      records.push({ ...priceEvent(event), project: projectMap.get(session.session_id),
        session_id: session.session_id, session_name: displayName(session),
        session_started_at: session.session_started_at, is_subagent: session.is_subagent,
        is_fork: session.is_fork, agent_nickname: session.agent_nickname });
    }
  }
  const base = (params) => records.filter((row) =>
    (![false, 0, "0", "false"].includes(params.includeSubagents ?? params.include_subagents) || !row.is_subagent) &&
    (!params.workspace || params.workspace === "all" || row.project.workspace_key === params.workspace)
  );
  const rangeFor = (params) => resolveRange(params, today, snapshot.earliest_date);
  const window = (rows, start, end) => ({ start_date: start, end_date: end, ...summarize(rows.filter((row) => inRange(row, { start_date: start, end_date: end }))) });

  function dashboard(params = {}) {
    const all = base(params);
    const range = rangeFor(params);
    const selected = all.filter((row) => inRange(row, range));
    const board = buildBoard(all, today);
    return {
      schema_version: 3, generated_at: snapshot.generated_at, timezone: snapshot.timezone, today,
      available_range: { start_date: snapshot.earliest_date || today, end_date: today },
      selection: range, summary: summarize(selected), projects: groupProjects(selected, all),
      models: groupModels(selected), habit_board: board, quality: snapshot.quality || {}, pricing: PRICING,
      snapshot_windows: { today: window(all, today, today), trailing_14d: window(all, shiftDay(today, -13), today),
        trailing_30d: window(all, shiftDay(today, -29), today), month_to_date: window(all, `${today.slice(0, 7)}-01`, today) },
      trend_days: board.days.filter((day) => day.date >= shiftDay(today, -13) && day.date <= today),
      workspaces: snapshot.workspaces || []
    };
  }

  function breakdown(type, id, params = {}) {
    const all = base(params);
    const selectedRange = rangeFor(params);
    if (type === "day" && !validDate(id)) throw new RangeError("Choose a valid day.");
    const range = type === "day" ? { start_date: id, end_date: id } : selectedRange;
    let selected = all.filter((row) => inRange(row, range));
    if (type === "project") selected = selected.filter((row) => row.project.id === id);
    if (type === "workflow") selected = selected.filter((row) => row.session_id === id);
    const projects = groupProjects(selected, all);
    const name = type === "day" ? id : type === "project"
      ? [...projectMap.values()].find((project) => project.id === id)?.name || "Project"
      : displayName(snapshot.sessions.find((session) => session.session_id === id) || {});
    const recorded = all.filter((row) => type === "project" ? row.project.id === id : type === "workflow" ? row.session_id === id : row.date === id);
    return { type, id, name, range, summary: summarize(selected), projects,
      workflows: groupWorkflows(selected), models: groupModels(selected),
      recorded: { ...summarize(recorded), start_date: recorded.reduce((date, row) => row.date < date ? row.date : date, today), end_date: today },
      outcome: type === "project" ? projects[0]?.outcome || null : null,
      quality: snapshot.quality || {}, pricing: PRICING };
  }
  return { dashboard, breakdown, today };
}

// The HTTP server and hosted/static page use exactly the same transform.
export function buildDashboardPayload(index, params = {}) {
  return createAnalytics({ ...index, generated_at: params.now?.toISOString() || index.generated_at }).dashboard(params);
}

export function buildDayPayload(index, date, params = {}) {
  return createAnalytics({ ...index, generated_at: params.now?.toISOString() || index.generated_at }).breakdown("day", date, params);
}
