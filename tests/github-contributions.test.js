import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CACHE_MS,createCalendarReader,fetchCalendar,parseCalendar,validateCalendar} from '../lib/github-contributions.js';
const timestamp='2026-11-12T12:00:00.000Z';
const days=Array.from({length:365},(_,i)=>({
  date:new Date(Date.parse(timestamp)-(364-i)*86400000).toISOString().slice(0,10),
  count:i===0 ? 1 : i===1 ? 1000 : 0,
  level:i===0 ? 1 : i===1 ? 4 : 0
}));
const labels=days.map(({count},i)=>'<tool-tip for="contribution-day-component-'+i+'">'+(count===0?'No':count.toLocaleString('en-US'))+' contribution'+(count===1?'':'s')+' on November 12th.</tool-tip>');
const cells=days.map(({date,level},i)=>'<td data-date="'+date+'" data-level="'+level+'" id="contribution-day-component-'+i+'"></td>');
function page(c=cells,t=labels,total='1,001') {
  return '<h2 id="js-contribution-activity-description">'+total+' contributions in the last year</h2><div data-graph-url="/users/kjmcawesome/contributions" data-url="/kjmcawesome" data-from="'+days[0].date+' 00:00:00 UTC" data-to="'+days.at(-1).date+' 23:59:59 UTC">'+[...c].reverse().join('')+t.join('')+'</div>';
}
test('uses each official tooltip count, sorts dates, reconciles the displayed total and preserves true zeroes',()=>{
  const snapshot=parseCalendar(page(),timestamp);
  assert.deepEqual(snapshot.days,days);assert.equal(snapshot.total,1001);
  assert.throws(()=>parseCalendar(page(cells,labels.slice(1)),timestamp));
  assert.throws(()=>parseCalendar(page(cells,labels,'1,002'),timestamp));
  assert.throws(()=>parseCalendar(page(cells,labels).replace(days[130].date,days[129].date),timestamp));
  assert.throws(()=>parseCalendar(page().replace('data-url="/kjmcawesome"','data-url="/unknown"'),timestamp));
  assert.throws(()=>parseCalendar(page(),'2025-11-12T12:00:00.000Z'));
});
test('does not treat HTTP errors, sign-in pages, or changed markup as zero activity',async()=>{
  for(const response of [new Response('Sign in',{status:403}),Response.json({days:[]}),new Response('Maintenance',{headers:{'Content-Type':'text/html'}})])
    await assert.rejects(fetchCalendar({fetchFn:async()=>response}));
});
test('live successes are reused, failed refreshes preserve counts and timestamp, and recover after backoff',async()=>{
  let time=Date.parse(timestamp), calls=0, offline=false; const captured=parseCalendar(page(),timestamp);
  const read=createCalendarReader({now:()=>time,collect:async()=>{calls++;if(offline)throw Error('down');return {...captured,fetched_at:new Date(time).toISOString()};}});
  assert.equal((await read()).cache_status,'live');
  time+=CACHE_MS-1;assert.equal((await read()).cache_status,'cached');assert.equal(calls,1);
  offline=true;time+=1;const retained=await read();assert.equal(retained.stale,true);assert.equal(retained.fetched_at,timestamp);
  assert.equal((await read()).total,1001);assert.equal(calls,2);
  offline=false;time+=61_000;assert.equal((await read()).stale,false);assert.equal(calls,3);
});
test('retains a validated packaged backup on cold failure; missing or invalid backup is unavailable',async()=>{
  const captured=parseCalendar(page(),timestamp);const read=createCalendarReader({now:()=>Date.parse(timestamp)+CACHE_MS*2,collect:async()=>{throw Error('down');}});
  await assert.rejects(read({loadBackup:async()=>({...captured,total:0})}));
  const result=await read({loadBackup:async()=>captured});assert.equal(result.cache_status,'backup');assert.equal(result.stale,true);assert.deepEqual(result.days,days);
  assert.throws(()=>validateCalendar({...result,days:days.slice(0,-1)}));
});
