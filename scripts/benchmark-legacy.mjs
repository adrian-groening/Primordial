// P00 characterization benchmark, not a claim about browser rendering performance.
import {Ecosystem} from '../dist/engine.js';
import {cpus,platform,arch} from 'node:os';
const ticks=1800,dt=1/30,seed=90210;
const cases=[{count:0,depth:1,width:6},{count:1,depth:1,width:6},{count:4,depth:3,width:12}];
const results=cases.map(neural=>{
 const warmup=new Ecosystem(seed,neural);for(let i=0;i<300;i++)warmup.step(dt);
 const samples=[];let final;
 for(let repeat=0;repeat<3;repeat++){
  const sim=new Ecosystem(seed,neural),start=performance.now();
  for(let i=0;i<ticks;i++)sim.step(dt);
  samples.push(performance.now()-start);
  final={population:sim.organisms.length,births:sim.births,food:sim.food.length};
 }
 const medianMs=[...samples].sort((a,b)=>a-b)[1];
 return {neural,samplesMs:samples,medianMs,stepsPerSecond:ticks/(medianMs/1000),final};
});
console.log(JSON.stringify({model:'legacy-v1',node:process.version,v8:process.versions.v8,platform:platform(),arch:arch(),cpu:cpus()[0]?.model,seed,ticks,dt,includesInitialization:false,description:'Headless 60 simulated seconds per repeat, three repeats after a 300-step disposable warm-up. Does not measure browser rendering, workers, sustained long-run load, or peak memory.',results},null,2));
