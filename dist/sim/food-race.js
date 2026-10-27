import { segmentCircleHit } from './obstacles2d.js';

/** Rotational symmetry provides equivalent starting geometry for both contestants. */
export function configureFoodRace(world) {
  world.obstacles=[{id:'s1',x:120,y:75,radius:12},{id:'s2',x:92,y:38,radius:10},
    {id:'s3',x:148,y:112,radius:10},{id:'s4',x:42,y:119,radius:7},{id:'s5',x:198,y:31,radius:7}];
  const half=[[59,75],[76,84],[60,40],[116,120],[34,25],[27,73],
    [72,123],[113,18],[49,95],[78,58],[18,115],[97,132]];
  world.food=half.flatMap(([x,y],i)=>[{id:`f${i*2}`,x,y,radius:1.2,amount:1,regrow_at:Infinity},
    {id:`f${i*2+1}`,x:240-x,y:150-y,radius:1.2,amount:1,regrow_at:Infinity}]);
  world.foodRegrows=false;
}
const clearSegment=(from,to,world,radius)=>world.obstacles.every(o=>segmentCircleHit(from,to,o,radius+.6)===null);

/** Deterministic geometric navigation; it never chooses a food target. */
export function foodPath(world,body,target) {
  if(clearSegment(body,target,world,body.radius))return[{x:target.x,y:target.y}];
  const nodes=[{x:body.x,y:body.y},{x:target.x,y:target.y}];
  for(const o of world.obstacles){const radius=(o.radius+body.radius+1.4)/Math.cos(Math.PI/16);
    for(let i=0;i<16;i++){const angle=i*Math.PI/8,p={x:o.x+Math.cos(angle)*radius,y:o.y+Math.sin(angle)*radius};
      if(p.x>body.radius&&p.x<world.width-body.radius&&p.y>body.radius&&p.y<world.height-body.radius&&
        world.obstacles.every(other=>Math.hypot(p.x-other.x,p.y-other.y)>other.radius+body.radius+.5))nodes.push(p);
    }
  }
  const distance=nodes.map(()=>Infinity),previous=nodes.map(()=>-1),visited=new Set();distance[0]=0;
  while(visited.size<nodes.length){let best=-1;
    for(let i=0;i<nodes.length;i++)if(!visited.has(i)&&(best<0||distance[i]<distance[best]))best=i;
    if(best<0||!Number.isFinite(distance[best]))break;if(best===1)break;visited.add(best);
    for(let j=0;j<nodes.length;j++)if(!visited.has(j)&&j!==best&&clearSegment(nodes[best],nodes[j],world,body.radius)){
      const cost=distance[best]+Math.hypot(nodes[j].x-nodes[best].x,nodes[j].y-nodes[best].y);
      if(cost<distance[j]){distance[j]=cost;previous[j]=best;}
    }
  }
  if(!Number.isFinite(distance[1]))return[];
  const path=[];for(let at=1;at!==0;at=previous[at]){if(at<0)return[];path.push({...nodes[at]});}return path.reverse();
}
export function observeFoodRace(world,id,game) {
  const body=world.bodies.find(b=>b.id===id),opponent=world.bodies.find(b=>b.id!==id);
  const round=x=>Math.round(x*10)/10;
  const visible=world.food.filter(f=>f.amount&&Math.hypot(f.x-body.x,f.y-body.y)<=90&&clearSegment(body,f,world,0))
    .map(f=>({id:f.id,x_mm:f.x,y_mm:f.y,distance_mm:round(Math.hypot(f.x-body.x,f.y-body.y)),
      rival_distance_mm:round(Math.hypot(f.x-opponent.x,f.y-opponent.y))})).sort((a,b)=>a.distance_mm-b.distance_mm).slice(0,12);
  return{contestant:id,objective:'Collect more physical food particles than the rival. One point per particle. No respawns.',
    time_seconds:round(world.time),remaining_seconds:round(Math.max(0,game.duration_seconds-world.time)),
    score:{self:body.meals,rival:opponent.meals},self:{x_mm:round(body.x),y_mm:round(body.y),heading_degrees:round(body.angle*180/Math.PI),
      energy:round(body.energy),fatigue:round(body.mind.fatigue),behavior:body.mind.intent,current_goal:body.raceCommand?.goal??null},
    rival:{x_mm:round(opponent.x),y_mm:round(opponent.y)},visible_food:visible,
    map:{width_mm:world.width,height_mm:world.height,obstacles:world.obstacles},
    choices:[...visible.map(f=>f.id),'explore_left','explore_right','rest'],
    action_seconds:game.horizon_seconds,
    execution:'You choose a goal and pace. A deterministic navigator follows that target. Neural drive powers motion; contact/feeding/fatigue reflexes remain active. Unknown or consumed targets never auto-switch to another food.'};
}
export function applyFoodRaceDecision(world,id,decision,decisionId) {
  const body=world.bodies.find(b=>b.id===id);
  const target=world.food.find(f=>f.id===decision.goal&&f.amount);
  body.raceCommand={...decision,decisionId,issuedAt:world.time,path:target?foodPath(world,body,target):[]};
}
