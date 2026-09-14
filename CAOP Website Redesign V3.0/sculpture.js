import * as THREE from 'three';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';

// One persistent scene. The same nodes become potential, a neural system,
// a connected business, and a calibrated network as the visitor scrolls.
const canvas=document.querySelector('#sculpture');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const mobile=matchMedia('(max-width: 700px)');
const motion=document.querySelector('#motion');
const story=document.querySelector('#story');
const chapters=[...document.querySelectorAll('.chapter')];
const rail=[...document.querySelectorAll('.chapter-rail a')];
const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
const mix=(a,b,t)=>a+(b-a)*t;
const smooth=t=>{t=clamp(t);return t*t*(3-2*t);};
let paused=reduced.matches;
let progress=0,target=0,active=-1,selectedFunction=0,time=0;
let scrollRange=1;
function measure(){scrollRange=Math.max(1,story.offsetHeight-innerHeight);}
function readScroll(){target=clamp(scrollY/scrollRange)*4;}
measure();readScroll();progress=target;
addEventListener('resize',()=>{measure();readScroll();},{passive:true});
addEventListener('scroll',readScroll,{passive:true});
document.querySelectorAll('[data-jump]').forEach(link=>link.addEventListener('click',event=>{
  event.preventDefault();const chapter=Number(link.dataset.jump);
  scrollTo({top:chapter/4*scrollRange,behavior:reduced.matches?'instant':'smooth'});
}));

