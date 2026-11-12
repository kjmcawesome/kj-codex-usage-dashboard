import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {validateCloudConfiguration} from './cloud-config.js';
const configPath = new URL('../.cloud-sync/config.json',import.meta.url);

export async function syncSnapshotToCloud(snapshot,{fetchFn=fetch,configurationPath=configPath}={}) {
  let config;
  try { config = JSON.parse(await readFile(configurationPath,'utf8')); }
  catch { throw new Error('Cloud sync is not configured. Your saved history is unchanged.'); }
  config = validateCloudConfiguration(config);
  const headers = {'Content-Type':'application/json','x-usage-sync-token':config.token};
  if (config.site_access_token) headers['OAI-Sites-Authorization'] = `Bearer ${config.site_access_token}`;
  const response = await fetchFn(`${config.url}/api/sync`,{method:'POST',redirect:'error',headers,
    body:JSON.stringify(snapshot),signal:AbortSignal.timeout(90000)});
  let result;
  try { result=await response.json(); } catch { throw new Error('Cloud sync returned an unreadable response. The saved cloud history was kept.'); }
  if (!response.ok || result.ok !== true) throw new Error(result.error || `Cloud sync failed (${response.status}).`);
  if (result.generated_at !== snapshot.generated_at) throw new Error('Cloud sync did not confirm this collection.');
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const snapshot=JSON.parse(await readFile(new URL('../public/data/usage-snapshot.json',import.meta.url),'utf8'));
  console.log(JSON.stringify(await syncSnapshotToCloud(snapshot)));
}
