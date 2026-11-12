import {CALENDAR_ROUTE,CALENDAR_SYNC_ROUTE,BACKUP_ROUTE,CALENDAR_KEY,createCalendarReader,validateCalendar} from './github-contributions.js';
import {sanitizeCloudSnapshot, mergeCloudSnapshots} from './cloud-snapshot.js';

const readCalendar = createCalendarReader();
const KEY = 'usage/current.json';
const MAX_BYTES = 12 * 1024 * 1024;
const json = (payload,status=200) => Response.json(payload,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});

async function authorized(request,secret) {
  if (!secret || secret.length < 32) return false;
  const supplied = request.headers.get('x-usage-sync-token') || '';
  if (supplied.length > 256) return false;
  const encode = value => new TextEncoder().encode(value);
  const [a,b] = await Promise.all([crypto.subtle.digest('SHA-256',encode(secret)),crypto.subtle.digest('SHA-256',encode(supplied))]);
  return new Uint8Array(a).every((value,index) => value === new Uint8Array(b)[index]);
}

async function boundedJson(request,limit=MAX_BYTES) {
  if (!request.body) throw new Error('Upload a usage snapshot.');
  const reader = request.body.getReader();
  const parts = []; let size = 0;
  while (true) {
    const {value,done} = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error('Usage snapshot exceeds the upload limit.'); }
    parts.push(value);
  }
  const body = new Uint8Array(size); let offset = 0;
  for (const part of parts) { body.set(part,offset); offset += part.byteLength; }
  return JSON.parse(new TextDecoder().decode(body));
}

async function saveCalendar(bucket,value) {
  const calendar=validateCalendar(value);
  if (Date.parse(calendar.fetched_at)>Date.now()+300000) throw Error('Future collection time.');
  const body=JSON.stringify(calendar);
  for (let i=0;i<3;i++) {
    const old=await bucket.get(CALENDAR_KEY);
    if (old) {
      const existing=validateCalendar(await old.json());
      if (existing.fetched_at>calendar.fetched_at || (existing.fetched_at===calendar.fetched_at && JSON.stringify(existing)!==body)) return false;
      if (existing.fetched_at===calendar.fetched_at) return true;
    }
    const saved=await bucket.put(CALENDAR_KEY,body,{httpMetadata:{contentType:'application/json'},onlyIf:old ? {etagMatches:old.etag} : {etagDoesNotMatch:'*'}});
    if (saved) return true;
  }
  return false;
}

export async function cloudFetch(request,env,serveAsset) {
  const path = new URL(request.url).pathname;
  if (path === CALENDAR_SYNC_ROUTE) {
    if (request.method!=='POST') return json({error:'Method not allowed'},405);
    if (!await authorized(request,env.USAGE_SYNC_TOKEN)) return json({error:'Sync is restricted to the configured collector.'},403);
    if (!env.BUCKET) return json({error:'Cloud storage is unavailable.'},503);
    let incoming;
    try {
      incoming=validateCalendar(await boundedJson(request,65536));
      if (Date.parse(incoming.fetched_at)>Date.now()+300000) throw Error();
    } catch { return json({error:'Invalid GitHub calendar. The saved calendar was kept.'},400); }
    try {
      if (!await saveCalendar(env.BUCKET,incoming)) return json({error:'A newer calendar is already saved. Refresh for the latest count.'},409);
      return json({ok:true,fetched_at:incoming.fetched_at,total:incoming.total});
    } catch { return json({error:'Calendar storage unavailable. The saved calendar was kept.'},503); }
  }
  if (path === CALENDAR_ROUTE) {
    if (!['GET','HEAD'].includes(request.method)) return json({error:'Method not allowed'},405);
    try {
      const data=await readCalendar({
        loadCache:async()=> (await env.BUCKET?.get(CALENDAR_KEY))?.json(),
        saveCache:async value=> env.BUCKET && saveCalendar(env.BUCKET,value),
        loadBackup:async()=> (await serveAsset(new Request(new URL(BACKUP_ROUTE,request.url)))).json()
      });
      return new Response(request.method === 'HEAD' ? null : JSON.stringify(data),{headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
    } catch { return json({error:'GitHub contributions are temporarily unavailable.'},503); }
  }
  if (path === '/api/sync') {
    if (request.method !== 'POST') return json({error:'Method not allowed'},405);
    if (!await authorized(request,env.USAGE_SYNC_TOKEN)) return json({error:'Sync is restricted to the configured collector.'},403);
    if (!env.BUCKET) return json({error:'Cloud storage is unavailable.'},503);
    let incoming;
    try { incoming = sanitizeCloudSnapshot(await boundedJson(request)); }
    catch (error) { return json({error:error.message},400); }
    try {
      for (let attempt=0;attempt<3;attempt++) {
        const stored = await env.BUCKET.get(KEY);
        const prior = stored ? sanitizeCloudSnapshot(await stored.json()) : null;
        let merged;
        try { merged = mergeCloudSnapshots(incoming,prior,new Date().toISOString()); }
        catch (error) { return json({error:error.message},409); }
        const body = JSON.stringify(merged);
        if (new TextEncoder().encode(body).length > MAX_BYTES) return json({error:'Preserved history exceeds the storage limit. Existing cloud data was kept.'},413);
        const saved = await env.BUCKET.put(KEY,body,{httpMetadata:{contentType:'application/json'},onlyIf:stored ? {etagMatches:stored.etag} : {etagDoesNotMatch:'*'}});
        if (saved) return json({ok:true,generated_at:merged.generated_at,cloud_synced_at:merged.source.cloud_synced_at,session_count:merged.sessions.length});
      }
      return json({error:'Another sync updated the cloud history. Please retry.'},409);
    } catch { return json({error:'Cloud storage could not save the update. Your previous history is still available.'},503); }
  }
  if (path === '/data/usage-snapshot.json') {
    if (!['GET','HEAD'].includes(request.method)) return json({error:'Method not allowed'},405);
    if (!env.BUCKET) return json({error:'Cloud storage is unavailable.'},503);
    try {
      const stored = await env.BUCKET.get(KEY);
      if (!stored) return serveAsset(request);
      return new Response(request.method === 'HEAD' ? null : stored.body,{headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
    } catch { return json({error:'Cloud history is temporarily unavailable. Please retry.'},503); }
  }
  return serveAsset(request);
}
