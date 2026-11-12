import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {cloudFetch} from '../lib/cloud-runtime.js';
import {sanitizeCloudSnapshot,mergeCloudSnapshots} from '../lib/cloud-snapshot.js';
import {presentationSnapshot} from '../public/presentation.js';
import {createAnalytics} from '../public/analytics.js';
import {refreshCloudUsage} from '../public/refresh-client.js';
import {createRefreshHelperServer} from '../refresh-helper.js';

const seed=JSON.parse(await readFile(new URL('../config/history-baseline.json',import.meta.url),'utf8'));
const snapshot=sanitizeCloudSnapshot({...seed,sessions:seed.sessions.slice(0,3)});
const secret='unit-test-secret-which-is-at-least-32-characters';
function bucket() {
  let value=null,version=0;
  return { async get(){return value===null?null:{etag:String(version),json:async()=>JSON.parse(value),body:value};},
    async put(key,body,{onlyIf}) {if(value===null ? onlyIf.etagDoesNotMatch !== '*' : onlyIf.etagMatches !== String(version)) return null; value=body;version++;return {etag:String(version)};} };
}
const post=(value=snapshot,token=secret)=>new Request('https://test.site/api/sync',{method:'POST',headers:{'x-usage-sync-token':token},body:JSON.stringify(value)});

test('cloud uploads require authorization, strip arbitrary content, and survive a new worker invocation',async()=>{
  const env={BUCKET:bucket(),USAGE_SYNC_TOKEN:secret};
  assert.equal((await cloudFetch(post(snapshot,'wrong'),env)).status,403);
  const result=await cloudFetch(post({...snapshot,prompts:['never store'],sessions:snapshot.sessions.map(row=>({...row,raw_prompt:'secret'}))}),env);
  assert.equal(result.status,200);
  const response=await cloudFetch(new Request('https://test.site/data/usage-snapshot.json'),env);
  const saved=await response.json();
  assert.equal(saved.sessions.length,3);assert.equal(saved.source.storage,'cloud');
  assert.ok(!JSON.stringify(saved).includes('secret'));assert.ok(!('prompts' in saved));
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');
});

test('cloud merges preserve missing sessions, reject stale collections, and retry conditional conflicts',async()=>{
  const env={BUCKET:bucket(),USAGE_SYNC_TOKEN:secret};
  assert.equal((await cloudFetch(post(),env)).status,200);
  const newer={...snapshot,generated_at:new Date(Date.parse(snapshot.generated_at)+1000).toISOString(),sessions:[{...snapshot.sessions[0],collected_at:new Date(Date.parse(snapshot.generated_at)+1000).toISOString()}]};
  const original=env.BUCKET.put; let calls=0;
  env.BUCKET.put=async(...args)=>++calls===1?null:original(...args);
  assert.equal((await cloudFetch(post(newer),env)).status,200);assert.equal(calls,2);
  const saved=await (await env.BUCKET.get()).json();assert.equal(saved.sessions.length,3);
  assert.equal((await cloudFetch(post(snapshot),env)).status,409);
});

test('storage failures never turn into a successful old fallback; only absent data uses the seed',async()=>{
  const request=new Request('https://test.site/data/usage-snapshot.json');
  let fallback=0;const serve=()=>{fallback++;return Response.json(snapshot);};
  assert.equal((await cloudFetch(request,{BUCKET:bucket()},serve)).status,200);assert.equal(fallback,1);
  assert.equal((await cloudFetch(request,{BUCKET:{get:async()=>{throw Error('down');}}},serve)).status,503);assert.equal(fallback,1);
});

test('invalid numbers, duplicate sessions and future collection dates cannot overwrite cloud history',()=>{
  assert.throws(()=>sanitizeCloudSnapshot({...snapshot,sessions:[snapshot.sessions[0],snapshot.sessions[0]]}));
  assert.throws(()=>sanitizeCloudSnapshot({...snapshot,generated_at:'2099-01-01T00:00:00Z'}));
  assert.throws(()=>sanitizeCloudSnapshot({...snapshot,sessions:[{...snapshot.sessions[0],total_tokens:-1}]}));
  assert.throws(()=>mergeCloudSnapshots(snapshot,{...snapshot,timezone:'UTC'},new Date().toISOString()));
});

