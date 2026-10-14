// Public sections have one canonical destination. Archived feature links land
// on Upcoming, including links saved before the menu was simplified.
export const activeNavigation=['Home','Directory','Marketplace','Collectors','Pressing','Upcoming'];
export const mobileNavigation=['Home','Directory','Marketplace','Collectors','Pressing','Upcoming'];
export function resolveSection(value:string|null):string|null{
 if(value==='FMV'||value==='Community'||value==='GrailMatch')return 'Upcoming';
 if(value==='My Profile'||value==='Collectors')return 'Collectors';
 if(value==='Comic Workshop'||value==='Pressing')return 'Pressing';
 return value&&(activeNavigation.includes(value)||value==='Messages'||value==='Orders'||value==='Wallet'||value==='Account')?value:null;
}
export function publicSection(value:string):string{
 const section=resolveSection(value);
 return section==='Collectors'?'My Profile':section==='Pressing'?'Comic Workshop':section||'Home';
}
