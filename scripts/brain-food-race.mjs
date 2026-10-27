import { performance } from 'node:perf_hooks';
import { BrainEmbodied } from './brain-embodied.mjs';
import { OBSERVER_MODEL } from './brain-observer-service.mjs';
import { configureFoodRace, observeFoodRace, applyFoodRaceDecision } from '../dist/sim/food-race.js';

export function validateRaceDecision(text,observation){
 let value;try{value=JSON.parse(text);}catch{throw Error('Invalid race action JSON');}
 if(!value||Array.isArray(value)||Object.keys(value).sort().join(',')!=='expected_food,goal,pace,plan'||
    !observation.choices.includes(value.goal)||!['slow','steady','fast'].includes(value.pace)||
    !Number.isInteger(value.expected_food)||value.expected_food<0||value.expected_food>3||
    typeof value.plan!=='string'||!value.plan.trim()||value.plan.length>240)
   throw Error('Choose one offered goal, a valid pace, expected_food 0–3 and a brief plan; other controls are forbidden');
 return{...value,plan:value.plan.trim()};
}
export function raceRequest(observation,history,seed,round){
 return{model:OBSERVER_MODEL,stream:false,keep_alive:'10m',format:{type:'object',additionalProperties:false,
  properties:{goal:{type:'string',enum:observation.choices},pace:{type:'string',enum:['slow','steady','fast']},
   expected_food:{type:'integer',minimum:0,maximum:3},plan:{type:'string',maxLength:240}},required:['goal','pace','expected_food','plan']},
  messages:[{role:'system',content:'You control one virtual fly in a food race. Your sole goal is to collect more food particles than the rival before time runs out. Choose one offered food ID or explore_left, explore_right, rest. You cannot teleport or award points. A navigator follows your chosen goal; physical contact collects food, and a rival may reach it first. Picking a gone target makes you stop until another plan. Choose pace slow, steady or fast, balancing speed and fatigue. Return ONLY JSON: goal, pace, expected_food (your forecast of points gained in the next action interval, integer 0–3), plan (one brief sentence explaining the choice, max 35 words/240 characters). Use measured feedback from previous actions. Report a concise stated plan, not a long reasoning trace. Never invent coordinates, foods or achievements.'},
   {role:'user',content:JSON.stringify({...observation,recent_outcomes:history.slice(-3)})}],
  options:{num_ctx:4096,num_predict:170,temperature:.35,seed:(seed+round*7919)>>>0,top_p:.9}};
}

