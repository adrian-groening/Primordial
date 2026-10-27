const $=id=>document.getElementById(id);
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
let signature='';
export function renderFoodRace(game,world){
 $('race-scoreboard').hidden=!game;$('race-analysis').hidden=!game;if(!game)return;
 const time=world?.time??0;
 $('race-clock').textContent=`${Math.max(0,game.duration_seconds-time).toFixed(1)} s remaining`;
 $('race-score-a').textContent=game.scores.a;$('race-score-b').textContent=game.scores.b;
 $('race-phase').textContent=game.phase==='complete'?game.winner==='tie'?'DRAW · equal food collected':`FLY ${game.winner.toUpperCase()} WINS`:
  game.phase==='planning'?`ROUND ${game.round} · Llama 2 is planning · simulated time paused for equal opportunity`:
  game.phase==='running'?`ROUND ${game.round} · both plans executing in the physical world`:game.phase.toUpperCase();
 const key=JSON.stringify(game);if(key===signature)return;signature=key;
 const plans=$('race-plans');plans.replaceChildren();const current=game.rounds.at(-1);
 for(const id of ['a','b']){
  const d=current?.decisions[id],m=game.metrics[id],card=node('article',undefined,`race-plan race-${id}`);
  card.append(node('span',`FLY ${id.toUpperCase()} · STATED PLAN`,'eyebrow'),node('p',d?.action?.plan??(d?.status==='rejected'?d.error:'Waiting for the model…'),'race-plan-text'));
  card.append(node('p',d?.action?`${d.action.goal} · ${d.action.pace.toUpperCase()} · forecasts ${d.action.expected_food} food`:'No validated action yet','mono'));
  card.append(node('p',d?.outcome?`Measured +${d.outcome.food_gained} food · ${d.outcome.distance_mm.toFixed(1)} mm · ${d.outcome.contacts} contacts`:'Outcome pending execution','fine'));
  card.append(node('p',`${m.valid} valid / ${m.rejected} rejected · avg ${(m.latency_ms/Math.max(1,m.valid+m.rejected)/1000).toFixed(2)} s per plan`,'fine'));plans.append(card);
 }
 const rounds=$('race-rounds');rounds.replaceChildren();
 for(const round of [...game.rounds].reverse().slice(0,8)){
  const details=node('details',undefined,'observer-log-entry');details.append(node('summary',`Round ${round.round} · ${round.worldTime.toFixed(1)} s${round.after?' · measured':' · planning/executing'}`));
  for(const id of ['a','b']){const d=round.decisions[id];if(!d)continue;
   details.append(node('p',`Fly ${id.toUpperCase()}: ${d.action?.plan??d.error??'Thinking…'}`),node('p',d.outcome?
    `Goal ${d.action?.goal??'none'} · expected ${d.action?.expected_food??'—'} · collected ${d.outcome.food_gained} · forecast error ${d.outcome.forecast_error??'—'} · travelled ${d.outcome.distance_mm.toFixed(1)} mm`:'Waiting for outcome','fine'));
  }
  const audit=node('details');audit.append(node('summary','Exact observations, replies, actions and outcome'),node('pre',JSON.stringify(round,null,2)));details.append(audit);rounds.append(details);
 }
 const canvas=$('race-score-plot'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
 ctx.clearRect(0,0,w,h);const max=Math.max(3,game.scores.a,game.scores.b),left=25,top=15;
 ctx.strokeStyle='#293f3c';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,top);ctx.lineTo(left,h-22);ctx.lineTo(w-10,h-22);ctx.stroke();
 for(const [id,color] of [['a','#9ed9c1'],['b','#a9bdd8']]){ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();let previous=null;
  const points=[{time:0,scores:{a:0,b:0}},...game.history];
  for(const p of points){const x=left+p.time/game.duration_seconds*(w-left-12),y=h-22-p.scores[id]/max*(h-top-28);if(previous){ctx.lineTo(x,previous.y);ctx.lineTo(x,y);}else ctx.moveTo(x,y);previous={x,y};}ctx.stroke();
 }
 ctx.fillStyle='#8e9c9c';ctx.font='10px monospace';ctx.fillText('0',7,h-22);ctx.fillText(String(max),5,top+4);ctx.fillText('Food collected · simulated seconds',left+6,h-5);ctx.fillText(String(game.duration_seconds),w-32,h-5);
}
