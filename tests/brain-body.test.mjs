import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {BrainBodyWorld} from '../dist/sim/brain-body-world.js';
import {BrainLabService} from '../scripts/brain-lab-service.mjs';
import {BrainLiveService} from '../scripts/brain-live-service.mjs';
import {BrainControlService} from '../scripts/brain-control-service.mjs';
import {validateBodyWindow} from '../scripts/brain-embodied.mjs';
import {createLocalServer} from '../scripts/local-server.mjs';
const reference=fileURLToPath(new URL('../dist/data/brain-lab-reference.json',import.meta.url));
const settings={resultId:'reference-200ms',mode:'physical',duration_ms:100,seed:42,rounds:1,interval_ms:2000,target_spikes_per_second:10000};
const until=async(fn)=>{const start=Date.now();while(!fn()){if(Date.now()-start>10000)throw Error('Timed out');await new Promise(r=>setTimeout(r,5));}};
const motors=(l=50,r=l)=>({a:{left_hz:l,right_hz:r},b:{left_hz:l,right_hz:r}});
function assertSpace(world){for(const b of world.bodies)assert(world.validPosition(b));assert(Math.hypot(world.bodies[0].x-world.bodies[1].x,world.bodies[0].y-world.bodies[1].y)>=world.bodies[0].radius+world.bodies[1].radius-1e-6);}

test('sensory input reflects food gradients, occlusion, touch and energy state',()=>{
 const w=new BrainBodyWorld();w.food=[{id:'food',x:58,y:66,radius:1,amount:1}];
 const rates=w.sense('a');assert(rates.left_hz>rates.right_hz);assert.equal(rates.contact_hz,20);
 w.bodies[0].touch=1;assert.equal(w.sense('a').contact_hz,250);
 w.food=[{id:'hidden',x:145,y:75,amount:1}];assert.equal(w.sense('a').left_hz,30);assert.equal(w.sense('a').right_hz,30);
 w.bodies[0].alive=false;assert.deepEqual(w.sense('a'),{left_hz:0,right_hz:0,contact_hz:0});
});

test('zero neural motor output cannot seek food or move a resting body',()=>{
 const w=new BrainBodyWorld(),initial=w.bodies.map(b=>({x:b.x,y:b.y,angle:b.angle}));
 for(let i=0;i<100;i++)w.advance(motors(0),100);
 w.bodies.forEach((b,i)=>{assert.deepEqual({x:b.x,y:b.y,angle:b.angle},initial[i]);assert.equal(b.distance,0);assert.equal(b.meals,0);assert(b.energy<100);});
});

test('measured motors create motion, contact feeding and a closed sensory loop',()=>{
 const w=new BrainBodyWorld(),start=w.sense('a');
 for(let i=0;i<25;i++)w.advance(motors(),100);
 assert(w.bodies[0].distance>10);assert(w.bodies[0].meals>0);assert(w.bodies[1].meals>0);
 assert(w.events.some(e=>e.type==='ate-food'));assert.notDeepEqual(w.sense('a'),start);assertSpace(w);
});

test('bodies bump, slide and remain outside each other, walls and solid objects over long runs',()=>{
 const w=new BrainBodyWorld();w.obstacles=[];Object.assign(w.bodies[0],{x:100,y:75,angle:0});Object.assign(w.bodies[1],{x:110,y:75,angle:Math.PI});
 for(let i=0;i<30;i++){w.advance(motors(70),100);assertSpace(w);}
 assert(w.events.some(e=>e.type==='body-contact'));
 const arena=new BrainBodyWorld();
 for(let i=0;i<500;i++){arena.advance(motors(50+20*Math.sin(i/5),45+25*Math.cos(i/7)),100);assertSpace(arena);}
 assert(arena.bodies.every(b=>b.trail.length<=240));assert(arena.events.length<=60);assert(arena.motion.length<=11);
});

test('invalid motor output cannot corrupt the physical world and depleted energy disables motion',()=>{
 const w=new BrainBodyWorld(),before=w.snapshot();assert.throws(()=>w.advance(motors(NaN),100));assert.deepEqual(w.snapshot(),before);
 w.bodies.forEach(b=>{b.energy=.0001;});w.food=[];w.advance(motors(0),100);
 assert(w.bodies.every(b=>!b.alive));const position=w.bodies.map(b=>b.x);w.advance(motors(500),100);assert.deepEqual(w.bodies.map(b=>b.x),position);
});

