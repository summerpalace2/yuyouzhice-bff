import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./java-core-client.mjs', import.meta.url), 'utf8');
const start = source.indexOf('function plannerConversationBody(');
const end = source.indexOf('function applyAdjustmentBody(', start);
assert.ok(start >= 0 && end > start);
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);

test('planner bridge retains opaque continuation and explicit reset through Java boundary', () => {
  const body = context.plannerConversationBody({baseRevision:2,message:'',context:{activeDay:2,pendingIntentId:'opaque',resetConversation:true}});
  assert.equal(body.context.activeDay,2);
  assert.equal(body.context.pendingIntentId,'opaque');
  assert.equal(body.context.resetConversation,true);
});

test('planner bridge reset requires boolean true and does not forward client operation', () => {
  const body = context.plannerConversationBody({context:{resetConversation:'true',operation:'REMOVE_STOP'}});
  assert.equal(body.context.resetConversation,false);
  assert.equal(body.context.pendingIntentId,null);
  assert.equal(body.context.operation,undefined);
});