/** Both plans see the same frozen world and are committed together. */
export class BrainFoodRace extends BrainEmbodied{
 constructor(session,options){
  super(session,options);this.fetcher=options.fetcher;this.timeoutMs=options.timeoutMs??90000;
  configureFoodRace(this.world);
  if(session.settings.swap_sides){const [a,b]=this.world.bodies;[a.x,b.x]=[b.x,a.x];[a.y,b.y]=[b.y,a.y];[a.angle,b.angle]=[b.angle,a.angle];}
  this.game=session.game={schema:'food-race-v1',duration_seconds:session.settings.game_seconds??60,horizon_seconds:session.settings.plan_seconds??2,
   total_particles:this.world.food.length,phase:'starting',round:0,rounds:[],history:[],winner:null,
   scores:{a:0,b:0},metrics:{a:{valid:0,rejected:0,latency_ms:0,tokens:0},b:{valid:0,rejected:0,latency_ms:0,tokens:0}},
   rules:'One point per physically collected particle. No respawns. Symmetric arena. Both choose from the same world-time snapshot; plans commit together. Highest score at the time limit or when food is exhausted wins.'};
  session.llmEnabled=true;session.controller='llm-food-race';this.nextPlanAt=0;this.current=null;
  for(const body of this.world.bodies)body.raceCommand={goal:'rest',pace:'steady',plan:'Waiting for the first LLM plan',path:[]};
  this.updateGameView();
 }
 updateGameView(){const g=this.game;g.scores=Object.fromEntries(this.world.bodies.map(b=>[b.id,b.meals]));
  this.world.race={phase:g.phase,round:g.round,duration_seconds:g.duration_seconds,remaining_seconds:Math.max(0,g.duration_seconds-this.world.time),scores:{...g.scores},winner:g.winner};}
 checkpoint(){return Object.fromEntries(this.world.bodies.map(b=>[b.id,{score:b.meals,distance:b.distance,contacts:b.contacts,x:b.x,y:b.y}]));}
 async beforeStep(controller){
  if(this.shouldFinish()){this.finish();return;}
  if(this.world.time+1e-8<this.nextPlanAt)return;
  this.game.phase='planning';this.session.state='thinking';const round=++this.game.round;
  const observations=Object.fromEntries(this.agents.map(a=>[a.id,observeFoodRace(this.world,a.id,this.game)]));
  const entry={round,worldTime:this.world.time,before:this.checkpoint(),decisions:{},after:null};
  this.current=entry;this.game.rounds=[...this.game.rounds,entry].slice(-40);this.updateGameView();await this.save();
  const order=round%2===1?this.agents:[...this.agents].reverse();
  for(const agent of order){controller.signal.throwIfAborted();agent.state='planning';
   const observation=observations[agent.id],history=this.game.rounds.filter(r=>r.after&&r.decisions[agent.id]).map(r=>({
    goal:r.decisions[agent.id].action?.goal??null,status:r.decisions[agent.id].status,outcome:r.decisions[agent.id].outcome}));
   const request=raceRequest(observation,history,agent.seed,round),decision={status:'thinking',request,rawReply:null,action:null,latency_ms:null,outcome:null};
   entry.decisions[agent.id]=decision;await this.save();const start=performance.now();
   try{
    const response=await this.fetcher('http://127.0.0.1:11434/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request),
     signal:AbortSignal.any([controller.signal,AbortSignal.timeout(this.timeoutMs)])});
    const data=await response.json();controller.signal.throwIfAborted();
    if(!response.ok||typeof data.message?.content!=='string'||data.message.content.length>4000)throw Error('Local model did not return a usable race action');
    decision.rawReply=data.message.content;decision.action=validateRaceDecision(decision.rawReply,observation);decision.status='valid';
    decision.tokens=Number.isSafeInteger(data.eval_count)?data.eval_count:null;this.game.metrics[agent.id].valid++;
    this.game.metrics[agent.id].tokens+=decision.tokens??0;
   }catch(error){controller.signal.throwIfAborted();decision.status='rejected';decision.error=error.name==='TimeoutError'?'LLM plan timed out':error.message;this.game.metrics[agent.id].rejected++;}
   decision.latency_ms=performance.now()-start;this.game.metrics[agent.id].latency_ms+=decision.latency_ms;
   agent.state='ready';await this.save();
  }
  // Neither fly sees the other fly's plan and neither acts before both attempts finish.
  controller.signal.throwIfAborted();
  for(const agent of this.agents){const decision=entry.decisions[agent.id];
   if(decision.status==='valid')applyFoodRaceDecision(this.world,agent.id,decision.action,`${this.session.id}:race:${round}:${agent.id}`);
   else applyFoodRaceDecision(this.world,agent.id,{goal:'rest',pace:'steady',plan:'No valid LLM action this round'},`${this.session.id}:race:${round}:${agent.id}`);
  }
  this.nextPlanAt=Math.min(this.game.duration_seconds,this.world.time+this.game.horizon_seconds);
  this.game.phase='running';this.session.state='running';this.updateGameView();await this.save();
 }
 async afterStep(){
  this.updateGameView();const time=this.world.time;
  if(!this.game.history.length||time-this.game.history.at(-1).time>=.999)this.game.history=[...this.game.history,{time,scores:{...this.game.scores}}].slice(-181);
  if(this.current&&!this.current.after&&(time+1e-8>=this.nextPlanAt||this.shouldFinish())){
   this.current.after=this.checkpoint();this.current.endTime=time;
   for(const agent of this.agents){const before=this.current.before[agent.id],after=this.current.after[agent.id],decision=this.current.decisions[agent.id];
    decision.outcome={food_gained:after.score-before.score,score:after.score,distance_mm:after.distance-before.distance,
     contacts:after.contacts-before.contacts,forecast_error:decision.action?after.score-before.score-decision.action.expected_food:null};
   }
  }
  if(this.shouldFinish())this.finish();
 }
 shouldFinish(){return this.world.time+1e-8>=this.game.duration_seconds||this.world.food.every(f=>!f.amount)||this.world.bodies.every(b=>!b.alive);}
 finish(){this.finished=true;this.game.phase='complete';this.updateGameView();const {a,b}=this.game.scores;this.game.winner=a===b?'tie':a>b?'a':'b';this.updateGameView();
  this.game.completedAt=new Date().toISOString();this.game.history.push({time:this.world.time,scores:{...this.game.scores}});}
 async run(controller){await super.run(controller);
  if(!this.finished){this.game.phase=this.session.state;this.updateGameView();this.session.world=this.world.snapshot();await this.save();}
 }
}
