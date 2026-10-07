import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('./index.mjs',import.meta.url),'utf8');
const start=source.indexOf("  if (req.method === 'DELETE' && /^\\/api\\/trips\\/[^/]+$/.test(url.pathname))");
const end=source.indexOf("  if (req.method === 'GET' && /^\\/api\\/trips\\/[^/]+\\/pdf$/.test(url.pathname))",start);
assert.ok(start>=0&&end>start);
function route(){
 const events=[];
 const ctx=vm.createContext({decodeURIComponent,Number,body:async req=>req.input,
  authUser:async()=>({id:'owner'}),javaTokenFor:()=> 'owner-token',
  javaCore:{async getTrip(){throw new Error('must not replace displayed version');},async deleteTrip(token,id,version){
   events.push({token,id,version});if(version!==2)throw Object.assign(new Error('version changed'),{status:409});return{tripId:id};}},
  persistentStore:{async deleteTripWorkspace(){events.push('workspace deleted');}},
  json:(_res,status,data)=>({status,data}),javaErrorResponse:(_res,error)=>({status:error.status||500})});
 vm.runInContext(`globalThis.run=async(input)=>{const req={method:'DELETE',input},url={pathname:'/api/trips/trip'},res={};${source.slice(start,end)}}`,ctx);
 return{run:ctx.run,events};
}
test('stale displayed version conflicts without deleting workspace',async()=>{
 const h=route();assert.equal((await h.run({expectedVersion:1})).status,409);
 assert.equal(h.events.length,1);assert.equal(h.events[0].version,1);
});
test('current displayed version deletes using owner token',async()=>{
 const h=route();assert.equal((await h.run({expectedVersion:2})).status,200);
 assert.equal(h.events[0].token,'owner-token');assert.equal(h.events[1],'workspace deleted');
});
test('missing and invalid versions never call delete',async()=>{
 for(const value of [undefined,0,-1,1.5,'2',Number.MAX_SAFE_INTEGER+1]){
  const h=route();assert.equal((await h.run({expectedVersion:value})).status,428);assert.equal(h.events.length,0);
 }
});
const front=await readFile(new URL('../frontend/web/src/features/trip-save/save-service.js',import.meta.url),'utf8');
const fstart=front.indexOf('export async function deleteTrip('),fend=front.indexOf('export async function exportTripPdf(',fstart);
function frontend(version,fail=false){
 const state={user:{id:'owner'},savedTrips:[{id:'trip',trip:{version}}]},requests=[];
 const ctx=vm.createContext({state,Number,String,Array,encodeURIComponent,
  toast(){},invalidatePageCache(){},captureAuthentication:()=>({owns:()=>true}),
  request:async(url,options)=>{requests.push(options);if(fail)throw new Error('version changed');},
  getTripChatKey:()=> 'chat',loadUserChats:()=>({}),saveUserChats(){},markPageDataFresh(){}});
 vm.runInContext(front.slice(fstart,fend).replace('export async function','async function')+';globalThis.run=deleteTrip;',ctx);
 return{state,requests,run:ctx.run};
}
test('frontend sends displayed version and restores list on conflict',async()=>{
 const h=frontend(1,true);await h.run('trip');assert.equal(JSON.parse(h.requests[0].body).expectedVersion,1);
 assert.equal(h.state.savedTrips.length,1);
});
test('frontend missing displayed version requires refresh before mutation',async()=>{
 const h=frontend(undefined);let refresh=0;await h.run('trip',{loadTripsCallback:async()=>refresh++});
 assert.equal(refresh,1);assert.equal(h.requests.length,0);assert.equal(h.state.savedTrips.length,1);
});
