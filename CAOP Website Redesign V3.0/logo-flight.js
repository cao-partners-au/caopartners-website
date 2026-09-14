// One lightweight DOM layer: reuse the client assets, with camera-style depth projection.
const section=document.querySelector('#work-with-us');
const field=section.querySelector('.client-flight');
const toggle=section.querySelector('.flight-motion');
const globalMotion=document.querySelector('#motion');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const clientMarks=[...document.querySelectorAll('.source-logo-group:not([aria-hidden]) img')].map(image=>({src:image.getAttribute('src'),name:image.alt}));
clientMarks.push(
 {src:'assets/clients/goat-mask.svg',name:'The GOAT co'},
 {src:'assets/clients/marvel-invest-mask.svg',name:'Marvel Invest'},
 {src:'assets/clients/harvac-mask.svg',name:'Harvac'}
);
// Stratify the depths so the scene is already populated when it enters the viewport.
let seed=7429;
function random(){seed=(seed*16807)%2147483647;return (seed-1)/2147483646;}
const TAU=Math.PI*2;
const particles=clientMarks.map((brand,index)=>{
 const image=document.createElement('img');
 image.src=brand.src;image.alt='';image.decoding='async';image.draggable=false;
 image.className='flight-logo';image.width=150;image.height=72;
 field.append(image);
 return {image,phase:(index+.15)/clientMarks.length,speed:1/(17+random()*9),angle:index*2.3999632297,radius:.62+random()*.48,tilt:(random()-.5)*12};
});
let width=0,height=0,frame=0,last=0,inView=false,paused=false,narrow=false,activeCount=particles.length,nextBrand=10;
function paint(){
 particles.forEach(p=>{
  if(p.image.hidden)return;
  // Constant forward travel through 3D space accelerates naturally near the camera.
  const depth=narrow?1600-p.phase*2100:2600-p.phase*3200,scale=720/(720+depth);
  const x=width*.5+Math.cos(p.angle)*width*(narrow?.48:.58)*p.radius*scale;
  const y=height*.46+Math.sin(p.angle)*height*(narrow?.52:.58)*p.radius*scale;
  const fadeIn=Math.min(1,p.phase/.14),fadeOut=Math.min(1,(1-p.phase)/.13);
  p.image.style.transform=`translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) translate(-50%,-50%) scale(${scale.toFixed(4)}) rotate(${p.tilt.toFixed(2)}deg)`;
  p.image.style.opacity=(Math.max(0,fadeIn*fadeOut)*(narrow?.94:.72)).toFixed(3);
  p.image.style.zIndex=String(Math.floor(p.phase*100));
 });
}
function allowed(){return inView&&!paused&&!reduced.matches&&!document.hidden&&globalMotion.getAttribute('aria-pressed')!=='true';}
function tick(now){
 frame=0;if(!allowed()){last=0;return;}
 // Cap mobile rendering at 30fps while keeping travel speed based on elapsed time.
 if(last&&now-last<(narrow?32:15)){frame=requestAnimationFrame(tick);return;}
 const dt=last?Math.min((now-last)/1000,.1):0;last=now;
 particles.forEach(p=>{
  if(p.image.hidden)return;
  p.phase+=dt*p.speed;
  if(p.phase>=1){
   if(narrow){p.image.src=clientMarks[nextBrand%clientMarks.length].src;nextBrand++;}
   p.phase-=1;p.angle=(p.angle+1.5+random()*2)%TAU;p.radius=.62+random()*.48;p.tilt=(random()-.5)*12;}
 });
 paint();frame=requestAnimationFrame(tick);
}
function sync(){
 const globallyPaused=reduced.matches||globalMotion.getAttribute('aria-pressed')==='true';
 toggle.disabled=globallyPaused;
 toggle.setAttribute('aria-pressed',String(paused||globallyPaused));
 toggle.setAttribute('aria-label',paused?'Resume client logo animation':'Pause client logo animation');
 toggle.querySelector('span').textContent=globallyPaused?'Motion paused':paused?'Play flight':'Pause flight';
 toggle.querySelector('b').textContent=paused||globallyPaused?'▷':'Ⅱ';
 if(allowed()){if(!frame){last=0;frame=requestAnimationFrame(tick);}}
 else{cancelAnimationFrame(frame);frame=0;last=0;}
}
function resize(){
 width=field.clientWidth;height=field.clientHeight;
 const wasNarrow=narrow;narrow=width<=700;activeCount=narrow?10:particles.length;
 particles.forEach((p,i)=>{
  p.image.hidden=i>=activeCount;p.image.style.width=`${narrow?130:150}px`;
  if(wasNarrow!==narrow){p.phase=(i+.15)/activeCount;p.image.src=clientMarks[i].src;}
 });
 if(wasNarrow!==narrow)nextBrand=activeCount;paint();
}
new ResizeObserver(resize).observe(field);resize();
if('IntersectionObserver' in window){
 new IntersectionObserver(entries=>{inView=entries[0].isIntersecting;sync();},{threshold:0}).observe(section);
}else inView=true;
toggle.hidden=false;
toggle.addEventListener('click',()=>{paused=!paused;sync();});
reduced.addEventListener('change',sync);
document.addEventListener('visibilitychange',sync);
new MutationObserver(sync).observe(globalMotion,{attributes:true,attributeFilter:['aria-pressed']});
sync();
