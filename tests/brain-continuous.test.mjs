import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {BrainLabService} from '../scripts/brain-lab-service.mjs';
import {BrainLiveService} from '../scripts/brain-live-service.mjs';
import {BrainControlService,validateControlSettings} from '../scripts/brain-control-service.mjs';
import {validateRecording} from '../dist/brain-lab-data.js';
import {createLocalServer} from '../scripts/local-server.mjs';
const reference=fileURLToPath(new URL('../dist/data/brain-lab-reference.json',import.meta.url));
const initial=JSON.parse(await readFile(reference,'utf8'));
const settings={resultId:'reference-200ms',mode:'continuous',interval_ms:2000,rounds:1,duration_ms:200,seed:42,target_spikes_per_second:10040};
const until=async(fn)=>{const start=Date.now();while(!fn()){if(Date.now()-start>10000)throw Error('Timed out waiting');await new Promise(r=>setTimeout(r,5));}};
async function fixture(corrupt=false){
 const root=await mkdtemp(resolve(tmpdir(),'brain-continuous-')),runner=resolve(root,'live.cjs');
 await writeFile(runner,`
 const fs=require('node:fs'); const template=JSON.parse(fs.readFileSync(${JSON.stringify(reference)},'utf8'));
 let seq=0,rate=150,decision=null,buffer='';
 process.stdin.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\\n'))>=0){const v=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);rate=v.rate_hz;decision=v.decision_id;}});
 setInterval(()=>{seq++;const data={...template,schema:'brain-live-v1',sequence:seq,network_builds:1,start_ms:(seq-1)*200,end_ms:seq*200,rate_hz:rate,seed:42,decision_id:decision,
 state_before:String(seq-1).padStart(64,'0'),state_after:String(seq).padStart(64,'0'),
 nodes:template.nodes.map(n=>({...n,counts:{sugar:n.counts.sugar}})),conditions:[template.conditions.find(c=>c.key==='sugar')]};
 if(${corrupt}&&seq===2)data.state_before='f'.repeat(64);
 console.log(JSON.stringify({type:'window',recording:data}));},5);
 `);
 const brainOptions={brainRoot:root,python:process.execPath,runner,referenceFiles:[],defaultResult:reference};
 const brain=new BrainLabService(brainOptions);await brain.ready;
 return {root,runner,brain,brainOptions,async close(){await brain.close();await rm(root,{recursive:true,force:true});}};
}

test('live recordings contain one actual condition; fabricated paired trials and invalid state boundaries are rejected',()=>{
 const data={...initial,schema:'brain-live-v1',sequence:1,start_ms:0,end_ms:200,state_before:'0'.repeat(64),state_after:'1'.repeat(64),conditions:[initial.conditions.find(c=>c.key==='sugar')]};
 assert.equal(validateRecording(data),data);
 assert.throws(()=>validateRecording({...data,end_ms:250}),/live window/);
 assert.throws(()=>validateRecording({...data,state_after:'missing'}),/live window/);
 assert.throws(()=>validateRecording({...data,conditions:initial.conditions}),/recording/);
 assert.equal(validateControlSettings(settings).mode,'continuous');
 assert.throws(()=>validateControlSettings({...settings,interval_ms:0}));
});

test('continuous control advances during inference, survives hitting the target and bounds history beyond the old round limit',async()=>{
 const f=await fixture();let calls=0,windowsWhileThinking=0;
 const service=new BrainControlService(f.brain,async()=>{
   calls++;const before=service.live.latest.recording.sequence;
   await new Promise(r=>setTimeout(r,40));
   windowsWhileThinking=Math.max(windowsWhileThinking,service.live.latest.recording.sequence-before);
   return Response.json({message:{content:JSON.stringify({rate_hz:100,rationale:'Maintain the measured target.'})}});
 },{live:{runner:f.runner},wait:async(ms,value,{signal})=>{signal.throwIfAborted();await new Promise(r=>setImmediate(r));}});
 try{
   await service.start(settings);
   await until(()=>!service.active||service.active.steps.some(step=>step.round>=23&&step.outcome));
   assert(service.active,JSON.stringify(await service.status()));assert(calls>settings.rounds);assert(windowsWhileThinking>1);
   assert.equal(service.active.steps.length,20);assert(service.live.samples.length<=120);
   const completed=[...service.active.steps].reverse().find(step=>step.outcome);
   assert.equal(completed.targetError,0);
   assert.equal(completed.outcome.rate_hz,100);
   assert.equal(f.brain.resultId,'reference-200ms');
   await assert.rejects(f.brain.run({rate_hz:150,duration_ms:200,seed:42}),/owns/);
   await service.cancel();
   assert.equal(service.live.child,null);assert.equal(f.brain.controlOwner,null);
   assert.equal((await service.status()).session.state,'cancelled');
 }finally{await service.close();await f.close();}
});

