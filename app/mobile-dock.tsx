'use client';
import {BookOpen,Camera,Home,ShoppingBag,User} from 'lucide-react';
import './mobile-dock.css';

type Props={tab:string;scanOpen:boolean;onNavigate:(section:string)=>void;onScan:()=>void};
const left=[{section:'Home',label:'Home',Icon:Home},{section:'Marketplace',label:'Shop',Icon:ShoppingBag}];
const right=[{section:'Directory',label:'Directory',Icon:BookOpen},{section:'Collectors',label:'Profile',Icon:User}];

export default function MobileDock({tab,scanOpen,onNavigate,onScan}:Props){
 const destination=(item:typeof left[number])=>{const active=tab===item.section||(item.section==='Collectors'&&tab==='My Profile');return <button type="button" key={item.section} aria-label={item.label} aria-current={active?'page':undefined} onClick={()=>onNavigate(item.section==='Collectors'?'My Profile':item.section)}><item.Icon size={21}/><span>{item.label}</span></button>};
 return <nav className="mobile-bottom mobile-scan-dock" aria-label="Quick mobile navigation">
  {left.map(destination)}
  <button type="button" className="scan-action" aria-label="Scan a comic" aria-haspopup="dialog" aria-expanded={scanOpen} onClick={onScan}><Camera size={24}/><span>Scan</span></button>
  {right.map(destination)}
 </nav>;
}
