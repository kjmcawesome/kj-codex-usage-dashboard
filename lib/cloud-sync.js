import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {CALENDAR_SYNC_ROUTE,fetchCalendar,validateCalendar} from './github-contributions.js';
const configPath = new URL('../.cloud-sync/config.json',import.meta.url);
import {validateCloudConfiguration} from './cloud-config.js';

async function configForSync(path) {
  let config;
  try { config=JSON.parse(await readFile(path,'utf8')); }
  catch { throw new Error('Cloud sync has not been configured on this Mac. The cloud dashboard is still available.'); }
  return validateCloudConfiguration(config);
}

async function upload(path,value,config,fetchFn) {
  const headers={'Content-Type':'application/json','x-usage-sync-token':config.token};
  if (config.site_access_token) headers['OAI-Sites-Authorization']='Bearer '+config.site_access_token;
  const response=await fetchFn(config.url+path,{method:'POST',redirect:'error',headers,body:JSON.stringify(value),signal:AbortSignal.timeout(path === CALENDAR_SYNC_ROUTE ? 20000 : 90000)});
  let result;
  try { result=await response.json(); } catch { throw new Error('Cloud sync returned an unreadable response.'); }
  if (!response.ok || result.ok!==true) throw new Error(result.error || 'Cloud sync failed ('+response.status+').');
  return result;
}

async function uploadCalendar(config,fetchFn,collectCalendar) {
  const calendar=validateCalendar(await collectCalendar());
  const reply=await upload(CALENDAR_SYNC_ROUTE,calendar,config,fetchFn);
  if (reply.fetched_at!==calendar.fetched_at || reply.total!==calendar.total) throw Error('Cloud sync did not confirm the GitHub calendar.');
  return {ok:true,fetched_at:calendar.fetched_at,total:calendar.total};
}

export async function syncGitHubCalendarToCloud({fetchFn=fetch,collectCalendar=fetchCalendar,configurationPath=configPath}={}) {
  return uploadCalendar(await configForSync(configurationPath),fetchFn,collectCalendar);
}

export async function syncSnapshotToCloud(snapshot,{fetchFn=fetch,collectCalendar=fetchCalendar,configurationPath=configPath}={}) {
  const config=await configForSync(configurationPath);
  const [usage,github]=await Promise.allSettled([upload('/api/sync',snapshot,config,fetchFn),uploadCalendar(config,fetchFn,collectCalendar)]);
  if (usage.status==='rejected') throw usage.reason;
  if (usage.value.generated_at!==snapshot.generated_at) throw new Error('Cloud sync did not confirm this collection.');
  return {...usage.value,github_calendar:github.status==='fulfilled'?github.value:{ok:false}};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--github-only') console.log(JSON.stringify(await syncGitHubCalendarToCloud()));
  else {
    const snapshot=JSON.parse(await readFile(new URL('../public/data/usage-snapshot.json',import.meta.url),'utf8'));
    console.log(JSON.stringify(await syncSnapshotToCloud(snapshot)));
  }
}
