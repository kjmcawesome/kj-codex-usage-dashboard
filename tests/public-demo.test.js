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
