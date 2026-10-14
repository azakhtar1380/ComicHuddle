import React,{useId} from 'react';
import {StyleSheet,View} from 'react-native';
import Svg,{Circle,Defs,LinearGradient,Path,Pattern,Rect,Stop} from 'react-native-svg';
export const color={canvas:'#f6f0e4',white:'#fffdf7',ink:'#1e2530',muted:'#64615d',line:'#d7cbb6',coral:'#bd332d',lilac:'#f4c958',lilacLight:'#fae8b4',mint:'#cce7df',peach:'#f3d0b4',blue:'#d0e3f2',navy:'#202938'};
export type IconName='Home'|'Directory'|'FMV'|'Marketplace'|'GrailMatch'|'Messages'|'More'|'Close'|'Arrow'|'Search'|'Scan'|'User'|'Community'|'Pressing'|'Check'|'Back'|'Auction'|'Collection';
const paths:Record<IconName,string>={
 Auction:'m14 3 7 7-4 4-7-7Z M3 14l7-7M2 22l9-9M12 20h10v2H12Z',
 Collection:'M3 5h18v15H3ZM3 9h18M8 5V2h8v3M8 13h8',
 Scan:'M7 3H3v4M17 3h4v4M21 17v4h-4M7 21H3v-4M7 7v10M10 7v10M14 7v10M17 7v10M4 12h16',
 Home:'M3 10.5 12 3l9 7.5V21h-6v-7H9v7H3Z',
 Directory:'M12 5v16M12 5C8 2 4 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-2-1-6-2-10 1Z',
 FMV:'M4 20h16M5 15l5-5 4 3 6-9M15 4h5v5',
 Marketplace:'M5 7h14l2 14H3ZM8 7V5a4 4 0 0 1 8 0v2',
 GrailMatch:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
 Messages:'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-3 3V11.5A8.5 8.5 0 0 1 9.5 3h3a8.5 8.5 0 0 1 8.5 8.5Z',
 More:'M4 6h16M4 12h16M4 18h16',Close:'m6 6 12 12M6 18 18 6',Arrow:'M5 12h14m-6-6 6 6-6 6',Search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
 User:'M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2M16 5a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
 Community:'M16 21v-2a5 5 0 0 0-5-5H7a5 5 0 0 0-5 5v2M13 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM17 3a4 4 0 0 1 0 8M22 21v-2a5 5 0 0 0-4-4.8',
 Pressing:'M4 3h16v5H4ZM4 16h16v5H4ZM7 12h10M12 8v8',Check:'m5 12 4 4L20 5',Back:'m15 5-7 7 7 7'
};
export function Icon({name,size=22,tint=color.ink}:{name:IconName;size?:number;tint?:string}){return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d={paths[name]} stroke={tint} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/></Svg>}
export function Atmosphere({tone='gold'}:{tone?:'gold'|'mint'|'peach'|'dark'}){
 const id='panel'+useId().replace(/[^a-z0-9]/gi,'');
 const colors=tone==='mint'?['#b9dcd1','#e6efe1']:tone==='peach'?['#eab388','#fae4c6']:tone==='dark'?['#344b59','#202938']:['#f0bd42','#fae8b4'];
 return <View pointerEvents="none" style={StyleSheet.absoluteFill}><Svg width="100%" height="100%" viewBox="0 0 400 300" preserveAspectRatio="none"><Defs><LinearGradient id={id} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={colors[0]}/><Stop offset="1" stopColor={colors[1]}/></LinearGradient><Pattern id={id+'dots'} width="7" height="7" patternUnits="userSpaceOnUse"><Circle cx="2" cy="2" r="1" fill={color.ink} opacity={.12}/></Pattern></Defs><Rect width="400" height="300" fill={'url(#'+id+')'}/><Path d="M300 145 200 0H260ZM300 145 350 0H400ZM300 145 400 60V105ZM300 145 400 210V270ZM300 145 340 300H275ZM300 145 110 300H175ZM300 145 0 135V70Z" fill="#fffdf7" opacity={.32}/><Rect width="400" height="300" fill={'url(#'+id+'dots)'}/><Path d="m335 75 9 36 31-20-16 33 37 9-35 13 18 31-32-18-11 36-9-35-33 18 17-33-36-9 35-12-17-33 32 19Z" fill="#fffdf7" opacity={.55}/></Svg></View>;
}
