import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {BrainLabService} from '../scripts/brain-lab-service.mjs';
import {BrainLiveService} from '../scripts/brain-live-service.mjs';
import {BrainControlService,parseControlDecision,validateControlSettings} from '../scripts/brain-control-service.mjs';
import {parseOrganismDecision} from '../scripts/brain-organisms.mjs';
import {createLocalServer} from '../scripts/local-server.mjs';
const reference=fileURLToPath(new URL('../dist/data/brain-lab-reference.json',import.meta.url));
const settings={mode:'duo',resultId:'reference-200ms',duration_ms:200,seed:42,rounds:3,interval_ms:2000,target_spikes_per_second:10000};
async function until(fn){const begin=Date.now();while(!fn()){if(Date.now()-begin>10000)throw Error('Timed out');await new Promise(r=>setTimeout(r,5));}}
const reply=(value)=>Response.json({message:{content:JSON.stringify(value)}});
async function fixture(){
 const root=await mkdtemp(resolve(tmpdir(),'brain-organisms-')),runner=resolve(root,'worker.cjs');
 await writeFile(runner,`
 const fs=require('node:fs'),crypto=require('node:crypto'); const t=JSON.parse(fs.readFileSync(${JSON.stringify(reference)},'utf8'));
 const args=Object.fromEntries(Array.from({length:(process.argv.length-2)/2},(_,i)=>[process.argv[2+i*2],process.argv[3+i*2]]));
 let seq=0,rate=Number(args['--rate-hz']),seed=Number(args['--seed']),decision=null,buffer='';
 const hash=n=>crypto.createHash('sha256').update(seed+':'+n).digest('hex');
 process.stdin.on('data',c=>{buffer+=c;let n;while((n=buffer.indexOf('\\n'))>=0){const v=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);rate=v.rate_hz;decision=v.decision_id;}});
 setInterval(()=>{seq++;const condition={...t.conditions.find(c=>c.key==='sugar')};condition.downstream_spikes=rate*10+seed;condition.total_spikes=condition.input_spikes+condition.downstream_spikes;
 const data={...t,schema:'brain-live-v1',sequence:seq,network_builds:1,start_ms:(seq-1)*200,end_ms:seq*200,seed,rate_hz:rate,decision_id:decision,
 state_before:hash(seq-1),state_after:hash(seq),conditions:[condition],nodes:t.nodes.map(n=>({...n,counts:{sugar:n.counts.sugar}}))};
 console.log(JSON.stringify({type:'window',recording:data}));},8);
 `);
 const brainOptions={brainRoot:root,python:process.execPath,runner,referenceFiles:[],defaultResult:reference};
 const brain=new BrainLabService(brainOptions);await brain.ready;
 return{root,runner,brainOptions,brain,async close(){await brain.close();await rm(root,{recursive:true,force:true});}};
}
const fastWait=async(ms,value,{signal})=>{signal.throwIfAborted();await new Promise(r=>setImmediate(r));};

test('organism decisions strictly bound own stimulation and message payloads',()=>{
 assert.equal(validateControlSettings(settings).mode,'duo');
 const decision={rate_hz:125,rationale:'Observe the response.',message:'What input are you testing?'};
 assert.deepEqual(parseOrganismDecision(JSON.stringify(decision),parseControlDecision),decision);
 for(const value of [{...decision,recipient:'b'},{...decision,rate_hz:999},{...decision,message:'x'.repeat(241)},
 {...decision,message:{text:'nested'}},{...decision,message:'bad\u0001'},null,[],{}])
 assert.throws(()=>parseOrganismDecision(JSON.stringify(value),parseControlDecision));
});

