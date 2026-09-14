// Additional editorial scenes share the existing node renderer, geometry and material.
export function createContinuitySwarms(THREE,onChange){
 const vet=document.querySelector('#vetting'),candidates=document.querySelector('#candidates'),insights=document.querySelector('#insights'),proof=document.querySelector('.proof-composition'),footer=document.querySelector('.source-footer');
 const sections=[vet,candidates,insights,proof,footer],items=[],steps=[...vet.querySelectorAll('.vet-step')];
 const titles=steps.map(s=>s.querySelector('h3').textContent);
 let installed=false,enabled=false,activeVet=-1;
 function add(host,kind,where='append',index=0){
  const slot=document.createElement('div');slot.className=`continuity-scene scene-${kind}`;slot.setAttribute('aria-hidden','true');slot.hidden=true;
  if(where==='before')host.before(slot);else if(where==='after')host.after(slot);else host.append(slot);
  const item={slot,kind,index,rect:null,strength:0};items.push(item);return item;
 }
 const vetScene=add(vet.querySelector('.vet-cta'),'vet','before');
 const caption=document.createElement('div');caption.className='vet-scene-caption';vetScene.slot.append(caption);
 steps.forEach((step,i)=>add(step.querySelector('h3'),'vet-mobile','after',i));
 [...candidates.querySelectorAll('.cand-card')].forEach((card,i)=>add(card.querySelector('h3'),'candidate','after',i));
 [...insights.querySelectorAll('.post')].forEach((post,i)=>add(post.querySelector('.post-body'),'insight','before',i));
 const tools=add(proof.querySelector('.source-tools-row'),'tools','after');tools.badges=[...proof.querySelectorAll('.source-tool-badge')];tools.metrics=[...proof.querySelectorAll('.proof-metric')];
 const end=add(footer.querySelector('.footer-brand .logo'),'footer');
 [vet,candidates,insights].forEach((section,i)=>{const bridge=add(section,'bridge','before',i);sections.push(bridge.slot);});
 function setEnabled(value){enabled=installed&&value;sections.forEach(s=>s.classList.toggle('has-continuity',enabled));items.forEach(s=>s.slot.hidden=!enabled);}
 function install(scene,geometry,material){
  for(const item of items){
   item.mesh=new THREE.InstancedMesh(geometry,material,96);item.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);item.mesh.frustumCulled=false;scene.add(item.mesh);
   for(let i=0;i<96;i++)item.mesh.setColorAt(i,new THREE.Color(i===0||i%17===0?0xd7ffda:i%4===0?0x8bcabc:0x4f9a9e));item.mesh.instanceColor.needsUpdate=true;
   const buffer=new Float32Array(96*18),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(buffer,3).setUsage(THREE.DynamicDrawUsage));
   item.lines=new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:0x86c6b8,transparent:true,opacity:.2,depthWrite:false}));item.lines.frustumCulled=false;scene.add(item.lines);
   item.positions=new Float32Array(96*3);item.links=buffer;
  }
  installed=true;setEnabled(true);
 }
 function measure(){
  items.forEach(s=>{s.rect=s.slot.getBoundingClientRect();if(s.badges){s.badgeRects=s.badges.map(b=>b.getBoundingClientRect());s.metricRects=s.metrics.map(b=>b.getBoundingClientRect());s.proofRect=proof.getBoundingClientRect();s.outcomeRect=proof.querySelector('.proof-outcomes').getBoundingClientRect();}});
  const rects=steps.map(s=>s.getBoundingClientRect());
  const next=rects.reduce((best,r,i)=>Math.abs(r.top+Math.min(r.height,250)/2-innerHeight*.48)<Math.abs(rects[best].top+Math.min(rects[best].height,250)/2-innerHeight*.48)?i:best,0);
  if(next!==activeVet){activeVet=next;caption.textContent=`0${next+1} / ${titles[next]}`;steps.forEach((s,i)=>s.classList.toggle('node-stage-active',i===next));}
 }
 const pi=Math.PI*2,temp=new THREE.Object3D();
 const sphere=(i,n,r=1)=>{const y=1-2*(i+.5)/n,a=i*2.39996323,q=Math.sqrt(Math.max(0,1-y*y));return [Math.cos(a)*q*r,y*r,Math.sin(a)*q*r];};
 function form(stage,i,n,t){
  if(stage===0){const p=sphere(i,n,.7),phase=(t*.11+i/n)%1;return [p[0]+(i%4===0?(1-phase)*-1.3:0),p[1],p[2]];}
  if(stage===1){const k=i%6,a=k*pi/6,p=sphere(Math.floor(i/6),Math.ceil(n/6),.2);return [Math.cos(a)*.74+p[0],Math.sin(a)*.68+p[1],p[2]+Math.sin(a+t*.2)*.24];}
  if(stage===2){if(i===0)return [Math.cos(t*.7)*.3,0,.4];const side=i%2?-1:1,p=sphere(Math.floor(i/2),Math.ceil(n/2),.4);return [p[0]+side*(.5+Math.sin(t*.6)*.1),p[1],p[2]];}
  if(stage===3){if(i<24)return sphere(i,24,.35);const a=(i-24)/(n-24)*pi+t*.18;return [Math.cos(a)*.9,Math.sin(a)*.62,Math.sin(a)*.35];}
  const layer=Math.floor(i/16),a=(i%16)/16*pi+t*.12;return [Math.cos(a)*.7,(layer-(Math.ceil(n/16)-1)/2)*.23,Math.sin(a)*.55];
 }
 function shape(item,i,n,t){
  if(item.kind==='vet'||item.kind==='vet-mobile')return form(item.kind==='vet'?activeVet:item.index,i,n,t);
  if(item.kind==='candidate'){
   if(item.index===0){if(i===0)return [-.8+((t*.13)%1)*.8,-.2,.6];return sphere(i,n,.72);}
   if(item.index===1)return form(2,i,n,t);
   if(i===0)return [0,0,.5];const branch=i%5,u=(Math.floor(i/5)+1)/Math.ceil(n/5),a=branch*pi/5;return [Math.cos(a)*u*.9,Math.sin(a)*u*.75,Math.sin(u*5-t)*.14];
  }
  if(item.kind==='insight'){
   if(item.index===0){const ring=i%3,a=Math.floor(i/3)/Math.ceil(n/3)*pi+t*(ring%2?-.23:.23),r=.58+ring*.15;return ring===0?[Math.cos(a)*r,Math.sin(a)*r*.28,Math.sin(a)*r]:ring===1?[Math.cos(a)*r*.4,Math.sin(a)*r,Math.cos(a)*r]:[Math.cos(a)*r,Math.sin(a)*r,Math.sin(a)*r*.25];}
   if(i<16)return sphere(i,16,.22);const branch=i%5,a=branch*pi/5,p=sphere(Math.floor((i-16)/5),Math.ceil((n-16)/5),.18);return [Math.cos(a)*.78+p[0],Math.sin(a)*.7+p[1],p[2]+Math.sin(a)*.3];
  }
  if(item.kind==='footer'){const a=i/n*pi+t*.1;return [Math.cos(a)*.9,Math.sin(a)*1.05,Math.sin(a)*.35];}
  const u=(i/n+t*.1)%1;return [Math.sin(u*pi+item.index)*.7,(u-.5)*2,Math.cos(u*pi)*.25];
 }
 function paint(time,dt){
  if(!installed)return;
  const mobile=innerWidth<=760;
  for(const item of items){
   const r=item.rect,visible=enabled&&r?.width>0&&r.height>0&&(item.kind==='tools'?item.proofRect.bottom>0&&item.proofRect.top<innerHeight:r.bottom>0&&r.top<innerHeight);
   item.mesh.visible=!!visible;item.lines.visible=!!visible;if(!visible)continue;item.elapsed=Math.min(3,(item.elapsed||0)+dt);
   const focused=item.slot.closest('.post')?.matches(':hover,:focus-within'),wanted=focused?1:0;
   item.strength+=(wanted-item.strength)*(1-Math.exp(-dt*6));
   const n=item.kind==='bridge'?24:item.kind==='footer'?32:mobile?64:96;
   const scale=Math.min(r.width*.44,(r.height-(item.kind==='vet'?34:0))*.46),cx=r.left+r.width/2,cy=r.top+(r.height-(item.kind==='vet'?34:0))/2;
   const angle=Math.sin(time*.2)*.24,ca=Math.cos(angle),sa=Math.sin(angle);let links=0;
   const link=(a,b)=>{if(links>=288)return;item.links.set([...a,...b],links++*6);};
   if(item.kind==='tools'){
    // Paths travel below each original tool mark into a common operating core.
    const hub=[cx,r.top+r.height*.65,0];let node=0;
    for(const badge of item.badgeRects){
     const start=[badge.left+badge.width/2,badge.bottom+3,0],bend=[start[0],r.top+15,0];link(start,bend);link(bend,hub);
     const u=(time*.18+node*.19)%1;
     const x=bend[0]+(hub[0]-bend[0])*u,y=bend[1]+(hub[1]-bend[1])*u;
     temp.position.set(x,y,4);temp.scale.setScalar(3.4);temp.updateMatrix();item.mesh.setMatrixAt(node++,temp.matrix);
    }
    for(let i=0;i<24;i++){const p=sphere(i,24,1),a=time*.35,x=p[0]*Math.cos(a)+p[2]*Math.sin(a);temp.position.set(hub[0]+x*25,hub[1]+p[1]*23,p[2]*20);temp.scale.setScalar(i%7===0?4:2.6);temp.updateMatrix();item.mesh.setMatrixAt(node++,temp.matrix);}
    const desktop=item.outcomeRect.left>r.right;
    const gx=desktop?(r.right+item.outcomeRect.left)/2:item.proofRect.left+14;
    const origin=[gx,hub[1],0];link(hub,origin);
    item.metricRects.forEach((m,k)=>{
     const bend=[gx,m.bottom-5,0],end=[m.left+m.width*.85,m.bottom-5,0];link(origin,bend);link(bend,end);
     const u=(time*.13+k*.22)%1,point=u<.5?[gx,origin[1]+(bend[1]-origin[1])*u*2,2]:[gx+(end[0]-gx)*(u-.5)*2,bend[1],2];
     temp.position.set(...point);temp.scale.setScalar(3.2);temp.updateMatrix();item.mesh.setMatrixAt(node++,temp.matrix);
    });
    item.mesh.count=node;
   }else{
    item.mesh.count=n;
    for(let i=0;i<n;i++){
     let p=shape(item,i,n,time*(1+item.strength*.8));
     if(item.kind==='footer')p[1]-=(1-Math.min(1,item.elapsed/2.4))**3*(1+(i%7)*.15);
     // Morph the sticky vetting sculpture smoothly as the active checkpoint changes.
     if(item.kind==='vet'){
      item.morph??=Array.from({length:96},()=>null);const old=item.morph[i]??p,k=1-Math.exp(-dt*5);p=old.map((v,j)=>v+(p[j]-v)*k);item.morph[i]=p;
     }
     const wide=item.kind==='bridge'||item.kind==='footer'?r.width*.44:scale;
     const x=cx+(p[0]*ca+p[2]*sa)*wide,y=cy+p[1]*scale,z=(p[2]*ca-p[0]*sa)*scale;
     item.positions.set([x,y,z],i*3);
     const lead=i===0&&item.kind==='candidate',pulse=(Math.sin(time*1.4-i*.15)+1)/2;
     const radius=item.kind==='bridge'?1.7+pulse:item.kind==='footer'?2+pulse:lead?7.5:(i%13===0?5:3)*(mobile?.84:1)*(1+item.strength*.2);
     temp.position.set(x,y,z);temp.scale.set(radius,radius*.9,radius);temp.rotation.set(i,time*.18+i,0);temp.updateMatrix();item.mesh.setMatrixAt(i,temp.matrix);
     if(i>0){const stride=item.kind==='insight'&&item.index===0?3:1,j=i-stride;if(j>=0){const prev=item.positions.subarray(j*3,j*3+3),d=(x-prev[0])**2+(y-prev[1])**2;if(d<scale*scale*.22)link([x,y,z],prev);}}
     if(item.kind==='candidate'&&item.index===2&&i%5===0)link([cx,cy,0],[x,y,z]);
     if(item.kind==='insight'&&item.index===1&&i>16&&i%15===0)link([cx,cy,0],[x,y,z]);
    }
   }
   item.mesh.instanceMatrix.needsUpdate=true;item.lines.geometry.setDrawRange(0,links*2);item.lines.geometry.attributes.position.needsUpdate=true;item.lines.material.opacity=item.kind==='bridge'?.08:.2+item.strength*.12;
  }
 }
 return {sections,install,measure,paint,setEnabled};
}
