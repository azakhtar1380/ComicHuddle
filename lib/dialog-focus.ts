type DialogEntry={element:HTMLElement;previous:HTMLElement|null};
const dialogs:DialogEntry[]=[];
let previousOverflow='',previousPadding='';
const focusable='button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]';

function focusInPlace(element:HTMLElement|null|undefined){
 if(element?.isConnected)element.focus({preventScroll:true});
}

function focusControl(element:HTMLElement,dialog:HTMLElement){
 focusInPlace(element);
 // Reveal keyboard targets by scrolling the dialog itself, never the page.
 const target=element.getBoundingClientRect(),frame=dialog.getBoundingClientRect();
 const top=frame.top+dialog.clientTop,bottom=top+dialog.clientHeight;
 if(target.top<top)dialog.scrollTop+=target.top-top;
 else if(target.bottom>bottom)dialog.scrollTop+=target.bottom-bottom;
}

/** How many dialogs hold the page scroll lock right now. */
export const lockedDialogs=()=>dialogs.length;
// Dev only: something set body overflow outside this module and left the page stuck.
function warnIfLeaked(){
 if(process.env.NODE_ENV==='production'||typeof window==='undefined')return;
 setTimeout(()=>{if(!dialogs.length&&document.body.style.overflow==='hidden')console.warn('[scroll lock] The page is still locked with no dialog open. Use activateDialog (lib/dialog-focus.ts) instead of setting body overflow directly.')},400);
}

export function activateDialog(element:HTMLElement|null,onClose:()=>void){
 if(!element)return;
 const entry:DialogEntry={element,previous:document.activeElement as HTMLElement|null};
 if(!dialogs.length){
  const bar=window.innerWidth-document.documentElement.clientWidth;
  previousOverflow=document.body.style.overflow;previousPadding=document.body.style.paddingRight;
  if(bar>0)document.body.style.paddingRight=bar+'px';document.body.style.overflow='hidden';
 }
 dialogs.push(entry);
 let active=true;
 // Focus right after the dialog first paints: focusing earlier forces a full-page layout before anything shows.
 // (A sliding drawer starts outside the viewport; preventScroll keeps the page still.)
 requestAnimationFrame(()=>setTimeout(()=>{if(active&&!element.contains(document.activeElement))focusInPlace(element)},0));
 const key=(event:KeyboardEvent)=>{
  if(dialogs.at(-1)!==entry)return;
  // A native modal owns its keyboard/focus behavior above this custom overlay.
  if((event.target as Element|null)?.closest?.('dialog[open]'))return;
  if(event.key==='Escape'){event.preventDefault();onClose();return}
  if(event.key!=='Tab')return;
  const controls=Array.from(element.querySelectorAll<HTMLElement>(focusable));
  const first=controls[0],last=controls.at(-1);
  if(!first||!last){event.preventDefault();return}
  if(event.shiftKey&&(document.activeElement===first||document.activeElement===element)){
   event.preventDefault();focusControl(last,element);
  }else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===element)){
   event.preventDefault();focusControl(first,element);
  }
 };
 document.addEventListener('keydown',key);
 return()=>{
  if(!active)return;active=false;
  const wasTop=dialogs.at(-1)===entry;
  dialogs.splice(dialogs.indexOf(entry),1);
  document.removeEventListener('keydown',key);
  if(!dialogs.length){document.body.style.overflow=previousOverflow;document.body.style.paddingRight=previousPadding;warnIfLeaked()}
  if(wasTop){
   const parent=dialogs.at(-1)?.element;
   const previous=entry.previous?.isConnected&&(!parent||parent.contains(entry.previous))?entry.previous:parent;
   focusInPlace(previous);
  }
 };
}
