let trigger;
const dialogs=[...document.querySelectorAll('dialog[id^="enquiry-"]')];
document.querySelectorAll('[data-enquire]').forEach(button=>button.addEventListener('click',()=>{
 trigger=button;
 const dialog=document.querySelector('#enquiry-'+button.dataset.enquire);
 const form=dialog.querySelector('form');
 form.reset();form.hidden=false;dialog.querySelector('.demo-success').hidden=true;
 dialog.showModal();
}));
function close(dialog){dialog.close();dialog.querySelector('form').reset();trigger?.focus();}
dialogs.forEach(dialog=>{
 dialog.querySelectorAll('.dialog-close,[data-close-demo]').forEach(button=>button.addEventListener('click',()=>close(dialog)));
 dialog.addEventListener('close',()=>dialog.querySelector('form').reset());
 dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close(dialog);}});
 dialog.querySelector('form').addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget;form.reset();form.hidden=true;
  dialog.querySelector('.demo-success').hidden=false;dialog.querySelector('[data-close-demo]').focus();
 });
});
const menu=document.querySelector('.menu-toggle'),mobileNav=document.querySelector('#mobile-nav');
menu.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')==='true';menu.setAttribute('aria-expanded',String(!open));menu.setAttribute('aria-label',open?'Open navigation':'Close navigation');mobileNav.hidden=open;menu.querySelector('span').textContent=open?'+':'−';});
mobileNav.querySelectorAll('a,button').forEach(link=>link.addEventListener('click',()=>{mobileNav.hidden=true;menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-label','Open navigation');menu.querySelector('span').textContent='+';}));
const prefersReducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
const motionButton=document.querySelector('#motion');
const allowMotion=()=>!prefersReducedMotion.matches && motionButton?.getAttribute('aria-pressed')!=='true';
// A floating talent deck; the original articles remain readable without JavaScript.
const tierSwitch=document.querySelector('.tier-switch');
const tierButtons=[...tierSwitch.querySelectorAll('[data-tier]')];
const tierPanels=tierButtons.map(button=>document.getElementById(button.getAttribute('aria-controls')));
const tierGrid=document.querySelector('.tier-grid');
let activeTier=0,tierPaused=false;
const tierControls=document.createElement('div');tierControls.className='tier-deck-controls';
tierControls.innerHTML='<button type="button" class="tier-prev" aria-label="Previous talent tier">←</button><span class="tier-status" aria-live="polite"></span><button type="button" class="tier-next" aria-label="Next talent tier">→</button><button type="button" class="tier-motion" aria-pressed="false">Pause floating</button>';
tierGrid.after(tierControls);
const tierStatus=tierControls.querySelector('.tier-status');
function selectTier(index,focus=false){
 activeTier=(index+3)%3;
 tierButtons.forEach((button,i)=>{
  const active=i===activeTier,slot=(i-activeTier+4)%3-1;
  button.setAttribute('aria-pressed',String(active));
  tierPanels[i].hidden=false;tierPanels[i].setAttribute('aria-hidden',String(!active));tierPanels[i].tabIndex=active?0:-1;
  tierPanels[i].classList.toggle('is-current',active);tierPanels[i].style.setProperty('--tier-slot',slot);tierPanels[i].style.zIndex=active?3:1;
 });
 tierStatus.textContent=`0${activeTier+1} / 03 — ${tierButtons[activeTier].childNodes[1].textContent}`;
 if(focus)tierButtons[activeTier].focus();
}
tierSwitch.hidden=false;tierSwitch.setAttribute('role','group');tierGrid.classList.add('is-floating');
tierButtons.forEach((button,i)=>{
 const face=document.createElement('div');face.className='tier-face';
 while(tierPanels[i].firstChild)face.append(tierPanels[i].firstChild);
 tierPanels[i].append(face);
 button.addEventListener('click',()=>selectTier(i));
 tierPanels[i].addEventListener('click',()=>{if(!tierSwiped)selectTier(i);});
 button.addEventListener('keydown',event=>{
  let next;if(event.key==='ArrowRight')next=(i+1)%3;if(event.key==='ArrowLeft')next=(i+2)%3;
  if(event.key==='Home')next=0;if(event.key==='End')next=2;
  if(next!==undefined){event.preventDefault();selectTier(next,true);}
 });
});
tierControls.querySelector('.tier-prev').addEventListener('click',()=>selectTier(activeTier-1));
tierControls.querySelector('.tier-next').addEventListener('click',()=>selectTier(activeTier+1));
const syncTierMotion=()=>tierGrid.classList.toggle('motion-off',tierPaused||!allowMotion());
tierControls.querySelector('.tier-motion').addEventListener('click',event=>{
 tierPaused=!tierPaused;event.currentTarget.setAttribute('aria-pressed',String(tierPaused));event.currentTarget.textContent=tierPaused?'Resume floating':'Pause floating';syncTierMotion();
});
prefersReducedMotion.addEventListener('change',syncTierMotion);
new MutationObserver(syncTierMotion).observe(motionButton,{attributes:true,attributeFilter:['aria-pressed']});
new IntersectionObserver(entries=>tierGrid.classList.toggle('is-visible',entries[0].isIntersecting),{threshold:.1}).observe(tierGrid);
let tierPointer=null,tierSwiped=false;
tierGrid.addEventListener('pointerdown',event=>{tierPointer={x:event.clientX,y:event.clientY,id:event.pointerId};tierSwiped=false;});
tierGrid.addEventListener('pointerup',event=>{
 if(!tierPointer||event.pointerId!==tierPointer.id)return;
 const dx=event.clientX-tierPointer.x,dy=event.clientY-tierPointer.y;
 if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.4){tierSwiped=true;selectTier(activeTier+(dx<0?1:-1));}
 tierPointer=null;
});
tierGrid.addEventListener('pointercancel',()=>tierPointer=null);
selectTier(0);syncTierMotion();
// Short entrance motion continues the pacing of the opening, without scroll hijacking.
const narrativeElements=document.querySelectorAll('.proof-clients,.tst-card,.do-card,.insight-card,.original-content .section-h2');
if('IntersectionObserver' in window){
 const entrances=new IntersectionObserver(entries=>entries.forEach(entry=>{
  if(!entry.isIntersecting)return;
  entrances.unobserve(entry.target);
  if(allowMotion())entry.target.animate([{opacity:.15,transform:'translateY(30px)'},{opacity:1,transform:'translateY(0)'}],{duration:850,easing:'cubic-bezier(.16,1,.3,1)'});
 }),{threshold:.12});
 narrativeElements.forEach(element=>entrances.observe(element));
}
document.querySelectorAll('.original-content details').forEach(details=>details.addEventListener('toggle',()=>{
 if(details.open&&allowMotion())details.querySelector('summary + div')?.animate([{opacity:0,transform:'translateY(-6px)'},{opacity:1,transform:'translateY(0)'}],{duration:300,easing:'ease-out'});
}));
const stopContentMotion=()=>{if(!allowMotion())document.querySelector('#after-experience').getAnimations({subtree:true}).forEach(animation=>{if(animation.effect?.getTiming().iterations!==Infinity)animation.finish();});};
prefersReducedMotion.addEventListener('change',stopContentMotion);
new MutationObserver(stopContentMotion).observe(motionButton,{attributes:true,attributeFilter:['aria-pressed']});
