type DialogEntry={element:HTMLElement;previous:HTMLElement|null};
const dialogs:DialogEntry[]=[];
let previousOverflow='';
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

export function activateDialog(element:HTMLElement|null,onClose:()=>void){
 if(!element)return;
 const entry:DialogEntry={element,previous:document.activeElement as HTMLElement|null};
 if(!dialogs.length){previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden'}
 dialogs.push(entry);
 // A sliding drawer starts outside the viewport. Default focus scrolls toward it.
 focusInPlace(element);
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
 let active=true;
 return()=>{
  if(!active)return;active=false;
  const wasTop=dialogs.at(-1)===entry;
  dialogs.splice(dialogs.indexOf(entry),1);
  document.removeEventListener('keydown',key);
  if(!dialogs.length)document.body.style.overflow=previousOverflow;
  if(wasTop){
   const parent=dialogs.at(-1)?.element;
   const previous=entry.previous?.isConnected&&(!parent||parent.contains(entry.previous))?entry.previous:parent;
   focusInPlace(previous);
  }
 };
}
