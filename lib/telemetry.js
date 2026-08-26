import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import readline from "node:readline";
import { createHash } from "node:crypto";
import { contextBand, resolveModel } from "../public/pricing.js";

export const COUNTING_VERSION = 3;
export const TOKEN_FIELDS = [
  "total_tokens", "input_tokens", "cached_input_tokens", "output_tokens",
  "reasoning_output_tokens", "cache_write_input_tokens"
];
const number = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const empty = () => Object.fromEntries(TOKEN_FIELDS.map((key) => [key, 0]));
const sumInto = (target, source) => TOKEN_FIELDS.forEach((key) => { target[key] += source[key] || 0; });
const signature = (values) => values.join(":");

function usage(info) {
  const result = Object.fromEntries(TOKEN_FIELDS.map((key) => [key, number(info[key])]));
  if (info.total_tokens == null) result.total_tokens = result.input_tokens + result.output_tokens;
  return result;
}

function diff(previous, current) {
  return Object.fromEntries(TOKEN_FIELDS.map((key) => [key, Math.max(0, current[key] - previous[key])]));
}

function dateKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function workspaceFor(cwd) {
  if (!cwd) return { workspace_key: "unknown", workspace_label: "Unknown workspace" };
  const absolute = resolve(cwd);
  const path = relative(os.homedir(), absolute);
  const parts = path.split(sep).filter(Boolean);
  if (!parts.length || path.startsWith("..")) {
    return { workspace_key: absolute, workspace_label: parts.at(-1) || "Home" };
  }
  const length = parts[0] === "Documents" && parts[1] === "Codex projects" ? 3 : 2;
  const group = parts.slice(0, length);
  return { workspace_key: join(os.homedir(), ...group), workspace_label: group.at(-1) };
}

export async function parseSessionLog(filePath) {
  const session = {
    session_id: null, parent_session_id: null, thread_name: null,
    session_started_at: null, cwd: null, workspace_key: "unknown", workspace_label: "Unknown workspace",
    is_subagent: false, is_fork: false, agent_nickname: null, agent_role: null,
    primary_model: null, models_used: [], ...empty(), events: [],
    quality: { duplicate_snapshots: 0, counter_resets: 0, invalid_records: 0, inconsistent_snapshots: 0 }
  };
  let previous = empty();
  let model = null;
  let turnId = null;
  const seen = new Set();
  const models = new Set();
  const input = createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch { session.quality.invalid_records += 1; continue; }
      const payload = record.payload || {};
      if (record.type === "session_meta") {
        // Forked logs contain replayed session_meta for ancestors. The first one owns this file.
        if (!session.session_id) {
          const spawn = payload.source?.subagent?.thread_spawn;
          session.session_id = payload.id || payload.session_id || null;
          session.parent_session_id = payload.forked_from_id || payload.parent_thread_id || spawn?.parent_thread_id || null;
          session.session_started_at = payload.timestamp || record.timestamp;
          session.is_fork = Boolean(payload.forked_from_id);
          session.is_subagent = Boolean(payload.source?.subagent || payload.thread_source?.subagent);
          session.agent_nickname = payload.agent_nickname || spawn?.agent_nickname || null;
          session.agent_role = payload.agent_role || spawn?.agent_role || null;
          session.cwd = payload.cwd || null;
          Object.assign(session, workspaceFor(session.cwd));
        }
        continue;
      }
      if (record.type === "turn_context") {
        model = payload.model || model;
        turnId = payload.turn_id || null;
        session.primary_model ||= model;
        if (model) models.add(model);
        continue;
      }
      if (record.type !== "event_msg" || payload.type !== "token_count" || !payload.info?.total_token_usage) continue;
      const current = usage(payload.info.total_token_usage);
      const last = payload.info.last_token_usage ? usage(payload.info.last_token_usage) : null;
      const cumulative = TOKEN_FIELDS.map((key) => current[key]);
      const key = signature(cumulative);
      if (seen.has(key)) { session.quality.duplicate_snapshots += 1; continue; }
      seen.add(key);
      let delta = diff(previous, current);
      if (current.total_tokens < previous.total_tokens) {
        // A genuinely new reset uses the last request, never re-adds the old high-water mark.
        session.quality.counter_resets += 1;
        delta = last && last.total_tokens <= current.total_tokens ? last : empty();
      }
      previous = current;
      if (delta.total_tokens <= 0) continue;
      const timestamp = new Date(record.timestamp);
      if (!Number.isFinite(timestamp.getTime())) { session.quality.invalid_records += 1; continue; }
      if (delta.total_tokens !== delta.input_tokens + delta.output_tokens ||
          delta.cached_input_tokens + delta.cache_write_input_tokens > delta.input_tokens ||
          delta.reasoning_output_tokens > delta.output_tokens) session.quality.inconsistent_snapshots += 1;
      session.events.push({
        timestamp: timestamp.toISOString(), date: dateKey(timestamp), model, turn_id: turnId,
        cumulative, last_usage: last ? TOKEN_FIELDS.map((field) => last[field]) : null,
        context_input_tokens: last && delta.total_tokens === last.total_tokens ? last.input_tokens : null,
        ...delta
      });
      sumInto(session, delta);
    }
  } finally {
    lines.close();
    input.destroy();
  }
  session.models_used = [...models];
  return session;
}