test('a driven body detects obstacles and keeps moving instead of permanently pressing',()=>{
 const w=new BrainBodyWorld();w.food=[];let avoided=false;
 for(let i=0;i<100;i++){w.advance(motors(50),100);assertSpace(w);avoided ||=w.bodies.some(b=>b.mind.intent==='avoiding');}
 assert(avoided);assert(w.bodies.every(b=>b.distance>80));
});

test('contact escape frees every corner while preserving body-space constraints',()=>{
 for(const [x,y,angle] of [[4.5,4.5,Math.PI*1.25],[235.5,4.5,-Math.PI/4],[4.5,145.5,Math.PI*.75],[235.5,145.5,Math.PI/4]]){
  const w=new BrainBodyWorld();w.food=[];w.obstacles=[];Object.assign(w.bodies[0],{x,y,angle});
  for(let i=0;i<50;i++){w.advance(motors(50),100);assertSpace(w);}
  assert(Math.hypot(w.bodies[0].x-x,w.bodies[0].y-y)>20);
 }
});

test('feeding and recovery change locomotor state instead of continuous forward motion',()=>{
 const w=new BrainBodyWorld();let fed=false,slowed=false,scanned=false;
 for(let i=0;i<40;i++){w.advance(motors(50),100);const b=w.bodies[0];
  fed ||=b.mind.intent==='feeding';slowed ||=fed&&Math.hypot(b.vx,b.vy)<3;scanned ||=b.mind.intent==='scanning';
 }
 assert(fed&&slowed&&scanned);const b=w.bodies[0];b.mind.fatigue=.9;b.mind.feedUntil=0;b.mind.escapeUntil=0;
 w.food=[];w.obstacles=[];Object.assign(b,{x:50,y:50,vx:0,vy:0});w.advance(motors(50),100);
 assert.equal(b.mind.intent,'resting');assert(b.mind.fatigue<.9);
});

test('exploration is reproducible and individuals can deviate with independent stochastic state',()=>{
 const a=new BrainBodyWorld(42),b=new BrainBodyWorld(42),c=new BrainBodyWorld(43);
 for(let i=0;i<60;i++){a.advance(motors(50),100);b.advance(motors(50),100);c.advance(motors(50),100);}
 assert.deepEqual(a.snapshot(),b.snapshot());assert.notDeepEqual(a.bodies.map(o=>[o.x,o.y]),c.bodies.map(o=>[o.x,o.y]));
});

async function fixture(){
 const root=await mkdtemp(resolve(tmpdir(),'brain-body-')),runner=resolve(root,'body.cjs');
 await writeFile(runner,`
 const fs=require('node:fs'),crypto=require('node:crypto'),template=JSON.parse(fs.readFileSync(${JSON.stringify(reference)},'utf8'));
 const args={};for(let i=2;i<process.argv.length;i++){if(process.argv[i]==='--external-step')continue;args[process.argv[i]]=process.argv[++i];}
 const seed=Number(args['--seed']),duration=Number(args['--window-ms']);let seq=0,buffer='';const pool=template.nodes.filter(n=>!n.input).slice(0,2).map(n=>n.index);
 const hash=n=>crypto.createHash('sha256').update(seed+':'+n).digest('hex');
 console.log(JSON.stringify({type:'ready'}));
 process.stdin.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\\n'))>=0){const command=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);
 setTimeout(()=>{seq++;const sensory=command.sensory_rates,left=Math.floor(sensory.left_hz/30),right=Math.floor(sensory.right_hz/30);
 const nodes=template.nodes.map(node=>({...node,counts:{sugar:node.index===pool[0]?left:node.index===pool[1]?right:0}}));
 const condition={key:'sugar',label:'Physical sensory',total_spikes:left+right,input_spikes:0,downstream_spikes:left+right,active_neurons:2,wall_seconds:.005,selected_spike_count:0,events_sampled:false,events:[]};
 const data={...template,schema:'brain-live-v1',external_step:true,sequence:seq,network_builds:1,seed,duration_ms:duration,start_ms:(seq-1)*duration,end_ms:seq*duration,
 rate_hz:command.rate_hz,decision_id:command.decision_id,state_before:hash(seq-1),state_after:hash(seq),sensory_rates:sensory,nodes,conditions:[condition],
 motor_output:{left_hz:left/(duration/1000),right_hz:right/(duration/1000),left_spikes:left,right_spikes:right,left_indices:[pool[0]],right_indices:[pool[1]]}};
 console.log(JSON.stringify({type:'window',recording:data}));},5);}});
 `);
 const brainOptions={brainRoot:root,python:process.execPath,runner,referenceFiles:[],defaultResult:reference};
 const brain=new BrainLabService(brainOptions);await brain.ready;
 return{root,runner,brainOptions,brain,async close(){await brain.close();await rm(root,{recursive:true,force:true});}};
}

