import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {dayInZone, shiftDay} from '../public/analytics.js';
const root = new URL('../',import.meta.url);
const json = async (path,value) => writeFile(new URL(path,root),JSON.stringify(value,null,2)+'\n','utf8');

export async function buildDemoSite({now = new Date()} = {}) {
  const snapshot = JSON.parse(await readFile(new URL('config/history-baseline.json',root),'utf8'));
  const today = dayInZone(now,snapshot.timezone);
  const originalEnd = snapshot.generated_at.slice(0,10);
  const shift = value => {
    const offset = Math.round((Date.parse(value+'T12:00:00Z')-Date.parse(originalEnd+'T12:00:00Z'))/86400000);
    return shiftDay(today, offset - 1);
  };
  for (const session of snapshot.sessions) {
    session.session_started_at = shift(session.session_started_at.slice(0,10))+'T12:00:00.000Z';
    session.collected_at = now.toISOString();
    for (const event of session.events) {
      event.date = shift(event.date);
      event.timestamp = event.date+'T12:00:00.000Z';
      event.last_timestamp = event.timestamp;
    }
  }
  snapshot.generated_at = now.toISOString();
  snapshot.earliest_date = snapshot.sessions.flatMap(row=>row.events.map(event=>event.date)).sort()[0];
  snapshot.latest_event_at = snapshot.sessions.flatMap(row=>row.events.map(event=>event.last_timestamp)).sort().at(-1);
  snapshot.source = {...snapshot.source,is_demo:true,storage:'demo',local_recorded_sessions:snapshot.sessions.length};
  await rm(new URL('demo-dist/',root),{recursive:true,force:true});
  const privateData = fileURLToPath(new URL('public/data',root));
  await cp(new URL('public/',root),new URL('demo-dist/',root),{recursive:true,filter:source=>source !== privateData});
  await mkdir(new URL('demo-dist/data/',root),{recursive:true});
  await json('demo-dist/data/usage-snapshot.json',snapshot);
  await cp(new URL('config/project-impact.json',root),new URL('demo-dist/data/project-impact.json',root));
  await json('demo-dist/data/build-info.json',{release:'project-roi-demo',counting_version:3,generated_at:snapshot.generated_at,is_demo:true,
    snapshot_sha256:createHash('sha256').update(await readFile(new URL('demo-dist/data/usage-snapshot.json',root))).digest('hex')});
  await cp(new URL('demo-dist/index.html',root),new URL('demo-dist/404.html',root));
  return snapshot;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const snapshot=await buildDemoSite();
  console.log(`Built a synthetic demo with ${snapshot.sessions.length} example sessions. No local account data was read.`);
}
