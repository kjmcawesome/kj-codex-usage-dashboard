import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os'; import {join} from 'node:path';
import {cloudFetch} from '../lib/cloud-runtime.js';
import {CALENDAR_KEY,CALENDAR_SYNC_ROUTE,createCalendarReader} from '../lib/github-contributions.js';
import {syncSnapshotToCloud} from '../lib/cloud-sync.js';

const stamp=new Date(Date.now()-100000).toISOString();
const days=Array.from({length:365},(_,i)=>({date:new Date(Date.parse(stamp)-(364-i)*86400000).toISOString().slice(0,10),count:i===364?3:0,level:i===364?1:0}));
const verified={login:'kjmcawesome',profile_url:'https://github.com/kjmcawesome',fetched_at:stamp,total:3,days};
const secret='fictional-unit-test-sync-token-with-32-characters';
const post=(body,token=secret)=>new Request('https://test.site'+CALENDAR_SYNC_ROUTE,{method:'POST',headers:{'x-usage-sync-token':token},body:JSON.stringify(body)});
function bucket(){let stored=null,etag=0;return {get:async(key)=>key!==CALENDAR_KEY||!stored?null:{etag:String(etag),json:async()=>JSON.parse(stored)},put:async(key,body,{onlyIf})=>{
  if (key!==CALENDAR_KEY || (stored ? onlyIf.etagMatches!==String(etag) : onlyIf.etagDoesNotMatch!=='*')) return null;
  stored=body;return {etag:String(++etag)};
}};}
test('collector writes a bounded calendar only with existing authorization; other fields are never persisted',async()=>{
  const env={USAGE_SYNC_TOKEN:secret,BUCKET:bucket()};
  assert.equal((await cloudFetch(post(verified,'wrong'),env)).status,403);
  assert.equal((await cloudFetch(post({...verified,login:'someone-else'}),env)).status,400);
  assert.equal((await cloudFetch(post({...verified,extra:'x'.repeat(66000)}),env)).status,400);
  assert.equal((await cloudFetch(post({...verified,fetched_at:new Date(Date.now()+3600000).toISOString()}),env)).status,400);
  const reply=await cloudFetch(post({...verified,unrelated:'excluded',days:days.map(d=>({...d,unrelated:'excluded'}))}),env);
  assert.equal(reply.status,200);assert.deepEqual(await (await env.BUCKET.get(CALENDAR_KEY)).json(),verified);
  assert.equal((await cloudFetch(post(verified),env)).status,200);
  const earlier={...verified,fetched_at:new Date(Date.parse(stamp)-1000).toISOString()};
  assert.equal((await cloudFetch(post(earlier),env)).status,409);
  assert.equal((await cloudFetch(post({...verified,total:0,days:days.map(d=>({...d,count:0,level:0}))}),env)).status,409);
  assert.deepEqual(await (await env.BUCKET.get(CALENDAR_KEY)).json(),verified);
});
test('a warm worker which fell back to a package sees a new Mac capture on the next request',async()=>{
  let calls=0,stored=null;const read=createCalendarReader({now:()=>Date.parse(stamp)+30000,collect:async()=>{calls++;throw Error('upstream unavailable')}});
  const options={loadCache:async()=>stored,loadBackup:async()=>({...verified,fetched_at:new Date(Date.parse(stamp)-600000).toISOString(),total:0,days:days.map(d=>({...d,count:0,level:0}))})};
  assert.equal((await read(options)).cache_status,'backup');stored=verified;
  const next=await read(options);assert.equal(next.total,3);assert.equal(next.cache_status,'cached');assert.equal(next.stale,false);assert.equal(calls,1);
});
test('Mac sync keeps valid Codex history when GitHub is unavailable and uses separate authenticated destination for GitHub',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'github-calendar-test-'));const configurationPath=join(dir,'config.json');
  try {
    const site='https://dashboard.example.com';
    await writeFile(configurationPath,JSON.stringify({url:site,token:secret,site_access_token:'fixture'}));
    const fetched=[];const fetchFn=async(url,opts)=>{fetched.push(url);assert.equal(opts.headers['x-usage-sync-token'],secret);
      if (url===site+CALENDAR_SYNC_ROUTE) {assert.deepEqual(JSON.parse(opts.body),verified);return Response.json({ok:true,fetched_at:stamp,total:3});}
      assert.equal(url,site+'/api/sync');return Response.json({ok:true,generated_at:stamp});};
    const args={fetchFn,configurationPath};const old=await syncSnapshotToCloud({generated_at:stamp},{...args,collectCalendar:async()=>{throw Error('offline')}});
    assert.equal(old.ok,true);assert.deepEqual(old.github_calendar,{ok:false});assert.deepEqual(fetched,[site+'/api/sync']);
    const next=await syncSnapshotToCloud({generated_at:stamp},{...args,collectCalendar:async()=>({...verified,secret:'never upload'})});
    assert.deepEqual(next.github_calendar,{ok:true,fetched_at:stamp,total:3});
  }finally{await rm(dir,{recursive:true,force:true});}
});