export function reconcileSessions(inputSessions) {
  const byId = new Map();
  for (const session of inputSessions) {
    if (!session.session_id) continue;
    const previous = byId.get(session.session_id);
    if (!previous || session.events.length > previous.events.length ||
        (session.events.length === previous.events.length && session.total_tokens > previous.total_tokens)) {
      byId.set(session.session_id, session);
    }
  }
  const snapshotMaps = new Map();
  const getSnapshots = (session) => {
    if (!snapshotMaps.has(session.session_id)) {
      const entries = new Map();
      for (const event of session.events) {
        if (!event.cumulative) continue;
        const key = signature(event.cumulative);
        if (!entries.has(key)) entries.set(key, []);
        entries.get(key).push(event);
      }
      snapshotMaps.set(session.session_id, entries);
    }
    return snapshotMaps.get(session.session_id);
  };

  return [...byId.values()].map((original) => {
    const session = { ...original, ...empty(), events: [], quality: {
      ...original.quality, inherited_events_removed: 0, inherited_tokens_removed: 0,
      missing_parent: false, lineage_cycle: false
    } };
    const ancestors = [];
    const visited = new Set([original.session_id]);
    let parentId = original.parent_session_id;
    while (parentId) {
      if (visited.has(parentId)) { session.quality.lineage_cycle = true; break; }
      visited.add(parentId);
      const ancestor = byId.get(parentId);
      if (!ancestor) { session.quality.missing_parent = true; break; }
      ancestors.push(ancestor);
      parentId = ancestor.parent_session_id;
    }
    const inheritedMatch = (values, turnId, requireTurn = true) => ancestors.some((ancestor) =>
      (getSnapshots(ancestor).get(signature(values)) || []).some((event) =>
        (!requireTurn || !turnId || !event.turn_id || turnId === event.turn_id) &&
        event.timestamp <= original.session_started_at
      )
    );
    for (const raw of original.events) {
      let event = raw;
      // Fork replay rewrites timestamps. Match counter snapshots AND ancestor turn identity instead.
      if (event.cumulative && inheritedMatch(event.cumulative, event.turn_id)) {
        session.quality.inherited_events_removed += 1;
        session.quality.inherited_tokens_removed += event.total_tokens;
        continue;
      }
      if (session.events.length === 0 && event.cumulative && event.last_usage &&
          event.total_tokens > event.last_usage[0]) {
        const baseline = event.cumulative.map((value, index) => value - event.last_usage[index]);
        if (baseline.every((value) => value >= 0) && inheritedMatch(baseline, null, false)) {
          const own = Object.fromEntries(TOKEN_FIELDS.map((field, index) => [field, event.last_usage[index]]));
          session.quality.inherited_tokens_removed += event.total_tokens - own.total_tokens;
          event = { ...event, ...own, context_input_tokens: own.input_tokens };
        }
      }
      session.events.push(event);
      sumInto(session, event);
    }
    session.primary_model = session.events[0]?.model || null;
    session.models_used = [...new Set(session.events.map((event) => event.model).filter(Boolean))];
    return session;
  });
}

async function walk(root) {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const files = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
  }
  return files;
}

