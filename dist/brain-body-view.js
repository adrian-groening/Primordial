const colors={a:'#9ed9c1',b:'#a9bdd8'};
export class BrainBodyView {
  constructor(canvas,onSelect){this.canvas=canvas;this.onSelect=onSelect;this.world=null;this.sequence=null;this.bodies=[];
    canvas.addEventListener('click',event=>{const rect=canvas.getBoundingClientRect();const x=(event.clientX-rect.left)/rect.width*this.w,y=(event.clientY-rect.top)/rect.height*this.h;
      if(!this.transform)return;const p={x:(x-this.transform.x)/this.transform.scale,y:(y-this.transform.y)/this.transform.scale};
      const body=this.bodies.find(b=>Math.hypot(b.x-p.x,b.y-p.y)<b.radius+3);if(body)this.onSelect(body.id);
    });
  }
  update(world,active,sessionId){
    const key=`${sessionId}:${world?.step}`;
    if(key!==this.sequence){this.sequence=key;this.began=performance.now();}
    this.world=world;this.active=active;
  }
  draw(now,selected){
    const canvas=this.canvas,rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
    const dpr=Math.min(devicePixelRatio||1,2),w=rect.width,h=rect.height;
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    this.w=w;this.h=h;const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#030607';ctx.fillRect(0,0,w,h);
    const world=this.world;
    if(!world){ctx.fillStyle='#8e9c9c';ctx.font='12px monospace';ctx.fillText('Start the physical world to initialize both brains.',24,h/2);return;}
    const scale=Math.min((w-48)/world.width,(h-50)/world.height),ox=(w-world.width*scale)/2,oy=(h-world.height*scale)/2;
    this.transform={x:ox,y:oy,scale};ctx.save();ctx.translate(ox,oy);ctx.scale(scale,scale);
    ctx.lineWidth=.25;ctx.strokeStyle='#142225';ctx.beginPath();
    for(let x=0;x<=world.width;x+=10){ctx.moveTo(x,0);ctx.lineTo(x,world.height);}
    for(let y=0;y<=world.height;y+=10){ctx.moveTo(0,y);ctx.lineTo(world.width,y);}ctx.stroke();
    ctx.strokeStyle='#47615c';ctx.lineWidth=.5;ctx.strokeRect(0,0,world.width,world.height);
    for(const obstacle of world.obstacles){ctx.fillStyle='#101719';ctx.strokeStyle='#617170';ctx.lineWidth=.35;ctx.beginPath();ctx.arc(obstacle.x,obstacle.y,obstacle.radius,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.strokeStyle='#304343';ctx.beginPath();ctx.moveTo(obstacle.x-obstacle.radius*.4,obstacle.y);ctx.lineTo(obstacle.x+obstacle.radius*.4,obstacle.y);ctx.moveTo(obstacle.x,obstacle.y-obstacle.radius*.4);ctx.lineTo(obstacle.x,obstacle.y+obstacle.radius*.4);ctx.stroke();}
    for(const food of world.food){ctx.beginPath();ctx.arc(food.x,food.y,food.radius,0,Math.PI*2);ctx.fillStyle=food.amount?'#70ab6b':'#182521';ctx.fill();if(food.amount){ctx.strokeStyle='#a3ca89';ctx.lineWidth=.2;ctx.stroke();
      if(world.race){ctx.fillStyle='#83a985';ctx.font='2.4px monospace';ctx.fillText(food.id,food.x+1.5,food.y-1.5);}}}
    const progress=this.active?Math.min(1,(now-this.began)/Math.max(50,world.lastWallSeconds*1000)):1;
    const frames=world.motion??[],cursor=progress*Math.max(0,frames.length-1),index=Math.min(Math.floor(cursor),Math.max(0,frames.length-1)),t=cursor-index;
    this.bodies=world.bodies.map(body=>{const from=frames[index]?.find(p=>p.id===body.id)??body,to=frames[Math.min(index+1,frames.length-1)]?.find(p=>p.id===body.id)??from;
      return{...body,x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t,angle:from.angle+(to.angle-from.angle)*t,scan:(from.scan??0)+((to.scan??0)-(from.scan??0))*t,head:(from.head??0)+((to.head??0)-(from.head??0))*t,distance:(from.distance??body.distance)+((to.distance??body.distance)-(from.distance??body.distance))*t};});
    for(const body of this.bodies){const color=colors[body.id];
      if(world.race&&body.raceCommand?.path?.length){ctx.strokeStyle=color;ctx.globalAlpha=.45;ctx.lineWidth=.35;ctx.setLineDash([1,1]);ctx.beginPath();ctx.moveTo(body.x,body.y);for(const p of body.raceCommand.path)ctx.lineTo(p.x,p.y);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;}
      ctx.strokeStyle=color;ctx.globalAlpha=.18;ctx.lineWidth=.3;ctx.beginPath();body.trail.forEach((p,i)=>{if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);});ctx.stroke();ctx.globalAlpha=1;
      this.drawBody(ctx,body,selected===body.id,world.time);
      ctx.font='3px monospace';ctx.fillStyle=color;ctx.fillText(body.id.toUpperCase(),body.x-1,body.y-body.radius-2);
      ctx.font='2.5px monospace';ctx.fillText(body.mind?.intent??'active',body.x-6,body.y+body.radius+6);
      ctx.fillStyle='#20312b';ctx.fillRect(body.x-4,body.y+body.radius+2,8,.6);ctx.fillStyle=color;ctx.fillRect(body.x-4,body.y+body.radius+2,8*body.energy/100,.6);
      ctx.strokeStyle=color;ctx.lineWidth=.2;ctx.beginPath();ctx.moveTo(body.x,body.y);ctx.lineTo(body.x+body.vx*.1,body.y+body.vy*.1);ctx.stroke();
    }
    ctx.restore();ctx.fillStyle='#8e9c9c';ctx.font='9px monospace';
    ctx.fillText('0',ox,oy+world.height*scale+15);ctx.fillText(`${world.width} mm`,ox+world.width*scale-40,oy+world.height*scale+15);
    ctx.fillText(`${world.time.toFixed(2)} s simulated · step ${world.step} · ${world.race ? 'LLM food race' : 'no language model'}`,ox+8,oy+14);
    const focused=this.bodies.find(body=>body.id===selected);if(focused&&w>470)this.drawInset(ctx,focused,w,h,world.time);
  }
  drawBody(ctx,body,selected,time){
    const color=colors[body.id],intent=body.mind?.intent??'exploring';
    const quiet=['resting','scanning','feeding','quiescent'].includes(intent);
    const drive=(body.motor.left_hz+body.motor.right_hz)/(body.motor.left_hz+body.motor.right_hz+40);
    ctx.save();ctx.translate(body.x,body.y);ctx.rotate(body.angle);
    if(selected){ctx.setLineDash([.6,.8]);ctx.strokeStyle=color;ctx.lineWidth=.16;ctx.beginPath();ctx.arc(0,0,body.radius,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);}
    ctx.strokeStyle=color;ctx.lineWidth=.36;ctx.globalAlpha=body.alive?.95:.25;
    for(const side of [-1,1])for(let leg=0;leg<3;leg++){
      const phase=body.distance/3.8*Math.PI*2+(leg%2?Math.PI:0)+(side>0?Math.PI:0);
      const swing=quiet?.1:Math.sin(phase)*.8,hip=1-leg*1.25,kneeX=hip+.2+swing*.5;
      ctx.beginPath();ctx.moveTo(hip,side*.9);ctx.lineTo(kneeX,side*(quiet?2:2.6));ctx.lineTo(hip+.7+swing,side*(quiet?2.5:3.7));ctx.stroke();
      ctx.fillStyle=color;ctx.beginPath();ctx.arc(kneeX,side*(quiet?2:2.6),.13,0,Math.PI*2);ctx.fill();
    }
    const breath=body.alive?Math.sin(time*8+(body.mind?.phase??0))*.035:0;
    ctx.fillStyle='#1a302c';ctx.lineWidth=.32;ctx.beginPath();ctx.ellipse(-1,0,2.15,1.5+breath,0,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.globalAlpha=.45;for(const x of [-2,-1.2,-.4]){ctx.beginPath();ctx.moveTo(x,-1.15);ctx.quadraticCurveTo(x+.45,0,x,1.15);ctx.stroke();}ctx.globalAlpha=body.alive?1:.3;
    ctx.fillStyle='#27413b';ctx.beginPath();ctx.ellipse(1,0,1.15,1.2,0,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.save();ctx.translate(2.15,0);ctx.rotate(body.head??0);
    const nibble=intent==='feeding'?Math.sin(time*24)*.15:0;
    ctx.translate(nibble,0);ctx.fillStyle='#203734';ctx.beginPath();ctx.ellipse(.3,0,.95,.9,0,0,Math.PI*2);ctx.fill();ctx.stroke();
    for(const side of [-1,1]){
      ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(.55,side*.65,.25,.15,side*.4,0,Math.PI*2);ctx.fill();
      const scan=(body.scan??0),tipX=1.65+Math.cos(scan+side*.5)*.3,tipY=side*(1.4+Math.sin(scan)*.5);
      ctx.strokeStyle=color;ctx.lineWidth=.22;ctx.beginPath();ctx.moveTo(.65,side*.5);ctx.quadraticCurveTo(1.2,side*.7,tipX,tipY);ctx.stroke();
      const chemical=side<0?body.sensors?.left:body.sensors?.right;ctx.fillStyle=chemical>.2?'#e1bf82':color;
      ctx.beginPath();ctx.arc(tipX,tipY,.16+Math.min(.15,(chemical??0)*.15),0,Math.PI*2);ctx.fill();
    }
    ctx.restore();ctx.globalAlpha=.2+drive*.4;ctx.fillStyle=color;ctx.beginPath();ctx.arc(1,0,.35,0,Math.PI*2);ctx.fill();ctx.restore();
  }
  drawInset(ctx,body,w,h,time){
    const width=166,height=132,x=w-width-12,y=27;
    ctx.save();ctx.fillStyle='#071012f0';ctx.strokeStyle='#344c49';ctx.lineWidth=1;ctx.fillRect(x,y,width,height);ctx.strokeRect(x,y,width,height);
    ctx.fillStyle=colors[body.id];ctx.font='10px monospace';ctx.fillText(`ORGANISM ${body.id.toUpperCase()} · CLOSE VIEW`,x+10,y+17);
    ctx.save();ctx.translate(x+width/2,y+67);ctx.scale(8,8);this.drawBody(ctx,{...body,x:0,y:0,angle:0},false,time);ctx.restore();
    ctx.fillStyle='#d5e3dd';ctx.font='11px monospace';ctx.fillText(body.mind?.intent??'active',x+10,y+112);
    ctx.fillStyle='#8e9c9c';ctx.font='9px monospace';ctx.fillText(`energy ${body.energy.toFixed(0)}% · meals ${body.meals}`,x+10,y+126);ctx.restore();
  }

}