test('a broken neural-state chain stops the persistent process',async()=>{
 const f=await fixture(true),live=new BrainLiveService(f.brain,{runner:f.runner});
 const signal=new AbortController().signal;f.brain.acquireControl('state-test');
 try{
   await live.start({duration_ms:200,rate_hz:150,seed:42},'state-test',signal);
   await assert.rejects(live.waitForWindow(r=>r.sequence>=2,signal),/continuity/);
   await live.completion;assert.equal(live.child,null);
 }finally{await live.stop();f.brain.releaseControl('state-test');await f.close();}
});

test('bad or offline LLM decisions hold the existing input and retry without resetting the brain',async()=>{
 const f=await fixture();let calls=0;
 const service=new BrainControlService(f.brain,async()=>{
   calls++;
   if(calls===1)throw Error('Ollama temporarily offline');
   return Response.json({message:{content:calls===2?'{"rate_hz":100,"rationale":"extra field","action":"bad"}':'{"rate_hz":100,"rationale":"Hold input."}'}});
 },{live:{runner:f.runner},wait:async()=>{await new Promise(r=>setTimeout(r,30));}});
 try{
   await service.start(settings);await until(()=>service.active?.steps.some(s=>s.outcome));
   const steps=service.active.steps;
   assert.equal(steps[0].state,'rejected');assert.equal(steps[1].state,'rejected');
   assert.equal(steps[0].appliedSettings,null);assert.equal(steps[1].appliedSettings,null);
   assert.equal(service.live.latest.recording.network_builds,1);
   assert.equal(service.live.latest.recording.rate_hz,100);
   assert.equal(service.active.warning,null);assert(calls>=3);
 }finally{await service.close();await f.close();}
});

test('stopping during persistent startup cannot launch an orphan process',async()=>{
 const f=await fixture();let release,checking=false;
 const gate=new Promise(r=>release=r);f.brain.available=async()=>{checking=true;return gate;};
 const service=new BrainControlService(f.brain,fetch,{live:{runner:f.runner}});
 try{
   await service.start(settings);await until(()=>checking);
   const stopped=service.cancel();release(true);await stopped;
   assert.equal(service.live.child,null);assert.equal(f.brain.controlOwner,null);
 }finally{await service.close();await f.close();}
});

test('live API reconnects to the same clock and retains paired recordings; Stop releases the brain',async()=>{
 const f=await fixture();
 const server=createLocalServer(async()=>Response.json({message:{content:'{"rate_hz":100,"rationale":"Hold the input."}'}}),{
   dataDirectory:resolve(f.root,'ecology'),brainLab:f.brainOptions,brainControl:{live:{runner:f.runner}},
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port+'/api/brain/';
 try{
   const start=await fetch(base+'control/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(settings)});
   assert.equal(start.status,202);await until(()=>server.brainControl.live?.latest);
   const first=await(await fetch(base+'control/live')).json();
   await new Promise(r=>setTimeout(r,40));
   const next=await(await fetch(base+'control/live')).json();assert(next.recording.end_ms>first.recording.end_ms);
   assert.equal((await(await fetch(base+'result')).json()).resultId,'reference-200ms');
   assert.equal((await fetch(base+'control/live',{headers:{origin:'https://elsewhere.example'}})).status,403);
   await fetch(base+'control/stop',{method:'POST'});
   assert.equal((await(await fetch(base+'control/status')).json()).active,false);
   assert.equal(server.brainControl.live.child,null);
 }finally{await server.brainControl.close();await server.brainLab.close();await server.brainObserver.close();await new Promise(r=>server.close(r));await f.close();}
});
