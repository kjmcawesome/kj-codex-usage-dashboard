import test from 'node:test';
import assert from 'node:assert/strict';
import { priceEvent, resolveModel } from '../public/pricing.js';
import { createPublicSnapshot } from '../lib/telemetry.js';
import { modelDisplayName } from '../public/model-usage.js';
import { renderTokenMix, renderDirectHelper } from '../public/view.js';

const close = (a,b) => assert.ok(Math.abs(a-b)<1e-9, `${a} != ${b}`);
test('published GPT-6 models retain identity and use their own standard and long-context rates',()=>{
 for(const [model,expected] of [['gpt-6-astra',2.225],['gpt-6-sol',.445],['gpt-6-luna',.02225]]) {
  const event={model,input_tokens:200000,cached_input_tokens:100000,cache_write_input_tokens:50000,output_tokens:20000,total_tokens:220000,context_input_tokens:272000};
  assert.equal(resolveModel(model).proxy,false);
  assert.equal(resolveModel(model+'-2026-09-22').model,model);
  const short=priceEvent(event), long=priceEvent({...event,context_input_tokens:272001});
  close(short.estimated_cost_usd,expected);
  close(long.estimated_cost_usd,expected*2-short.cost_components.output*.5);
  assert.match(modelDisplayName({model,is_proxy:false}),/^GPT-6 /);
  const snapshot=createPublicSnapshot({generated_at:'2026-09-23T04:00:00Z',timezone:'America/Los_Angeles',workspaces:[],sessions:[{session_id:'a',events:[{...event,date:'2026-09-22',timestamp:'2026-09-23T03:00:00Z'}]}]});
  assert.equal(snapshot.sessions[0].events[0].model,model);
  assert.equal(snapshot.sessions[0].events[0].is_proxy,false);
 }
 assert.equal(resolveModel('unlisted-model').proxy,true);
});
test('token composition counts each bucket once and helper exclusion is explicit',()=>{
 const summary={total_tokens:100,input_tokens:80,cached_input_tokens:50,cache_write_input_tokens:10,fresh_input_tokens:20,output_tokens:15,unallocated_tokens:5,direct_cost_usd:2,direct_tokens:75,helper_cost_usd:1,helper_tokens:25};
 const html=renderTokenMix(summary);
 const proportions=[...html.matchAll(/style="flex:([0-9]+)"/g)].map(m=>Number(m[1]));
 assert.equal(proportions.reduce((a,b)=>a+b,0),100);
 assert.match(html,/Unclassified/);
 assert.match(renderDirectHelper(summary,false),/Excluded/);
 assert.doesNotMatch(renderDirectHelper(summary,false),/\$1\.00/);
 assert.match(renderTokenMix({total_tokens:0}),/No tokens recorded/);
});

test('legacy public publishing stays disabled when using the workspace Site', async () => {
  const { publishPages } = await import('../scripts/publish-pages.js');
  await assert.rejects(publishPages(), /Legacy public GitHub publication is disabled/);
});
