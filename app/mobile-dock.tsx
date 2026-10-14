'use client';
import {BookOpen,Home,Hourglass,ScanLine,ShoppingBag,User,Wrench} from 'lucide-react';
import './mobile-dock.css';

type Props={tab:string;scanOpen:boolean;onNavigate:(section:string)=>void;onScan:()=>void};
const left=[{section:'Home',label:'Home',Icon:Home},{section:'Directory',label:'Directory',Icon:BookOpen},{section:'Marketplace',label:'Marketplace',Icon:ShoppingBag}];
const right=[{section:'Collectors',label:'My Profile',Icon:User},{section:'Pressing',label:'Comic Workshop',Icon:Wrench},{section:'Upcoming',label:'Upcoming',Icon:Hourglass}];

export default function MobileDock({tab,scanOpen,onNavigate,onScan}:Props){
 const destination=(item:typeof left[number])=><button type="button" key={item.section} aria-label={item.label} aria-current={tab===item.section?'page':undefined} onClick={()=>onNavigate(item.section==='Collectors'?'My Profile':item.section)}><item.Icon size={20}/><span>{item.label}</span></button>;
 return <nav className="mobile-bottom mobile-scan-dock" aria-label="Quick mobile navigation">
  {left.map(destination)}
  <button type="button" className="scan-action" aria-label="Scan a comic" aria-haspopup="dialog" aria-expanded={scanOpen} onClick={onScan}><ScanLine size={26}/><span>SCAN</span></button>
  {right.map(destination)}
 </nav>;
}