async function readNames(path) {
  const names = new Map();
  try {
    const contents = await readFile(path, "utf8");
    for (const line of contents.split("\n")) {
      try {
        const row = JSON.parse(line);
        if (row.id && typeof row.thread_name === "string" && row.thread_name.trim()) names.set(row.id, row.thread_name.trim());
      } catch { /* A partial final line must not prevent a refresh. */ }
    }
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  return names;
}

export async function loadUsageIndex({
  codexRoot = join(os.homedir(), ".codex"),
  cacheFilePath = join(codexRoot, "cache", "usage-dashboard-index.json"),
  forceReparse = false
} = {}) {
  let previous;
  try { previous = JSON.parse(await readFile(cacheFilePath, "utf8")); }
  catch (error) { if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
  if (previous?.version !== COUNTING_VERSION) previous = null;
  const names = await readNames(join(codexRoot, "session_index.jsonl"));
  const paths = [...await walk(join(codexRoot, "sessions")), ...await walk(join(codexRoot, "archived_sessions"))].sort();
  const files = {};
  const source = { log_files: paths.length, reused_files: 0, reparsed_files: 0 };
  for (const path of paths) {
    const info = await stat(path);
    const fingerprint = { size: info.size, mtime_ms: Math.trunc(info.mtimeMs) };
    const cached = previous?.files?.[path];
    if (!forceReparse && cached && cached.size === fingerprint.size && cached.mtime_ms === fingerprint.mtime_ms) {
      files[path] = cached;
      source.reused_files += 1;
    } else {
      files[path] = { ...fingerprint, session: await parseSessionLog(path) };
      source.reparsed_files += 1;
    }
  }
  const generatedAt = new Date().toISOString();
  await mkdir(dirname(cacheFilePath), { recursive: true });
  const temporary = `${cacheFilePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify({ version: COUNTING_VERSION, generated_at: generatedAt, files }), "utf8");
  await rename(temporary, cacheFilePath);
  const sessions = reconcileSessions(Object.values(files).map((entry) => entry.session));
  const byId = new Map(sessions.map((session) => [session.session_id, session]));
  const quality = { inherited_tokens_removed: 0, inherited_events_removed: 0, duplicate_snapshots: 0,
    counter_resets: 0, invalid_records: 0, inconsistent_snapshots: 0, missing_parents: 0, lineage_cycles: 0 };
  let earliestDate = null;
  let latestEvent = null;
  for (const session of sessions) {
    session.thread_name = names.get(session.session_id) || session.thread_name || null;
    session.parent_thread_name = names.get(session.parent_session_id) || byId.get(session.parent_session_id)?.thread_name || null;
    for (const key of Object.keys(quality)) if (key in session.quality) quality[key] += session.quality[key] || 0;
    quality.missing_parents += Number(session.quality.missing_parent);
    quality.lineage_cycles += Number(session.quality.lineage_cycle);
    for (const event of session.events) {
      if (!earliestDate || event.date < earliestDate) earliestDate = event.date;
      if (!latestEvent || event.timestamp > latestEvent) latestEvent = event.timestamp;
    }
  }
  const workspaces = [...new Map(sessions.map((session) => [session.workspace_key,
    { workspace_key: session.workspace_key, workspace_label: session.workspace_label }])).values()]
    .sort((a, b) => a.workspace_label.localeCompare(b.workspace_label));
  return { counting_version: COUNTING_VERSION, generated_at: generatedAt,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, earliest_date: earliestDate,
    latest_event_at: latestEvent, sessions, workspaces, source, quality };
}

export function createPublicSnapshot(index) {
  const workspaceId = (key) => `ws_${createHash("sha256").update(key || "unknown").digest("hex").slice(0, 16)}`;
  // Only derived counts and chosen work names leave the collector. Never ship raw log content.
  return {
    snapshot_version: 3, counting_version: COUNTING_VERSION, generated_at: index.generated_at,
    timezone: index.timezone, earliest_date: index.earliest_date, latest_event_at: index.latest_event_at,
    quality: index.quality, source: { log_files: index.source?.log_files || 0 },
    workspaces: index.workspaces.map((workspace) => ({ ...workspace, workspace_key: workspaceId(workspace.workspace_key) })),
    sessions: index.sessions.map((session) => {
      const buckets = new Map();
      for (const event of session.events) {
        const model = resolveModel(event.model);
        const context = contextBand(event);
        const key = [event.date, model.model, model.proxy, context].join("|");
        if (!buckets.has(key)) buckets.set(key, {
          date: event.date, timestamp: event.timestamp, last_timestamp: event.timestamp,
          model: model.model, is_proxy: model.proxy, pricing_context: context, request_count: 0, ...empty()
        });
        const bucket = buckets.get(key);
        sumInto(bucket, event);
        bucket.request_count += 1;
        if (event.timestamp < bucket.timestamp) bucket.timestamp = event.timestamp;
        if (event.timestamp > bucket.last_timestamp) bucket.last_timestamp = event.timestamp;
      }
      return {
        session_id: session.session_id, parent_session_id: session.parent_session_id,
        thread_name: session.thread_name, parent_thread_name: session.parent_thread_name,
        session_started_at: session.session_started_at, is_subagent: session.is_subagent, is_fork: session.is_fork,
        agent_nickname: session.agent_nickname, workspace_key: workspaceId(session.workspace_key), workspace_label: session.workspace_label,
        ...Object.fromEntries(TOKEN_FIELDS.map((key) => [key, session[key] || 0])),
        events: [...buckets.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      };
    })
  };
}
