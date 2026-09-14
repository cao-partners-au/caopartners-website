// Full-width explanatory sculptures, sharing the founder swarm's renderer and materials.
export function createPointSwarms(THREE,onChange){
 const sections=[document.querySelector('#what-they-do'),document.querySelector('#process')];
 const kinds=['workflow','delivery','reporting','ownership','scope','match','embed'];
 const items=[...sections[0].querySelectorAll('.do-card'),...sections[1].querySelectorAll('.step')].map((row,i)=>{
  const slot=document.createElement('span');slot.className='point-swarm-slot';slot.setAttribute('aria-hidden','true');slot.hidden=true;if(i<4)row.querySelector('.do-detail').prepend(slot);else row.querySelector('h3').after(slot);
  const item={row,slot,kind:kinds[i],strength:.4,rect:null,nodes:null,lines:null};
  if(i<4)row.addEventListener('toggle',onChange);
  return item;
 });
 const temp=new THREE.Object3D(),colour=new THREE.Color();let installed=false;
 function setEnabled(enabled){sections.forEach(s=>s.classList.toggle('has-point-swarms',installed&&enabled));items.forEach(s=>s.slot.hidden=!(installed&&enabled));}
 function install(scene,geometry,material){
  items.forEach(item=>{
   item.nodes=new THREE.InstancedMesh(geometry,material,48);item.nodes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);item.nodes.frustumCulled=false;scene.add(item.nodes);
   item.positions=new Float32Array(48*3);item.linkPositions=new Float32Array(48*6);
   const links=new THREE.BufferGeometry();links.setAttribute('position',new THREE.BufferAttribute(item.linkPositions,3).setUsage(THREE.DynamicDrawUsage));
   item.lines=new THREE.LineSegments(links,new THREE.LineBasicMaterial({color:0x89cabb,transparent:true,opacity:.2,depthWrite:false}));item.lines.frustumCulled=false;scene.add(item.lines);
   for(let i=0;i<48;i++){colour.set(i%7===0?0xc6eee1:i%3===0?0x78b7b3:0x47979d);item.nodes.setColorAt(i,colour);}item.nodes.instanceColor.needsUpdate=true;
  });installed=true;setEnabled(true);
 }
 function measure(){items.forEach(s=>s.rect=s.slot.getBoundingClientRect());}
 function point(kind,i,t){
  const a=i*2.3999632297;
  if(kind==='workflow'){const branch=i%6,u=(Math.floor(i/6)+1)/8,r=.12+u*.74,theta=branch*Math.PI/3;return [Math.cos(theta)*r,Math.sin(theta)*r*.8,Math.sin(theta*2)*u*.3];}
  if(kind==='delivery'){const u=(Math.floor(i/3)/16+t*.24)%1;return [-.9+u*1.8,(i%3-1)*.62+Math.sin(u*6.28)*.10,Math.cos(u*6.28)*.18];}
  if(kind==='reporting'){
   if(i<12)return [Math.cos(a)*.2,-.48+Math.sin(a)*.17,Math.sin(a*2)*.16];
   const branch=i%3,x=(branch-1)*.62;
   if(i>38){const u=(i/9+t*.28)%1;return [x*(1-u),.45-u*.86,0];}
   return [x+Math.cos(a)*.15,.42+Math.sin(a)*.2,Math.sin(a*2)*.15];
  }
  if(kind==='ownership'){if(i<12)return [Math.cos(a)*.2,Math.sin(a)*.2,Math.sin(a*2)*.2];const theta=(i-12)/36*Math.PI*2+t*.18;return [Math.cos(theta)*.82,Math.sin(theta)*.62,Math.sin(theta*2)*.3];}
  if(kind==='scope'){const y=1-2*(i+.5)/48,r=Math.sqrt(1-y*y);return [Math.cos(a)*r*.8,y*.8,Math.sin(a)*r*.8];}
  if(kind==='match'){
   if(i>=40){const u=(i-40)/8;return [(u-.5)*.85,Math.sin(t*2+u*6.28)*.06,0];}
   const side=i<20?-1:1,k=i%20,y=1-2*(k+.5)/20,r=Math.sqrt(1-y*y),gap=.49+Math.sin(t*.8)*.09;return [side*gap+Math.cos(a)*r*.32,y*.42,Math.sin(a)*r*.36];
  }
  // Three layers gather into an embedded, coherent lattice.
  const assemble=.86+Math.sin(t*.6)*.08;return [(i%4-1.5)*.39*assemble,(Math.floor(i/4)%4-1.5)*.39*assemble,(Math.floor(i/16)-1)*.43*assemble];
 }
 function paint(time,dt){
  if(!installed)return;
  const process=items.slice(4).filter(s=>s.rect?.bottom>0&&s.rect.top<innerHeight);
  const current=process.reduce((best,s)=>!best||Math.abs(s.rect.top-innerHeight*.42)<Math.abs(best.rect.top-innerHeight*.42)?s:best,null);
  items.forEach(item=>{
   const r=item.rect,visible=!!r&&r.width>0&&r.height>0&&(item.row.tagName!=='DETAILS'||item.row.open)&&r.bottom>0&&r.top<innerHeight;
   item.nodes.visible=visible;item.lines.visible=visible;if(!visible)return;
   const active=item.kind==='scope'||item.kind==='match'||item.kind==='embed'?item===current:item.row.open;
   item.strength+=(Number(active)-item.strength)*(1-Math.exp(-dt*9));
   const strength=item.strength,scale=Math.min(r.width,r.height)*.46;
   const wide=['workflow','delivery','match'].includes(item.kind),scaleX=wide?r.width*.45:scale*1.28;
   const angle=.3+Math.sin(time*.24)*.22,ca=Math.cos(angle),sa=Math.sin(angle);
   let linkCount=0;
   for(let i=0;i<48;i++){
    const [x,y,z]=point(item.kind,i,time*(.45+strength*.55));
    const breathing=1+Math.sin(time*1.1+i*.21)*.022;
    const px=r.left+r.width/2+(x*ca+z*sa)*scaleX*breathing,py=r.top+r.height/2+y*scale;
    const pz=(z*ca-x*sa)*scale;
    item.positions.set([px,py,pz],i*3);
    let radius=(3.2+(i%7===0?1.6:0))*(.85+strength*.3)*Math.min(1.25,r.height/150);
    if(item.kind==='scope'&&Math.abs(y-Math.sin(time*.9)*.75)<.18)radius*=1.4;
    temp.position.set(px,py,pz);temp.scale.set(radius,radius*.88,radius);temp.rotation.set(i,time*.2+i*.6,0);temp.updateMatrix();item.nodes.setMatrixAt(i,temp.matrix);
    const previous=i-(item.kind==='workflow'?6:item.kind==='delivery'?3:1);
    if(previous>=0){const q=previous*3,dx=px-item.positions[q],dy=py-item.positions[q+1];if(dx*dx+dy*dy<Math.max(scale,scaleX)*Math.max(scale,scaleX)*.65){item.linkPositions.set([px,py,pz,item.positions[q],item.positions[q+1],item.positions[q+2]],linkCount*6);linkCount++;}}
   }
   item.nodes.instanceMatrix.needsUpdate=true;item.lines.geometry.setDrawRange(0,linkCount*2);item.lines.geometry.attributes.position.needsUpdate=true;item.lines.material.opacity=.1+strength*.2;
  });
 }
 return {sections,install,measure,paint,setEnabled};
}
