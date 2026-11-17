// Server side of display name / @handle changes (migration 058). Counts, the 30-day handle reservation, the 90-day
// /@old → /@new redirect, and the history log. Server-only.
import {getPool} from '../db/postgres';
import {HANDLE_CHANGE_LIMIT,HANDLE_REDIRECT_DAYS,HANDLE_RESERVE_DAYS,NAME_CHANGE_LIMIT,changesLeft,handlePattern} from './name-rules';

const missing=(error:unknown)=>['42P01','42703'].includes((error as {code?:string})?.code||'');

/** Changes used so far, or null before migration 058. */
export async function nameChangeCounts(profileId:string):Promise<{name:number;handle:number}|null>{
 try{const {rows}=await getPool().query<{name_changes:number;handle_changes:number}>('SELECT name_changes,handle_changes FROM ch_web.profiles WHERE id=$1',[profileId]);
  return rows[0]?{name:Number(rows[0].name_changes)||0,handle:Number(rows[0].handle_changes)||0}:{name:0,handle:0}}
 catch(error){if(missing(error))return null;throw error}
}
export async function changesLeftFor(profileId:string,unlimited:boolean){
 const counts=await nameChangeCounts(profileId);
 if(!counts)return {name:unlimited?null:0,handle:unlimited?null:0,ready:false};
 return {name:changesLeft(counts.name,NAME_CHANGE_LIMIT,unlimited),handle:changesLeft(counts.handle,HANDLE_CHANGE_LIMIT,unlimited),ready:true};
}
/** True when someone else gave this handle up less than 30 days ago (it's held for them). */
export async function handleHeld(handle:string,profileId:string|null){
 try{const {rows}=await getPool().query("SELECT 1 FROM ch_web.profile_name_history WHERE kind='handle' AND lower(old_value)=$1 AND ($2::text IS NULL OR profile_id<>$2) AND changed_at>now()-make_interval(days=>$3) LIMIT 1",[handle.toLowerCase(),profileId,HANDLE_RESERVE_DAYS]);return rows.length>0}
 catch(error){if(missing(error))return false;throw error}
}
/** Where /@old should go (the member's current handle) for 90 days after a change, or null. */
export async function handleRedirect(handle:string){
 if(!handlePattern.test(handle))return null;
 try{const {rows}=await getPool().query<{handle:string}>("SELECT p.handle FROM ch_web.profile_name_history h JOIN ch_web.profiles p ON p.id=h.profile_id WHERE h.kind='handle' AND lower(h.old_value)=$1 AND h.changed_at>now()-make_interval(days=>$2) AND p.visible=1 AND COALESCE(p.moderated,0)=0 AND p.deletion_started_at IS NULL AND NOT EXISTS (SELECT 1 FROM ch_web.profiles o WHERE lower(o.handle)=$1) ORDER BY h.changed_at DESC LIMIT 1",[handle.toLowerCase(),HANDLE_REDIRECT_DAYS]);
  return rows[0]&&rows[0].handle.toLowerCase()!==handle.toLowerCase()?rows[0].handle:null}
 catch{return null}
}
/** Logs a real change and (optionally) counts it against the member's limit. */
export async function recordNameChange(input:{profileId:string;kind:'name'|'handle';oldValue:string;newValue:string;changedBy:string;count:boolean}){
 const pool=getPool();
 await pool.query('INSERT INTO ch_web.profile_name_history (id,profile_id,kind,old_value,new_value,changed_by) VALUES ($1,$2,$3,$4,$5,$6)',[crypto.randomUUID(),input.profileId,input.kind,input.oldValue,input.newValue,input.changedBy]);
 if(input.count)await pool.query(`UPDATE ch_web.profiles SET ${input.kind==='name'?'name_changes=name_changes+1':'handle_changes=handle_changes+1'} WHERE id=$1`,[input.profileId]);
}
export async function resetNameChanges(profileId:string){await getPool().query('UPDATE ch_web.profiles SET name_changes=0,handle_changes=0 WHERE id=$1',[profileId])}
