// Origin story setup (Phase 6): the five panels behind the Origin Story trophy, the one-time nudge, and the
// "remind me after my next haul" snooze. Server-only. Tolerant of missing tables.
import {getPool} from '../db/postgres';
import {notify} from './notifications';
import {upsertExtras} from './profile-extras';

export type OriginStep={id:'photo'|'handle'|'cover'|'character'|'grail_world';label:string;done:boolean};
const q=async<T>(text:string,values:unknown[]):Promise<T[]>=>{try{return (await getPool().query(text,values)).rows as T[]}catch{return []}};
export async function originStory(userId:string){
 const [p]=await q<{id:string;handle:string}>('SELECT id,handle FROM ch_web.profiles WHERE user_id=$1',[userId]);
 if(!p)return {profileId:null,handle:null,steps:[] as OriginStep[],snoozed:false,earned:false,nudged:false};
 const [x]=await q<{cover_id:string|null;favorite_character_id:number|null;grail_issue_id:string|null;world:string|null;origin_nudged_at:Date|null;origin_snoozed_at:Date|null}>(`SELECT cover_id,favorite_character_id,grail_issue_id,to_jsonb(x)->>'world' AS world,to_jsonb(x)->>'origin_nudged_at' AS origin_nudged_at,to_jsonb(x)->>'origin_snoozed_at' AS origin_snoozed_at FROM ch_web.profile_extras x WHERE profile_id=$1`,[p.id]);
 const [photo]=await q<{ok:boolean}>('SELECT EXISTS(SELECT 1 FROM ch_web.profile_avatars WHERE profile_id=$1) AS ok',[p.id]);
 const [earned]=await q<{ok:boolean}>("SELECT EXISTS(SELECT 1 FROM ch_web.user_trophies WHERE user_id=$1 AND trophy='origin_story' AND earned_at IS NOT NULL AND revoked_at IS NULL) AS ok",[userId]);
 const steps:OriginStep[]=[
  {id:'photo',label:'Profile photo',done:!!photo?.ok},
  {id:'handle',label:'Handle',done:!!p.handle},
  {id:'cover',label:'Cover photo',done:!!x?.cover_id},
  {id:'character',label:'Favorite character',done:x?.favorite_character_id!=null},
  {id:'grail_world',label:'Grail + world',done:x?.grail_issue_id!=null&&!!x?.world&&x.world!=='classic'},
 ];
 return {profileId:p.id,handle:p.handle,steps,snoozed:!!x?.origin_snoozed_at,earned:!!earned?.ok,nudged:!!x?.origin_nudged_at};
}
/** Once: a 'system' notification for members whose origin story isn't earned (skipped while snoozed). */
export async function nudgeOriginStory(userId:string){
 const s=await originStory(userId);
 if(!s.profileId||s.earned||s.nudged||s.snoozed||s.steps.every(step=>step.done))return false;
 await upsertExtras({id:s.profileId,userId},[['origin_nudged_at',new Date().toISOString()]]).catch(()=>undefined);
 await notify({userId,kind:'system',title:'Your origin story is still blank!',body:`${s.steps.filter(x=>!x.done).length} panels to go. Finish it to unlock the Origin Story trophy.`,href:'/origin-story'});
 return true;
}
export async function snoozeOriginStory(userId:string){
 const s=await originStory(userId);if(!s.profileId)return;
 await upsertExtras({id:s.profileId,userId},[['origin_snoozed_at',new Date().toISOString()]]);
}
/** After a vault save that added comics: end the snooze and remind them once more. */
export async function originStoryAfterHaul(userId:string,added:number){
 if(added<=0)return;
 const s=await originStory(userId);if(!s.profileId||!s.snoozed||s.earned)return;
 await getPool().query('UPDATE ch_web.profile_extras SET origin_snoozed_at=NULL,origin_nudged_at=NULL WHERE profile_id=$1',[s.profileId]).catch(()=>undefined);
 await nudgeOriginStory(userId);
}
