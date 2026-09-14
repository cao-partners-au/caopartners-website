// DOM-based 3D cards: real, selectable text and no extra WebGL scene or image downloads.
const section=document.querySelector('#testimonials');
const stage=section.querySelector('.review-stage');
const deck=section.querySelector('.review-deck');
const source=section.querySelector('.review-source');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const globalMotion=document.querySelector('#motion');
const dialog=document.querySelector('#review-dialog');
// Use existing client carousel marks and the three logos supplied by the user.
const clientLogos={
 'EZYAIR':{src:'assets/clients/ezyair.png',name:'EZYAIR'},
 'Vitale Projects':{src:'assets/clients/vitale.svg',name:'Vitale Projects'},
 'Northwear & Kingston Con':{src:'assets/clients/northwear.png',name:'Northwear'},
 'H&L Construction':{src:'assets/clients/handl-mask.svg',name:'H&L Constructions',presentation:'emblem'},
 'Striking Pools':{src:'assets/clients/striking-pools.png',name:'Striking Pools'},
 'Hive Property':{src:'assets/clients/hive.png',name:'Hive Property'},
 'The GOAT co':{src:'assets/clients/goat-mask.svg',name:'The GOAT co',presentation:'goat'},
 'Marvel Invest':{src:'assets/clients/marvel-invest-mask.svg',name:'Marvel Invest',presentation:'marvel'},
 'Harvac':{src:'assets/clients/harvac-mask.svg',name:'Harvac',presentation:'harvac'}
};
const reviews=[...source.querySelectorAll('figure')].map((figure,i)=>({
 quote:figure.querySelector('blockquote').innerHTML,
 text:figure.querySelector('blockquote').textContent.trim().replace(/\s+/g,' '),
 name:figure.querySelector('.tst-name').textContent.trim(),
 org:figure.querySelector('.tst-org').textContent.trim(),
 category:i<4?'candidates':'clients',
 logo:i<4?null:clientLogos[figure.querySelector('.tst-org').textContent.trim()]||null
}));
let category='clients',current=0,localPaused=false,returnFocus=null;
let visibleReviews=[],cards=[],entered=false;
let autoTimer=0,reviewInView=false,pointerOverCards=false;
const motionAllowed=()=>!reduced.matches&&!localPaused&&globalMotion.getAttribute('aria-pressed')!=='true';
function canAutoAdvance(){
 return reviewInView&&motionAllowed()&&!document.hidden&&!dialog.open&&!pointerOverCards&&!section.contains(document.activeElement);
}
function syncAutoAdvance(){
 clearTimeout(autoTimer);autoTimer=0;
 if(canAutoAdvance())autoTimer=setTimeout(()=>{
  autoTimer=0;
  if(canAutoAdvance())select(current+1);
 },4000);
}
function span(className,text){const el=document.createElement('span');el.className=className;if(text!==undefined)el.textContent=text;return el;}
function excerpt(text){
 if(text.length<=225)return text;
 const slice=text.slice(0,225);return slice.slice(0,slice.lastIndexOf(' '))+'…';
}
function businessMark(logo){
 const badge=span('review-business-mark');
 if(logo.presentation)badge.dataset.presentation=logo.presentation;
 badge.setAttribute('role','img');badge.setAttribute('aria-label',logo.name);
 badge.style.setProperty('--business-mark',`url("${logo.src}")`);
 return badge;
}
function makeCard(review,index){
 const button=document.createElement('button');button.type='button';button.className='review-card';
 const floating=span('review-card-float'),flip=span('review-card-flip');
 const front=span('review-face review-front');
 const meta=span('review-card-meta');meta.append(span('',review.category==='clients'?'Client story':'Placed candidate'),span('',String(index+1).padStart(2,'0')));
 const quote=span('review-card-quote',excerpt(review.text));
 const byline=span('review-card-byline'),person=span('review-card-person');
 person.append(span('review-card-name',review.name),span('review-card-org',review.org));byline.append(person);
 if(review.logo)byline.append(businessMark(review.logo));
 const foot=span('review-card-footer');foot.append(span('review-card-action','Read full review'),span('','+'));
 const markRow=span('review-mark-row');markRow.append(span('review-quote-mark','“'));
 front.append(meta,markRow,quote,byline,foot);
 const back=span('review-face review-back');back.setAttribute('aria-hidden','true');
 const logo=document.createElement('img');logo.src='assets/logo.svg';logo.alt='';logo.width=110;logo.height=56;
 back.append(span('review-back-label',review.logo?'CLIENT STORY':'CAO PARTNERS'),review.logo?businessMark(review.logo):logo,span('review-back-org',review.org));
 flip.append(front,back);floating.append(flip);button.append(floating);
 button.style.setProperty('--float-delay',`${-index*1.23}s`);
 button.addEventListener('click',()=>{if(index===current)openReview(button);else select(index);});
 return button;
}
function positionCards(){
 const count=cards.length;
 cards.forEach((card,index)=>{
  let distance=(index-current+count)%count;if(distance>count/2)distance-=count;
  const visible=Math.abs(distance)<=2;
  card.classList.toggle('is-current',distance===0);
  card.classList.toggle('is-away',!visible);
  card.inert=!visible;card.setAttribute('aria-hidden',String(!visible));
  card.tabIndex=distance===0?0:-1;
  card.setAttribute('aria-label',`${distance===0?'Read full review':'Select review'} by ${visibleReviews[index].name}, ${visibleReviews[index].org}`);
  card.style.setProperty('--slot',distance);
  card.style.setProperty('--depth',`${60-Math.abs(distance)*110}px`);
  card.style.setProperty('--turn',`${-distance*13}deg`);
  card.style.setProperty('--fan',`${distance*8}deg`);
  card.style.setProperty('--drop',`${Math.abs(distance)*24}px`);
  card.style.zIndex=String(10-Math.abs(distance));
 });
 section.querySelector('.review-position').textContent=`${String(current+1).padStart(2,'0')} / ${String(count).padStart(2,'0')} — ${visibleReviews[current].org}`;
}
function select(index){current=(index+cards.length)%cards.length;positionCards();syncAutoAdvance();}
function renderCards(){
 visibleReviews=reviews.filter(review=>review.category===category);current=0;
 cards=visibleReviews.map(makeCard);deck.replaceChildren(...cards);positionCards();
 section.querySelectorAll('[data-review-group]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.reviewGroup===category)));
 section.querySelector('#review-audience-word').textContent=category==='clients'?'clients':'candidates';
 if(entered)section.classList.add('reviews-entered');
 syncAutoAdvance();
}
function openReview(button){
 const review=visibleReviews[current];returnFocus=button;
 // Trusted, authored original testimonial markup, including its paragraph breaks.
 dialog.querySelector('#review-dialog-quote').innerHTML=review.quote;
 dialog.querySelector('#review-dialog-name').textContent=review.name;
 dialog.querySelector('#review-dialog-org').textContent=review.org;
 dialog.querySelector('.review-dialog-label').textContent=review.category==='clients'?'Client story':'Placed candidate';
 const brand=dialog.querySelector('.review-dialog-brand');brand.replaceChildren();brand.hidden=!review.logo;
 if(review.logo)brand.append(businessMark(review.logo));
 section.classList.add('review-reading');dialog.showModal();syncAutoAdvance();
}
function closeReview(){dialog.close();}
dialog.querySelectorAll('.review-close,.review-close-text').forEach(button=>button.addEventListener('click',closeReview));
dialog.addEventListener('close',()=>{section.classList.remove('review-reading');returnFocus?.focus({preventScroll:true});syncAutoAdvance();});
dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeReview();});
section.querySelectorAll('[data-review-group]').forEach(button=>button.addEventListener('click',()=>{category=button.dataset.reviewGroup;renderCards();}));
section.querySelector('[data-review-prev]').addEventListener('click',()=>select(current-1));
section.querySelector('[data-review-next]').addEventListener('click',()=>select(current+1));
deck.addEventListener('keydown',event=>{
 let next;if(event.key==='ArrowLeft')next=current-1;if(event.key==='ArrowRight')next=current+1;
 if(event.key==='Home')next=0;if(event.key==='End')next=cards.length-1;
 if(next!==undefined){event.preventDefault();select(next);cards[current].focus({preventScroll:true});}
});
let touchStart=null,suppressClickUntil=0;
stage.addEventListener('pointerdown',event=>{if(event.pointerType==='touch')touchStart={x:event.clientX,y:event.clientY};});
stage.addEventListener('pointerup',event=>{
 if(!touchStart)return;const dx=event.clientX-touchStart.x,dy=event.clientY-touchStart.y;touchStart=null;
 if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.5){select(current+(dx<0?1:-1));suppressClickUntil=performance.now()+350;}
});
stage.addEventListener('pointercancel',()=>{touchStart=null;});
stage.addEventListener('click',event=>{if(performance.now()<suppressClickUntil){event.preventDefault();event.stopPropagation();}},true);
function syncMotion(){
 section.classList.toggle('cards-paused',!motionAllowed());
 const button=section.querySelector('.review-motion');
 button.textContent=localPaused?'Resume cards':'Pause cards';button.setAttribute('aria-pressed',String(localPaused));
 if(!motionAllowed()){stage.style.setProperty('--pointer-x','0deg');stage.style.setProperty('--pointer-y','0deg');}
 syncAutoAdvance();
}
section.querySelector('.review-motion').addEventListener('click',()=>{localPaused=!localPaused;syncMotion();});
reduced.addEventListener('change',syncMotion);
new MutationObserver(syncMotion).observe(globalMotion,{attributes:true,attributeFilter:['aria-pressed']});
let pointerFrame=0,pointerX=0,pointerY=0;
stage.addEventListener('pointermove',event=>{
 if(event.pointerType!=='mouse'||!motionAllowed())return;
 const rect=stage.getBoundingClientRect();pointerX=(event.clientX-rect.left)/rect.width-.5;pointerY=(event.clientY-rect.top)/rect.height-.5;
 if(pointerFrame)return;pointerFrame=requestAnimationFrame(()=>{stage.style.setProperty('--pointer-x',`${pointerY*-3}deg`);stage.style.setProperty('--pointer-y',`${pointerX*5}deg`);pointerFrame=0;});
});
stage.addEventListener('pointerleave',()=>{stage.style.setProperty('--pointer-x','0deg');stage.style.setProperty('--pointer-y','0deg');});
renderCards();stage.hidden=false;section.querySelectorAll('.review-ui').forEach(el=>el.hidden=false);source.hidden=true;syncMotion();
if('IntersectionObserver' in window){
 const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{
  section.classList.toggle('reviews-visible',entry.isIntersecting);
  reviewInView=entry.isIntersecting&&entry.intersectionRatio>=.35;syncAutoAdvance();
  if(entry.isIntersecting&&!entered){entered=true;requestAnimationFrame(()=>section.classList.add('reviews-entered'));}
 }),{threshold:[0,.12,.35]});observer.observe(stage);
}else{entered=true;reviewInView=true;section.classList.add('reviews-entered','reviews-visible');syncAutoAdvance();}
stage.addEventListener('pointerenter',event=>{if(event.pointerType==='mouse'){pointerOverCards=true;syncAutoAdvance();}});
stage.addEventListener('pointerleave',()=>{pointerOverCards=false;syncAutoAdvance();});
section.addEventListener('focusin',syncAutoAdvance);
section.addEventListener('focusout',()=>queueMicrotask(syncAutoAdvance));
document.addEventListener('visibilitychange',()=>{section.classList.toggle('review-page-hidden',document.hidden);syncAutoAdvance();});
