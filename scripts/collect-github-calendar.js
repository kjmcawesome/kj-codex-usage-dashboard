import {mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {fetchCalendar,validateCalendar} from '../lib/github-contributions.js';
const dir=new URL('../public/data/',import.meta.url);
const output=new URL('github-contributions-backup.json',dir);

export async function refreshCalendarBackup() {
  let result;
  try { result=await fetchCalendar(); }
  catch {
    // An offline rebuild preserves the last successfully validated counts and collection time.
    try { result=validateCalendar(JSON.parse(await readFile(output,'utf8')));return {calendar:result,refreshed:false}; }
    catch { console.warn('GitHub calendar not available during build; the live endpoint will retry.');return {calendar:null,refreshed:false}; }
  }
  await mkdir(dir,{recursive:true});
  const tmp=new URL('github-contributions-backup.'+process.pid+'.tmp',dir);
  try { await writeFile(tmp,JSON.stringify(result)+'\n');await rename(tmp,output); } finally {await rm(tmp,{force:true});}
  return {calendar:result,refreshed:true};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const {calendar,refreshed}=await refreshCalendarBackup();
  if (!calendar) process.exitCode=1;
  else console.log(JSON.stringify({login:calendar.login,total:calendar.total,days:calendar.days.length,fetched_at:calendar.fetched_at,refreshed}));
}
