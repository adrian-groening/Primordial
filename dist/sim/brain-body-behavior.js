const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const angleDelta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
function random(m){let x=m.rng;x^=x<<13;x^=x>>>17;x^=x<<5;m.rng=x>>>0;return m.rng/4294967296;}
export function bodyMind(seed,id){const m={rng:((seed^(id==='a'?0x9e3779b9:0x85ebca6b))>>>0)||1,
 intent:'exploring',reason:'Sampling the nearby environment',fatigue:0,arousal:.3,odorMemory:0,exploreTurn:0,
 nextTurn:0,nextScan:0,scanUntil:0,feedUntil:0,restUntil:0,escapeUntil:0,lastContact:-10,
 escapeStarted:0,normalX:0,normalY:0,scanAngle:0,headYaw:0,phase:0};
 m.phase=random(m)*Math.PI*2;m.nextScan=.8+random(m)*1.2;return m;}
export function contactReflex(body,nx,ny,time){const m=body.mind;
 if(time-m.lastContact>.12){m.normalX=0;m.normalY=0;m.escapeStarted=time;}
 m.normalX=m.normalX*.65+nx;m.normalY=m.normalY*.65+ny;m.lastContact=time;m.escapeUntil=time+.55;m.arousal=1;
}

/** Explicit synthetic homeostatic/reflex layer. Neural drive still gates locomotion. */
export function bodyBehavior(body,p,time,dt,drive,world=null){const m=body.mind;
 const speed=Math.hypot(body.vx,body.vy),hungry=clamp((100-body.energy)/45,0,1);
 m.fatigue=clamp(m.fatigue+dt*(speed>3?.035*speed/35:-.22),0,1);
 m.arousal+=(clamp(p.odor*.4+hungry*.5+body.touch*.7,.12,1)-m.arousal)*Math.min(1,dt*2);
 m.scanAngle=Math.sin(time*5.5+m.phase)*(.12+(m.intent==='scanning'?.35:.12));
 m.headYaw=m.scanAngle*.28;
 if(time>=m.nextTurn){m.exploreTurn=m.exploreTurn*.45+(random(m)-.5)*1.3;m.nextTurn=time+.4+random(m)*.8;}
 let intent='exploring',reason='Correlated exploratory turns',throttle=.55+hungry*.18,turn=m.exploreTurn;
 if(!body.alive){intent='inactive';reason='Energy depleted';throttle=0;turn=0;}
 else if(drive<1e-8){intent='quiescent';reason='No measured neural motor drive';throttle=0;turn=0;}
 else if(time<m.escapeUntil){
   intent='reorienting';reason='Backing away from recent contact';
   const target=Math.atan2(m.normalY,m.normalX);turn=clamp(angleDelta(target,body.angle)*4,-4.5,4.5);
   throttle=time-m.escapeStarted<.14?-.35:.38;
 }else if(time<m.feedUntil){intent='feeding';reason='Handling a contacted food patch';throttle=.015;turn=Math.sin(time*9+m.phase)*.08;}
 else if((m.fatigue>.72||time<m.restUntil)&&body.energy>18){
   if(time>=m.restUntil)m.restUntil=time+.7+random(m)*.6;
   intent='resting';reason='Recovering after locomotion';throttle=0;turn=0;
 }else if(body.raceCommand){
   const command=body.raceCommand,pace={slow:.28,steady:.6,fast:.95}[command.pace]??0;
   if(command.goal==='rest'){intent='LLM resting';reason=command.plan;throttle=0;turn=0;}
   else if(command.goal==='explore_left'||command.goal==='explore_right'){
     intent='LLM exploring';reason=command.plan;throttle=pace;turn=command.goal==='explore_left'?-.8:.8;
   }else{
     const target=world?.food.find(f=>f.id===command.goal&&f.amount);
     if(!target||!command.path.length){intent='awaiting LLM plan';reason=target?'No safe route to chosen target':'Chosen particle is gone';throttle=0;turn=0;}
     else{
       while(command.path.length>1&&Math.hypot(body.x-command.path[0].x,body.y-command.path[0].y)<3)command.path.shift();
       const waypoint=command.path[0],error=angleDelta(Math.atan2(waypoint.y-body.y,waypoint.x-body.x),body.angle);
       intent=`LLM seeking ${command.goal}`;reason=command.plan;turn=clamp(error*4,-4,4);
       throttle=pace*Math.max(.12,Math.cos(error));
     }
   }
 }else if(p.clearance<10){
   intent='avoiding';reason='Local wall or obstacle proximity';
   turn=clamp(angleDelta(Math.atan2(p.awayY,p.awayX),body.angle)*2.4,-3.4,3.4);throttle=.34;
 }else if(p.neighbor && p.neighbor.distance<19){
   intent='yielding';reason='Keeping body space around a nearby organism';
   turn=-Math.sign(p.neighbor.bearing|| (body.id==='a'?1:-1))*1.9;throttle=.3;
 }else if(time<m.scanUntil){intent='scanning';reason='Pausing to sample the chemical gradient';throttle=.025;turn=Math.sin(time*7+m.phase)*.25;}
 else if(time>=m.nextScan){m.scanUntil=time+.16+random(m)*.24;m.nextScan=time+2.6+random(m)*3.4;
   intent='scanning';reason='Short sensory pause';throttle=.025;turn=.2*m.exploreTurn;
 }else if(p.odor>.13&&hungry>.12){
   intent='foraging';reason='Local chemical gradient and energy deficit';
   const gradient=(p.right-p.left)/(p.left+p.right+.03);
   const falling=p.odor<m.odorMemory-.015;
   turn=clamp(gradient*5+m.exploreTurn*(falling?.6:.15),-2.8,2.8);throttle=.4+hungry*.35;
 }
 m.odorMemory+=(p.odor-m.odorMemory)*Math.min(1,dt*3);
 m.intent=intent;m.reason=reason;
 return{throttle,turn,intent,reason,source:'synthetic body reflexes + measured neural motor drive'};
}
