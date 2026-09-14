import * as THREE from 'three';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
import { createPointSwarms } from './point-swarms.js?v=18';
import { createContinuitySwarms } from './continuity-swarms.js?v=20';

// Continue the opening's material and geometry, in one shared, transparent viewport.
const section=document.querySelector('#founders');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const mobile=matchMedia('(max-width:760px)');
const motion=document.querySelector('#motion');
const states=[...section.querySelectorAll('.founder-visual')].map((frame,i)=>({frame,portrait:frame.querySelector('.founder-portrait'),direction:i===0?-1:1,elapsed:0,started:false,rect:null}));
const clamp=v=>Math.max(0,Math.min(1,v));
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
const mix=(a,b,t)=>a+(b-a)*t;
const allowed=()=>!reduced.matches&&motion.getAttribute('aria-pressed')!=='true';
let renderer,scene,camera,canvas,frame=0,last=0,time=0,near=false,failed=false;
let measured=true,sectionRect,geometry,material,environment;
let seed=4913;
function random(){seed=seed*16807%2147483647;return(seed-1)/2147483646;}
const temp=new THREE.Object3D(),colour=new THREE.Color();
const points=createPointSwarms(THREE,()=>{measured=true;wake();});
const continuity=createContinuitySwarms(THREE,()=>{measured=true;wake();});
function reveal(){states.forEach(s=>{s.portrait.style.transform='none';s.portrait.style.opacity='1';s.portrait.style.willChange='auto';});}
function init(){
 if(renderer||failed||!allowed())return;
 canvas=document.createElement('canvas');canvas.className='founder-swarm-canvas';canvas.setAttribute('aria-hidden','true');document.body.append(canvas);
 try{renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});}catch{failed=true;canvas.remove();reveal();return;}
 renderer.setClearColor(0x000000,0);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.18;
 scene=new THREE.Scene();camera=new THREE.OrthographicCamera(0,innerWidth,0,innerHeight,.1,2000);camera.position.z=1000;
 const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment();environment=pmrem.fromScene(room,.03);scene.environment=environment.texture;room.dispose();pmrem.dispose();
 scene.add(new THREE.HemisphereLight(0xd1efff,0x05242c,1.5));
 const key=new THREE.DirectionalLight(0xe8fcf3,4);key.position.set(-300,-500,600);scene.add(key);
 const rim=new THREE.DirectionalLight(0x29bac6,5);rim.position.set(500,100,-300);scene.add(rim);
 geometry=new THREE.IcosahedronGeometry(1,2);
 material=new THREE.MeshPhysicalMaterial({color:0x8eb7b8,roughness:.28,metalness:.62,clearcoat:.65,clearcoatRoughness:.3});
 states.forEach(s=>{
  s.nodes=new THREE.InstancedMesh(geometry,material,160);s.nodes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);s.nodes.frustumCulled=false;scene.add(s.nodes);
  s.seeds=Array.from({length:160},(_,i)=>{const tone=random();colour.set(tone>.94?0xc6eee1:tone>.7?0x47979d:tone>.24?0x406f7d:0x183c50);s.nodes.setColorAt(i,colour);return {u:random(),v:random(),phase:random()*Math.PI*2,radius:2.6+random()*3.9};});
  s.nodes.instanceColor.needsUpdate=true;s.portrait.style.willChange='transform,opacity';
 });
 points.install(scene,geometry,material);continuity.install(scene,geometry,material);
 canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();failed=true;cancelAnimationFrame(frame);frame=0;canvas.hidden=true;points.setEnabled(false);continuity.setEnabled(false);reveal();});
 renderer.compile(scene,camera);size();measure();paint(0);
}
function size(){
 if(renderer){renderer.setPixelRatio(Math.min(devicePixelRatio,mobile.matches?1:1.4));renderer.setSize(innerWidth,innerHeight);camera.right=innerWidth;camera.bottom=innerHeight;camera.updateProjectionMatrix();}
 measured=true;wake();
}
function measure(){sectionRect=section.getBoundingClientRect();states.forEach(s=>s.rect=s.frame.getBoundingClientRect());points.measure();continuity.measure();measured=false;}
function paint(dt){
 const count=mobile.matches?64:112,duration=mobile.matches?1.25:1.6;
 states.forEach(s=>{
  const r=s.rect,visible=r.bottom>0&&r.top<innerHeight;
  if(!s.started&&r.top<innerHeight*.88){s.started=true;if(r.bottom<0)s.elapsed=duration;}
  if(s.started&&visible)s.elapsed=Math.min(duration,s.elapsed+dt);
  const p=clamp(s.elapsed/duration),push=1-Math.pow(1-clamp(p/.82),3),release=smooth(.65,1,p);
  const distance=mobile.matches?Math.min(180,r.width*.65):s.direction<0?r.right+90:innerWidth-r.left+90;
  const offset=s.direction*distance*(1-push);
  s.portrait.style.transform=`translate3d(${offset.toFixed(2)}px,0,0)`;
  s.portrait.style.opacity=String(smooth(0,.1,p));
  if(p===1)s.portrait.style.willChange='auto';
  s.nodes.visible=visible&&s.started;
  const activeCount=p===1?(mobile.matches?18:26):count;s.nodes.count=activeCount;
  if(!s.nodes.visible)return;
  const edge=s.direction<0?r.left+offset:r.right+offset;
  for(let i=0;i<activeCount;i++){
   const node=s.seeds[i];
   const wave=Math.sin(time*1.3+node.phase),trail=(mobile.matches?75:145)*(0.45+0.55*(1-push));
   let x=edge+s.direction*(9+node.u*trail)+wave*5;
   let y=r.top+node.v*r.height+Math.sin(time*2+node.phase)*12;
   // Scouts wrap over and under the photo while the dense body pushes its outer edge.
   if(i%5===0){x=r.left+offset+node.u*r.width;y=(i%2?r.top-12:r.bottom+12)+wave*7;}
   const padding=12+node.u*(mobile.matches?14:30),along=.06+node.v*.88;
   let restingX,restingY;
   if(i%4===0){restingX=r.left-padding;restingY=r.top+along*r.height;}
   else if(i%4===1){restingX=r.right+padding;restingY=r.top+along*r.height;}
   else{restingX=r.left+along*r.width;restingY=i%4===2?r.top-padding:r.bottom+padding;}
   x=mix(x,restingX+wave*5,release);y=mix(y,restingY+Math.cos(time*.9+node.phase)*7,release);
   const retained=i<(mobile.matches?18:26);
   if(!retained){x+=s.direction*node.u*90*release;y+=(node.v-.5)*100*release;}
   const fade=retained?mix(1,.55,release):1-release;
   const radius=node.radius*(mobile.matches?.8:1)*fade*smooth(0,.1,p);
   temp.position.set(x,y,Math.sin(node.phase+time*.3)*25);temp.scale.set(radius,radius*.84,radius*.9);temp.rotation.set(node.phase,time*.16+node.phase,node.phase*.4);temp.updateMatrix();s.nodes.setMatrixAt(i,temp.matrix);
  }
  s.nodes.instanceMatrix.needsUpdate=true;
 });
 points.paint(time,dt);continuity.paint(time,dt);
 renderer.setScissorTest(false);renderer.clear();renderer.render(scene,camera);
}
function tick(now){
 frame=0;if(!near||document.hidden||!allowed()||failed){last=0;return;}
 if(measured)measure();
 // Full refresh rate while pushing a photo; only the settled ambient drift is capped.
 const entering=states.some(s=>s.elapsed<(mobile.matches?1.25:1.6)&&s.rect.bottom>0&&s.rect.top<innerHeight*.88);
 if(!entering&&last&&now-last<32){frame=requestAnimationFrame(tick);return;}
 const dt=last?Math.min((now-last)/1000,.08):0;last=now;time+=dt;
 paint(dt);frame=requestAnimationFrame(tick);
}
function wake(){
 points.setEnabled(allowed()&&!failed);continuity.setEnabled(allowed()&&!failed);
 if(!near||document.hidden||!allowed()||failed){cancelAnimationFrame(frame);frame=0;last=0;if(canvas)canvas.hidden=true;if(!allowed()){states.forEach(s=>{s.elapsed=4;s.started=true;});reveal();}return;}
 init();if(!renderer||failed)return;canvas.hidden=false;
 if(!frame){last=0;frame=requestAnimationFrame(tick);}
}
addEventListener('scroll',()=>{measured=true;},{passive:true});
addEventListener('resize',size,{passive:true});mobile.addEventListener('change',size);
reduced.addEventListener('change',wake);new MutationObserver(wake).observe(motion,{attributes:true,attributeFilter:['aria-pressed']});document.addEventListener('visibilitychange',wake);
const nearby=new Set();
const observer=new IntersectionObserver(entries=>{entries.forEach(e=>e.isIntersecting?nearby.add(e.target):nearby.delete(e.target));near=nearby.size>0;measured=true;wake();},{rootMargin:'240px 0px'});
const resizeObserver=new ResizeObserver(()=>{measured=true;});
[section,...points.sections,...continuity.sections].forEach(el=>{observer.observe(el);resizeObserver.observe(el);});
