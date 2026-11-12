import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readHistoryBaseline,readPreviousSnapshot} from '../lib/history.js';
import {validateCloudConfiguration} from '../lib/cloud-config.js';

test('synthetic snapshots cannot enter retained personal history',async()=>{
  const root=await mkdtemp(join(tmpdir(),'demo-history-'));
  try {
    const file=join(root,'snapshot.json');
    await writeFile(file,JSON.stringify({source:{is_demo:true},sessions:[{session_id:'demo-only'}]}));
    assert.equal(await readHistoryBaseline(file),null);
    assert.equal(await readPreviousSnapshot(file),null);
    const personal={source:{is_demo:false},sessions:[{session_id:'synthetic-personal-test'}]};
    await writeFile(file,JSON.stringify(personal));
    assert.deepEqual(await readPreviousSnapshot(file),personal);
    assert.deepEqual(await readHistoryBaseline(file),personal);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('cloud sync configuration requires a clean HTTPS origin and a private token',()=>{
  const token='test-only-not-a-real-token'.repeat(2);
  assert.equal(validateCloudConfiguration({url:'https://dashboard.example.com',token}).url,'https://dashboard.example.com');
  for(const url of ['http://dashboard.example.com','https://user:password@dashboard.example.com','https://dashboard.example.com/path','https://dashboard.example.com/?secret=test']) {
    assert.throws(()=>validateCloudConfiguration({url,token}));
  }
  assert.throws(()=>validateCloudConfiguration({url:'https://dashboard.example.com',token:'short'}));
});

test('calendar-only sync uses the configured HTTPS origin without a platform header on hosts that do not need one',async()=>{
  const {syncGitHubCalendarToCloud}=await import('../lib/cloud-sync.js');
  const {CALENDAR_SYNC_ROUTE}=await import('../lib/github-contributions.js');
  const root=await mkdtemp(join(tmpdir(),'calendar-sync-'));
  try {
    const configurationPath=join(root,'config.json');
    const url='https://dashboard.example.com',token='unit-test-collector-token-'.repeat(2);
    await writeFile(configurationPath,JSON.stringify({url,token}));
    const fetched_at='2026-11-12T12:00:00.000Z';
    const days=Array.from({length:365},(_,i)=>({date:new Date(Date.parse(fetched_at)-(364-i)*86400000).toISOString().slice(0,10),count:0,level:0}));
    const calendar={login:'kjmcawesome',profile_url:'https://github.com/kjmcawesome',fetched_at,days,total:0};
    let uploads=0;
    const receipt=await syncGitHubCalendarToCloud({configurationPath,collectCalendar:async()=>calendar,fetchFn:async (endpoint,options)=>{
      uploads++;
      assert.equal(endpoint,url+CALENDAR_SYNC_ROUTE);assert.equal(options.redirect,'error');assert.equal(options.method,'POST');
      const h=new Headers(options.headers);assert.equal(h.get('x-usage-sync-token'),token);assert.equal(h.has('OAI-Sites-Authorization'),false);
      assert.equal(JSON.parse(options.body).days.length,365);assert.equal(JSON.parse(options.body).sessions,undefined);
      return Response.json({ok:true,total:0,fetched_at});
    }});
    assert.equal(uploads,1);assert.equal(receipt.fetched_at,fetched_at);
  } finally { await rm(root,{recursive:true,force:true}); }
});