test('two persistent brains exchange real prompt messages, remain isolated and keep bounded history',async()=>{
 const f=await fixture();let inFlight=0,maxInFlight=0;const requests=[];
 const service=new BrainControlService(f.brain,async(url,options)=>{
   const request=JSON.parse(options.body),context=JSON.parse(request.messages[1].content);requests.push(context);
   inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);await new Promise(r=>setTimeout(r,15));inFlight--;
   const id=context.identity.id;
   return reply({rate_hz:id==='a'?75:(context.inbox.length?125:200),rationale:'Consider my own activity and the received report.',
     message:id==='a'?'I am testing a lower input; what are you observing?':'I received your report and will compare my response.'});
 },{live:{runner:f.runner},wait:fastWait,auditFile:resolve(f.root,'controller.json')});
 try{
   await service.start(settings);
   await until(()=>service.active?.messages.length>=2);
   const [a,b]=service.duo.agents;assert.notEqual(a.live.child.pid,b.live.child.pid);
   assert.equal(a.live.latest.recording.seed,42);assert.equal(b.live.latest.recording.seed,43);
   assert.equal(a.live.latest.recording.organism_id,'a');assert.equal(b.live.latest.recording.organism_id,'b');
   assert.notEqual(a.live.latest.resultId,b.live.latest.resultId);
   assert.equal(a.live.latest.recording.rate_hz,75);assert.equal(b.live.latest.recording.rate_hz,125);
   const aSent=service.active.messages.find(m=>m.sender==='a'),bSent=service.active.messages.find(m=>m.sender==='b');
   const bRequest=requests.find(c=>c.identity.id==='b');
   assert.equal(bRequest.inbox[0].text,aSent.text);assert.equal(bRequest.inbox[0].id,aSent.id);
   assert.equal(bSent.replyTo,aSent.id);
   assert(service.active.steps.find(s=>s.organismId==='b').receivedMessageIds.includes(aSent.id));
   assert.equal(bRequest.latest_measurement.seed,43);assert.equal(bRequest.partner_measurement,undefined);
   const seqA=a.live.latest.recording.sequence,seqB=b.live.latest.recording.sequence;
   await Promise.all([service.communication({enabled:false}),service.save()]);
   await until(()=>requests.some(c=>c.communication_enabled===false&&c.identity.id==='b'));
   const mutedRequest=requests.find(c=>c.communication_enabled===false&&c.identity.id==='b');
   assert.deepEqual(mutedRequest.inbox,[]);
   await until(()=>service.active.messages.some(m=>!m.delivered));
   await until(()=>b.live.latest.recording.rate_hz===200);
   assert(a.live.latest.recording.sequence>seqA);assert(b.live.latest.recording.sequence>seqB);
   assert.equal(b.live.latest.recording.rate_hz,200);
   await service.communication({enabled:true});
   await until(()=>service.active.decisionCount>=49);
   assert.equal(maxInFlight,1);assert.equal(service.active.steps.length,40);assert.equal(service.active.messages.length,40);
   for(const context of requests){assert(context.inbox.length<=4);assert(context.recently_sent.length<=2);
     if(context.identity.id==='b')assert(!context.prior_rounds.some(r=>r.rate_hz===75));}
   assert(a.live.samples.length<=120);assert(b.live.samples.length<=120);
   await service.cancel();assert.equal(a.live.child,null);assert.equal(b.live.child,null);assert.equal(f.brain.controlOwner,null);
   const disk=JSON.parse(await readFile(resolve(f.root,'controller.json'),'utf8'));
   assert.equal(disk.sessions[0].messages.length,40);assert.equal(disk.sessions[0].state,'cancelled');
   assert.equal(service.auditError,null);
 }finally{await service.close();await f.close();}
});

test('failure of the second brain during startup stops the first and releases control',async()=>{
 const f=await fixture();const service=new BrainControlService(f.brain,fetch,{liveFactory:id=>new BrainLiveService(f.brain,
   {instanceId:id,runner:id==='a'?f.runner:resolve(f.root,'missing.cjs')})});
 try{
   await service.start(settings);await service.completion;
   assert.equal((await service.status()).session.state,'failed');
   assert.equal(service.duo.agents[0].live.child,null);assert.equal(service.duo.agents[1].live.child,null);
   assert.equal(f.brain.controlOwner,null);
 }finally{await service.close();await f.close();}
});

test('Stop during second-brain startup or model inference terminates both processes',async()=>{
 const f=await fixture();let count=0,release;
 const gate=new Promise(r=>release=r);f.brain.available=async()=>++count===2?gate:true;
 const service=new BrainControlService(f.brain,async(url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason))),{live:{runner:f.runner}});
 try{
   await service.start(settings);await until(()=>count===2);
   const stopped=service.cancel();release(true);await stopped;
   assert(service.duo.agents.every(a=>a.live.child===null));assert.equal(f.brain.controlOwner,null);
   f.brain.available=async()=>true;
   await service.start(settings);await until(()=>service.active.steps.length>0);
   await service.cancel();assert(service.duo.agents.every(a=>a.live.child===null));
 }finally{await service.close();await f.close();}
});

test('HTTP selection, communication controls, origins and persisted conversation identities remain explicit',async()=>{
 const f=await fixture();const server=createLocalServer(async(url,options)=>{
  const c=JSON.parse(JSON.parse(options.body).messages[1].content);
  return reply({rate_hz:100,rationale:'Hold input.',message:'Hello from '+c.identity.name});
 },{dataDirectory:resolve(f.root,'ecology'),brainLab:f.brainOptions,brainControl:{live:{runner:f.runner},wait:fastWait}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/api/brain/';
 const post=(path,value,origin)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(origin?{origin}:{})},body:JSON.stringify(value)});
 try{
  assert.equal((await post('control/communication',{enabled:false})).status,409);
  assert.equal((await post('control/start',settings)).status,202);await until(()=>server.brainControl.active.messages.length>=2);
  const a=await(await fetch(base+'control/live?organism=a')).json(),b=await(await fetch(base+'control/live?organism=b')).json();
  assert.equal(a.recording.organism_id,'a');assert.equal(b.recording.organism_id,'b');assert.notEqual(a.resultId,b.resultId);
  assert.equal((await fetch(base+'control/live?organism=c')).status,400);
  assert.equal((await post('control/communication',{enabled:false},'https://external.example')).status,403);
  assert.equal((await post('control/communication',{enabled:false,rate_hz:200})).status,400);
  assert.equal((await post('control/communication',{enabled:false})).status,200);
  const status=await(await fetch(base+'control/status')).json();assert.equal(status.session.communication.enabled,false);assert.equal(status.organisms.length,2);
  assert.equal((await post('run',{rate_hz:100,duration_ms:200,seed:42})).status,409);
  await post('control/stop',{});assert.equal((await(await fetch(base+'control/status')).json()).active,false);
 }finally{await server.brainControl.close();await server.brainLab.close();await server.brainObserver.close();await new Promise(r=>server.close(r));await f.close();}
});
