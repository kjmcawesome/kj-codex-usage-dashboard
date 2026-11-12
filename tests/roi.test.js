import test from 'node:test';
import assert from 'node:assert/strict';
import {modelReturn} from '../public/roi.js';

test('unvalued projects have no return, while a zero benefit is a loss',()=>{
  const project={estimated_cost_usd:100};
  assert.equal(modelReturn(project,{}).roi,null);
  assert.equal(modelReturn(project,{hours:'0'}).roi,-1);
  assert.equal(modelReturn(project,{hours:'3'}).roi,null);
  assert.equal(modelReturn(project,{rate:'50'}).breakEvenHours,2);
});
test('ROI includes other investment and benefits and guards partial or zero cost',()=>{
  const project={estimated_cost_usd:100};
  const inputs={hours:'5', rate:'60',benefit:'30',cost:'50'};
  const result=modelReturn(project,inputs);
  assert.equal(result.value,330); assert.equal(result.net,180);
  assert.equal(result.roi,1.2); assert.equal(result.breakEvenHours,2);
  assert.equal(modelReturn({...project,unallocated_tokens:10},inputs).roi,null);
  assert.equal(modelReturn({estimated_cost_usd:0},{benefit:'50'}).roi,null);
  assert.ok(modelReturn(project,{hours:'-1'}).error);
});
