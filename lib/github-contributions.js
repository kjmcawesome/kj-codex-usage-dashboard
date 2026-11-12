// Public contribution counts from GitHub's profile calendar. No account token or repository data is sent.
export const GITHUB_LOGIN = 'kjmcawesome';
export const GITHUB_PROFILE = 'https://github.com/' + GITHUB_LOGIN;
const SOURCE_PATH = '/users/' + GITHUB_LOGIN + '/contributions';
export const CALENDAR_ROUTE = '/data/github-contributions.json';
export const BACKUP_ROUTE = '/data/github-contributions-backup.json';
export const CALENDAR_KEY = 'github/public-profile-calendar-v1.json';
export const CACHE_MS = 15 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const DAY = 86400000;
const invalid = () => { throw Error('GitHub did not return a verified contribution calendar.'); };
function attrs(tag) {
  const result = Object.create(null);
  for (const [, key, , value] of tag.matchAll(/\s([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)) result[key] = value;
  return result;
}

export function validateCalendar(value) {
  if (value?.login !== GITHUB_LOGIN || value.profile_url !== GITHUB_PROFILE || typeof value.fetched_at !== 'string' || !Number.isFinite(Date.parse(value.fetched_at)) ||
      !Array.isArray(value.days) || value.days.length < 365 || value.days.length > 373 ||
      !Number.isSafeInteger(value.total) || value.total < 0) invalid();
  let previous, total = 0;
  for (const {date,count,level} of value.days) {
    const time = Date.parse(date + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(time) || new Date(time).toISOString().slice(0,10) !== date ||
        (previous !== undefined && time - previous !== DAY) || !Number.isSafeInteger(count) || count < 0 ||
        !Number.isInteger(level) || level < 0 || level > 4 || (count === 0) !== (level === 0)) invalid();
    previous = time; total += count;
  }
  // Never report a calendar for a different year as a newly collected calendar.
  if (Math.abs(previous - Date.parse(value.fetched_at.slice(0,10) + 'T00:00:00Z')) > DAY || total !== value.total) invalid();
  return value;
}

export function parseCalendar(html, fetchedAt = new Date().toISOString()) {
  if (typeof html !== 'string' || html.length > 2_000_000) invalid();
  const graph = [...html.matchAll(/<div\b[^>]*\bdata-graph-url\s*=[^>]*>/gi)].map(([t])=>attrs(t))
    .find(a=>a['data-graph-url']===SOURCE_PATH && a['data-url']==='/'+GITHUB_LOGIN);
  const heading = [...html.matchAll(/<h2\b([^>]*)>([^<]*)<\/h2>/gi)].find(([,a])=>attrs(' '+a).id==='js-contribution-activity-description');
  const expected = heading?.[2].trim().match(/^(No|\d[\d,]*)\s+contributions?\s+in the last year$/i);
  if (!graph || !expected) invalid();
  const counts = new Map();
  for (const [,tag,body] of html.matchAll(/<tool-tip\b([^>]*)>([^<]*)<\/tool-tip>/gi)) {
    const id = attrs(' '+tag).for;
    if (!id || !id.startsWith('contribution-day-component-')) continue;
    const match = body.trim().match(/^(No|\d[\d,]*) contributions? on [^.]+\.$/i);
    if (!match || counts.has(id)) invalid();
    counts.set(id, /^no$/i.test(match[1]) ? 0 : Number(match[1].replaceAll(',','')));
  }
  const days = [];
  for (const [tag] of html.matchAll(/<td\b[^>]*>/gi)) {
    const a = attrs(tag);
    if (!Object.hasOwn(a,'data-date')) continue;
    if (!counts.has(a.id) || !/^[0-4]$/.test(a['data-level'])) invalid();
    days.push({date:a['data-date'],count:counts.get(a.id),level:Number(a['data-level'])});
    counts.delete(a.id);
  }
  days.sort((a,b)=>a.date.localeCompare(b.date));
  if (counts.size || graph['data-from']?.slice(0,10)!==days[0]?.date || graph['data-to']?.slice(0,10)!==days.at(-1)?.date) invalid();
  return validateCalendar({login:GITHUB_LOGIN,profile_url:GITHUB_PROFILE,fetched_at:fetchedAt,
    total:/^no$/i.test(expected[1]) ? 0 : Number(expected[1].replaceAll(',','')),days});
}

export async function fetchCalendar({fetchFn=fetch,now=Date.now}={}) {
  const response = await fetchFn('https://github.com'+SOURCE_PATH,{redirect:'error',signal:AbortSignal.timeout(5500),
    headers:{'Accept':'text/html','Accept-Language':'en-US,en;q=0.9','User-Agent':'Project-Economics-Contribution-Calendar/1.0'}});
  if (!response.ok || !/^text\/html\b/i.test(response.headers.get('content-type') || '')) invalid();
  return parseCalendar(await response.text(),new Date(now()).toISOString());
}

// A worker isolate (or local server) caches successful data and retries a failed source at most once per minute.
export function createCalendarReader({collect=fetchCalendar,now=Date.now}={}) {
  let latest = null, retryAfter = 0;
  return async function read({loadCache,saveCache,loadBackup}={}) {
    const load = async fn => { try { if(fn) {const data=validateCalendar(await fn());if(Date.parse(data.fetched_at) <= now()+300000 && (!latest || data.fetched_at > latest.fetched_at)) latest=data;} } catch { /* invalid or missing saved calendar */ } };
    if (!latest) await load(loadCache);
    const age = latest ? now()-Date.parse(latest.fetched_at) : Infinity;
    if (age >= 0 && age < CACHE_MS && !retryAfter) return {...latest,cache_status:'cached',stale:false};
    if (now() >= retryAfter) {
      retryAfter=now()+RETRY_MS; // Concurrent requests may use the backup while one contacts GitHub.
      try {
        const next = validateCalendar(await collect());
        if (latest && next.fetched_at < latest.fetched_at) invalid();
        latest=next; retryAfter=0;
        try { if(saveCache) await saveCache(next); } catch { /* Still usable from memory. */ }
        return {...next,cache_status:'live',stale:false};
      } catch { retryAfter=now()+RETRY_MS; }
    }
    const previous=latest;
    await load(loadBackup);
    if (latest) return {...latest,cache_status:previous===latest?'stale':'backup',stale:true};
    throw Error('GitHub contributions are temporarily unavailable.');
  };
}
