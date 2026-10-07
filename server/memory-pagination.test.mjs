import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('./java-core-client.mjs',import.meta.url),'utf8');
const factory=source.slice(source.indexOf('function createHttpClient()'),source.indexOf('export function createJavaCoreClient()'));
class JavaCoreError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
function client(requestJava){return vm.runInNewContext(factory+';createHttpClient()',{requestJava,JavaCoreError});}
const entries=Array.from({length:251},(_,id)=>({id:'memory-'+id}));
test('memory management reads every bounded page and preserves token and abort signal',async()=>{
 const calls=[],signal=new AbortController().signal;
 const actual=client(async(path,options)=>{calls.push({path,options});const url=new URL(path,'http://fixture');const offset=Number(url.searchParams.get('offset'));return entries.slice(offset,offset+100);});
 const result=await actual.listTravelMemories('token',signal);
 assert.equal(result.length,251);assert.equal(result[250].id,'memory-250');assert.equal(calls.length,3);
 for(const call of calls){assert.equal(call.options.token,'token');assert.equal(call.options.signal,signal);}
});
test('short first page returns all 51 confirmed sources',async()=>{
 let calls=0;const actual=client(async()=>{calls++;return entries.slice(0,51);});
 assert.equal((await actual.listTravelMemories('token')).length,51);assert.equal(calls,1);
});
test('provider ignoring offset fails explicitly instead of looping or silently hiding records',async()=>{
 let calls=0;const actual=client(async()=>{calls++;return entries.slice(0,100);});
 await assert.rejects(actual.listTravelMemories('token'),error=>error.code==='MEMORY_PAGE_CHANGED');assert.equal(calls,2);
});
test('an exact page multiple terminates on an empty page',async()=>{
 let calls=0;const actual=client(async()=>calls++===0?entries.slice(0,100):[]);
 assert.equal((await actual.listTravelMemories('token')).length,100);assert.equal(calls,2);
});
