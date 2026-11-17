// Sections of the single-page app. Retired sections (Upcoming, FMV, Community, GrailMatch) fall back to Home.
export const activeNavigation=['Home','Directory','Marketplace','Collectors','Pressing'];
export const mobileNavigation=['Home','Directory','Marketplace','Collectors'];
export function resolveSection(value:string|null):string|null{
 if(value==='Upcoming'||value==='FMV'||value==='Community'||value==='GrailMatch')return null;
 if(value==='My Profile'||value==='Collectors')return 'Collectors';
 if(value==='Comic Workshop'||value==='Pressing'||value==='Workshop')return 'Pressing';
 if(value==='Collection'||value==='My Collection')return 'Collectors'; // the collection is the profile's Collection tab
 return value&&(activeNavigation.includes(value)||value==='Messages'||value==='Orders'||value==='Wallet'||value==='Account'||value==='Settings'||value==='Rules')?value:null;
}
export function publicSection(value:string):string{
 const section=resolveSection(value);
 return section==='Collectors'?'My Profile':section==='Pressing'?'Comic Workshop':section||'Home';
}