test('presentation mode removes identifying labels from all analytic drilldowns without changing amounts',()=>{
  const source={...snapshot,sessions:snapshot.sessions.map(row=>({...row,thread_name:'Sensitive Client',parent_thread_name:'Sensitive Parent',agent_nickname:'Internal Name',workspace_label:'Private Folder'})),workspaces:snapshot.workspaces.map(row=>({...row,workspace_label:'Private Folder'}))};
  const presented=presentationSnapshot(source);
  const original=createAnalytics(source).dashboard({days:'all'});
  const analytics=createAnalytics(presented);const report=analytics.dashboard({days:'all'});
  assert.equal(report.summary.total_tokens,original.summary.total_tokens);
  assert.equal(report.summary.estimated_cost_usd,original.summary.estimated_cost_usd);
  const surfaces=JSON.stringify({presented,report,details:report.projects.map(row=>analytics.breakdown('project',row.project_id,{days:'all'}))});
  assert.ok(!/Sensitive|Internal Name|Private Folder/.test(surfaces));
  assert.ok(!presented.sessions.some(row=>/^Project \d+$/.test(row.thread_name)));
  const named=presentationSnapshot(source,{[source.sessions[0].session_id]:{presentation_label:'Recruiting connections site',project_label:'Sensitive Client'}});
  assert.equal(named.sessions[0].thread_name,'Recruiting connections site');
  assert.equal(named.sessions[0].total_tokens,source.sessions[0].total_tokens);
  assert.equal(source.sessions[0].thread_name,'Sensitive Client');
});

test('Refresh on another device only reads cloud data and never contacts localhost',async()=>{
  const calls=[];const result=await refreshCloudUsage({fetchFn:async(url)=>{calls.push(url);return Response.json(snapshot);}});
  assert.equal(calls.length,1);assert.ok(calls[0].startsWith('./data/usage-snapshot.json'));
  assert.equal(result.source,'cloud');assert.equal(result.rebuilt,false);
});

test('a successful sync is not reported fresh until its new collection is read back',async()=>{
  const newer=new Date(Date.parse(snapshot.generated_at)+1000).toISOString();
  await assert.rejects(refreshCloudUsage({syncMac:true,fetchFn:async url=>Response.json(url.includes('sync-cloud')?{ok:true,generated_at:newer}:snapshot)}),/newly synced/);
});

test('cloud sync cannot be triggered from a foreign webpage, absent Origin, or a rebinding Host',async()=>{
  let writes=0;
  const server=createRefreshHelperServer({refreshFn:async()=>({generated_at:snapshot.generated_at}),snapshotFn:async()=>snapshot,syncFn:async()=>{writes++;return {ok:true,generated_at:snapshot.generated_at};}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/sync-cloud`;
  try {
    for(const headers of [{},{Origin:'https://evil.example','Content-Type':'application/json'},{Origin:'https://public.example.com','Content-Type':'application/json'},{Origin:'https://dashboard.example.com','Content-Type':'text/plain'}]) assert.equal((await fetch(url,{method:'POST',headers,body:'{}'})).status,403,JSON.stringify(headers));
    const {request}=await import('node:http');
    const rebound=await new Promise((resolve,reject)=>{const req=request(url,{method:'POST',headers:{Host:'evil.example',Origin:'http://localhost','Content-Type':'application/json'}},response=>{response.resume();resolve(response.statusCode);});req.on('error',reject);req.end('{}');});
    assert.equal(rebound,403);
    assert.equal(writes,0);
    assert.equal((await fetch(url,{method:'POST',headers:{Origin:'https://dashboard.example.com','Content-Type':'application/json'},body:'{}'})).status,200);
    assert.equal(writes,1);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
