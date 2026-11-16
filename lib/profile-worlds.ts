// Profile worlds (themes). Phase 1 ships the Classic Huddle look; the full set arrives with the Theme screen.
export type ProfileWorld={id:string;name:string;sky:[string,string]};
export const WORLDS:readonly ProfileWorld[]=[{id:'classic',name:'Classic Huddle',sky:['#efd369','#f3c94a']}];
export const worldFor=(id:string|null|undefined)=>WORLDS.find(world=>world.id===id)||WORLDS[0];
