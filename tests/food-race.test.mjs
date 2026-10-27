import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {BrainBodyWorld} from '../dist/sim/brain-body-world.js';
import {configureFoodRace,foodPath,observeFoodRace,applyFoodRaceDecision} from '../dist/sim/food-race.js';
import {segmentCircleHit} from '../dist/sim/obstacles2d.js';
import {validateRaceDecision,raceRequest} from '../scripts/brain-food-race.mjs';
import {BrainLabService} from '../scripts/brain-lab-service.mjs';
import {BrainControlService,validateControlSettings} from '../scripts/brain-control-service.mjs';
import {createLocalServer} from '../scripts/local-server.mjs';
const template=JSON.parse(await readFile(new URL('../dist/data/brain-lab-reference.json',import.meta.url),'utf8'));
const settings={mode:'race',resultId:'reference-200ms',duration_ms:200,seed:42,rounds:1,interval_ms:2000,target_spikes_per_second:10000,game_seconds:10,plan_seconds:1};
const pause=()=>new Promise(r=>setImmediate(r));
const until=async(fn)=>{let n=0;while(!fn()){if(n++>1000)throw Error('Timed out');await new Promise(r=>setTimeout(r,5));}};
const decision=(goal='rest')=>({goal,pace:'fast',expected_food:goal==='rest'?0:1,plan:'Seek the offered particle before the rival.'});
class FakeLive{
 constructor(id){this.id=id;this.child=null;this.latest=null;this.samples=[];this.progress='ready';this.failure=null;this.sequence=0;}
 async start(settings,owner,signal){signal.throwIfAborted();this.settings=settings;this.owner=owner;this.child={pid:this.id==='a'?1:2};}
 async stepSensory(rates,id,signal){signal.throwIfAborted();await pause();const seq=++this.sequence,ms=this.settings.duration_ms,pools=template.nodes.filter(n=>!n.input).slice(0,2).map(n=>n.index);
 const r={...template,schema:'brain-live-v1',organism_id:this.id,external_step:true,sequence:seq,network_builds:1,seed:this.settings.seed,duration_ms:ms,start_ms:(seq-1)*ms,end_ms:seq*ms,
  rate_hz:150,decision_id:id,sensory_rates:rates,state_before:String(seq-1).padStart(64,'0'),state_after:String(seq).padStart(64,'0'),
  nodes:template.nodes.map(n=>({...n,counts:{sugar:pools.includes(n.index)?7:0}})),
  conditions:[{key:'sugar',label:'test',total_spikes:14,input_spikes:0,downstream_spikes:14,active_neurons:2,events:[],selected_spike_count:0,wall_seconds:.01}],
  motor_output:{left_hz:7/(ms/1000),right_hz:7/(ms/1000),left_spikes:7,right_spikes:7,left_indices:[pools[0]],right_indices:[pools[1]]}};
 this.latest={resultId:`live-${this.owner}-${this.id}-${seq}`,recording:r};this.samples.push({sequence:seq,end_ms:r.end_ms,rate_hz:150,spikes_per_second:14/(ms/1000)});this.samples=this.samples.slice(-120);return this.latest;
 }
 async stop(){this.child=null;}
}
async function fixture(fetcher){const root=await mkdtemp(resolve(tmpdir(),'food-race-'));const brain=new BrainLabService({brainRoot:root});await brain.ready;
 const control=new BrainControlService(brain,fetcher,{liveFactory:id=>new FakeLive(id),auditFile:resolve(root,'audit.json')});
 return{root,brain,control,async close(){await control.close();await brain.close();await rm(root,{recursive:true,force:true});}};
}
const reply=value=>Response.json({message:{content:JSON.stringify(value)},eval_count:30});

test('race layout is symmetric, unique and scoring cannot double-award or respawn a particle',()=>{
 const w=new BrainBodyWorld();configureFoodRace(w);assert.equal(new Set(w.food.map(f=>`${f.x},${f.y}`)).size,24);
 for(const f of w.food)assert(w.food.some(g=>g.x===240-f.x&&g.y===150-f.y));
 for(const o of w.obstacles)assert(w.obstacles.some(p=>p.x===240-o.x&&p.y===150-o.y&&p.radius===o.radius));
 for(const foodId of ['f0','f1'])for(const reversed of [false,true]){
  const arena=new BrainBodyWorld();arena.obstacles=[];arena.foodRegrows=false;arena.food=[{id:foodId,x:104.6,y:75,radius:1.2,amount:1}];
  Object.assign(arena.bodies[0],{x:100,y:75});Object.assign(arena.bodies[1],{x:109.2,y:75});if(reversed)arena.bodies.reverse();
  const zero={a:{left_hz:0,right_hz:0},b:{left_hz:0,right_hz:0}};arena.advance(zero,100);
  const winner=arena.bodies.find(b=>b.meals===1);assert.equal(winner.id,foodId==='f0'?'a':'b');
  for(let i=0;i<20;i++)arena.advance(zero,1000);assert.equal(arena.bodies.reduce((n,b)=>n+b.meals,0),1);assert.equal(arena.food[0].amount,0);
 }
});

test('a selected food is followed around solid obstacles; target choice never silently switches',()=>{
 const w=new BrainBodyWorld();configureFoodRace(w);const a=w.bodies[0],target={id:'test',x:170,y:75,amount:1};w.food=[target];
 const path=foodPath(w,a,target);assert(path.length>1);let from=a;for(const p of path){assert(w.obstacles.every(o=>segmentCircleHit(from,p,o,a.radius)===null));from=p;}
 applyFoodRaceDecision(w,'a',decision('test'),'test-action');assert.equal(a.raceCommand.goal,'test');
 target.amount=0;w.advance({a:{left_hz:50,right_hz:50},b:{left_hz:50,right_hz:50}},100);
 assert.equal(a.mind.intent,'awaiting LLM plan');assert.equal(a.raceCommand.goal,'test');
});

