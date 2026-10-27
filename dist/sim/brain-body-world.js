import { segmentCircleHit } from './obstacles2d.js';
import { bodyMind, bodyBehavior, contactReflex } from './brain-body-behavior.js';

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
export const BODY_ADAPTER = Object.freeze({ version: 'virtual-body-v2',
  scope: 'Experimental sensor/motor adapter, not validated fly locomotion or anatomical laterality',
  sensory: '21 sugar inputs split by reference order: 10 virtual left chemical sensors, 10 right, 1 virtual contact proxy',
  motor: 'Two downstream readout pools gate locomotion; explicit body reflexes add gradient sampling, feeding, resting and contact escape',
  max_speed_mm_s: 45, radius_mm: 4.5 });

/** Fixed-step physical arena; all active locomotion is gated by measured neural drive. */
export class BrainBodyWorld {
  constructor(seed = 90210) {
    this.width = 240; this.height = 150; this.time = 0; this.step = 0; this.seed = seed;
    this.obstacles = [{id:'s1',x:120,y:75,radius:12},{id:'s2',x:92,y:38,radius:10},
      {id:'s3',x:152,y:114,radius:11},{id:'s4',x:42,y:119,radius:7},{id:'s5',x:203,y:30,radius:8}];
    this.bodies = ['a','b'].map((id,i)=>({id,x:i?190:50,y:75,angle:i?Math.PI:0,radius:BODY_ADAPTER.radius_mm,
      vx:0,vy:0,energy:82,alive:true,meals:0,distance:0,contacts:0,touch:0,
      motor:{left_hz:0,right_hz:0},sensors:null,trail:[],mind:bodyMind(seed,id)}));
    const points = [[59,75],[181,75],[76,84],[164,66],[60,40],[178,112],[116,120],[124,30],
      [34,25],[212,125],[27,73],[215,75],[72,123],[182,28],[126,104],[110,49],
      [49,95],[191,55],[78,58],[164,92],[18,115],[222,35],[97,132],[145,18]];
    this.food = points.map(([x,y],i)=>({id:`f${i}`,x,y,radius:1.2,amount:1,regrow_at:0}));
    this.events=[]; this.motion=[]; this.lastWallSeconds=0; this.lastInputs={};
  }
  concentration(point) {
    let sum=0;
    for(const food of this.food) {
      if(!food.amount)continue;
      if(this.obstacles.some(obstacle=>segmentCircleHit(point,food,obstacle)!==null))continue;
      const distance=Math.hypot(food.x-point.x,food.y-point.y);
      sum+=Math.exp(-distance/15)*.75;
    }
    return clamp(sum,0,1);
  }
  sense(id) {
    const b=this.bodies.find(body=>body.id===id); if(!b)throw Error('Unknown physical organism');
    const angle=b.angle+b.mind.scanAngle;
    const point=(side)=>({x:b.x+Math.cos(angle)*4-Math.sin(angle)*side*2.5,
      y:b.y+Math.sin(angle)*4+Math.cos(angle)*side*2.5});
    const left=this.concentration(point(-1)),right=this.concentration(point(1));
    const rates={left_hz:b.alive?Math.round(30+200*left):0,right_hz:b.alive?Math.round(30+200*right):0,
      contact_hz:b.alive?Math.round(20+230*clamp(b.touch,0,1)):0};
    b.sensors={left,right,touch:b.touch,...rates}; return {...rates};
  }
  perceive(body){
    this.sense(body.id);
    let clearance=Infinity,awayX=0,awayY=0;
    const surface=(d,nx,ny)=>{if(d<clearance)clearance=d;const weight=Math.max(0,(12-d)/12);awayX+=nx*weight;awayY+=ny*weight;};
    surface(body.x-body.radius,1,0);surface(this.width-body.radius-body.x,-1,0);
    surface(body.y-body.radius,0,1);surface(this.height-body.radius-body.y,0,-1);
    for(const o of this.obstacles){const dx=body.x-o.x,dy=body.y-o.y,d=Math.hypot(dx,dy);surface(d-body.radius-o.radius,dx/(d||1),dy/(d||1));}
    const other=this.bodies.find(b=>b.id!==body.id),dx=other.x-body.x,dy=other.y-body.y,d=Math.hypot(dx,dy);
    const visible=d<30&&!this.obstacles.some(o=>segmentCircleHit(body,other,o)!==null);
    return{left:body.sensors.left,right:body.sensors.right,odor:(body.sensors.left+body.sensors.right)/2,
      clearance,awayX,awayY,neighbor:visible?{distance:d,bearing:Math.atan2(Math.sin(Math.atan2(dy,dx)-body.angle),Math.cos(Math.atan2(dy,dx)-body.angle))}:null};
  }
  validPosition(body) {
    const r=body.radius;
    return body.x>=r-1e-6&&body.x<=this.width-r+1e-6&&body.y>=r-1e-6&&body.y<=this.height-r+1e-6&&
      this.obstacles.every(o=>Math.hypot(body.x-o.x,body.y-o.y)>=r+o.radius-1e-6);
  }
  event(type, body, other) {
    this.events.push({type,organism:body.id,other,time:this.time}); this.events=this.events.slice(-60);
  }
  alignToSurface(body,nx,ny) {
    contactReflex(body,nx,ny,this.time);
  }
  collideObstacle(body, obstacle) {
    const dx=body.x-obstacle.x,dy=body.y-obstacle.y,d=Math.hypot(dx,dy),required=body.radius+obstacle.radius;
    if(d>=required)return;
    const nx=d>1e-9?dx/d:1,ny=d>1e-9?dy/d:0;
    body.x=obstacle.x+nx*(required+1e-6);body.y=obstacle.y+ny*(required+1e-6);
    const vn=body.vx*nx+body.vy*ny;
    if(vn<0){body.vx-=vn*1.15*nx;body.vy-=vn*1.15*ny;}
    if(body.touch<.2){body.contacts++;this.event('contact',body,obstacle.id);}
    body.touch=1;
    // Passive contact deflection, independent of the neural motor decoder.
    this.alignToSurface(body,nx,ny);
  }
  resolveBodies() {
    const [a,b]=this.bodies,dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy),required=a.radius+b.radius;
    if(d>=required)return;
    const nx=d>1e-9?dx/d:1,ny=d>1e-9?dy/d:0,overlap=required-d+1e-6;
    a.x-=nx*overlap/2;a.y-=ny*overlap/2;b.x+=nx*overlap/2;b.y+=ny*overlap/2;
    const closing=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
    if(closing<0){const impulse=-closing*.575;a.vx-=impulse*nx;a.vy-=impulse*ny;b.vx+=impulse*nx;b.vy+=impulse*ny;}
    if(a.touch<.2&&b.touch<.2){a.contacts++;b.contacts++;this.event('body-contact',a,b.id);}
    contactReflex(a,-nx,-ny,this.time);contactReflex(b,nx,ny,this.time);
    a.touch=1;b.touch=1;
  }
  advance(motors,durationMs,wallSeconds=0) {
    if(!Number.isFinite(durationMs)||durationMs<1||durationMs>1000)throw Error('Invalid physical interval');
    for(const b of this.bodies){const motor=motors[b.id];
      if(!motor||!Number.isFinite(motor.left_hz)||!Number.isFinite(motor.right_hz)||motor.left_hz<0||motor.right_hz<0)
        throw Error('Missing measured neural motor output');
    }
    for(const b of this.bodies)b.motor={left_hz:motors[b.id].left_hz,right_hz:motors[b.id].right_hz};
    this.lastWallSeconds=wallSeconds;this.motion=[];
    const steps=Math.ceil(durationMs/10),dt=durationMs/1000/steps;
    const pose=b=>({id:b.id,x:b.x,y:b.y,angle:b.angle,distance:b.distance,scan:b.mind.scanAngle,head:b.mind.headYaw});
    this.motion.push(this.bodies.map(pose));
    for(let i=0;i<steps;i++){
      const before=this.bodies.map(b=>({x:b.x,y:b.y}));
      const perceptions=Object.fromEntries(this.bodies.map(b=>[b.id,this.perceive(b)]));
      for(const b of this.bodies){
        const left=b.motor.left_hz/(b.motor.left_hz+20),right=b.motor.right_hz/(b.motor.right_hz+20);
        const energyFactor=b.alive?clamp(b.energy/20,0,1):0;
        const drive=(left+right)*.5;
        const reflex=bodyBehavior(b,perceptions[b.id],this.time,dt,drive,this);
        b.control={neural_drive:drive,neural_turn:(right-left)*5,reflex_turn:reflex.turn,throttle:reflex.throttle,source:reflex.source};
        const speed=drive*BODY_ADAPTER.max_speed_mm_s*energyFactor*reflex.throttle;
        b.angle+=((right-left)*5+reflex.turn)*dt*energyFactor*Math.min(1,drive*2);
        const blend=1-Math.exp(-dt/.12);
        b.vx+=(Math.cos(b.angle)*speed-b.vx)*blend;b.vy+=(Math.sin(b.angle)*speed-b.vy)*blend;
        b.x+=b.vx*dt;b.y+=b.vy*dt;b.touch*=Math.exp(-dt/1.2);
        if(b.x<b.radius||b.x>this.width-b.radius){if(b.touch<.2){b.contacts++;this.event('wall-contact',b,'wall');}this.alignToSurface(b,b.x<b.radius?1:-1,0);b.x=clamp(b.x,b.radius,this.width-b.radius);b.vx*=-.15;b.touch=1;}
        if(b.y<b.radius||b.y>this.height-b.radius){if(b.touch<.2){b.contacts++;this.event('wall-contact',b,'wall');}this.alignToSurface(b,0,b.y<b.radius?1:-1);b.y=clamp(b.y,b.radius,this.height-b.radius);b.vy*=-.15;b.touch=1;}
      }
      for(let pass=0;pass<4;pass++){
        this.resolveBodies();
        for(const b of this.bodies){for(const obstacle of this.obstacles)this.collideObstacle(b,obstacle);
          b.x=clamp(b.x,b.radius,this.width-b.radius);b.y=clamp(b.y,b.radius,this.height-b.radius);}
      }
      const separated=Math.hypot(this.bodies[0].x-this.bodies[1].x,this.bodies[0].y-this.bodies[1].y)>=this.bodies[0].radius+this.bodies[1].radius-1e-6;
      if(!separated||this.bodies.some(b=>!this.validPosition(b))){
        this.bodies.forEach((b,j)=>{b.x=before[j].x;b.y=before[j].y;b.vx=0;b.vy=0;});
      }
      this.bodies.forEach((b,j)=>{
        const distance=Math.hypot(b.x-before[j].x,b.y-before[j].y);b.distance+=distance;
        b.energy=Math.max(0,b.energy-(.06*dt+.015*distance));
        if(!b.energy&&b.alive){b.alive=false;this.event('energy-depleted',b,null);}
      });
      // Award contact to the earliest swept entry, independent of body storage order.
      for(const food of this.food)if(food.amount){
        const eligible=this.bodies.flatMap((b,j)=>{if(!b.alive)return[];
          const inside=Math.hypot(before[j].x-food.x,before[j].y-food.y)<=b.radius+food.radius;
          const fraction=inside?0:segmentCircleHit(before[j],b,food,b.radius);
          return fraction===null?[]:[{body:b,fraction}];});
        eligible.sort((a,b)=>Math.abs(a.fraction-b.fraction)>1e-9?a.fraction-b.fraction:
          (parseInt(food.id.slice(1),10)%2===0?a.body.id.localeCompare(b.body.id):b.body.id.localeCompare(a.body.id)));
        const winner=eligible[0]?.body;
        if(winner){food.amount=0;food.regrow_at=this.foodRegrows===false?Infinity:this.time+12;
          winner.energy=Math.min(100,winner.energy+12);winner.meals++;winner.mind.feedUntil=this.time+.55;this.event('ate-food',winner,food.id);}
      }
      this.time+=dt;
      for(const food of this.food)if(this.foodRegrows!==false&&!food.amount&&food.regrow_at<=this.time)food.amount=1;
      this.motion.push(this.bodies.map(pose));
    }
    this.step++;
    for(const b of this.bodies){b.trail.push({x:b.x,y:b.y});b.trail=b.trail.slice(-240);this.sense(b.id);}
    return this.snapshot();
  }
  snapshot() {return structuredClone({schema:'brain-body-world-v1',width:this.width,height:this.height,units:'mm',time:this.time,step:this.step,
    adapter:BODY_ADAPTER,bodies:this.bodies,obstacles:this.obstacles,food:this.food,events:this.events,motion:this.motion,lastWallSeconds:this.lastWallSeconds,race:this.race??null});}
}