test('persistent brains wait for world input; no LLM is called and both neural clocks stay synchronized',async()=>{
 const f=await fixture();let llmCalls=0;
 const service=new BrainControlService(f.brain,async()=>{llmCalls++;throw Error('LLM must remain off');},{live:{runner:f.runner},auditFile:resolve(f.root,'audit.json')});
 try{
  await service.start(settings);await until(()=>service.embodied.world.step>=12);
  assert.equal(llmCalls,0);assert.equal(service.active.llmEnabled,false);assert.equal(service.active.messages.length,0);
  const [a,b]=service.embodied.agents;assert.notEqual(a.live.child.pid,b.live.child.pid);
  assert.equal(a.live.latest.recording.seed,42);assert.equal(b.live.latest.recording.seed,43);
  const completed=service.active.steps.at(-1);assert(Math.abs(completed.worldTime*1000-completed.worldStep*100)<.001);
  assert(completed.motorOutputs.a.left_hz>0);assert(service.embodied.world.bodies.some(b=>b.distance>0));
  assert(completed.neuralWindows.a.includes('-a-'));assert(completed.neuralWindows.b.includes('-b-'));
  await service.cancel();assert.equal(a.live.child,null);assert.equal(b.live.child,null);assert.equal(f.brain.controlOwner,null);
  const disk=JSON.parse(await readFile(resolve(f.root,'audit.json'),'utf8'));assert(disk.sessions[0].world.time>0);assert.equal(disk.sessions[0].llmEnabled,false);
 }finally{await service.close();await f.close();}
});

test('unacknowledged/mismatched sensory clocks and fabricated motor output are rejected',async()=>{
 const f=await fixture(),live=new BrainLiveService(f.brain,{runner:f.runner,instanceId:'a'}),signal=new AbortController().signal;
 f.brain.acquireControl('body-proof');
 try{
  await live.start({duration_ms:100,rate_hz:150,seed:42,external_step:true},'body-proof',signal);assert.equal(live.latest,null);
  await new Promise(r=>setTimeout(r,30));assert.equal(live.latest,null);
  const rates={left_hz:100,right_hz:80,contact_hz:20},window=await live.stepSensory(rates,'step-1',signal);
  assert(validateBodyWindow(window.recording,rates,42,0,100));
  assert.throws(()=>validateBodyWindow(window.recording,rates,42,100,100),/synchronized/);
  const bad=structuredClone(window.recording);bad.motor_output.left_spikes++;assert.throws(()=>validateBodyWindow(bad,rates,42,0,100),/motor/);
  assert.throws(()=>live.stepSensory({left_hz:-1,right_hz:10,contact_hz:0},'bad',signal));
 }finally{await live.stop();f.brain.releaseControl('body-proof');await f.close();}
});

test('physical HTTP operation blocks language inference and exposes both bodies and neural windows',async()=>{
 const f=await fixture();let llmCalls=0;
 const server=createLocalServer(async()=>{llmCalls++;throw Error('LLM call forbidden');},{dataDirectory:resolve(f.root,'ecology'),brainLab:f.brainOptions,brainControl:{live:{runner:f.runner}}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const post=(path,body)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 try{
  assert.equal((await post('/api/brain/control/start',settings)).status,202);await until(()=>server.brainControl.embodied.world.step>=2);
  const status=await(await fetch(base+'/api/brain/control/status')).json();assert.equal(status.model,null);assert.equal(status.world.bodies.length,2);assert.equal(status.session.llmEnabled,false);
  assert.equal((await post('/api/brain/observer/observe',{})).status,409);assert.equal((await post('/api/dialogue',{})).status,409);
  assert.equal((await(await fetch(base+'/api/brain/observer/status')).json()).available,false);
  assert.equal((await(await fetch(base+'/api/dialogue/status')).json()).available,false);assert.equal(llmCalls,0);
  const b=await(await fetch(base+'/api/brain/control/live?organism=b')).json();assert.equal(b.recording.organism_id,'b');assert(b.recording.motor_output);
  await post('/api/brain/control/stop',{});assert(server.brainControl.embodied.agents.every(a=>!a.live.child));
 }finally{await server.brainControl.close();await server.brainLab.close();await server.brainObserver.close();await new Promise(r=>server.close(r));await f.close();}
});
