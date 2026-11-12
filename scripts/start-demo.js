import {fileURLToPath} from 'node:url';
import {buildDemoSite} from './build-demo.js';
import {startServer} from '../server.js';
import {buildDashboardPayload,buildDayPayload} from '../lib/usage-data.js';
const snapshot=await buildDemoSite();
startServer({staticRoot:fileURLToPath(new URL('../demo-dist/',import.meta.url)),usageService:{
  getDashboard:async params=>buildDashboardPayload(snapshot,params),
  getDay:async (day,params)=>buildDayPayload(snapshot,day,params),
  refresh:async()=>({ok:true,generated_at:snapshot.generated_at,source:snapshot.source})
}});
