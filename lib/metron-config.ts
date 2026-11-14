// Dependency-free Metron settings so read paths can import them without cycles.
export const METRON_COVER_HOST='static.metron.cloud';
/** Reads METRON_API_TOKEN, METRON_UPC_ENABLED, COVER_DIRECT_DISPLAY, METRON_DAILY_BUDGET, METRON_MINUTE_BUDGET. */
export type MetronEnv=Record<string,string|undefined>;
export function metronConfig(env:MetronEnv=process.env){
 const token=typeof env.METRON_API_TOKEN==='string'&&/^[A-Za-z0-9_.~-]{20,512}$/.test(env.METRON_API_TOKEN)?env.METRON_API_TOKEN:null;
 const bounded=(raw:string|undefined,fallback:number,max:number)=>{const value=Number(raw);return Number.isInteger(value)&&value>0?Math.min(value,max):fallback};
 return {token,upcEnabled:!!token&&env.METRON_UPC_ENABLED==='true',directCovers:!!token&&env.COVER_DIRECT_DISPLAY==='metron',
  // Defaults leave headroom under Metron's standard 20/min and 5,000/day for the nightly catalog sync.
  dailyBudget:bounded(env.METRON_DAILY_BUDGET,2000,25000),minuteBudget:bounded(env.METRON_MINUTE_BUDGET,15,20)};
}
export type MetronConfig=ReturnType<typeof metronConfig>;
/** Only exact https static.metron.cloud image URLs are ever displayed or cached. */
export function metronImageUrl(value:unknown):string|null{
 if(typeof value!=='string'||!value||value.length>1024)return null;
 try{const url=new URL(value);if(url.protocol!=='https:'||url.hostname!==METRON_COVER_HOST||url.username||url.password||url.port||url.hash)return null;return url.href}catch{return null}
}
