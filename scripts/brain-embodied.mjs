import { performance } from 'node:perf_hooks';
import { BrainBodyWorld } from '../dist/sim/brain-body-world.js';

export function validateBodyWindow(recording, rates, seed, startMs, durationMs) {
  if (recording.external_step !== true || recording.seed !== seed || recording.duration_ms !== durationMs ||
      Math.abs(recording.start_ms-startMs)>.001 || Object.entries(rates).some(([key,value])=>recording.sensory_rates?.[key]!==value))
    throw new Error('Physical world and neural sensory window are not synchronized');
  const motor=recording.motor_output,seen=new Set();
  if(!motor)throw new Error('No measured neural motor readout');
  for(const side of ['left','right']){
    const ids=motor[side+'_indices'],spikes=motor[side+'_spikes'],hz=motor[side+'_hz'];
    if(!Array.isArray(ids)||!ids.length||ids.length>128||!Number.isSafeInteger(spikes)||spikes<0||
       !Number.isFinite(hz)||hz<0||hz>10000||Math.abs(hz-spikes/ids.length/(durationMs/1000))>1e-6)
      throw new Error('Invalid neural motor pool');
    let measured=0;
    for(const index of ids){const node=recording.nodes.find(node=>node.index===index);
      if(seen.has(index)||!node||node.input)throw new Error('Motor pools must contain distinct recorded downstream neurons');
      seen.add(index);measured+=node.counts.sugar;
    }
    if(measured!==spikes)throw new Error('Motor output does not match recorded spikes');
  }
  return {left_hz:motor.left_hz,right_hz:motor.right_hz};
}

/** Two intact neural networks in a lockstep virtual physical world. No LLM dependency. */
export class BrainEmbodied {
  constructor(session,{liveFactory,save,measure}){
    Object.assign(this,{session,save,measure});
    this.world=new BrainBodyWorld(session.settings.seed);
    this.engine=process.env.BRAIN_BODY_ENGINE??'cython';
    this.agents=['a','b'].map((id,i)=>({id,name:`Organism ${id.toUpperCase()}`,seed:(session.settings.seed+i)>>>0,
      live:liveFactory(id),state:'starting'}));
    session.agents=this.agents.map(({id,name,seed})=>({id,name,seed,decisionCount:0}));
    session.messages=[];session.communication={enabled:false};session.decisionCount=0;
    session.controller='physical-neural';session.llmEnabled=false;
  }
  status(){return this.agents.map(({id,name,seed,state,live})=>({id,name,seed,state,latestId:live.latest?.resultId??null,
    progress:live.progress,samples:live.samples,active:Boolean(live.child),failure:live.failure,
    measured:live.latest?this.measure(live.latest.recording,live.latest.resultId):null}));}
  getLive(id='a'){const agent=this.agents.find(a=>a.id===id);if(!agent)throw Object.assign(new Error('Choose organism a or b'),{status:400});return agent.live;}
  async beforeStep(){}
  async afterStep(){}
  async run(controller){
    const session=this.session;
    try{
      session.state='running';await this.save();
      for(const agent of this.agents){await agent.live.start({duration_ms:session.settings.duration_ms,seed:agent.seed,
        rate_hz:150,external_step:true,engine:this.engine},session.id,controller.signal);agent.state='ready';}
      while(true){
        controller.signal.throwIfAborted();
        await this.beforeStep(controller);
        if(this.finished)break;
        const start=performance.now(),startMs=this.world.time*1000,id=`${session.id}:physical:${this.world.step+1}`;
        const rates=Object.fromEntries(this.agents.map(a=>[a.id,this.world.sense(a.id)]));
        for(const agent of this.agents)agent.state='sensing';
        const windows=await Promise.all(this.agents.map(a=>a.live.stepSensory(rates[a.id],id,controller.signal)));
        controller.signal.throwIfAborted();
        const motors={};
        this.agents.forEach((a,i)=>{motors[a.id]=validateBodyWindow(windows[i].recording,rates[a.id],a.seed,startMs,session.settings.duration_ms);a.state='running';});
        this.world.lastInputs=rates;
        const world=this.world.advance(motors,session.settings.duration_ms,(performance.now()-start)/1000);
        const step={round:++session.decisionCount,state:'complete',createdAt:new Date().toISOString(),
          controller:'physical-neural',worldStep:world.step,worldTime:world.time,sensoryInputs:rates,motorOutputs:motors,
          neuralWindows:Object.fromEntries(this.agents.map((a,i)=>[a.id,windows[i].resultId]))};
        session.steps=[...session.steps,step].slice(-40);
        await this.afterStep(step,controller);
        session.world=this.world.snapshot();await this.save();
        if(this.finished)break;
      }
      if(this.finished){session.state='complete';session.reason='Food race complete';}
    }catch(error){
      session.state=controller.signal.aborted?'cancelled':'failed';session.error=controller.signal.aborted?null:error.message;
      session.reason=controller.signal.aborted?'Physical world stopped; latest world and neural recordings retained':'Physical world stopped after a neural or physics error';
    }finally{
      await this.stop();for(const a of this.agents)a.state='stopped';
      session.world=this.world.snapshot();session.completedAt=new Date().toISOString();await this.save();
    }
  }
  async stop(){await Promise.all(this.agents.map(a=>a.live.stop()));}
}