test('only offered movement goals are accepted; forecasts and generated claims cannot award score',()=>{
 const w=new BrainBodyWorld();configureFoodRace(w);const o=observeFoodRace(w,'a',{duration_seconds:60,horizon_seconds:2});
 assert.deepEqual(validateRaceDecision(JSON.stringify(decision(o.choices[0])),o),decision(o.choices[0]));
 for(const action of [{...decision('f999')},{...decision('rest'),score:100},{...decision('rest'),pace:'teleport'},
 {...decision('rest'),expected_food:99},{...decision('rest'),plan:'x'.repeat(241)}])assert.throws(()=>validateRaceDecision(JSON.stringify(action),o));
 const prompt=raceRequest(o,[],42,1);assert.deepEqual(prompt.format.properties.goal.enum,o.choices);assert.equal(w.bodies[0].meals,0);
 assert.equal(validateControlSettings(settings).mode,'race');assert.throws(()=>validateControlSettings({...settings,game_seconds:999}));
});

test('both LLMs plan from one frozen snapshot and commit together; Stop aborts planning',async()=>{
 let release,waiting=false,contexts=[];const f=await fixture(async(url,{body,signal})=>{
  const c=JSON.parse(JSON.parse(body).messages[1].content);contexts.push(c);
  if(contexts.length===2){waiting=true;return new Promise((resolve,reject)=>{release=()=>resolve(reply(decision(c.visible_food[0].id)));signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});}
  return reply(decision(c.visible_food[0].id));
 });
 try{
  await f.control.start(settings);await until(()=>waiting);
  assert.equal(f.control.embodied.world.time,0);assert(f.control.embodied.world.bodies.every(b=>b.raceCommand.goal==='rest'));
  assert.equal(contexts[0].time_seconds,contexts[1].time_seconds);assert.equal(contexts[1].rival_plan,undefined);
  release();await until(()=>f.control.embodied.world.step>=1);assert(f.control.embodied.world.bodies.every(b=>b.raceCommand.goal.startsWith('f')));
  await f.control.cancel();assert.equal(f.brain.controlOwner,null);assert(f.control.embodied.agents.every(a=>!a.live.child));
 }finally{await f.close();}
 const held=await fixture(async(url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})));
 try{await held.control.start(settings);await until(()=>held.control.active.game.rounds[0]?.decisions.a);await held.control.cancel();assert.equal(held.control.active,null);}finally{await held.close();}
});

test('match outcomes and winner use physical food events, with forecasts evaluated against actual gains',async()=>{
 let inFlight=0,maxInFlight=0;const f=await fixture(async(url,{body})=>{inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);await pause();const c=JSON.parse(JSON.parse(body).messages[1].content);inFlight--;return reply(decision(c.visible_food[0]?.id??'explore_left'));});
 try{
  await f.control.start(settings);await f.control.completion;const s=(await f.control.status()).session;
  assert.equal(s.state,'complete');assert.equal(s.game.phase,'complete');assert.equal(maxInFlight,1);
  assert.equal(s.game.scores.a,s.world.bodies.find(b=>b.id==='a').meals);assert.equal(s.game.scores.b,s.world.bodies.find(b=>b.id==='b').meals);
  assert(s.game.scores.a+s.game.scores.b>0);assert(s.game.scores.a+s.game.scores.b<=24);
  assert.equal(s.game.winner,s.game.scores.a===s.game.scores.b?'tie':s.game.scores.a>s.game.scores.b?'a':'b');
  const d=s.game.rounds[0].decisions.a;assert(d.outcome);assert.equal(d.outcome.forecast_error,d.outcome.food_gained-d.action.expected_food);
  assert(d.request&&d.rawReply);assert.equal(f.brain.controlOwner,null);
  const disk=JSON.parse(await readFile(resolve(f.root,'audit.json'),'utf8'));assert.equal(disk.sessions[0].game.winner,s.game.winner);
 }finally{await f.close();}
});

test('invalid actions cost an opportunity and never trigger automatic food-seeking',async()=>{
 const f=await fixture(async()=>reply({...decision('rest'),score:100}));
 try{await f.control.start(settings);await f.control.completion;const g=f.control.sessions[0].game;
 assert.equal(g.scores.a+g.scores.b,0);assert(g.metrics.a.rejected>0);assert.equal(g.winner,'tie');
 assert(f.control.sessions[0].world.bodies.every(b=>b.distance===0));}finally{await f.close();}
});

test('race HTTP lifecycle exposes authoritative scores and rejects extra external controls',async()=>{
 const root=await mkdtemp(resolve(tmpdir(),'race-http-'));const server=createLocalServer(async(url,{body})=>{const c=JSON.parse(JSON.parse(body).messages[1].content);return reply(decision(c.visible_food[0]?.id??'rest'));},
 {dataDirectory:resolve(root,'ecology'),brainLab:{brainRoot:root},brainControl:{liveFactory:id=>new FakeLive(id)}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/api/brain/`;
 const post=value=>fetch(base+'control/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
 try{assert.equal((await post({...settings,set_score:100})).status,400);assert.equal((await post(settings)).status,202);
 await server.brainControl.completion;const s=await(await fetch(base+'control/status')).json();assert.equal(s.session.game.phase,'complete');assert.equal(s.session.llmEnabled,true);
 }finally{await server.brainControl.close();await server.brainObserver.close();await server.brainLab.close();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});
