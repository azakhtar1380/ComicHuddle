'use client';
// Phone navigation: four quick spots + the Scan button, and a "More" sheet laid out like a
// comic-book page where every section of the site is its own panel.
import {useEffect,useRef,useState,type ComponentType} from 'react';
import {BookOpen,Camera,Clock3,Home,LayoutGrid,MessageCircle,ShoppingBag,User,Users,Wallet,Wrench,X} from 'lucide-react';
import './mobile-dock.css';

type Props={tab:string;scanOpen:boolean;onNavigate:(section:string)=>void;onScan:()=>void};
type Item={id:string;label:string;caption:string;Icon:ComponentType<{size?:number}>;section?:string;href?:string;tone:string;wide?:boolean};
const quick:Item[]=[
 {id:'Home',label:'Home',caption:'',Icon:Home,section:'Home',tone:''},
 {id:'Marketplace',label:'Shop',caption:'',Icon:ShoppingBag,section:'Marketplace',tone:''},
];
const quickRight:Item[]=[{id:'Directory',label:'Directory',caption:'',Icon:BookOpen,section:'Directory',tone:''}];
/** Every destination in the header menu, as comic panels. */
const panels:Item[]=[
 {id:'Directory',label:'Comic Directory',caption:'2.6 million issues',Icon:BookOpen,section:'Directory',tone:'red',wide:true},
 {id:'Characters',label:'Characters',caption:'Heroes & villains',Icon:Users,href:'/characters',tone:'yellow'},
 {id:'Marketplace',label:'Shop',caption:'Buy & sell copies',Icon:ShoppingBag,section:'Marketplace',tone:'blue'},
 {id:'Collectors',label:'My Collection',caption:'Your shelf & profile',Icon:User,section:'My Profile',tone:'cream'},
 {id:'Pressing',label:'Comic Workshop',caption:'Pressing & grading',Icon:Wrench,section:'Pressing',tone:'ink'},
 {id:'Wallet',label:'Wallet & Rewards',caption:'Points & credit',Icon:Wallet,href:'/wallet',tone:'green',wide:true},
 {id:'Messages',label:'Messages',caption:'Talk to collectors',Icon:MessageCircle,section:'Messages',tone:'cream'},
 {id:'Upcoming',label:'Coming Soon',caption:'What’s next',Icon:Clock3,href:'/upcoming',tone:'yellow'},
 {id:'Home',label:'Home',caption:'Back to the front page',Icon:Home,section:'Home',tone:'blue',wide:true},
];
const isActive=(item:Item,tab:string)=>tab===item.id||tab===item.section||(item.id==='Collectors'&&(tab==='My Profile'||tab==='Collectors'));

export default function MobileDock({tab,scanOpen,onNavigate,onScan}:Props){
 const [open,setOpen]=useState(false),sheet=useRef<HTMLDialogElement>(null),opener=useRef<HTMLButtonElement>(null);
 useEffect(()=>{const node=sheet.current;if(!node)return;if(open&&!node.open)node.showModal();if(!open&&node.open)node.close()},[open]);
 const go=(item:Item)=>{setOpen(false);if(item.href)window.location.assign(item.href);else if(item.section)onNavigate(item.section)};
 const dockButton=(item:Item)=>{const active=isActive(item,tab);return <button type="button" key={item.id} aria-label={item.label} aria-current={active?'page':undefined} onClick={()=>go(item)}><item.Icon size={21}/><span>{item.label}</span></button>};
 const moreActive=!quick.concat(quickRight).some(item=>isActive(item,tab));
 return <>
  <nav className="mobile-bottom mobile-scan-dock dock-v2" aria-label="Quick mobile navigation">
   {quick.map(dockButton)}
   <button type="button" className="scan-action" aria-label="Scan a comic" aria-haspopup="dialog" aria-expanded={scanOpen} onClick={onScan}><Camera size={24}/><span>Scan</span></button>
   {quickRight.map(dockButton)}
   <button ref={opener} type="button" className={'dock-more'+(open?' open':'')} aria-label="All sections" aria-haspopup="dialog" aria-expanded={open} aria-current={moreActive?'page':undefined} onClick={()=>setOpen(true)}><LayoutGrid size={21}/><span>More</span></button>
  </nav>
  <dialog ref={sheet} className="dock-sheet" aria-labelledby="dock-sheet-title" onClose={()=>{setOpen(false);opener.current?.focus()}} onClick={event=>{if(event.target===event.currentTarget)setOpen(false)}}>
   <div className="dock-page">
    <div className="dock-page-head"><h2 id="dock-sheet-title"><span>Where to,</span> collector?</h2><button type="button" className="dock-close" aria-label="Close menu" onClick={()=>setOpen(false)}><X size={20}/></button></div>
    <div className="dock-panels">{panels.map(item=>{const active=isActive(item,tab);return <button type="button" key={item.id+item.label} className={'dock-panel tone-'+item.tone+(item.wide?' wide':'')+(active?' here':'')} aria-current={active?'page':undefined} onClick={()=>go(item)}>
     <span className="dock-panel-icon"><item.Icon size={26}/></span><strong>{item.label}</strong><small>{item.caption}</small>{active&&<em className="dock-here">You are here</em>}
    </button>})}</div>
   </div>
  </dialog>
 </>;
}
