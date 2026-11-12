const COUNTERS = ['total_tokens', 'input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'cache_write_input_tokens'];
const fail = () => { throw new Error('Invalid usage snapshot. The saved cloud history has not been changed.'); };
const text = (value, limit = 500) => typeof value === 'string' && value.length <= limit ? value : fail();
const date = (value, nullable = false) => value == null && nullable ? null : Number.isFinite(Date.parse(value)) ? text(value, 40) : fail();
const number = (value) => Number.isSafeInteger(value) && value >= 0 ? value : fail();
const counts = (row) => Object.fromEntries(COUNTERS.map(key => [key, number(row[key] ?? 0)]));
const numericRecord = (row = {}) => Object.fromEntries(Object.entries(row).filter(([key,value]) => /^[a-z_]+$/.test(key) && Number.isSafeInteger(value) && value >= 0));

// Reconstruct the public schema: arbitrary fields, prompts, paths and tool data
// are never persisted by the cloud endpoint.
export function sanitizeCloudSnapshot(input, now = Date.now()) {
  if (input?.snapshot_version !== 3 || input.counting_version !== 3 || !Array.isArray(input.sessions) || !Array.isArray(input.workspaces) || input.sessions.length > 50000) fail();
  const generated = date(input.generated_at);
  if (Date.parse(generated) > now + 300000) fail();
  const timezone = text(input.timezone, 100);
  try { new Intl.DateTimeFormat('en', {timeZone: timezone}); } catch { fail(); }
  const ids = new Set();
  const sessions = input.sessions.map(row => {
    const id = text(row.session_id, 100);
    if (!id || ids.has(id) || !Array.isArray(row.events) || row.events.length > 100000) fail();
    ids.add(id);
    const collected = date(row.collected_at || generated);
    if (Date.parse(collected) > Date.parse(generated)) fail();
    return {
      session_id:id, parent_session_id:row.parent_session_id == null ? null : text(row.parent_session_id,100),
      thread_name:text(row.thread_name || ''), parent_thread_name:text(row.parent_thread_name || ''),
      session_started_at:date(row.session_started_at,true), is_subagent:row.is_subagent === true, is_fork:row.is_fork === true,
      agent_nickname:text(row.agent_nickname || '',100), workspace_key:text(row.workspace_key,100), workspace_label:text(row.workspace_label || ''),
      collected_at:collected, ...counts(row),
      events:row.events.map(event => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date) || new Date(event.date).toISOString().slice(0,10) !== event.date) fail();
        if (!['short','long','unknown'].includes(event.pricing_context)) fail();
        return {date:event.date, timestamp:date(event.timestamp), last_timestamp:date(event.last_timestamp), model:text(event.model,100), is_proxy:event.is_proxy === true, pricing_context:event.pricing_context, request_count:number(event.request_count), ...counts(event)};
      })
    };
  });
  return {snapshot_version:3, counting_version:3, generated_at:generated, timezone,
    earliest_date:input.earliest_date == null ? null : text(input.earliest_date,10), latest_event_at:date(input.latest_event_at,true),
    quality:numericRecord(input.quality), source:{...numericRecord(input.source), historical_generated_at:date(input.source?.historical_generated_at,true), quality_scope:'current_local_logs'},
    workspaces:input.workspaces.map(row => ({workspace_key:text(row.workspace_key,100),workspace_label:text(row.workspace_label)})), sessions};
}

export function mergeCloudSnapshots(incoming, previous, syncedAt) {
  if (previous && previous.timezone !== incoming.timezone) throw new Error('Snapshot timezones differ. Cloud history was kept.');
  if (previous && Date.parse(previous.generated_at) > Date.parse(incoming.generated_at)) throw new Error('This collection is older than the cloud history. Collect again before syncing.');
  const recorded = new Map((previous?.sessions || []).map(row => [row.session_id,row]));
  for (const row of incoming.sessions) {
    const prior = recorded.get(row.session_id);
    if (!prior || Date.parse(row.collected_at) >= Date.parse(prior.collected_at)) recorded.set(row.session_id,row);
  }
  const sessions = [...recorded.values()];
  const historical = sessions.filter(row => row.collected_at !== incoming.generated_at);
  const eventDates = sessions.flatMap(row => row.events.filter(event => event.total_tokens > 0).map(event => event.date));
  const workspaces = [...new Map([...(previous?.workspaces || []),...incoming.workspaces].map(row => [row.workspace_key,row])).values()];
  return {...incoming,sessions,workspaces,earliest_date:eventDates.sort()[0] || null,
    source:{...incoming.source,recorded_sessions:sessions.length,local_recorded_sessions:sessions.length-historical.length,
      historical_sessions_preserved:historical.length,historical_generated_at:historical.map(row => row.collected_at).sort()[0] || null,
      cloud_synced_at:syncedAt,storage:'cloud'}};
}