const copy=["Maps every manual process across sales, ops, finance, and support. Deploys agents that replace the work, not just assist with it. The output is a different kind of business.", "Starts with the highest-leverage problem and ships something that works. Then the next one. The pace is not consulting pace. It is founder pace.", "This is a strategic infrastructure role. Sits at the decision-making table. Does not wait for tickets or quarterly reviews to move.", "Employed by you. Everything they build belongs to your business. The knowledge transfers. When they leave, the systems stay."];
const names=["Rebuilds workflows with AI agents, not around them", "Delivers in weeks, not quarters", "Reports to the CEO, not the tech team", "Your employee. Your IP. Your advantage."];
document.querySelectorAll('[data-function]').forEach(button=>button.addEventListener('click',()=>{
  selectedFunction=Number(button.dataset.function);
  document.querySelectorAll('[data-function]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});
  document.querySelector('#function-copy').textContent=copy[selectedFunction];
  document.querySelector('#function-heading').textContent=names[selectedFunction];
}));
function motionLabel(){motion.innerHTML=paused?'Motion off <span>▷</span>':'Motion on <span>Ⅱ</span>';motion.setAttribute('aria-pressed',String(paused));motion.setAttribute('aria-label',paused?'Enable ambient motion':'Pause ambient motion');}
motion.addEventListener('click',()=>{paused=!paused;motionLabel();});reduced.addEventListener('change',e=>{paused=e.matches;motionLabel();});motionLabel();
function updateChapters(){
  const section=Math.min(3,Math.floor(progress));
  const fraction=progress-section;
  const blend=smooth((fraction-.22)/.68);
  const nearest=section+(blend>.5?1:0);
  chapters.forEach((el,i)=>{
    let visibility=i===section?1-smooth((blend-.08)/.48):i===section+1?smooth((blend-.42)/.58):0;
    if(progress>=3.999)visibility=i===4?1:0;
    el.style.opacity=visibility;
    el.style.visibility=visibility>.005?'visible':'hidden';
    const shift=i===section?-blend*55:(1-blend)*65;
    el.style.transform=`translate3d(0,${reduced.matches?0:shift}px,0)`;
    el.classList.toggle('is-active',i===nearest);
    el.inert=i!==nearest;
    el.setAttribute('aria-hidden',String(i!==nearest));
  });
  if(nearest!==active){active=nearest;document.querySelector('#chapter-counter').textContent=`0${active+1} / 05`;rail.forEach((el,i)=>{el.classList.toggle('active',i===active);if(i===active)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');});}
  return {section,blend};
}

let renderer;
try{renderer=new THREE.WebGLRenderer({canvas,alpha:false,antialias:true,powerPreference:'high-performance'});}catch{document.body.classList.add('webgl-failed');motion.hidden=true;}
if(!renderer){let last=-1;function fallback(){if(last!==target){progress=target;updateChapters();last=target;}requestAnimationFrame(fallback);}fallback();}
else{
renderer.setPixelRatio(Math.min(devicePixelRatio,mobile.matches?1.25:1.5));
renderer.setSize(innerWidth,innerHeight);
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.18;
const scene=new THREE.Scene();
scene.fog=new THREE.FogExp2(0x071a21,.034);
const camera=new THREE.PerspectiveCamera(42,innerWidth/innerHeight,.05,90);
camera.position.set(0,0,11);
const pmrem=new THREE.PMREMGenerator(renderer);const room=new RoomEnvironment();const env=pmrem.fromScene(room,.03);scene.environment=env.texture;room.dispose();pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xd1efff,0x05242c,1.5));
const key=new THREE.DirectionalLight(0xe8fcf3,4);key.position.set(-3,5,5);scene.add(key);
const rim=new THREE.DirectionalLight(0x29bac6,5);rim.position.set(5,1,-3);scene.add(rim);
const low=new THREE.PointLight(0x146bfd,28,15,2);low.position.set(2,-3,3);scene.add(low);

const backdrop=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({depthWrite:false,depthTest:false,uniforms:{uTime:{value:0},uProgress:{value:0}},vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.999,1.);}`,fragmentShader:`varying vec2 vUv;uniform float uTime;uniform float uProgress;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){vec2 uv=vUv;vec3 col=vec3(.015,.047,.063);float cloud=exp(-length((uv-vec2(.66,.53))*vec2(1.2,1.5))*2.9);col+=vec3(.017,.078,.092)*cloud;float wave=sin(uv.x*5.+uv.y*3.+uTime*.045)*.5+.5;col+=vec3(.005,.018,.02)*wave;float streak=exp(-pow((uv.y-.65-(uv.x-.5)*.45)*7.,2.));col+=vec3(.02,.044,.05)*streak*.5;col*=1.-length(uv-.5)*.53;col+= (hash(gl_FragCoord.xy)-.5)*.019;gl_FragColor=vec4(col,1.);}` }));backdrop.renderOrder=-1000;backdrop.frustumCulled=false;scene.add(backdrop);

const N=mobile.matches?620:1050;
const shapes=Array.from({length:5},()=>new Float32Array(N*3));
const radii=new Float32Array(N),tones=new Float32Array(N),seed=new Float32Array(N);
let randomSeed=48271;
function rand(){randomSeed=(randomSeed*16807)%2147483647;return(randomSeed-1)/2147483646;}
const golden=Math.PI*(3-Math.sqrt(5));
for(let i=0;i<N;i++){
 const t=(i+.5)/N,theta=i*golden,y=1-2*t,r=Math.sqrt(1-y*y),a=theta+y*.65;
 // Pebbled, curved seed: dense, tactile and built from independent nodes.
 shapes[0].set([Math.cos(a)*r*1.6+Math.sin(y*2.2)*.25,y*2.4,Math.sin(a)*r*1.2],i*3);
 const branch=i%12,along=Math.floor(i/12)/(N/12),angle=branch/12*Math.PI*2+.2;
 const length=.5+along*3.1,wave=Math.sin(along*8+branch)*.22;
 shapes[1].set([Math.cos(angle)*length+wave,Math.sin(angle)*length*.85+Math.sin(along*4)*.2,Math.sin(branch*2.3)*along*1.5+Math.cos(theta)*.24],i*3);
 const cluster=i%4,local=Math.floor(i/4)/(N/4),az=local*golden*N*.27,sy=1-2*local,sr=Math.sqrt(Math.max(0,1-sy*sy));
 const centers=[[0,2,0],[2.4,0,.3],[0,-2,.1],[-2.4,0,-.3]],c=centers[cluster];
 shapes[2].set([c[0]+Math.cos(az)*sr*.7,c[1]+sy*.7,c[2]+Math.sin(az)*sr*.7],i*3);
 const band=i%3,q=Math.floor(i/3)/(N/3)*Math.PI*2,thickness=Math.sin(theta)*.11,rr=1.5+band*.48;
 shapes[3].set([Math.cos(q)*(rr+thickness),Math.sin(q)*(rr+thickness)*(.67+band*.08),Math.cos(theta)*.11+(band-1)*.8+Math.sin(q)*.7],i*3);
 const out=5+rand()*9;
 shapes[4].set([Math.cos(theta)*r*out,y*out*.7,Math.sin(theta)*out-3],i*3);
 radii[i]=(.065+rand()*.041)*(mobile.matches?1.18:1);tones[i]=rand();seed[i]=rand()*Math.PI*2;
}
const group=new THREE.Group();scene.add(group);
const material=new THREE.MeshPhysicalMaterial({color:0x8eb7b8,roughness:.28,metalness:.62,clearcoat:.65,clearcoatRoughness:.3});
const nodes=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,2),material,N);nodes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);nodes.frustumCulled=false;group.add(nodes);
const temp=new THREE.Object3D();const colour=new THREE.Color();
for(let i=0;i<N;i++){const bright=tones[i]>.94;colour.set(bright?0xc6eee1:tones[i]>.7?0x47979d:tones[i]>.24?0x406f7d:0x183c50);nodes.setColorAt(i,colour);}
nodes.instanceColor.needsUpdate=true;
const current=new Float32Array(N*3);
// Thin branching links share node positions, so no independent scene cuts occur.
const edges=[];
for(let i=12;i<N;i++){
 if(i%2===0)edges.push([i,i-12]);
 if(i%7===0)edges.push([i,Math.max(0,i-24)]);
 if(i%37===0)edges.push([i,Math.max(0,i-1)]);
}
const linksPos=new Float32Array(edges.length*6);
const linksGeo=new THREE.BufferGeometry();linksGeo.setAttribute('position',new THREE.BufferAttribute(linksPos,3).setUsage(THREE.DynamicDrawUsage));
const linksMat=new THREE.LineBasicMaterial({color:0x6fb9bd,transparent:true,opacity:.02,depthWrite:false});
const links=new THREE.LineSegments(linksGeo,linksMat);links.frustumCulled=false;group.add(links);
const core=new THREE.Mesh(new THREE.IcosahedronGeometry(.36,4),new THREE.MeshPhysicalMaterial({color:0xcceade,emissive:0x63cdb3,emissiveIntensity:.24,metalness:.42,roughness:.18,clearcoat:1}));group.add(core);
// A soft analytic halo instead of a full-screen bloom pass.
const halo=new THREE.Sprite(new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{strength:{value:0}},vertexShader:`varying vec2 vUv;void main(){vUv=uv;vec4 mv=modelViewMatrix*vec4(0.,0.,0.,1.);mv.xy+=position.xy*vec2(length(modelMatrix[0].xyz),length(modelMatrix[1].xyz));gl_Position=projectionMatrix*mv;}`,fragmentShader:`varying vec2 vUv;uniform float strength;void main(){float r=length(vUv-.5)*2.;float glow=exp(-r*r*6.)*.22;gl_FragColor=vec4(.37,.83,.75,glow*strength);}`}));halo.scale.set(2.4,2.4,1);group.add(halo);
// Sparse foreground particles give the camera a sense of travelling through volume.
const dustPositions=new Float32Array(240*3);for(let i=0;i<240;i++)dustPositions.set([(rand()-.5)*27,(rand()-.5)*18,(rand()-.5)*25],i*3);
const dustGeo=new THREE.BufferGeometry();dustGeo.setAttribute('position',new THREE.BufferAttribute(dustPositions,3));
const dust=new THREE.Points(dustGeo,new THREE.PointsMaterial({color:0x699aa8,size:.016,transparent:true,opacity:.42,depthWrite:false}));scene.add(dust);
const pulseMat=new THREE.MeshBasicMaterial({color:0xd4f9de});
const pulseCount=20;const pulses=new THREE.InstancedMesh(new THREE.SphereGeometry(.023,6,4),pulseMat,pulseCount);pulses.frustumCulled=false;group.add(pulses);
let px=0,py=0,sx=0,sy=0;
addEventListener('pointermove',e=>{px=(e.clientX/innerWidth-.5);py=(e.clientY/innerHeight-.5);},{passive:true});
const scales=mobile.matches?[.82,.52,.53,.56,.9]:[1, .89,.9,1,1.1];
const rots=[[-.18,.28,-.48],[.08,-.12,.12],[.08,-.18,.24],[.2,.15,-.42],[0,0,0]];
let last=performance.now(),frame=0,slowFrames=0,adaptive=false;
function size(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();measure();readScroll();}
addEventListener('resize',size,{passive:true});
let previousProgress=-10;
function draw(now){requestAnimationFrame(draw);const delta=Math.min((now-last)/1000,.055);last=now;if(document.hidden)return;
 // After the cinematic story, render only on scroll; content below remains native HTML.
 if(scrollY>story.offsetHeight+innerHeight*.2)return;
 progress=reduced.matches?target:mix(progress,target,1-Math.exp(-delta*9));if(Math.abs(progress-target)<.00005)progress=target;
 const changed=Math.abs(progress-previousProgress)>.00001;
 if(paused&&!changed&&frame>0)return;
 if(!paused)time+=delta;
 const {section,blend}=updateChapters();previousProgress=progress;
 const a=shapes[section],b=shapes[section+1];
 const mobileNow=mobile.matches;
 const s0=mobileNow?[.82,.52,.53,.56,.9]:scales;
 const coords=mobileNow?[[.55,-.4,0],[.8,-2.2,0],[.8,-2.1,0],[.8,-2.1,0],[0,0,0]]:[[2.1,.05,0],[2.55,0,0],[2.5,0,0],[2.7,0,0],[0,0,-1]];
 const spread=Math.sin(blend*Math.PI)*(section===0?.62:section===3?1.2:.25);
 const localScale=mix(s0[section],s0[section+1],blend);
 group.scale.setScalar(localScale);
 for(let k=0;k<3;k++)group.position.setComponent(k,mix(coords[section][k],coords[section+1][k],blend));
 if(!paused){sx=mix(sx,px,.025);sy=mix(sy,py,.025);}
 group.rotation.set(mix(rots[section][0],rots[section+1][0],blend)+sy*.07,mix(rots[section][1],rots[section+1][1],blend)+sx*.12+Math.sin(time*.1)*.12,mix(rots[section][2],rots[section+1][2],blend)+Math.sin(time*.07)*.045);
 // The camera gently pushes into the object between chapters, then resolves on the new form.
 camera.position.z=11-Math.sin(blend*Math.PI)*(mobileNow?.4:1.25);
 camera.position.x=sx*.1;camera.position.y=-sy*.08;camera.lookAt(0,0,0);
 const nodeSizes=[1,.6,.67,.75,.4];const nodeSize=mix(nodeSizes[section],nodeSizes[section+1],blend);
 for(let i=0;i<N;i++){
  const ix=i*3;const breath=1+Math.sin(time*.5+seed[i])*.009;
  for(let k=0;k<3;k++)current[ix+k]=mix(a[ix+k],b[ix+k],blend)*breath*(1+spread*.18);
  temp.position.fromArray(current,ix);
  const r=radii[i]*nodeSize;
  temp.scale.set(r*(1.03+Math.sin(seed[i])*.16),r*.82,r*.87);
  temp.rotation.set(seed[i],seed[i]*.4,seed[i]*.6+time*.018);
  temp.updateMatrix();nodes.setMatrixAt(i,temp.matrix);
 }
 nodes.instanceMatrix.needsUpdate=true;
 const lineOpacity=[.035,.3,.16,.19,.035];linksMat.opacity=mix(lineOpacity[section],lineOpacity[section+1],blend);
 for(let i=0;i<edges.length;i++){const [a,b]=edges[i];for(let k=0;k<3;k++){linksPos[i*6+k]=current[a*3+k];linksPos[i*6+3+k]=current[b*3+k];}}
 linksGeo.attributes.position.needsUpdate=true;
 const coreScales=[.02,1,.95,.6,.02];core.scale.setScalar(mix(coreScales[section],coreScales[section+1],blend)*(1+Math.sin(time*1.1)*.025));
 core.rotation.set(time*.1,time*.13,0);halo.material.uniforms.strength.value=core.scale.x;
 for(let i=0;i<pulseCount;i++){
  const [a,b]=edges[(i*29+selectedFunction*17)%edges.length];const t=(time*.18+i/pulseCount)%1;
  temp.position.set(mix(current[a*3],current[b*3],t),mix(current[a*3+1],current[b*3+1],t),mix(current[a*3+2],current[b*3+2],t));temp.scale.setScalar(core.scale.x);temp.updateMatrix();pulses.setMatrixAt(i,temp.matrix);
 }
 pulses.instanceMatrix.needsUpdate=true;
 dust.rotation.y=time*.006;dust.position.z=-progress*.8;
 backdrop.material.uniforms.uTime.value=time;backdrop.material.uniforms.uProgress.value=progress;
 renderer.render(scene,camera);frame++;
 if(delta>.038&&frame>30)slowFrames++;else slowFrames=Math.max(0,slowFrames-1);
 if(slowFrames>40&&!adaptive){renderer.setPixelRatio(1);adaptive=true;}
}
requestAnimationFrame(draw);
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();document.body.classList.add('webgl-failed');canvas.hidden=true;});
}
